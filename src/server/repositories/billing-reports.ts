/**
 * Billing Report repository (M11): bill grid, detail (header strip + consolidated lines),
 * detailed-line grid, Edit Info (bill number / status), bulk Approve / Cancel, Draft-only
 * delete, and the Calculate command that runs the billing engine for chosen contracts.
 */
import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { AppDb } from "@/server/api/db";
import { AppError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { assertInScope, scopedWhere } from "@/server/auth/scope";
import * as s from "@/server/db/schema";
import { runBulk } from "@/server/domain/bulk";
import type { BulkResult } from "@/server/domain/types";
import { paginate } from "@/server/query/paginate";
import type { GridQuery } from "@/server/query/grid-query";
import { lastClosedPeriod, periodContaining } from "@/lib/grid-defs/organization/billing";
import {
  BILLING_LINE_FIELDS, BILLING_LINE_SEARCH_FIELDS, BILLING_LINE_SORT_FIELDS, BILLING_REPORT_FIELDS, BILLING_REPORT_SEARCH_FIELDS, BILLING_REPORT_SORT_FIELDS,
  canTransitionBill, type BillInfoInput,
} from "@/lib/grid-defs/organization/billing-reports";
import { assertVersion, compileGrid, domainCtxOf, logDelete, logUpdate, type Actor, type GridBinding } from "./clients-shared";
import { calculateContract, type CalcResult } from "./billing-engine";
import { loadContract } from "./billing";

const r = s.billingReports;
const l = s.billingReportLines;
export const REPORT_ENTITY = "billing_report";

const contractNameSql = sql<string>`(SELECT bc.name FROM billing_contracts bc WHERE bc.id = billing_reports.contract_id)`;
const frequencySql = sql<string>`(SELECT bc.frequency FROM billing_contracts bc WHERE bc.id = billing_reports.contract_id)`;
const clientNameSql = sql<string>`(SELECT cl.name FROM clients cl WHERE cl.id = billing_reports.client_id)`;
const warehouseCodeSql = sql<string>`(SELECT w.code FROM warehouses w WHERE w.id = billing_reports.warehouse_id)`;
const createdByNameSql = sql<string | null>`(SELECT u.name FROM users u WHERE u.id = billing_reports.created_by)`;

const BINDING: GridBinding = {
  exprs: {
    billNumber: sql`${r.billNumber}`, contractName: contractNameSql, clientId: sql`${r.clientId}`, warehouseId: sql`${r.warehouseId}`, billStatus: sql`${r.billStatus}`,
    calcStatus: sql`${r.calcStatus}`, createdAt: sql`${r.createdAt}`, periodStart: sql`${r.periodStart}`, periodEnd: sql`${r.periodEnd}`, totalPrice: sql`${r.totalPrice}`,
    exportedToIntegration: sql`${r.exportedToIntegration}`, clientName: clientNameSql, warehouseCode: warehouseCodeSql, calculatedAt: sql`${r.calculatedAt}`, createdByName: createdByNameSql,
  },
  fields: BILLING_REPORT_FIELDS, sortable: BILLING_REPORT_SORT_FIELDS, search: BILLING_REPORT_SEARCH_FIELDS,
  defaultSort: [{ field: "calculatedAt", dir: "desc" }], tiebreaker: r.id,
};

const ROW = {
  id: r.id, contractId: r.contractId, contractName: contractNameSql, billNumber: r.billNumber, calcStatus: r.calcStatus, clientId: r.clientId, clientName: clientNameSql,
  warehouseId: r.warehouseId, warehouseCode: warehouseCodeSql, calculatedAt: r.calculatedAt, createdByName: createdByNameSql, periodStart: r.periodStart, periodEnd: r.periodEnd,
  billStatus: r.billStatus, totalPrice: r.totalPrice, currency: r.currency, exportedToIntegration: r.exportedToIntegration, errorMessage: r.errorMessage, frequency: frequencySql,
  createdAt: r.createdAt, version: r.version,
};

export interface ReportRow {
  readonly id: string;
  readonly contractId: string;
  readonly contractName: string;
  readonly billNumber: string;
  readonly calcStatus: "Successful" | "Failed";
  readonly clientId: string;
  readonly clientName: string;
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly calculatedAt: string;
  readonly createdByName: string | null;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly billStatus: "Draft" | "Approved" | "Canceled";
  readonly totalPrice: number;
  readonly currency: string;
  readonly exportedToIntegration: boolean;
  readonly errorMessage: string | null;
  readonly frequency: string;
  readonly createdAt: string;
  readonly version: number;
}

const reportScope = (auth: AuthContext): SQL | undefined => scopedWhere(r, auth.viewScope);

const fix = (row: ReportRow): ReportRow => ({ ...row, exportedToIntegration: Boolean(row.exportedToIntegration) });

export function listReports(db: AppDb, auth: AuthContext, query: GridQuery, contractId?: string | null): { rows: ReportRow[]; total: number } {
  const grid = compileGrid(BINDING, query, [reportScope(auth), contractId ? eq(r.contractId, contractId) : undefined]);
  const result = paginate(db.select(ROW).from(r).where(grid.where).orderBy(...grid.orderBy).$dynamic(),
    () => db.select({ n: sql<number>`count(*)` }).from(r).where(grid.where).get()?.n ?? 0, { page: query.page, pageSize: query.pageSize });
  return { rows: (result.rows as ReportRow[]).map(fix), total: result.total };
}

export function loadReport(db: AppDb, auth: AuthContext, id: string): typeof r.$inferSelect {
  const row = db.select().from(r).where(eq(r.id, id)).get();
  assertInScope(auth.scope, row, "Bill");
  return row!;
}

export function getReport(db: AppDb, auth: AuthContext, id: string) {
  loadReport(db, auth, id);
  const row = fix(db.select(ROW).from(r).where(eq(r.id, id)).get() as ReportRow);
  const consolidated = db.select().from(l).where(and(eq(l.reportId, id), eq(l.isDetail, false))).orderBy(asc(l.feeName), asc(l.fromQty)).all();
  const counts = db.select({ n: sql<number>`count(*)` }).from(l).where(and(eq(l.reportId, id), eq(l.isDetail, true))).get()?.n ?? 0;
  return { ...row, consolidated, detailCount: counts };
}
export type ReportDetail = ReturnType<typeof getReport>;

const LINE_BINDING: GridBinding = {
  exprs: {
    feeName: sql`${l.feeName}`, operationType: sql`${l.operationType}`, sku: sql`${l.sku}`, referenceNumber: sql`${l.referenceNumber}`, lpNumber: sql`${l.lpNumber}`,
    activityDate: sql`${l.activityDate}`, quantity: sql`${l.quantity}`, adjustedPrice: sql`${l.adjustedPrice}`, unitPrice: sql`${l.unitPrice}`, totalPrice: sql`${l.totalPrice}`,
  },
  fields: BILLING_LINE_FIELDS, sortable: BILLING_LINE_SORT_FIELDS, search: BILLING_LINE_SEARCH_FIELDS,
  defaultSort: [{ field: "feeName", dir: "asc" }, { field: "activityDate", dir: "asc" }], tiebreaker: l.id,
};

export function listReportLines(db: AppDb, auth: AuthContext, reportId: string, query: GridQuery) {
  loadReport(db, auth, reportId);
  const grid = compileGrid(LINE_BINDING, query, [eq(l.reportId, reportId), eq(l.isDetail, true)]);
  const frequency = db.select({ f: frequencySql }).from(r).where(eq(r.id, reportId)).get()?.f ?? "";
  const result = paginate(db.select().from(l).where(grid.where).orderBy(...grid.orderBy).$dynamic(),
    () => db.select({ n: sql<number>`count(*)` }).from(l).where(grid.where).get()?.n ?? 0, { page: query.page, pageSize: query.pageSize });
  return { rows: result.rows.map((x) => ({ ...x, billingFrequency: frequency })), total: result.total };
}

export function updateReportInfo(tx: AppDb, auth: AuthContext, actor: Actor, id: string, input: BillInfoInput) {
  const before = loadReport(tx, auth, id);
  assertVersion(before.version, input.version);
  if (!canTransitionBill(before.billStatus, input.billStatus)) throw new AppError("INVALID_STATE", `A ${before.billStatus.toLowerCase()} bill can't move to ${input.billStatus}`, { fieldErrors: { billStatus: [`Not allowed from ${before.billStatus}`] } });
  if (input.billStatus === "Approved" && before.calcStatus === "Failed") throw new AppError("INVALID_STATE", "A failed calculation can't be approved; calculate again", { fieldErrors: { billStatus: ["Failed bills can't be approved"] } });
  const clash = tx.select({ id: r.id }).from(r).where(eq(r.billNumber, input.billNumber.trim())).get();
  if (clash && clash.id !== id) throw new AppError("DUPLICATE", "Another bill already uses this number", { fieldErrors: { billNumber: ["Another bill already uses this number"] } });
  const after = tx.update(r).set({ billNumber: input.billNumber.trim(), billStatus: input.billStatus, updatedBy: actor.userId, version: sql`${r.version} + 1` }).where(eq(r.id, id)).returning().get();
  logUpdate(tx, domainCtxOf(actor, auth), REPORT_ENTITY, id, after.billNumber, { billNumber: before.billNumber, billStatus: before.billStatus }, { billNumber: after.billNumber, billStatus: after.billStatus });
  return { id, billNumber: after.billNumber, billStatus: after.billStatus, version: after.version };
}

function setStatus(tx: AppDb, auth: AuthContext, actor: Actor, ids: readonly string[], to: "Approved" | "Canceled"): BulkResult {
  const ctx = domainCtxOf(actor, auth);
  return runBulk(tx, ids, (inner, id) => {
    const row = loadReport(inner, auth, id);
    if (row.billStatus === to) throw new AppError("INVALID_STATE", `Bill ${row.billNumber} is already ${to.toLowerCase()}`);
    if (!canTransitionBill(row.billStatus, to)) throw new AppError("INVALID_STATE", `Bill ${row.billNumber} is ${row.billStatus.toLowerCase()}`);
    if (to === "Approved" && row.calcStatus === "Failed") throw new AppError("INVALID_STATE", `Bill ${row.billNumber} failed to calculate`);
    inner.update(r).set({ billStatus: to, updatedBy: actor.userId, version: sql`${r.version} + 1` }).where(eq(r.id, id)).run();
    logUpdate(inner, ctx, REPORT_ENTITY, id, row.billNumber, { billStatus: row.billStatus }, { billStatus: to });
  });
}

export const approveReports = (tx: AppDb, auth: AuthContext, actor: Actor, ids: readonly string[]): BulkResult => setStatus(tx, auth, actor, ids, "Approved");
export const cancelReports = (tx: AppDb, auth: AuthContext, actor: Actor, ids: readonly string[]): BulkResult => setStatus(tx, auth, actor, ids, "Canceled");

export function deleteReports(tx: AppDb, auth: AuthContext, actor: Actor, ids: readonly string[]): BulkResult {
  const ctx = domainCtxOf(actor, auth);
  return runBulk(tx, ids, (inner, id) => {
    const row = loadReport(inner, auth, id);
    if (row.billStatus !== "Draft") throw new AppError("INVALID_STATE", `Bill ${row.billNumber} is ${row.billStatus.toLowerCase()}; only draft bills can be deleted`);
    inner.delete(r).where(eq(r.id, id)).run();
    logDelete(inner, ctx, REPORT_ENTITY, id, row.billNumber);
  });
}

/* ---------------- calculate ---------------- */

export const calculateSchema = z.object({
  ids: z.array(z.string().trim().min(1).max(64)).min(1, "Select at least one contract").max(100, "At most 100 contracts at once"),
  mode: z.enum(["lastClosed", "current", "custom"]).default("lastClosed"),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).superRefine((v, ctx) => {
  if (v.mode !== "custom") return;
  if (!v.start) ctx.addIssue({ code: "custom", path: ["start"], message: "Start date is required" });
  if (!v.end) ctx.addIssue({ code: "custom", path: ["end"], message: "End date is required" });
  if (v.start && v.end && v.end < v.start) ctx.addIssue({ code: "custom", path: ["end"], message: "End date must be on or after the start date" });
});
export type CalculateInput = z.output<typeof calculateSchema>;

const addDay = (d: string): string => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

export function periodFor(contract: { calcStartDate: string; frequency: Parameters<typeof periodContaining>[1] }, input: Pick<CalculateInput, "mode" | "start" | "end">, today: string): { start: string; end: string } {
  if (input.mode === "custom" && input.start && input.end) return { start: input.start, end: addDay(input.end) };
  if (input.mode === "current") {
    const current = periodContaining(contract.calcStartDate, contract.frequency, today);
    return { start: current.start, end: addDay(today) < current.end ? addDay(today) : current.end };
  }
  return lastClosedPeriod(contract.calcStartDate, contract.frequency, today) ?? periodContaining(contract.calcStartDate, contract.frequency, today);
}

export function calculateContracts(tx: AppDb, auth: AuthContext, actor: Actor, input: CalculateInput, now: Date = new Date()): BulkResult & { reports: (CalcResult & { contractId: string })[] } {
  const ctx = domainCtxOf(actor, auth);
  const reports: (CalcResult & { contractId: string })[] = [];
  const today = now.toISOString().slice(0, 10);
  const result = runBulk(tx, input.ids, (inner, id) => {
    const contract = loadContract(inner, auth, id);
    const period = periodFor(contract, input, today);
    if (period.start < contract.calcStartDate) throw new AppError("INVALID_STATE", `${contract.name} starts on ${contract.calcStartDate}`);
    const out = calculateContract(inner, ctx, id, period, now);
    reports.push({ ...out, contractId: id });
  });
  return { ...result, reports };
}

/* ---------------- scheduler ---------------- */

/**
 * Billing-periods scheduler: bills every Approved contract whose last period has closed
 * (period end <= today) and has no Successful, non-canceled bill for that exact period yet.
 */
export function autoCalculateDue(db: AppDb, now: Date = new Date()): { calculated: number; failed: number; skipped: number } {
  const today = now.toISOString().slice(0, 10);
  const contracts = db.select().from(s.billingContracts).where(eq(s.billingContracts.approvalStatus, "Approved")).all();
  const ctx = { userId: null, source: "scheduler:billing-periods", scope: { warehouseIds: contracts.map((c) => c.warehouseId), clientIds: "all" as const } };
  let calculated = 0;
  let failed = 0;
  let skipped = 0;
  for (const contract of contracts) {
    const period = lastClosedPeriod(contract.calcStartDate, contract.frequency, today);
    if (!period || period.end > today) { skipped += 1; continue; }
    const existing = db.select({ id: r.id }).from(r).where(and(eq(r.contractId, contract.id), sql`substr(${r.periodStart}, 1, 10) = ${period.start}`,
      sql`${r.billStatus} <> 'Canceled'`, eq(r.calcStatus, "Successful"))).get();
    if (existing) { skipped += 1; continue; }
    const out = db.transaction((tx) => calculateContract(tx as unknown as AppDb, ctx, contract.id, period, now));
    if (out.status === "Successful") calculated += 1;
    else failed += 1;
  }
  return { calculated, failed, skipped };
}
