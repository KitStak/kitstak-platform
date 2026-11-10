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
import { lastClosedPeriod, lastDayOf, periodContaining, periodEnd as enginePeriodEnd, todayIn } from "@/lib/grid-defs/organization/billing";
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

/** Latest reason a Draft bill went stale after its calculation (e.g. a VAS operation changed); NULL when current. */
const outdatedSql = sql<string | null>`(SELECT cl.message FROM change_log cl WHERE cl.entity_type = 'billing_report' AND cl.entity_id = billing_reports.id AND cl.field = 'outdated'
  AND cl.at > billing_reports.calculated_at AND billing_reports.bill_status = 'Draft' ORDER BY cl.at DESC LIMIT 1)`;

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
  createdAt: r.createdAt, version: r.version, outdatedReason: outdatedSql,
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
  /** Set when the Draft bill no longer matches its source activity (recalculate to clear). */
  readonly outdatedReason?: string | null;
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

/** One approved bill per period: approving a bill whose period overlaps another Approved bill of the contract would bill the client twice. */
function assertNoApprovedOverlap(db: AppDb, row: { id: string; contractId: string; periodStart: string; periodEnd: string; billNumber: string }): void {
  const others = periodConflicts(db, row.contractId, row.periodStart.slice(0, 10), row.periodEnd.slice(0, 10)).filter((c) => c.reportId !== row.id);
  const other = others.find((c) => c.billStatus === "Approved") ?? others[0];
  if (other) throw new AppError("INVALID_STATE", `${other.billStatus} bill ${other.billNumber} already covers ${usDay(other.periodStart)} – ${usDay(other.periodEnd)}; bill ${row.billNumber} would bill the period twice. Cancel one of them first.`);
}

/**
 * A bill whose period has not ended yet can't be approved: approval locks the contract's VAS for
 * the period and would block the real period-end run. `allowOpenPeriod` is the explicit override
 * (the UI asks "Approve a bill for a period that is still open?" first).
 */
export function assertPeriodClosed(db: AppDb, row: { warehouseId: string; periodEnd: string; billNumber: string }, now: Date = new Date(), allowOpenPeriod = false): void {
  if (allowOpenPeriod) return;
  const today = warehouseToday(db, row.warehouseId, now);
  const end = row.periodEnd.slice(0, 10);
  if (end >= today) {
    throw new AppError("INVALID_STATE", `Bill ${row.billNumber}'s period ends ${usDay(end)} and hasn't closed yet. Approve it once the period closes, or use Approve on the bill to confirm approving an open period.`, { details: { openPeriod: true, periodEnd: end } });
  }
}

export function updateReportInfo(tx: AppDb, auth: AuthContext, actor: Actor, id: string, input: BillInfoInput) {
  const before = loadReport(tx, auth, id);
  assertVersion(before.version, input.version);
  if (!canTransitionBill(before.billStatus, input.billStatus)) throw new AppError("INVALID_STATE", `A ${before.billStatus.toLowerCase()} bill can't move to ${input.billStatus}`, { fieldErrors: { billStatus: [`Not allowed from ${before.billStatus}`] } });
  if (input.billStatus === "Approved" && before.billStatus !== "Approved") {
    assertNoApprovedOverlap(tx, before);
    assertPeriodClosed(tx, before, new Date(), input.allowOpenPeriod === true);
  }
  if (input.billStatus === "Approved" && before.calcStatus === "Failed") throw new AppError("INVALID_STATE", "A failed calculation can't be approved; calculate again", { fieldErrors: { billStatus: ["Failed bills can't be approved"] } });
  const clash = tx.select({ id: r.id }).from(r).where(eq(r.billNumber, input.billNumber.trim())).get();
  if (clash && clash.id !== id) throw new AppError("DUPLICATE", "Another bill already uses this number", { fieldErrors: { billNumber: ["Another bill already uses this number"] } });
  const after = tx.update(r).set({ billNumber: input.billNumber.trim(), billStatus: input.billStatus, updatedBy: actor.userId, version: sql`${r.version} + 1` }).where(eq(r.id, id)).returning().get();
  logUpdate(tx, domainCtxOf(actor, auth), REPORT_ENTITY, id, after.billNumber, { billNumber: before.billNumber, billStatus: before.billStatus }, { billNumber: after.billNumber, billStatus: after.billStatus });
  return { id, billNumber: after.billNumber, billStatus: after.billStatus, version: after.version };
}

