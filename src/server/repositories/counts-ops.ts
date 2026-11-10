/**
 * Count plan / line commands (M07): Cancel, Update Inv. (ledger `Count` postings),
 * variance summary for the confirm, line Cancel and line Delete.
 */
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import {
  lineCancelReason, lineDeleteReason, lineUpdateInvReason, planCancelReason, planUpdateInvReason,
} from "@/lib/grid-defs/counts/count-math";
import * as schema from "@/server/db/schema";
import type { AppDb } from "@/server/api/db";
import { notFoundError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { hasWarehouse, type Scope } from "@/server/auth/scope";
import { changeLog, jobs, ledger, runBulk, tasks } from "@/server/domain";
import { DomainError } from "@/server/domain/errors";
import { rollupJob } from "@/server/domain/progress";
import { findEntryBucket, getCountLine, getCountPlanRow, lineLabel, movePlan, moveLine, rollupCountPlan, type CountLineRow, type CountPlanRow } from "@/server/domain/task-handlers/count";
import { nowIso, type BulkResult, type DomainCtx, type Tx } from "@/server/domain/types";

export const idsSchema = z.object({ ids: z.array(z.string().min(1).max(64)).min(1, "Select at least one record").max(1000, "At most 1000 records at once") });
export const updateInvSchema = idsSchema.extend({ reasonId: z.string().min(1).max(64).nullish(), note: z.string().trim().max(400).nullish() });
export const varianceQuerySchema = z.object({ level: z.enum(["plan", "line"]), ids: z.array(z.string().min(1).max(64)).min(1).max(1000) });

function ownLine(tx: Tx, scope: Scope, id: string): { line: CountLineRow; plan: CountPlanRow } {
  const line = tx.select().from(schema.countPlanLines).where(eq(schema.countPlanLines.id, id)).get();
  if (!line) throw notFoundError("Count line");
  const plan = getCountPlanRow(tx, line.planId);
  if (!hasWarehouse(scope, plan.warehouseId)) throw notFoundError("Count line");
  return { line, plan };
}

function ownPlan(tx: Tx, scope: Scope, id: string): CountPlanRow {
  const plan = tx.select().from(schema.countPlans).where(eq(schema.countPlans.id, id)).get();
  if (!plan || !hasWarehouse(scope, plan.warehouseId)) throw notFoundError("Count plan");
  return plan;
}

/* ----------------------------------------------------------------- cancel */
function cancelLineWork(tx: Tx, ctx: DomainCtx, line: CountLineRow): void {
  const pending = tx.select({ id: schema.tasks.id, jobId: schema.tasks.jobId }).from(schema.tasks)
    .where(and(eq(schema.tasks.countLineId, line.id), eq(schema.tasks.status, "Pending"))).all();
  if (pending.length) tasks.cancel(tx, ctx, { taskIds: pending.map((t) => t.id) });
  moveLine(tx, ctx, line, "Cancelled");
  for (const jobId of new Set(pending.map((t) => t.jobId))) settleJob(tx, ctx, jobId);
}

/** A count job with nothing left to do: cancelled when nothing was counted, else completed by rollup. */
function settleJob(tx: Tx, ctx: DomainCtx, jobId: string): void {
  const job = tx.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).get();
  if (!job || job.status === "Completed" || job.status === "Cancelled") return;
  const live = tx.select({ status: schema.tasks.status }).from(schema.tasks).where(and(eq(schema.tasks.jobId, jobId), ne(schema.tasks.status, "Cancelled"))).all();
  if (live.length === 0) jobs.cancelJob(tx, ctx, { jobId });
  else rollupJob(tx, ctx, jobId);
}

export function cancelCountPlans(tx: Tx, ctx: DomainCtx, auth: AuthContext, ids: readonly string[]): BulkResult {
  return runBulk(tx, ids, (inner, id) => {
    const plan = ownPlan(inner, auth.scope, id);
    const reason = planCancelReason(plan.status);
    if (reason) throw new DomainError("INVALID_STATE", `${plan.code}: ${reason}.`);
    const lines = inner.select().from(schema.countPlanLines).where(eq(schema.countPlanLines.planId, id)).all();
    for (const line of lines) if (!lineCancelReason(line.status)) cancelLineWork(inner, ctx, line);
    const fresh = getCountPlanRow(inner, id);
    if (fresh.status !== "Cancelled") movePlan(inner, ctx, fresh, "Cancelled");
  });
}

export function cancelCountLines(tx: Tx, ctx: DomainCtx, auth: AuthContext, ids: readonly string[]): BulkResult {
  return runBulk(tx, ids, (inner, id) => {
    const { line, plan } = ownLine(inner, auth.scope, id);
    const reason = lineCancelReason(line.status);
    if (reason) throw new DomainError("INVALID_STATE", reason);
    cancelLineWork(inner, ctx, line);
    rollupCountPlan(inner, ctx, plan.id);
  });
}

