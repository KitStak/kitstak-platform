/**
 * 3PL Billing repository (M11): contract grid, detail, create/edit, approve / cancel
 * approval, duplicate, guarded delete, and fee CRUD with tiers + conditions. Every write
 * logs field-level change_log rows on entity "billing_contract".
 */
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import { AppError, notFoundError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { assertInScope, hasClient, hasWarehouse, scopedWhere } from "@/server/auth/scope";
import * as s from "@/server/db/schema";
import { runBulk } from "@/server/domain/bulk";
import type { BulkResult } from "@/server/domain/types";
import { paginate } from "@/server/query/paginate";
import type { GridQuery } from "@/server/query/grid-query";
import {
  BILLING_FIELDS, BILLING_SEARCH_FIELDS, BILLING_SORT_FIELDS, chargeUnit, conditionText, periodEnd, type ContractSave, type FeeSave,
  splitOneTime, withOneTime, PRICING_MODE_META, type PricingMode,
} from "@/lib/grid-defs/organization/billing";
import { round } from "@/lib/grid-defs/organization/common";
import { assertVersion, compileGrid, domainCtxOf, logCreate, logDelete, logUpdate, namesOf, type Actor, type GridBinding } from "./clients-shared";

const c = s.billingContracts;
const f = s.billingFees;
export const CONTRACT_ENTITY = "billing_contract";

/**
 * Contract-level change-log entry with an exact message (fee names are kept verbatim;
 * the generic field diff would humanize "PickPack" into "Pick Pack").
 */
export function logContractEvent(tx: AppDb, ctx: { userId: string | null; source: string }, contractId: string, contractName: string,
  ev: { type: "Create" | "Update" | "Delete"; message: string; field?: string; label?: string; from?: string; to?: string }): void {
  tx.insert(s.changeLog).values({
    entityType: CONTRACT_ENTITY, entityId: contractId, entityCode: contractName, type: ev.type, field: ev.field ?? null, fieldLabel: ev.label ?? null,
    fromValue: ev.from ?? null, toValue: ev.to ?? null, message: ev.message, userId: ctx.userId, source: ctx.source,
  }).run();
}

const clientNameSql = sql<string>`(SELECT cl.name FROM clients cl WHERE cl.id = billing_contracts.client_id)`;
const warehouseCodeSql = sql<string>`(SELECT w.code FROM warehouses w WHERE w.id = billing_contracts.warehouse_id)`;
const createdByNameSql = sql<string>`(SELECT u.name FROM users u WHERE u.id = billing_contracts.created_by)`;
const feeCountSql = sql<number>`(SELECT COUNT(*) FROM billing_fees bf WHERE bf.contract_id = billing_contracts.id)`;
const reportCountSql = sql<number>`(SELECT COUNT(*) FROM billing_reports br WHERE br.contract_id = billing_contracts.id AND br.bill_status <> 'Canceled' AND br.calc_status <> 'Failed')`;
/** Last calculation = the latest successful, non-canceled bill (a failed run or a deleted bill never stamps it). */
const lastCalcSql = sql<string | null>`(SELECT MAX(br.calculated_at) FROM billing_reports br WHERE br.contract_id = billing_contracts.id AND br.bill_status <> 'Canceled' AND br.calc_status = 'Successful')`;

const BINDING: GridBinding = {
  exprs: {
    name: sql`${c.name}`, clientId: sql`${c.clientId}`, warehouseId: sql`${c.warehouseId}`, approvalStatus: sql`${c.approvalStatus}`,
    frequency: sql`${c.frequency}`, calcStartDate: sql`${c.calcStartDate}`, lastCalculatedAt: lastCalcSql, createdAt: sql`${c.createdAt}`,
    nextPeriodStart: sql`${c.nextPeriodStart}`, clientName: clientNameSql, warehouseCode: warehouseCodeSql, createdByName: createdByNameSql, feeCount: feeCountSql,
  },
  fields: BILLING_FIELDS, sortable: BILLING_SORT_FIELDS, search: BILLING_SEARCH_FIELDS,
  defaultSort: [{ field: "createdAt", dir: "desc" }], tiebreaker: c.id,
};

export interface ContractRow {
  readonly id: string;
  readonly name: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly approvalStatus: "Draft" | "Approved";
  readonly calcStartDate: string;
  readonly lastCalculatedAt: string | null;
  readonly frequency: (typeof c.$inferSelect)["frequency"];
  readonly nextPeriodStart: string | null;
  readonly createdByName: string | null;
  readonly createdAt: string;
  readonly feeCount: number;
  readonly reportCount: number;
  readonly version: number;
}

const ROW = {
  id: c.id, name: c.name, clientId: c.clientId, clientName: clientNameSql, warehouseId: c.warehouseId, warehouseCode: warehouseCodeSql,
  approvalStatus: c.approvalStatus, calcStartDate: c.calcStartDate, lastCalculatedAt: lastCalcSql, frequency: c.frequency,
  nextPeriodStart: c.nextPeriodStart, createdByName: createdByNameSql, createdAt: c.createdAt, feeCount: feeCountSql, reportCount: reportCountSql, version: c.version,
};

export const contractScope = (auth: AuthContext, view = true): SQL | undefined => scopedWhere(c, view ? auth.viewScope : auth.scope);

export function listContracts(db: AppDb, auth: AuthContext, query: GridQuery): { rows: ContractRow[]; total: number } {
  const grid = compileGrid(BINDING, query, [contractScope(auth)]);
  const result = paginate(db.select(ROW).from(c).where(grid.where).orderBy(...grid.orderBy).$dynamic(),
    () => db.select({ n: sql<number>`count(*)` }).from(c).where(grid.where).get()?.n ?? 0, { page: query.page, pageSize: query.pageSize });
  return { rows: result.rows as ContractRow[], total: result.total };
}

export function loadContract(db: AppDb, auth: AuthContext, id: string): typeof c.$inferSelect {
  const row = db.select().from(c).where(eq(c.id, id)).get();
  assertInScope(auth.scope, row, "Billing contract");
  return row!;
}

export interface FeeView {
  readonly id: string;
  readonly name: string;
  readonly operationType: (typeof f.$inferSelect)["operationType"];
  readonly calculationType: (typeof f.$inferSelect)["calculationType"];
  readonly feeBy: string;
  readonly chargeBy: string;
  readonly vasTypeId: string | null;
  readonly vasTypeName: string | null;
  readonly useMinPrice: boolean;
  readonly minPrice: number | null;
  readonly useMaxPrice: boolean;
  readonly maxPrice: number | null;
  readonly splitDay: number | null;
  readonly standardRate: number | null;
  readonly alternateRate: number | null;
  readonly chargeOneTime: boolean;
  readonly pricingMode: PricingMode;
  readonly conditions: readonly { field: string; comparator: string; value: unknown; text: string }[];
  readonly tiers: readonly { id: string; fromQty: number | null; toQty: number | null; rate: number }[];
  readonly priceStrip: string;
  readonly createdAt: string;
}

export function feesOf(db: AppDb, contractId: string): FeeView[] {
  const fees = db.select().from(f).where(eq(f.contractId, contractId)).orderBy(asc(f.createdAt), asc(f.id)).all();
  if (fees.length === 0) return [];
  const tiers = db.select().from(s.billingFeeTiers).where(inArray(s.billingFeeTiers.feeId, fees.map((x) => x.id))).orderBy(asc(s.billingFeeTiers.fromQty)).all();
  const vas = namesOf(db, "lookup_values", fees.map((x) => x.vasTypeId));
  return fees.map((fee) => {
    const own = tiers.filter((t) => t.feeId === fee.id).map((t) => ({ id: t.id, fromQty: t.fromQty, toQty: t.toQty, rate: t.rate }));
    const rate = fee.calculationType === "Split Month Storage" ? fee.standardRate ?? 0 : own[0]?.rate ?? fee.standardRate ?? 0;
    const strip = own.length > 1 ? `${own.length} tiers from ${rate.toFixed(2)} per ${chargeUnit(fee.chargeBy)}` : `${rate.toFixed(2)} per ${chargeUnit(fee.chargeBy)}`;
    return {
      id: fee.id, name: fee.name, operationType: fee.operationType, calculationType: fee.calculationType, feeBy: fee.feeBy, chargeBy: fee.chargeBy,
      vasTypeId: fee.vasTypeId, vasTypeName: fee.vasTypeId ? vas.get(fee.vasTypeId) ?? null : null, useMinPrice: Boolean(fee.useMinPrice), minPrice: fee.minPrice,
      useMaxPrice: Boolean(fee.useMaxPrice), maxPrice: fee.maxPrice, splitDay: fee.splitDay, standardRate: fee.standardRate, alternateRate: fee.alternateRate,
      chargeOneTime: Boolean(fee.chargeOneTime) || splitOneTime(fee.conditions).chargeOneTime, pricingMode: splitOneTime(fee.conditions).pricingMode,
      conditions: splitOneTime(fee.conditions).conditions.map((x) => ({ ...x, text: conditionText(x) })),
      tiers: own.length ? own : [{ id: "standard", fromQty: 1, toQty: null, rate: fee.standardRate ?? 0 }], priceStrip: strip, createdAt: fee.createdAt,
    };
  });
}

export function getContract(db: AppDb, auth: AuthContext, id: string) {
  const row = loadContract(db, auth, id);
  const view = db.select(ROW).from(c).where(eq(c.id, id)).get() as ContractRow;
  const client = db.select({ currency: s.clients.currency }).from(s.clients).where(eq(s.clients.id, row.clientId)).get();
  const lastReport = db.select({ id: s.billingReports.id, billNumber: s.billingReports.billNumber, totalPrice: s.billingReports.totalPrice, billStatus: s.billingReports.billStatus, calculatedAt: s.billingReports.calculatedAt })
    .from(s.billingReports).where(and(eq(s.billingReports.contractId, id), sql`${s.billingReports.billStatus} <> 'Canceled'`, eq(s.billingReports.calcStatus, "Successful")))
    .orderBy(sql`${s.billingReports.calculatedAt} DESC`).limit(1).get() ?? null;
  return { ...view, currency: client?.currency ?? "USD", fees: feesOf(db, id), lastReport };
}
export type ContractDetail = ReturnType<typeof getContract>;

function assertWritableScope(auth: AuthContext, input: { clientId: string; warehouseId: string }): void {
  if (!hasWarehouse(auth.scope, input.warehouseId)) throw new AppError("VALIDATION", "Choose a warehouse you have access to", { fieldErrors: { warehouseId: ["Choose a warehouse you have access to"] } });
  if (!hasClient(auth.scope, input.clientId)) throw new AppError("VALIDATION", "Choose a client you have access to", { fieldErrors: { clientId: ["Choose a client you have access to"] } });
}

function display(db: AppDb, row: typeof c.$inferSelect): Record<string, unknown> {
  const cl = namesOf(db, "clients", [row.clientId]);
  const wh = namesOf(db, "warehouses", [row.warehouseId]);
  return { name: row.name, clientId: cl.get(row.clientId) ?? "", warehouseId: wh.get(row.warehouseId) ?? "", calcStartDate: row.calcStartDate, frequency: row.frequency, approvalStatus: row.approvalStatus };
}

function assertNameFree(db: AppDb, clientId: string, name: string, exceptId?: string): void {
  const clash = db.select({ id: c.id }).from(c).where(and(eq(c.clientId, clientId), sql`lower(${c.name}) = lower(${name})`)).get();
  if (clash && clash.id !== exceptId) throw new AppError("DUPLICATE", `A billing form named ${name} already exists for this client`, { fieldErrors: { name: ["This client already has a billing form with this name"] } });
}

export function createContract(tx: AppDb, auth: AuthContext, actor: Actor, input: ContractSave): { id: string; name: string } {
  assertWritableScope(auth, input);
  const client = tx.select({ status: s.clients.status }).from(s.clients).where(eq(s.clients.id, input.clientId)).get();
  if (!client) throw notFoundError("Client");
  if (client.status !== "Active") throw new AppError("VALIDATION", "This client is inactive", { fieldErrors: { clientId: ["This client is inactive"] } });
  assertNameFree(tx, input.clientId, input.name.trim());
  const row = tx.insert(c).values({
    name: input.name.trim(), clientId: input.clientId, warehouseId: input.warehouseId, calcStartDate: input.calcStartDate, frequency: input.frequency,
    approvalStatus: "Draft", nextPeriodStart: periodEnd(input.calcStartDate, input.frequency), createdBy: actor.userId, updatedBy: actor.userId,
  }).returning({ id: c.id, name: c.name }).get();
  logCreate(tx, domainCtxOf(actor, auth), CONTRACT_ENTITY, row.id, row.name);
  return row;
}

export function updateContract(tx: AppDb, auth: AuthContext, actor: Actor, id: string, input: ContractSave): { id: string; name: string; version: number } {
  const before = loadContract(tx, auth, id);
  assertVersion(before.version, input.version);
  assertWritableScope(auth, input);
  assertNameFree(tx, input.clientId, input.name.trim(), id);
  const reports = tx.select({ n: sql<number>`count(*)` }).from(s.billingReports).where(eq(s.billingReports.contractId, id)).get()?.n ?? 0;
  if (reports > 0 && (input.clientId !== before.clientId || input.warehouseId !== before.warehouseId)) {
    throw new AppError("VALIDATION", "Client and warehouse are locked once bills exist", { fieldErrors: { clientId: ["Locked: this contract already has bills"] } });
  }
  // The schedule is fixed by live bills: changing it would re-align every future period against bills already issued.
  if ((input.calcStartDate !== before.calcStartDate || input.frequency !== before.frequency) && liveBillCount(tx, id) > 0) {
    const fieldErrors: Record<string, string[]> = {};
    if (input.calcStartDate !== before.calcStartDate) fieldErrors.calcStartDate = ["Locked: this contract already has bills"];
    if (input.frequency !== before.frequency) fieldErrors.frequency = ["Locked: this contract already has bills"];
    throw new AppError("VALIDATION", "Calc start date and frequency are locked once bills exist. Cancel the bills, or duplicate the contract to start a new schedule.", { fieldErrors });
  }
  const snapshot = display(tx, before);
  const after = tx.update(c).set({
    name: input.name.trim(), clientId: input.clientId, warehouseId: input.warehouseId, calcStartDate: input.calcStartDate, frequency: input.frequency,
    nextPeriodStart: before.lastCalculatedAt ? before.nextPeriodStart : periodEnd(input.calcStartDate, input.frequency), updatedBy: actor.userId, version: sql`${c.version} + 1`,
  }).where(eq(c.id, id)).returning().get();
  logUpdate(tx, domainCtxOf(actor, auth), CONTRACT_ENTITY, id, after.name, snapshot, display(tx, after));
  return { id, name: after.name, version: after.version };
}

/**
 * Another Approved contract for the same client and warehouse. Contracts are open-ended from their
 * calc start date, so any two approved for one client/warehouse overlap and would double-bill.
 */
export function approvedRival(db: AppDb, row: { id: string; clientId: string; warehouseId: string }): { id: string; name: string; calcStartDate: string } | undefined {
  return db.select({ id: c.id, name: c.name, calcStartDate: c.calcStartDate }).from(c)
    .where(and(eq(c.clientId, row.clientId), eq(c.warehouseId, row.warehouseId), eq(c.approvalStatus, "Approved"), sql`${c.id} <> ${row.id}`)).get() ?? undefined;
}

/** Bills that fix the contract's schedule: Successful and not Canceled. */
function liveBillCount(db: AppDb, contractId: string): number {
  return db.select({ n: sql<number>`count(*)` }).from(s.billingReports)
    .where(and(eq(s.billingReports.contractId, contractId), eq(s.billingReports.calcStatus, "Successful"), sql`${s.billingReports.billStatus} <> 'Canceled'`)).get()?.n ?? 0;
}

function setApproval(tx: AppDb, auth: AuthContext, actor: Actor, ids: readonly string[], to: "Draft" | "Approved"): BulkResult {
  const ctx = domainCtxOf(actor, auth);
  return runBulk(tx, ids, (inner, id) => {
    const row = loadContract(inner, auth, id);
    if (row.approvalStatus === to) throw new AppError("INVALID_STATE", `${row.name} is already ${to === "Approved" ? "approved" : "not approved"}`);
    if (to === "Approved") {
      const fees = inner.select({ n: sql<number>`count(*)` }).from(f).where(eq(f.contractId, id)).get()?.n ?? 0;
      if (fees === 0) throw new AppError("INVALID_STATE", `Add at least one fee to ${row.name} before approving`);
      const rival = approvedRival(inner, row);
      if (rival) throw new AppError("INVALID_STATE", `${rival.name} is already approved for this client and warehouse from ${rival.calcStartDate}. Approving ${row.name} too would bill the same activity twice; cancel that approval first.`);
    }
    inner.update(c).set({ approvalStatus: to, updatedBy: actor.userId, version: sql`${c.version} + 1` }).where(eq(c.id, id)).run();
    logUpdate(inner, ctx, CONTRACT_ENTITY, id, row.name, { approvalStatus: row.approvalStatus }, { approvalStatus: to });
  });
}

export const approveContracts = (tx: AppDb, auth: AuthContext, actor: Actor, ids: readonly string[]): BulkResult => setApproval(tx, auth, actor, ids, "Approved");
export const cancelContractApprovals = (tx: AppDb, auth: AuthContext, actor: Actor, ids: readonly string[]): BulkResult => setApproval(tx, auth, actor, ids, "Draft");

export function contractDeleteBlocker(db: AppDb, row: typeof c.$inferSelect): string | null {
  if (row.approvalStatus === "Approved") return "is approved; cancel the approval first";
  const reports = db.select({ n: sql<number>`count(*)` }).from(s.billingReports).where(and(eq(s.billingReports.contractId, row.id), sql`${s.billingReports.billStatus} <> 'Canceled'`, sql`${s.billingReports.calcStatus} <> 'Failed'`)).get()?.n ?? 0;
  if (reports > 0) return `has ${reports} ${reports === 1 ? "bill" : "bills"}`;
  return null;
}

export function deleteContracts(tx: AppDb, auth: AuthContext, actor: Actor, ids: readonly string[]): BulkResult {
  const ctx = domainCtxOf(actor, auth);
  return runBulk(tx, ids, (inner, id) => {
    const row = loadContract(inner, auth, id);
    const reason = contractDeleteBlocker(inner, row);
    if (reason) throw new AppError("INVALID_STATE", `${row.name} ${reason}`);
    const reports = inner.select({ id: s.billingReports.id }).from(s.billingReports).where(eq(s.billingReports.contractId, id)).all().map((r) => r.id);
    if (reports.length) inner.delete(s.billingReports).where(inArray(s.billingReports.id, reports)).run();
    inner.delete(c).where(eq(c.id, id)).run();
    logDelete(inner, ctx, CONTRACT_ENTITY, id, row.name);
  });
}

function copyName(db: AppDb, clientId: string, name: string): string {
  for (let i = 1; i < 100; i += 1) {
    const suffix = i === 1 ? " (copy)" : ` (copy ${i})`;
    // Names cap at 100 (Logiwa round-trip): trim the base so the suffix always fits.
    const candidate = `${name.slice(0, 100 - suffix.length).trimEnd()}${suffix}`;
    const clash = db.select({ id: c.id }).from(c).where(and(eq(c.clientId, clientId), sql`lower(${c.name}) = lower(${candidate})`)).get();
    if (!clash) return candidate;
  }
  const tail = ` (copy ${Date.now()})`;
  return `${name.slice(0, 100 - tail.length).trimEnd()}${tail}`;
}

/** Copies the contract header (as Draft) with every fee, tier and condition. */
export function duplicateContracts(tx: AppDb, auth: AuthContext, actor: Actor, ids: readonly string[]): BulkResult & { created: { id: string; name: string }[]; warnings: string[] } {
  const createdRows: { id: string; name: string }[] = [];
  const warnings: string[] = [];
  const ctx = domainCtxOf(actor, auth);
  const result = runBulk(tx, ids, (inner, id) => {
    const row = loadContract(inner, auth, id);
    const name = copyName(inner, row.clientId, row.name);
    const copy = inner.insert(c).values({
      name, clientId: row.clientId, warehouseId: row.warehouseId, calcStartDate: row.calcStartDate, frequency: row.frequency, approvalStatus: "Draft",
      nextPeriodStart: periodEnd(row.calcStartDate, row.frequency), createdBy: actor.userId, updatedBy: actor.userId,
    }).returning({ id: c.id, name: c.name }).get();
    for (const fee of inner.select().from(f).where(eq(f.contractId, id)).all()) {
      const { id: feeId, contractId: _c, createdAt: _a, updatedAt: _u, version: _v, ...rest } = fee;
      void _c; void _a; void _u; void _v;
      const newFee = inner.insert(f).values({ ...rest, contractId: copy.id, createdBy: actor.userId, updatedBy: actor.userId }).returning({ id: f.id }).get();
      const tiers = inner.select().from(s.billingFeeTiers).where(eq(s.billingFeeTiers.feeId, feeId)).all();
      if (tiers.length) inner.insert(s.billingFeeTiers).values(tiers.map((t) => ({ feeId: newFee.id, fromQty: t.fromQty, toQty: t.toQty, rate: t.rate, percentage: t.percentage }))).run();
    }
    logCreate(inner, ctx, CONTRACT_ENTITY, copy.id, copy.name);
    createdRows.push(copy);
    if (approvedRival(inner, { ...row, id: copy.id })) {
      warnings.push(`${copy.name} is a Draft copy; ${row.name} stays approved. Cancel that approval before approving the copy, or both would bill the same activity.`);
    }
  });
  return { ...result, created: createdRows, warnings };
}

/* ---------------- fees ---------------- */

function feeColumns(input: FeeSave) {
  const split = input.operationType === "Storage" && input.calculationType === "Split Month Storage";
  return {
    name: input.name.trim(), operationType: input.operationType, calculationType: input.operationType === "Storage" ? input.calculationType ?? null : null,
    feeBy: input.feeBy, chargeBy: input.chargeBy, vasTypeId: input.operationType === "VAS" ? input.vasTypeId ?? null : null,
    useMinPrice: input.useMinPrice, minPrice: input.useMinPrice ? round(input.minPrice ?? 0) : null,
    useMaxPrice: input.useMaxPrice, maxPrice: input.useMaxPrice ? round(input.maxPrice ?? 0) : null,
    splitDay: split ? input.splitDay ?? 15 : null,
    standardRate: split ? round(input.standardRate ?? 0, 4) : round(input.tiers[0]?.rate ?? 0, 4),
    alternateRate: split ? round(input.alternateRate ?? 0, 4) : null,
    chargeOneTime: input.operationType === "Recurring" && input.chargeOneTime,
    conditions: withOneTime(input.conditions, false, split ? undefined : input.pricingMode) as typeof input.conditions,
  };
}

function feeSummary(input: FeeSave): string {
  const split = input.calculationType === "Split Month Storage";
  const price = split ? `${(input.standardRate ?? 0).toFixed(2)}/${(input.alternateRate ?? 0).toFixed(2)} split day ${input.splitDay}`
    : `${PRICING_MODE_META[input.pricingMode ?? "graduated"].title}: ${input.tiers.map((t) => `${t.fromQty}–${t.toQty ?? "∞"} @ ${t.rate.toFixed(2)}`).join("; ")}`;
  const calc = input.calculationType ? ` · ${input.calculationType}` : "";
  const mm = [input.useMinPrice ? `min ${input.minPrice}` : "", input.useMaxPrice ? `max ${input.maxPrice}` : ""].filter(Boolean).join(", ");
  const once = input.operationType === "Recurring" && input.chargeOneTime ? " · charge one time" : "";
  const cond = input.conditions.length ? ` · if ${input.conditions.map(conditionText).join(" and ")}` : "";
  return `${input.operationType}${calc} · ${input.feeBy} · ${input.chargeBy} · ${price}${mm ? ` (${mm})` : ""}${once}${cond}`;
}

function assertFeeName(db: AppDb, contractId: string, name: string, exceptId?: string): void {
  const clash = db.select({ id: f.id }).from(f).where(and(eq(f.contractId, contractId), sql`lower(${f.name}) = lower(${name})`)).get();
  if (clash && clash.id !== exceptId) throw new AppError("DUPLICATE", `This contract already has a fee named ${name}`, { fieldErrors: { name: ["A fee with this name already exists"] } });
}

function assertVasType(db: AppDb, input: FeeSave): void {
  if (input.operationType !== "VAS" || !input.vasTypeId) return;
  const lv = db.select({ id: s.lookupValues.id }).from(s.lookupValues).where(and(eq(s.lookupValues.id, input.vasTypeId), eq(s.lookupValues.type, "vas_type"))).get();
  if (!lv) throw new AppError("VALIDATION", "Choose a VAS type", { fieldErrors: { vasTypeId: ["Choose a VAS type"] } });
}

function writeTiers(tx: AppDb, feeId: string, input: FeeSave): void {
  tx.delete(s.billingFeeTiers).where(eq(s.billingFeeTiers.feeId, feeId)).run();
  if (input.calculationType === "Split Month Storage") return;
  tx.insert(s.billingFeeTiers).values(input.tiers.map((t) => ({ feeId, fromQty: t.fromQty, toQty: t.toQty, rate: round(t.rate, 4) }))).run();
}

function lockedForFees(row: typeof c.$inferSelect): void {
  if (row.approvalStatus === "Approved") throw new AppError("INVALID_STATE", "Cancel the approval before changing fees");
}

export function createFee(tx: AppDb, auth: AuthContext, actor: Actor, contractId: string, input: FeeSave): { id: string; name: string } {
  const contract = loadContract(tx, auth, contractId);
  lockedForFees(contract);
  assertFeeName(tx, contractId, input.name.trim());
  assertVasType(tx, input);
  const row = tx.insert(f).values({ ...feeColumns(input), contractId, createdBy: actor.userId, updatedBy: actor.userId }).returning({ id: f.id, name: f.name }).get();
  writeTiers(tx, row.id, input);
  tx.update(c).set({ updatedBy: actor.userId, version: sql`${c.version} + 1` }).where(eq(c.id, contractId)).run();
  logContractEvent(tx, domainCtxOf(actor, auth), contractId, contract.name, { type: "Create", field: "fee", label: `Fee ${row.name}`, to: feeSummary(input), message: `Fee ${row.name} is created. ${feeSummary(input)}` });
  return row;
}

function loadFee(db: AppDb, contractId: string, feeId: string): typeof f.$inferSelect {
  const fee = db.select().from(f).where(and(eq(f.id, feeId), eq(f.contractId, contractId))).get();
  if (!fee) throw notFoundError("Fee");
  return fee;
}

function storedFeeSummary(db: AppDb, fee: typeof f.$inferSelect): string {
  const tiers = db.select().from(s.billingFeeTiers).where(eq(s.billingFeeTiers.feeId, fee.id)).orderBy(asc(s.billingFeeTiers.fromQty)).all();
  return feeSummary({
    name: fee.name, operationType: fee.operationType, calculationType: fee.calculationType, feeBy: fee.feeBy, chargeBy: fee.chargeBy, vasTypeId: fee.vasTypeId,
    useMinPrice: Boolean(fee.useMinPrice), minPrice: fee.minPrice, useMaxPrice: Boolean(fee.useMaxPrice), maxPrice: fee.maxPrice, splitDay: fee.splitDay,
    standardRate: fee.standardRate, alternateRate: fee.alternateRate, ...splitOneTime(fee.conditions),
    chargeOneTime: Boolean(fee.chargeOneTime) || splitOneTime(fee.conditions).chargeOneTime,
    tiers: tiers.length ? tiers.map((t) => ({ fromQty: t.fromQty ?? 0, toQty: t.toQty, rate: t.rate })) : [{ fromQty: 1, toQty: null, rate: fee.standardRate ?? 0 }],
  });
}

export function updateFee(tx: AppDb, auth: AuthContext, actor: Actor, contractId: string, feeId: string, input: FeeSave): { id: string; name: string } {
  const contract = loadContract(tx, auth, contractId);
  lockedForFees(contract);
  const before = loadFee(tx, contractId, feeId);
  assertFeeName(tx, contractId, input.name.trim(), feeId);
  assertVasType(tx, input);
  const old = storedFeeSummary(tx, before);
  tx.update(f).set({ ...feeColumns(input), updatedBy: actor.userId, version: sql`${f.version} + 1` }).where(eq(f.id, feeId)).run();
  writeTiers(tx, feeId, input);
  tx.update(c).set({ updatedBy: actor.userId, version: sql`${c.version} + 1` }).where(eq(c.id, contractId)).run();
  const label = before.name === input.name.trim() ? `Fee ${before.name}` : `Fee ${before.name} → ${input.name.trim()}`;
  const now = feeSummary(input);
  if (old !== now || before.name !== input.name.trim()) logContractEvent(tx, domainCtxOf(actor, auth), contractId, contract.name, { type: "Update", field: "fee", label, from: old, to: now, message: `${label} is modified. ${old} --> ${now}` });
  return { id: feeId, name: input.name.trim() };
}

export function deleteFee(tx: AppDb, auth: AuthContext, actor: Actor, contractId: string, feeId: string): { id: string } {
  const contract = loadContract(tx, auth, contractId);
  lockedForFees(contract);
  const fee = loadFee(tx, contractId, feeId);
  const old = storedFeeSummary(tx, fee);
  tx.delete(f).where(eq(f.id, feeId)).run();
  tx.update(c).set({ updatedBy: actor.userId, version: sql`${c.version} + 1` }).where(eq(c.id, contractId)).run();
  logContractEvent(tx, domainCtxOf(actor, auth), contractId, contract.name, { type: "Delete", field: "fee", label: `Fee ${fee.name}`, from: old, message: `Fee ${fee.name} is deleted.` });
  return { id: feeId };
}

/** Contracts of one client (client detail "Billing contracts" tab). */
export function contractsForClient(db: AppDb, auth: AuthContext, clientId: string): ContractRow[] {
  return db.select(ROW).from(c).where(and(eq(c.clientId, clientId), contractScope(auth, false))).orderBy(asc(c.name)).all() as ContractRow[];
}