function setStatus(tx: AppDb, auth: AuthContext, actor: Actor, ids: readonly string[], to: "Approved" | "Canceled", opts: { readonly allowOpenPeriod?: boolean; readonly now?: Date } = {}): BulkResult {
  const ctx = domainCtxOf(actor, auth);
  return runBulk(tx, ids, (inner, id) => {
    const row = loadReport(inner, auth, id);
    if (row.billStatus === to) throw new AppError("INVALID_STATE", `Bill ${row.billNumber} is already ${to.toLowerCase()}`);
    if (!canTransitionBill(row.billStatus, to)) throw new AppError("INVALID_STATE", `Bill ${row.billNumber} is ${row.billStatus.toLowerCase()}`);
    if (to === "Approved" && row.calcStatus === "Failed") throw new AppError("INVALID_STATE", `Bill ${row.billNumber} failed to calculate`);
    if (to === "Approved") {
      assertNoApprovedOverlap(inner, row);
      assertPeriodClosed(inner, row, opts.now ?? new Date(), opts.allowOpenPeriod === true);
    }
    inner.update(r).set({ billStatus: to, updatedBy: actor.userId, version: sql`${r.version} + 1` }).where(eq(r.id, id)).run();
    logUpdate(inner, ctx, REPORT_ENTITY, id, row.billNumber, { billStatus: row.billStatus }, { billStatus: to });
  });
}

export const approveReports = (tx: AppDb, auth: AuthContext, actor: Actor, ids: readonly string[], opts: { readonly allowOpenPeriod?: boolean; readonly now?: Date } = {}): BulkResult => setStatus(tx, auth, actor, ids, "Approved", opts);
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
  /** Preview only: returns each contract's exact period and any bills already covering it. Writes nothing. */
  dryRun: z.boolean().default(false),
  /** Cancel the Draft bills that already cover the period and bill it again (explicit user confirmation). */
  replaceDrafts: z.boolean().default(false),
}).superRefine((v, ctx) => {
  if (v.mode !== "custom") return;
  if (!v.start) ctx.addIssue({ code: "custom", path: ["start"], message: "Start date is required" });
  if (!v.end) ctx.addIssue({ code: "custom", path: ["end"], message: "End date is required" });
  if (v.start && v.end && v.end < v.start) ctx.addIssue({ code: "custom", path: ["end"], message: "End date must be on or after the start date" });
});
export type CalculateInput = Omit<z.output<typeof calculateSchema>, "dryRun" | "replaceDrafts"> & { readonly dryRun?: boolean; readonly replaceDrafts?: boolean };

const addDay = (d: string): string => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * The period a run bills, with an exclusive end. `lastClosed` returns null while the contract's
 * first period is still open: it never falls back to billing an open period (Logiwa only bills a
 * period after it has closed).
 */
export function periodFor(contract: { calcStartDate: string; frequency: Parameters<typeof periodContaining>[1] }, input: Pick<CalculateInput, "mode" | "start" | "end">, today: string): { start: string; end: string } | null {
  if (input.mode === "custom" && input.start && input.end) return { start: input.start, end: addDay(input.end) };
  if (input.mode === "current") {
    const current = periodContaining(contract.calcStartDate, contract.frequency, today);
    return { start: current.start, end: addDay(today) < current.end ? addDay(today) : current.end };
  }
  const closed = lastClosedPeriod(contract.calcStartDate, contract.frequency, today);
  return closed && closed.end <= addDay(today) ? closed : null;
}

/** M/D/YYYY for user-facing server messages (the app's default date pattern), never ISO. */
export const usDay = (ymd: string): string => {
  const [y, m, d] = ymd.slice(0, 10).split("-");
  return `${String(Number(m)).padStart(2, "0")}/${String(Number(d)).padStart(2, "0")}/${y}`;
};

export interface PeriodConflict { readonly reportId: string; readonly billNumber: string; readonly billStatus: "Draft" | "Approved"; readonly periodStart: string; readonly periodEnd: string }
export interface CalcPreview { readonly contractId: string; readonly contractName: string; readonly periodStart: string; readonly periodEnd: string; readonly today: string; readonly conflicts: readonly PeriodConflict[]; readonly blocked: string | null }