export function deleteCountLine(tx: Tx, ctx: DomainCtx, auth: AuthContext, id: string): void {
  const { line, plan } = ownLine(tx, auth.scope, id);
  const reason = lineDeleteReason(line.status);
  if (reason || plan.status !== "Pending") throw new DomainError("INVALID_STATE", reason ?? "Only lines of a pending count plan can be deleted");
  const n = tx.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM count_plan_lines WHERE plan_id = ${plan.id}`)?.n ?? 0;
  if (n <= 1) throw new DomainError("INVALID_STATE", "A count plan needs at least one line; delete the plan instead");
  const label = lineLabel(tx, line);
  tx.delete(schema.countPlanLines).where(eq(schema.countPlanLines.id, id)).run();
  changeLog.recordUpdate(tx, ctx, { entityType: "count_plan", entityId: plan.id, entityCode: plan.code, before: { countLines: n, removedLine: "" }, after: { countLines: n - 1, removedLine: label } });
}

/* ------------------------------------------------------------ update inv. */
type EntryRow = typeof schema.countLineEntries.$inferSelect;

function reasonCheck(tx: Tx, plan: CountPlanRow, reasonId: string | null | undefined): string | null {
  const wh = tx.select({ m: schema.warehouses.mandatoryCountReason }).from(schema.warehouses).where(eq(schema.warehouses.id, plan.warehouseId)).get();
  if (reasonId) {
    const r = tx.select().from(schema.lookupValues).where(and(eq(schema.lookupValues.id, reasonId), eq(schema.lookupValues.type, "adjustment_reason"))).get();
    if (!r) throw new DomainError("VALIDATION", "Choose a valid adjustment reason");
    return reasonId;
  }
  if (wh?.m) throw new DomainError("VALIDATION", "This warehouse requires a reason for cycle count updates");
  return null;
}

/** Posts one counted line's variances to the ledger and marks it Inventory Updated. */
export function postCountLine(tx: Tx, ctx: DomainCtx, line: CountLineRow, plan: CountPlanRow, reasonId: string | null, note?: string | null): number {
  const entries = tx.select().from(schema.countLineEntries).where(eq(schema.countLineEntries.lineId, line.id)).all();
  let posted = 0;
  const refs = { countPlanId: plan.id, jobId: line.jobId, note: note?.trim() || `Count plan ${plan.code}` };
  for (const e of entries) {
    const delta = e.countedQty - e.systemQty;
    if (delta === 0) continue;
    posted += postEntry(tx, ctx, plan, e, delta, reasonId, refs) ? 1 : 0;
  }
  const now = nowIso();
  moveLine(tx, ctx, line, "Inventory Updated", { inventoryUpdatedAt: now, inventoryUpdatedBy: ctx.userId, approvedStockQty: line.approvedStockQty, approvedCountQty: line.countedQty });
  return posted;
}

function postEntry(tx: Tx, ctx: DomainCtx, plan: CountPlanRow, e: EntryRow, delta: number, reasonId: string | null, refs: { countPlanId: string; jobId: string | null; note: string }): boolean {
  const bucket = findEntryBucket(tx, { productId: e.productId, locationId: e.locationId, lpId: e.lpId, lotNumber: e.lotNumber, expiryDate: e.expiryDate, packType: e.packType, damageReason: e.damageReason });
  if (bucket) {
    ledger.adjustTo(tx, ctx, { inventoryId: bucket.id, targetQty: Math.max(0, bucket.onHand + delta), type: "Count", adjustmentReasonId: reasonId, refs });
    return true;
  }
  if (delta < 0) return false;
  const product = tx.select().from(schema.products).where(eq(schema.products.id, e.productId)).get();
  if (!product) throw new DomainError("NOT_FOUND", "Product not found");
  ledger.adjustTo(tx, ctx, {
    bucket: { warehouseId: plan.warehouseId, clientId: product.clientId, productId: e.productId, locationId: e.locationId, lpId: e.lpId, lotNumber: e.lotNumber, expiryDate: e.expiryDate, packType: e.packType, qty: delta },
    targetQty: delta, type: "Count", adjustmentReasonId: reasonId, refs,
  });
  return true;
}

export function updateInventoryForPlans(tx: Tx, ctx: DomainCtx, auth: AuthContext, ids: readonly string[], reasonId?: string | null, note?: string | null): BulkResult {
  return runBulk(tx, ids, (inner, id) => {
    const plan = ownPlan(inner, auth.scope, id);
    const lines = inner.select().from(schema.countPlanLines).where(and(eq(schema.countPlanLines.planId, id), eq(schema.countPlanLines.status, "Count Completed"))).all();
    const reason = planUpdateInvReason(plan.status, lines.length);
    if (reason) throw new DomainError("INVALID_STATE", `${plan.code}: ${reason}.`);
    const r = reasonCheck(inner, plan, reasonId);
    for (const line of lines) postCountLine(inner, ctx, line, plan, r, note);
    rollupCountPlan(inner, ctx, id);
  });
}

export function updateInventoryForLines(tx: Tx, ctx: DomainCtx, auth: AuthContext, ids: readonly string[], reasonId?: string | null, note?: string | null): BulkResult {
  return runBulk(tx, ids, (inner, id) => {
    const { line, plan } = ownLine(inner, auth.scope, id);
    const reason = lineUpdateInvReason(line.status);
    if (reason) throw new DomainError("INVALID_STATE", reason);
    postCountLine(inner, ctx, line, plan, reasonCheck(inner, plan, reasonId), note);
    rollupCountPlan(inner, ctx, plan.id);
  });
}

/* --------------------------------------------------------- variance summary */
export interface VarianceRow {
  readonly planCode: string;
  readonly locationCode: string;
  readonly sku: string;
  readonly lotNumber: string | null;
  readonly systemQty: number;
  readonly countedQty: number;
  readonly delta: number;
}

export interface VarianceSummary {
  readonly eligible: number;
  readonly blocked: readonly { readonly id: string; readonly code: string; readonly reason: string }[];
  readonly rows: readonly VarianceRow[];
  readonly unitsUp: number;
  readonly unitsDown: number;
  readonly noDifferenceLines: number;
  readonly reasonRequired: boolean;
}

export function varianceSummary(db: AppDb, auth: AuthContext, input: z.output<typeof varianceQuerySchema>): VarianceSummary {
  const blocked: { id: string; code: string; reason: string }[] = [];
  const lineIds: string[] = [];
  const warehouseIds = new Set<string>();
  for (const id of new Set(input.ids)) {
    try {
      if (input.level === "plan") {
        const plan = ownPlan(db, auth.scope, id);
        const lines = db.select().from(schema.countPlanLines).where(and(eq(schema.countPlanLines.planId, id), eq(schema.countPlanLines.status, "Count Completed"))).all();
        const reason = planUpdateInvReason(plan.status, lines.length);
        if (reason) { blocked.push({ id, code: plan.code, reason }); continue; }
        lineIds.push(...lines.map((l) => l.id));
        warehouseIds.add(plan.warehouseId);
      } else {
        const { line, plan } = ownLine(db, auth.scope, id);
        const reason = lineUpdateInvReason(line.status);
        if (reason) { blocked.push({ id, code: lineLabel(db, line), reason }); continue; }
        lineIds.push(line.id);
        warehouseIds.add(plan.warehouseId);
      }
    } catch {
      blocked.push({ id, code: "—", reason: "Not found" });
    }
  }
  const rows = lineIds.length === 0 ? [] : db.all<VarianceRow & { lineId: string }>(sql`
    SELECT e.line_id AS lineId, p.code AS planCode, lo.code AS locationCode, pr.sku, e.lot_number AS lotNumber, e.system_qty AS systemQty, e.counted_qty AS countedQty,
      e.counted_qty - e.system_qty AS delta
    FROM count_line_entries e JOIN count_plan_lines l ON l.id = e.line_id JOIN count_plans p ON p.id = l.plan_id
    JOIN locations lo ON lo.id = e.location_id JOIN products pr ON pr.id = e.product_id
    WHERE e.line_id IN (${sql.join(lineIds.map((i) => sql`${i}`), sql`, `)}) ORDER BY p.code, lo.code, pr.sku`);
  const withDiff = new Set(rows.filter((r) => r.delta !== 0).map((r) => r.lineId));
  const required = warehouseIds.size > 0 && db.select({ id: schema.warehouses.id }).from(schema.warehouses)
    .where(and(inArray(schema.warehouses.id, [...warehouseIds]), eq(schema.warehouses.mandatoryCountReason, true))).all().length > 0;
  const variance = rows.filter((r) => r.delta !== 0).map(({ lineId: _lineId, ...r }) => r);
  return {
    eligible: input.level === "plan" ? input.ids.length - blocked.length : lineIds.length,
    blocked,
    rows: variance,
    unitsUp: variance.filter((r) => r.delta > 0).reduce((s, r) => s + r.delta, 0),
    unitsDown: variance.filter((r) => r.delta < 0).reduce((s, r) => s - r.delta, 0),
    noDifferenceLines: lineIds.filter((id) => !withDiff.has(id)).length,
    reasonRequired: required,
  };
}

export { getCountLine };