/** Successful, non-canceled bills of the contract whose period shares a day with [start, endInclusive]. */
export function periodConflicts(db: AppDb, contractId: string, start: string, endInclusive: string): PeriodConflict[] {
  return db.all<PeriodConflict>(sql`SELECT id AS reportId, bill_number AS billNumber, bill_status AS billStatus, substr(period_start, 1, 10) AS periodStart, substr(period_end, 1, 10) AS periodEnd
    FROM billing_reports WHERE contract_id = ${contractId} AND bill_status <> 'Canceled' AND calc_status = 'Successful'
      AND substr(period_start, 1, 10) <= ${endInclusive} AND substr(period_end, 1, 10) >= ${start}
    ORDER BY period_start`);
}

/** "Today" in the contract warehouse's time zone, so a preview never ends tomorrow for users west of UTC. */
function warehouseToday(db: AppDb, warehouseId: string, now: Date): string {
  const tz = db.select({ tz: s.warehouses.timezone }).from(s.warehouses).where(eq(s.warehouses.id, warehouseId)).get()?.tz;
  return todayIn(tz, now);
}

function previewOne(db: AppDb, auth: AuthContext, id: string, input: CalculateInput, now: Date): CalcPreview & { period: { start: string; end: string } } {
  const contract = loadContract(db, auth, id);
  const today = warehouseToday(db, contract.warehouseId, now);
  const resolved = periodFor(contract, input, today);
  if (!resolved) {
    // First period still open: show it, but block the run.
    const open = periodContaining(contract.calcStartDate, contract.frequency, today);
    return {
      contractId: id, contractName: contract.name, periodStart: open.start, periodEnd: lastDayOf(open.end), today, conflicts: [], period: open,
      blocked: `No closed period yet. ${contract.name}'s first period (${usDay(open.start)} – ${usDay(lastDayOf(open.end))}) closes after ${usDay(lastDayOf(open.end))}. Use "Current period to date" to bill it so far.`,
    };
  }
  const period = resolved;
  const endInclusive = lastDayOf(period.end);
  const conflicts = periodConflicts(db, id, period.start, endInclusive);
  const approved = conflicts.find((c) => c.billStatus === "Approved");
  const blocked = period.start < contract.calcStartDate ? `${contract.name} starts on ${usDay(contract.calcStartDate)}`
    : period.start > today ? `${contract.name}'s period starts after today`
    : approved ? `Approved bill ${approved.billNumber} already covers ${usDay(approved.periodStart)} – ${usDay(approved.periodEnd)}. Cancel that bill first to bill the period again.`
    : null;
  return { contractId: id, contractName: contract.name, periodStart: period.start, periodEnd: endInclusive, today, conflicts, blocked, period };
}

/** Dry run: the exact period per contract plus bills that already cover it (Calculate dialog preview). */
export function previewCalculation(db: AppDb, auth: AuthContext, input: CalculateInput, now: Date = new Date()): { previews: CalcPreview[]; failed: { id: string; code: string; message: string }[] } {
  const previews: CalcPreview[] = [];
  const failed: { id: string; code: string; message: string }[] = [];
  for (const id of new Set(input.ids)) {
    try {
      const { period: _p, ...view } = previewOne(db, auth, id, input, now);
      void _p;
      previews.push(view);
    } catch (error) {
      failed.push({ id, code: (error as { code?: string }).code ?? "INTERNAL", message: error instanceof Error ? error.message : "Couldn't preview" });
    }
  }
  return { previews, failed };
}

/**
 * Runs the engine per contract. Never double-bills: an Approved bill covering the period
 * blocks the run; Draft bills covering it block unless `replaceDrafts`, which cancels them
 * (logged as superseded) before writing the new bill. Periods end on the inclusive last day.
 */
export function calculateContracts(tx: AppDb, auth: AuthContext, actor: Actor, input: CalculateInput, now: Date = new Date()): BulkResult & { reports: (CalcResult & { contractId: string; periodStart: string; periodEnd: string; replaced: string[] })[] } {
  const ctx = domainCtxOf(actor, auth);
  const reports: (CalcResult & { contractId: string; periodStart: string; periodEnd: string; replaced: string[] })[] = [];
  const result = runBulk(tx, input.ids, (inner, id) => {
    const p = previewOne(inner, auth, id, input, now);
    if (p.blocked) throw new AppError("INVALID_STATE", p.blocked);
    // Refuse before writing anything (Logiwa parity): a fee-less contract would only produce a junk Failed bill.
    const feeCount = inner.select({ n: sql<number>`count(*)` }).from(s.billingFees).where(eq(s.billingFees.contractId, id)).get()?.n ?? 0;
    if (feeCount === 0) throw new AppError("INVALID_STATE", `${p.contractName} has no fees. Add at least one fee before calculating.`);
    // Earlier Failed bills for an overlapping period are superseded by this run.
    const failedPrior = inner.select({ id: r.id }).from(r).where(and(eq(r.contractId, id), eq(r.calcStatus, "Failed"), eq(r.billStatus, "Draft"), sql`substr(${r.periodStart}, 1, 10) = ${p.periodStart}`, sql`substr(${r.periodEnd}, 1, 10) = ${p.periodEnd}`)).orderBy(sql`${r.calculatedAt} DESC`).get();
    inner.delete(r).where(and(eq(r.contractId, id), eq(r.calcStatus, "Failed"), sql`${r.id} <> ${failedPrior?.id ?? ""}`, sql`substr(${r.periodStart}, 1, 10) <= ${p.periodEnd}`, sql`substr(${r.periodEnd}, 1, 10) >= ${p.periodStart}`)).run();
    const drafts = p.conflicts.filter((c) => c.billStatus === "Draft");
    if (drafts.length && !input.replaceDrafts) {
      throw new AppError("DUPLICATE", `Draft bill ${drafts.map((d) => d.billNumber).join(", ")} already covers ${usDay(drafts[0]!.periodStart)} – ${usDay(drafts[0]!.periodEnd)}. Confirm to replace it.`);
    }
    // Recalculate in place: the exact-period Draft (newest first) keeps its id and bill number; any other overlapping Draft is canceled.
    const keep = drafts.filter((d) => d.periodStart === p.periodStart && d.periodEnd === p.periodEnd).at(-1)?.reportId ?? failedPrior?.id;
    for (const d of drafts.filter((x) => x.reportId !== keep)) {
      inner.update(r).set({ billStatus: "Canceled", updatedBy: actor.userId, version: sql`${r.version} + 1` }).where(eq(r.id, d.reportId)).run();
      logUpdate(inner, ctx, REPORT_ENTITY, d.reportId, d.billNumber, { billStatus: "Draft" }, { billStatus: "Canceled (replaced by a new calculation)" });
    }
    const out = calculateContract(inner, ctx, id, p.period, now, { replaceReportId: keep });
    reports.push({ ...out, contractId: id, periodStart: p.periodStart, periodEnd: p.periodEnd, replaced: drafts.filter((x) => x.reportId !== keep).map((d) => d.billNumber) });
  });
  return { ...result, reports };
}

/* ---------------- data hygiene ---------------- */

/**
 * Idempotent repair of bills written by earlier engine versions: legacy 9-digit bill
 * numbers move to the 16-digit scheme, exclusive period ends (first day of the next
 * period) become the inclusive last day, duplicate bills for one contract period collapse
 * to one (Approved wins; else the newest Draft; Failed duplicates and no-fee Failed bills are removed).
 */
export function normalizeBillingReports(db: AppDb, now: Date = new Date()): { renumbered: number; periodFixed: number; canceled: number; deleted: number } {
  const out = { renumbered: 0, periodFixed: 0, canceled: 0, deleted: 0 };
  const rows = db.select({ id: r.id, contractId: r.contractId, billNumber: r.billNumber, billStatus: r.billStatus, calcStatus: r.calcStatus, periodStart: r.periodStart, periodEnd: r.periodEnd, calculatedAt: r.calculatedAt, errorMessage: r.errorMessage, frequency: frequencySql })
    .from(r).all();
  void now;
  // Issued bill numbers are never renumbered (auditors expect sequence order = issue order), so `renumbered` stays 0.
  for (const row of rows) {
    const endDay = row.periodEnd.slice(0, 10);
    const exclusive = enginePeriodEnd(row.periodStart.slice(0, 10), row.frequency as Parameters<typeof enginePeriodEnd>[1]);
    if (endDay === exclusive) {
      const fixed = new Date(Date.parse(`${endDay}T00:00:00Z`) - 1).toISOString();
      db.update(r).set({ periodEnd: fixed }).where(eq(r.id, row.id)).run();
      row.periodEnd = fixed;
      out.periodFixed += 1;
    }
  }
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    if (row.billStatus === "Canceled") continue;
    const k = `${row.contractId}|${row.periodStart.slice(0, 10)}|${row.periodEnd.slice(0, 10)}`;
    groups.set(k, [...(groups.get(k) ?? []), row]);
  }
  // One live bill per contract period, overlaps included: Approved bills win, then the newest Draft;
  // every other overlapping Draft is canceled (never deleted, so the bill number stays accounted for).
  const byContract = new Map<string, typeof rows>();
  for (const row of rows) {
    if (row.billStatus === "Canceled" || row.calcStatus !== "Successful") continue;
    byContract.set(row.contractId, [...(byContract.get(row.contractId) ?? []), row]);
  }
  const canceledIds = new Set<string>();
  for (const list of byContract.values()) {
    const ordered = [...list].sort((a, b) => Number(b.billStatus === "Approved") - Number(a.billStatus === "Approved") || b.calculatedAt.localeCompare(a.calculatedAt));
    const kept: typeof rows = [];
    for (const x of ordered) {
      const clash = kept.some((k) => k.periodStart.slice(0, 10) <= x.periodEnd.slice(0, 10) && x.periodStart.slice(0, 10) <= k.periodEnd.slice(0, 10));
      if (clash && x.billStatus === "Draft") {
        db.update(r).set({ billStatus: "Canceled", version: sql`${r.version} + 1` }).where(eq(r.id, x.id)).run();
        logUpdate(db, { userId: null, source: "Scheduler" }, REPORT_ENTITY, x.id, x.billNumber, { billStatus: "Draft" }, { billStatus: "Canceled (overlapping bill for the same period)" });
        canceledIds.add(x.id);
        out.canceled += 1;
      } else kept.push(x);
    }
  }
  for (const list of groups.values()) {
    const keep = list.find((x) => x.calcStatus === "Successful" && !canceledIds.has(x.id));
    const failed = list.filter((x) => x.calcStatus === "Failed").sort((a, b) => b.calculatedAt.localeCompare(a.calculatedAt));
    for (const [i, x] of failed.entries()) {
      if (keep || i > 0 || /no fees/i.test(x.errorMessage ?? "")) { db.delete(r).where(eq(r.id, x.id)).run(); out.deleted += 1; }
    }
  }
  return out;
}

/* ---------------- scheduler ---------------- */

/**
 * Billing-periods scheduler: bills every Approved contract whose last period has closed
 * (period end <= today) and has no Successful, non-canceled bill for that exact period yet.
 */
export function autoCalculateDue(db: AppDb, now: Date = new Date()): { calculated: number; failed: number; skipped: number } {
  normalizeBillingReports(db, now);
  // Contracts of Inactive clients are paused (the deactivation logs it on each contract); a final bill stays a manual Calculate.
  const contracts = db.select({ contract: s.billingContracts }).from(s.billingContracts).innerJoin(s.clients, eq(s.clients.id, s.billingContracts.clientId))
    .where(and(eq(s.billingContracts.approvalStatus, "Approved"), eq(s.clients.status, "Active"))).all().map((x) => x.contract);
  const ctx = { userId: null, source: "scheduler:billing-periods", scope: { warehouseIds: contracts.map((c) => c.warehouseId), clientIds: "all" as const } };
  let calculated = 0;
  let failed = 0;
  let skipped = 0;
  for (const contract of contracts) {
    const today = warehouseToday(db, contract.warehouseId, now);
    const period = lastClosedPeriod(contract.calcStartDate, contract.frequency, today);
    if (!period || period.end > today) { skipped += 1; continue; }
    if (periodConflicts(db, contract.id, period.start, lastDayOf(period.end)).length) { skipped += 1; continue; }
    let out: CalcResult;
    try {
      out = db.transaction((tx) => calculateContract(tx as unknown as AppDb, ctx, contract.id, period, now));
    } catch (error) {
      if ((error as { code?: string }).code === "DUPLICATE") { skipped += 1; continue; }
      throw error;
    }
    if (out.status === "Successful") calculated += 1;
    else failed += 1;
  }
  return { calculated, failed, skipped };
}

/**
 * Push approved bills to the accounting integration (R2-7). Only Approved, successfully calculated
 * bills can be exported; a bill already exported is refused unless `force` (re-push). The export
 * stamps `exported_to_integration` and writes an audit row, so the list's "Exported to integration"
 * column and the bill change log show it.
 */
export function exportReportsToIntegration(tx: AppDb, auth: AuthContext, actor: Actor, ids: readonly string[], opts: { readonly force?: boolean } = {}): BulkResult {
  const ctx = domainCtxOf(actor, auth);
  return runBulk(tx, ids, (inner, id) => {
    const row = loadReport(inner, auth, id);
    if (row.calcStatus === "Failed") throw new AppError("INVALID_STATE", `Bill ${row.billNumber} failed to calculate; it can't be exported`);
    if (row.billStatus !== "Approved") throw new AppError("INVALID_STATE", `Bill ${row.billNumber} is ${row.billStatus.toLowerCase()}; approve it before exporting to accounting`);
    if (row.exportedToIntegration && !opts.force) throw new AppError("INVALID_STATE", `Bill ${row.billNumber} was already exported to the integration`);
    inner.update(r).set({ exportedToIntegration: true, updatedBy: actor.userId, version: sql`${r.version} + 1` }).where(eq(r.id, id)).run();
    logUpdate(inner, ctx, REPORT_ENTITY, id, row.billNumber, { exportedToIntegration: Boolean(row.exportedToIntegration) }, { exportedToIntegration: true });
  });
}

/** Hourly cadence of the "billing-periods" scheduler task (scheduler/tasks/billing-periods.ts). */
export const AUTO_RUN_EVERY_MS = 60 * 60_000;

export interface AutoRunHistory {
  /** Last state of the scheduler task (null before the first run on this database). */
  readonly task: { readonly lastStartedAt: string | null; readonly lastStatus: string | null; readonly lastMessage: string | null; readonly runCount: number; readonly nextCheckAt: string } | null;
  /** Scheduler-written bills grouped by calculation day, newest first. */
  readonly runs: readonly { readonly day: string; readonly bills: number; readonly failed: number; readonly total: number; readonly contracts: number }[];
}

/** Billing Report "Auto-calculation" panel: scheduler task state plus the bills each run wrote. */
export function autoRunHistory(db: AppDb, auth: AuthContext, now: Date = new Date()): AutoRunHistory {
  let task: AutoRunHistory["task"] = null;
  try {
    const row = db.get<{ last_started_at: string | null; last_status: string | null; last_message: string | null; run_count: number }>(
      sql`SELECT last_started_at, last_status, last_message, run_count FROM scheduler_task_runs WHERE task_key = 'billing-periods'`);
    const base = row?.last_started_at ? Date.parse(row.last_started_at) : now.getTime();
    let next = base + AUTO_RUN_EVERY_MS;
    while (next < now.getTime()) next += AUTO_RUN_EVERY_MS;
    task = { lastStartedAt: row?.last_started_at ?? null, lastStatus: row?.last_status ?? null, lastMessage: row?.last_message ?? null, runCount: row?.run_count ?? 0, nextCheckAt: new Date(next).toISOString() };
  } catch { /* the scheduler tables are created on its first tick */ }
  const runs = db.all<{ day: string; bills: number; failed: number; total: number; contracts: number }>(sql`SELECT substr(${r.calculatedAt}, 1, 10) AS day, COUNT(*) AS bills,
      SUM(${r.calcStatus} = 'Failed') AS failed, ROUND(SUM(CASE WHEN ${r.calcStatus} = 'Successful' THEN ${r.totalPrice} ELSE 0 END), 2) AS total, COUNT(DISTINCT ${r.contractId}) AS contracts
    FROM ${r} WHERE ${r.createdBy} IS NULL AND ${reportScope(auth) ?? sql`1 = 1`} GROUP BY day ORDER BY day DESC LIMIT 12`);
  return { task, runs: runs.map((x) => ({ ...x, failed: Number(x.failed ?? 0), total: Number(x.total ?? 0) })) };
}

/** When the scheduler next bills a contract: the first hourly check after its open period closes (warehouse day). */
export function nextAutoRun(db: AppDb, contract: { readonly warehouseId: string; readonly calcStartDate: string; readonly frequency: Parameters<typeof periodContaining>[1]; readonly approvalStatus: string }, now: Date = new Date()): { readonly periodStart: string; readonly periodEnd: string; readonly runDay: string } | null {
  if (contract.approvalStatus !== "Approved") return null;
  const today = warehouseToday(db, contract.warehouseId, now);
  const open = periodContaining(contract.calcStartDate, contract.frequency, today < contract.calcStartDate ? contract.calcStartDate : today);
  // periodContaining returns an exclusive end: the first day after the period is the run day.
  return { periodStart: open.start, periodEnd: lastDayOf(open.end), runDay: open.end };
}
