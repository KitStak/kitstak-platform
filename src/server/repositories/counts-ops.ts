/**
 * Count plan / line commands (M07): Cancel, Update Inv. (ledger `Count` postings),
 * variance summary for the confirm, line Cancel and line Delete.
 *
 * Allocated stock (critic r5 blocker): a count can find less than is allocated. Physical truth must
 * always be postable, so before a shortage posts, unpicked shipment-order allocations on the
 * bucket are shorted (released, re-allocated from other locations where stock allows, and an
 * allocation exception is written on the order). Stock that is still committed after that
 * (picked, in a pick job, work orders) can't leave the ledger; those lines are listed in the
 * Update Inv. confirm and closed without posting (cancelled, with the reason) when the user
 * chooses to, so the plan never dead-ends and its locations unlock.
 */
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import {
  allocationShortfall, cancelDiscardsCount, COUNT_DISCARD_REASON_MESSAGE, isOpenLine, lineCancelReason, lineDeleteReason, lineUpdateInvReason,
  planCancelReason, planUpdateInvReason, selfApprovalReason, unitsLabel,
} from "@/lib/grid-defs/counts/count-math";
import { COUNT_SELF_APPROVE_PERMISSIONS } from "@/lib/grid-defs/counts/count-grids";
import { canAny } from "@/server/auth/permissions";
import * as schema from "@/server/db/schema";
import type { AppDb } from "@/server/api/db";
import { notFoundError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { hasWarehouse, type Scope } from "@/server/auth/scope";
import * as changeLog from "@/server/domain/change-log";
import * as jobs from "@/server/domain/jobs";
import { ledger } from "@/server/domain/ledger";
import { reallocateLine, recordException } from "@/server/domain/allocation";
import { runBulk } from "@/server/domain/bulk";
import * as tasks from "@/server/domain/tasks";
import { DomainError, insufficientStock } from "@/server/domain/errors";
import { rollupJob } from "@/server/domain/progress";
import { findEntryBucket, getCountLine, getCountPlanRow, lineLabel, movePlan, moveLine, restoreRecountOriginal, rollupCountPlan, type CountLineRow, type CountPlanRow } from "@/server/domain/task-handlers/count";
import { nowIso, type BulkResult, type DomainCtx, type Tx } from "@/server/domain/types";
import { assertPostAllowed } from "./counts-conflicts";
import { reasonName, recordCountEvent, updateInvEventText } from "./counts-events";
import { dbAll, dbGet, mapSeq, withWriteTx } from "@/server/db/sql";

export const idsSchema = z.object({ ids: z.array(z.string().min(1).max(64)).min(1, "Select at least one record").max(1000, "At most 1000 records at once") });
export const cancelSchema = idsSchema.extend({ reason: z.string().trim().max(400).nullish() });
export const updateInvSchema = idsSchema.extend({
  reasonId: z.string().min(1).max(64).nullish(),
  note: z.string().trim().max(400).nullish(),
  /** Close counted lines whose shortage is held by picked / in-job allocations without posting them. */
  closeBlocked: z.boolean().optional(),
});
export const varianceQuerySchema = z.object({ level: z.enum(["plan", "line"]), ids: z.array(z.string().min(1).max(64)).min(1).max(1000) });

type Db = Tx | AppDb;

async function ownLine(tx: Db, scope: Scope, id: string): Promise<{ line: CountLineRow; plan: CountPlanRow }> {
  const line = (await tx.select().from(schema.countPlanLines).where(eq(schema.countPlanLines.id, id)).limit(1))[0];
  if (!line) throw notFoundError("Count line");
  const plan = await getCountPlanRow(tx as Tx, line.planId);
  if (!hasWarehouse(scope, plan.warehouseId)) throw notFoundError("Count line");
  return { line, plan };
}

async function ownPlan(tx: Db, scope: Scope, id: string): Promise<CountPlanRow> {
  const plan = (await tx.select().from(schema.countPlans).where(eq(schema.countPlans.id, id)).limit(1))[0];
  if (!plan || !hasWarehouse(scope, plan.warehouseId)) throw notFoundError("Count plan");
  return plan;
}

/* ----------------------------------------------------------------- cancel */
async function cancelLineWork(tx: Tx, ctx: DomainCtx, line: CountLineRow, restore = false): Promise<void> {
  const pending = await tx.select({ id: schema.tasks.id, jobId: schema.tasks.jobId }).from(schema.tasks)
    .where(and(eq(schema.tasks.countLineId, line.id), eq(schema.tasks.status, "Pending")));
  if (pending.length) await tasks.cancel(tx, ctx, { taskIds: pending.map((t) => t.id) });
  // Count Completed → Cancelled runs through the machine's path (via Count Started); one status log row.
  await moveLine(tx, ctx, line, "Cancelled");
  // A line-level cancel reopens the superseded original (REQ-16); a plan cancel closes everything.
  if (restore) await restoreRecountOriginal(tx, ctx, line);
  for (const jobId of new Set(pending.map((t) => t.jobId))) await settleJob(tx, ctx, jobId);
}

/** A count job with nothing left to do: cancelled when nothing was counted, else completed by rollup. */
async function settleJob(tx: Tx, ctx: DomainCtx, jobId: string): Promise<void> {
  const job = (await tx.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).limit(1))[0];
  if (!job || job.status === "Completed" || job.status === "Cancelled") return;
  const live = await tx.select({ status: schema.tasks.status }).from(schema.tasks).where(and(eq(schema.tasks.jobId, jobId), ne(schema.tasks.status, "Cancelled")));
  if (live.length === 0) await jobs.cancelJob(tx, ctx, { jobId });
  else await rollupJob(tx, ctx, jobId);
}

const discardText = (n: number, reason: string): string => `${unitsLabel(n, ["counted line", "counted lines"])} discarded without posting · reason: ${reason}`;

/**
 * Cancels plans (Logiwa parity: any plan that is not Inventory Updated). Counted lines that were
 * never posted are discarded, so a reason is then mandatory and lands on the plan timeline.
 */
export async function cancelCountPlans(tx: Tx, ctx: DomainCtx, auth: AuthContext, ids: readonly string[], reason?: string | null): Promise<BulkResult> {
  return await runBulk(tx, ids, async (inner, id) => {
    const plan = await ownPlan(inner, auth.scope, id);
    const why = planCancelReason(plan.status);
    if (why) throw new DomainError("INVALID_STATE", `${plan.code}: ${why}.`);
    const lines = await inner.select().from(schema.countPlanLines).where(eq(schema.countPlanLines.planId, id));
    const discards = lines.filter((l) => cancelDiscardsCount(l.status)).length;
    const note = reason?.trim() || null;
    if (discards > 0 && !note) throw new DomainError("VALIDATION", `${plan.code}: ${COUNT_DISCARD_REASON_MESSAGE}`);
    for (const line of lines) if (!lineCancelReason(line.status)) await cancelLineWork(inner, ctx, line);
    const fresh = await getCountPlanRow(inner, id);
    if (fresh.status !== "Cancelled") await movePlan(inner, ctx, fresh, "Cancelled");
    if (note) await recordCountEvent(inner, ctx, { planId: plan.id, planCode: plan.code, text: discards > 0 ? `Count plan cancelled · ${discardText(discards, note)}` : `Count plan cancelled · reason: ${note}` });
  });
}

export async function cancelCountLines(tx: Tx, ctx: DomainCtx, auth: AuthContext, ids: readonly string[], reason?: string | null): Promise<BulkResult> {
  return await runBulk(tx, ids, async (inner, id) => {
    const { line, plan } = await ownLine(inner, auth.scope, id);
    const why = lineCancelReason(line.status);
    if (why) throw new DomainError("INVALID_STATE", why);
    const note = reason?.trim() || null;
    const discards = cancelDiscardsCount(line.status);
    if (discards && !note) throw new DomainError("VALIDATION", COUNT_DISCARD_REASON_MESSAGE);
    const label = await lineLabel(inner, line);
    await cancelLineWork(inner, ctx, line, true);
    if (note) await recordCountEvent(inner, ctx, { planId: plan.id, planCode: plan.code, line: { id: line.id, label }, text: discards ? `Line cancelled · ${discardText(1, note)}` : `Line cancelled · reason: ${note}` });
    await rollupCountPlan(inner, ctx, plan.id);
  });
}

export async function deleteCountLine(tx: Tx, ctx: DomainCtx, auth: AuthContext, id: string): Promise<void> {
  const { line, plan } = await ownLine(tx, auth.scope, id);
  const reason = lineDeleteReason(line.status);
  if (reason || plan.status !== "Pending") throw new DomainError("INVALID_STATE", reason ?? "Only lines of a pending count plan can be deleted");
  const n = (await dbGet<{ n: number }>(tx, sql`SELECT COUNT(*) AS n FROM count_plan_lines WHERE plan_id = ${plan.id}`))?.n ?? 0;
  if (n <= 1) throw new DomainError("INVALID_STATE", "A count plan needs at least one line; delete the plan instead");
  const label = await lineLabel(tx, line);
  await tx.delete(schema.countPlanLines).where(eq(schema.countPlanLines.id, id));
  await changeLog.recordUpdate(tx, ctx, { entityType: "count_plan", entityId: plan.id, entityCode: plan.code, before: { countLines: n, removedLine: "" }, after: { countLines: n - 1, removedLine: label } });
}

/* ------------------------------------------------------ allocated stock */
type EntryRow = typeof schema.countLineEntries.$inferSelect;

/** Who holds a bucket's allocated stock: "SO-1001 (Picked, 2)". */
export interface AllocationHolder {
  readonly ref: string;
  readonly status: string;
  readonly qty: number;
}

/** How one count entry posts against the bucket's allocations. */
export interface EntryPosting {
  readonly entry: EntryRow;
  readonly bucketId: string | null;
  readonly delta: number;
  readonly allocated: number;
  /** Units of unpicked allocations the posting shorts first. */
  readonly release: number;
  /** Units that stay committed (picked / in a job / work order): the line can't post. */
  readonly unpostable: number;
  readonly holders: readonly AllocationHolder[];
}

interface ReleasableAllocation {
  readonly id: string;
  readonly qty: number;
}

/** Unpicked shipment-order allocations with no live pick task: safe to short. */
async function releasableAllocations(tx: Db, bucketId: string): Promise<ReleasableAllocation[]> {
  return await dbAll<ReleasableAllocation>(tx, sql`
    SELECT a.id, a.qty FROM inventory_allocations a
    JOIN shipment_orders so ON so.id = a.order_id
    LEFT JOIN tasks t ON t.id = a.task_id
    WHERE a.inventory_id = ${bucketId} AND a.status = 'Allocated' AND a.work_order_id IS NULL AND so.job_id IS NULL
      AND (a.task_id IS NULL OR t.status IN ('Completed', 'Cancelled'))
    ORDER BY a.created_at DESC, a.id`);
}

async function allocationHolders(tx: Db, bucketId: string): Promise<AllocationHolder[]> {
  return (await dbAll<{ ref: string | null; status: string; qty: number }>(tx, sql`
    SELECT COALESCE(so.code, wo.code, 'Unknown document') AS ref, a.status, SUM(a.qty) AS qty FROM inventory_allocations a
    LEFT JOIN shipment_orders so ON so.id = a.order_id LEFT JOIN work_orders wo ON wo.id = a.work_order_id
    WHERE a.inventory_id = ${bucketId} AND a.status IN ('Allocated', 'Picked', 'Sorted', 'Packed', 'Loaded')
    GROUP BY ref, a.status ORDER BY ref`)).map((h) => ({ ref: h.ref ?? "Unknown document", status: h.status, qty: h.qty }));
}

export const holdersText = (holders: readonly AllocationHolder[]): string =>
  holders.slice(0, 4).map((h) => `${h.ref} (${h.status}, ${h.qty.toLocaleString("en-US")})`).join(", ") + (holders.length > 4 ? ` +${holders.length - 4} more` : "");

/** Plans every entry of a line against its bucket's allocations (read-only). */
export async function planLineEntries(tx: Db, lineId: string): Promise<EntryPosting[]> {
  const entries = await tx.select().from(schema.countLineEntries).where(eq(schema.countLineEntries.lineId, lineId));
  return await mapSeq(entries, async (entry): Promise<EntryPosting> => {
    const delta = entry.countedQty - entry.systemQty;
    const bucket = delta === 0 ? undefined : await findEntryBucket(tx as Tx, { productId: entry.productId, locationId: entry.locationId, lpId: entry.lpId, lotNumber: entry.lotNumber, expiryDate: entry.expiryDate, packType: entry.packType, damageReason: entry.damageReason });
    if (!bucket || delta >= 0 || bucket.allocated <= 0) return { entry, bucketId: bucket?.id ?? null, delta, allocated: bucket?.allocated ?? 0, release: 0, unpostable: 0, holders: [] };
    const target = Math.max(0, bucket.onHand + delta);
    const releasable = (await releasableAllocations(tx, bucket.id)).reduce((s, a) => s + a.qty, 0);
    const { release, unpostable } = allocationShortfall({ allocated: bucket.allocated, releasable, target });
    return { entry, bucketId: bucket.id, delta, allocated: bucket.allocated, release, unpostable, holders: release + unpostable > 0 ? await allocationHolders(tx, bucket.id) : [] };
  });
}

export interface LineAllocationBlock {
  readonly units: number;
  readonly holders: readonly AllocationHolder[];
  readonly message: string;
}

async function locationCode(tx: Db, id: string): Promise<string> {
  return (await tx.select({ code: schema.locations.code }).from(schema.locations).where(eq(schema.locations.id, id)).limit(1))[0]?.code ?? "the location";
}

/** Why a counted line can't post (its shortage is held by picked / in-job stock), or null. */
export async function lineAllocationBlock(tx: Db, postings: readonly EntryPosting[], label: string): Promise<LineAllocationBlock | null> {
  const blocked = postings.filter((p) => p.unpostable > 0);
  if (blocked.length === 0) return null;
  const units = blocked.reduce((s, p) => s + p.unpostable, 0);
  const holders = blocked.flatMap((p) => p.holders);
  const at = [...new Set(await mapSeq(blocked, async (p) => await locationCode(tx, p.entry.locationId)))].join(", ");
  const list = holders.length ? holdersText(holders) : "orders";
  return {
    units, holders,
    message: `${label}: ${unitsLabel(units)} at ${at} ${units === 1 ? "is" : "are"} committed to ${list}. Picked, in-job and work-order stock can't be counted out, so this shortage can't post. Close the line without posting, or resolve the order and recount.`,
  };
}

interface ShortedAllocation {
  readonly orderCode: string;
  readonly qty: number;
  readonly reallocated: number;
}

/** Shorts unpicked allocations ahead of a shortage posting; re-allocates elsewhere where it can. */
async function shortAllocations(tx: Tx, ctx: DomainCtx, plan: CountPlanRow, posting: EntryPosting): Promise<ShortedAllocation[]> {
  if (posting.release <= 0 || !posting.bucketId) return [];
  const out: ShortedAllocation[] = [];
  let left = posting.release;
  const at = await locationCode(tx, posting.entry.locationId);
  for (const ref of await releasableAllocations(tx, posting.bucketId)) {
    if (left <= 0) break;
    const alloc = (await tx.select().from(schema.inventoryAllocations).where(eq(schema.inventoryAllocations.id, ref.id)).limit(1))[0];
    if (!alloc) continue;
    const qty = Math.min(left, alloc.qty);
    await jobs.releaseForLine(tx, ctx, alloc, qty);
    left -= qty;
    const order = alloc.orderId ? (await tx.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, alloc.orderId)).limit(1))[0] : undefined;
    let reallocated = 0;
    if (alloc.orderLineId) {
      try {
        // Savepoint: a failed re-allocation leaves the release in place and reports the shortage.
        reallocated = await withWriteTx(tx, async (inner) => await reallocateLine(inner, ctx, { orderLineId: alloc.orderLineId ?? "", excludeLocationIds: [posting.entry.locationId] }));
      } catch {
        reallocated = 0;
      }
    }
    const shortBy = Math.max(0, qty - reallocated);
    if (order && shortBy > 0 && order.clientId) {
      await recordException(tx, {
        orderId: order.id, warehouseId: order.warehouseId, clientId: order.clientId, waveId: null, waveNo: "Cycle Count", waveRuleName: null,
        explanation: `Count shortage: count plan ${plan.code} found less stock at ${at}; ${unitsLabel(shortBy)} unallocated${reallocated > 0 ? ` (${unitsLabel(reallocated)} re-allocated from other locations)` : ""}`,
        runBy: ctx.source,
      });
    }
    out.push({ orderCode: order?.code ?? "order", qty, reallocated: Math.min(reallocated, qty) });
  }
  return out;
}

const shortedText = (rows: readonly ShortedAllocation[]): string =>
  `Count shortage shorted allocations · ${rows.map((r) => `${r.orderCode} −${r.qty}${r.reallocated ? ` (re-allocated ${r.reallocated} elsewhere)` : ""}`).join(", ")}`;

/* ------------------------------------------------------------ update inv. */
/** Supervisors (and admins) may post variances they counted; see COUNT_SELF_APPROVE_PERMISSIONS. */
export const canSelfApprove = (auth: AuthContext): boolean => auth.user.role === "admin" || canAny(auth, COUNT_SELF_APPROVE_PERMISSIONS as never);

async function lineHasVariance(tx: Db, lineId: string): Promise<boolean> {
  return Boolean(await dbGet<{ n: number }>(tx, sql`SELECT 1 AS n FROM count_line_entries WHERE line_id = ${lineId} AND counted_qty <> system_qty LIMIT 1`));
}

/** Four-eyes check for one counted line (null = this user may post it). */
async function approvalBlock(tx: Db, auth: AuthContext, line: CountLineRow): Promise<string | null> {
  if (line.countUserId !== auth.user.id) return null;
  return selfApprovalReason({ countUserId: line.countUserId, hasVariance: await lineHasVariance(tx, line.id) }, auth.user.id, canSelfApprove(auth));
}

export const COUNT_VARIANCE_REASON_MESSAGE = "A count variance requires a reason. Choose an adjustment reason.";

async function reasonCheck(tx: Tx, plan: CountPlanRow, reasonId: string | null | undefined): Promise<string | null> {
  const wh = (await tx.select({ m: schema.warehouses.mandatoryCountReason }).from(schema.warehouses).where(eq(schema.warehouses.id, plan.warehouseId)).limit(1))[0];
  if (reasonId) {
    const r = (await tx.select().from(schema.lookupValues).where(and(eq(schema.lookupValues.id, reasonId), eq(schema.lookupValues.type, "adjustment_reason"))).limit(1))[0];
    if (!r) throw new DomainError("VALIDATION", "Choose a valid adjustment reason");
    return reasonId;
  }
  if (wh?.m) throw new DomainError("VALIDATION", "This warehouse requires a reason for cycle count updates");
  return null;
}

/** Posts one counted line's variances to the ledger and marks it Inventory Updated. */
export async function postCountLine(tx: Tx, ctx: DomainCtx, line: CountLineRow, plan: CountPlanRow, reasonId: string | null, note?: string | null): Promise<number> {
  const postings = await planLineEntries(tx, line.id);
  const refs = { countPlanId: plan.id, jobId: line.jobId, note: note?.trim() || `Count plan ${plan.code}` };
  // Audit rule: a stock change from a count always carries an adjustment reason.
  if (!reasonId && postings.some((p) => p.delta !== 0)) throw new DomainError("VALIDATION", COUNT_VARIANCE_REASON_MESSAGE);
  const label = await lineLabel(tx, line);
  const block = await lineAllocationBlock(tx, postings, label);
  if (block) throw insufficientStock(block.message, { countLineId: line.id, units: block.units });
  // Lock Locations: another open plan holding a location keeps this count from changing its stock.
  const changed = [...new Set(postings.filter((p) => p.delta !== 0).map((p) => p.entry.locationId))];
  if (changed.length) {
    const locs = await tx.select({ id: schema.locations.id, code: schema.locations.code }).from(schema.locations).where(inArray(schema.locations.id, changed));
    await assertPostAllowed(tx, plan, locs);
  }
  let posted = 0;
  const shorted: ShortedAllocation[] = [];
  for (const p of postings) {
    if (p.delta === 0) continue;
    shorted.push(...await shortAllocations(tx, ctx, plan, p));
    posted += await postEntry(tx, ctx, plan, p.entry, p.delta, reasonId, refs) ? 1 : 0;
  }
  if (shorted.length) await recordCountEvent(tx, ctx, { planId: plan.id, planCode: plan.code, line: { id: line.id, label }, text: shortedText(shorted) });
  const now = nowIso();
  await moveLine(tx, ctx, line, "Inventory Updated", { inventoryUpdatedAt: now, inventoryUpdatedBy: ctx.userId, approvedStockQty: line.approvedStockQty, approvedCountQty: line.countedQty });
  return posted;
}

async function postEntry(tx: Tx, ctx: DomainCtx, plan: CountPlanRow, e: EntryRow, delta: number, reasonId: string | null, refs: { countPlanId: string; jobId: string | null; note: string }): Promise<boolean> {
  const bucket = await findEntryBucket(tx, { productId: e.productId, locationId: e.locationId, lpId: e.lpId, lotNumber: e.lotNumber, expiryDate: e.expiryDate, packType: e.packType, damageReason: e.damageReason });
  if (bucket) {
    await ledger.adjustTo(tx, ctx, { inventoryId: bucket.id, targetQty: Math.max(0, bucket.onHand + delta), type: "Count", adjustmentReasonId: reasonId, refs });
    return true;
  }
  if (delta < 0) return false;
  const product = (await tx.select().from(schema.products).where(eq(schema.products.id, e.productId)).limit(1))[0];
  if (!product) throw new DomainError("NOT_FOUND", "Product not found");
  await ledger.adjustTo(tx, ctx, {
    bucket: { warehouseId: plan.warehouseId, clientId: product.clientId, productId: e.productId, locationId: e.locationId, lpId: e.lpId, lotNumber: e.lotNumber, expiryDate: e.expiryDate, packType: e.packType, damageReason: e.damageReason, qty: delta },
    targetQty: delta, type: "Count", adjustmentReasonId: reasonId, refs,
  });
  return true;
}

/** Closes a counted line whose shortage can't post: cancelled, with the facts and reason on the timeline. */
async function closeWithoutPosting(tx: Tx, ctx: DomainCtx, plan: CountPlanRow, line: CountLineRow, block: LineAllocationBlock, reason: string | null, note?: string | null): Promise<void> {
  const label = await lineLabel(tx, line);
  await cancelLineWork(tx, ctx, line);
  const why = [reason ? `reason ${reason}` : null, note?.trim() ? `note: ${note.trim()}` : null].filter(Boolean).join(" · ");
  await recordCountEvent(tx, ctx, { planId: plan.id, planCode: plan.code, line: { id: line.id, label }, text: `Closed without posting · ${block.message.replace(/ Close the line.*$/, "")}${why ? ` · ${why}` : ""}` });
}

const blockedRefusal = (planCode: string, blocks: readonly LineAllocationBlock[]): string =>
  `${planCode}: ${unitsLabel(blocks.length, ["counted line", "counted lines"])} can't post because the stock is committed to orders. ${blocks[0]?.message ?? ""} Tick "Close these lines without posting" to post the rest.`;

export async function updateInventoryForPlans(tx: Tx, ctx: DomainCtx, auth: AuthContext, ids: readonly string[], reasonId?: string | null, note?: string | null, closeBlocked = false): Promise<BulkResult> {
  return await runBulk(tx, ids, async (inner, id) => {
    const plan = await ownPlan(inner, auth.scope, id);
    const lines = await inner.select().from(schema.countPlanLines).where(and(eq(schema.countPlanLines.planId, id), eq(schema.countPlanLines.status, "Count Completed")));
    const reason = planUpdateInvReason(plan.status, lines.length);
    if (reason) throw new DomainError("INVALID_STATE", `${plan.code}: ${reason}.`);
    // Nothing counted → nothing posts, so no reason is needed; the open lines are cancelled below.
    for (const line of lines) {
      const block = await approvalBlock(inner, auth, line);
      if (block) throw new DomainError("FORBIDDEN", `${plan.code} · ${await lineLabel(inner, line)}: ${block}`);
    }
    const r = lines.length > 0 ? await reasonCheck(inner, plan, reasonId) : null;
    const checked = await mapSeq(lines, async (line) => ({ line, block: await lineAllocationBlock(inner, await planLineEntries(inner, line.id), await lineLabel(inner, line)) }));
    const blocked = checked.filter((c): c is { line: CountLineRow; block: LineAllocationBlock } => c.block !== null);
    if (blocked.length > 0 && !closeBlocked) throw insufficientStock(blockedRefusal(plan.code, blocked.map((b) => b.block)), { blockedLines: blocked.length });
    if (blocked.length > 0 && !r && !note?.trim()) throw new DomainError("VALIDATION", COUNT_DISCARD_REASON_MESSAGE);
    let postings = 0;
    for (const { line, block } of checked) if (!block) postings += (await postCountLine(inner, ctx, line, plan, r, note));
    const rName = await reasonName(inner, r);
    for (const { line, block } of blocked) await closeWithoutPosting(inner, ctx, plan, line, block, rName, note);
    // Logiwa parity: plan-level Update Inv. cancels every line that is not Count Completed.
    const open = (await inner.select().from(schema.countPlanLines).where(eq(schema.countPlanLines.planId, id))).filter((l) => isOpenLine(l.status));
    for (const line of open) await cancelLineWork(inner, ctx, line);
    const posted = lines.length - blocked.length;
    const text = updateInvEventText({ lines: posted, postings, reason: rName, note, cancelledOpen: open.length });
    await recordCountEvent(inner, ctx, { planId: plan.id, planCode: plan.code, text: blocked.length ? `${text} · ${unitsLabel(blocked.length, ["counted line", "counted lines"])} closed without posting (stock committed to orders)` : text });
    await rollupCountPlan(inner, ctx, id);
  });
}

export async function updateInventoryForLines(tx: Tx, ctx: DomainCtx, auth: AuthContext, ids: readonly string[], reasonId?: string | null, note?: string | null, closeBlocked = false): Promise<BulkResult> {
  return await runBulk(tx, ids, async (inner, id) => {
    const { line, plan } = await ownLine(inner, auth.scope, id);
    const reason = lineUpdateInvReason(line.status);
    if (reason) throw new DomainError("INVALID_STATE", reason);
    const block = await approvalBlock(inner, auth, line);
    if (block) throw new DomainError("FORBIDDEN", block);
    const r = await reasonCheck(inner, plan, reasonId);
    const label = await lineLabel(inner, line);
    const held = await lineAllocationBlock(inner, await planLineEntries(inner, line.id), label);
    if (held && closeBlocked) {
      if (!r && !note?.trim()) throw new DomainError("VALIDATION", COUNT_DISCARD_REASON_MESSAGE);
      await closeWithoutPosting(inner, ctx, plan, line, held, await reasonName(inner, r), note);
    } else {
      const postings = await postCountLine(inner, ctx, line, plan, r, note);
      await recordCountEvent(inner, ctx, { planId: plan.id, planCode: plan.code, line: { id: line.id, label }, text: updateInvEventText({ lines: 1, postings, reason: await reasonName(inner, r), note }) });
    }
    await rollupCountPlan(inner, ctx, plan.id);
  });
}

/* --------------------------------------------------------- variance summary */
export interface VarianceRow {
  readonly lineId: string;
  readonly planCode: string;
  readonly locationCode: string;
  readonly sku: string;
  readonly lotNumber: string | null;
  readonly systemQty: number;
  readonly countedQty: number;
  readonly delta: number;
  /** Allocated qty of the bucket (0 = free stock). */
  readonly allocated: number;
  /** Unpicked allocation units this posting shorts first. */
  readonly unallocates: number;
  /** The line can't post: its shortage is held by committed stock. */
  readonly blocked: boolean;
}

export interface AllocationBlockedLine {
  readonly lineId: string;
  readonly planCode: string;
  readonly label: string;
  readonly units: number;
  readonly holders: string;
  readonly message: string;
}

export interface VarianceSummary {
  readonly eligible: number;
  readonly blocked: readonly { readonly id: string; readonly code: string; readonly reason: string }[];
  readonly rows: readonly VarianceRow[];
  readonly unitsUp: number;
  readonly unitsDown: number;
  readonly noDifferenceLines: number;
  readonly reasonRequired: boolean;
  /** Plan level only: plans whose not-yet-counted lines Update Inv. cancels. */
  readonly linesToCancel: readonly { readonly code: string; readonly lines: number }[];
  /** Counted lines that will post (0 = Update Inv. only cancels the open lines, nothing posts). */
  readonly countedLines: number;
  /** Counted lines whose shortage is committed to orders: they close without posting. */
  readonly allocationBlocked: readonly AllocationBlockedLine[];
  /** Units of unpicked allocations the postings short (with an allocation exception on the order). */
  readonly unitsUnallocated: number;
}

export async function varianceSummary(db: AppDb, auth: AuthContext, input: z.output<typeof varianceQuerySchema>): Promise<VarianceSummary> {
  const blocked: { id: string; code: string; reason: string }[] = [];
  const lineIds: string[] = [];
  const warehouseIds = new Set<string>();
  const linesToCancel: { code: string; lines: number }[] = [];
  for (const id of new Set(input.ids)) {
    try {
      if (input.level === "plan") {
        const plan = await ownPlan(db, auth.scope, id);
        const lines = await db.select().from(schema.countPlanLines).where(and(eq(schema.countPlanLines.planId, id), eq(schema.countPlanLines.status, "Count Completed")));
        const reason = planUpdateInvReason(plan.status, lines.length);
        if (reason) { blocked.push({ id, code: plan.code, reason }); continue; }
        const own = (await mapSeq(lines, async (l) => await approvalBlock(db, auth, l))).find(Boolean);
        if (own) { blocked.push({ id, code: plan.code, reason: own }); continue; }
        lineIds.push(...lines.map((l) => l.id));
        // A plan with nothing counted posts nothing, so it never makes a reason mandatory.
        if (lines.length > 0) warehouseIds.add(plan.warehouseId);
        const open = (await db.select({ status: schema.countPlanLines.status }).from(schema.countPlanLines).where(eq(schema.countPlanLines.planId, id))).filter((l) => isOpenLine(l.status)).length;
        if (open > 0) linesToCancel.push({ code: plan.code, lines: open });
      } else {
        const { line, plan } = await ownLine(db, auth.scope, id);
        const reason = lineUpdateInvReason(line.status);
        if (reason) { blocked.push({ id, code: await lineLabel(db as unknown as Tx, line), reason }); continue; }
        const own = await approvalBlock(db, auth, line);
        if (own) { blocked.push({ id, code: await lineLabel(db as unknown as Tx, line), reason: own }); continue; }
        lineIds.push(line.id);
        warehouseIds.add(plan.warehouseId);
      }
    } catch {
      blocked.push({ id, code: "—", reason: "Not found" });
    }
  }
  const raw = lineIds.length === 0 ? [] : await dbAll<{ entryId: string; lineId: string; planCode: string; locationCode: string; sku: string; lotNumber: string | null; systemQty: number; countedQty: number; delta: number }>(db, sql`
    SELECT e.id AS "entryId", e.line_id AS "lineId", p.code AS "planCode", lo.code AS "locationCode", pr.sku, e.lot_number AS "lotNumber", e.system_qty AS "systemQty", e.counted_qty AS "countedQty",
      e.counted_qty - e.system_qty AS delta
    FROM count_line_entries e JOIN count_plan_lines l ON l.id = e.line_id JOIN count_plans p ON p.id = l.plan_id
    JOIN locations lo ON lo.id = e.location_id JOIN products pr ON pr.id = e.product_id
    WHERE e.line_id IN (${sql.join(lineIds.map((i) => sql`${i}`), sql`, `)}) ORDER BY p.code, lo.code, pr.sku`);
  // Allocation check per line with a shortage (read-only planning; nothing is released here).
  const byEntry = new Map<string, EntryPosting>();
  const allocationBlocked: AllocationBlockedLine[] = [];
  for (const lineId of new Set(raw.filter((r) => r.delta < 0).map((r) => r.lineId))) {
    const postings = await planLineEntries(db, lineId);
    for (const p of postings) byEntry.set(p.entry.id, p);
    const line = (await db.select().from(schema.countPlanLines).where(eq(schema.countPlanLines.id, lineId)).limit(1))[0];
    if (!line) continue;
    const label = await lineLabel(db as unknown as Tx, line);
    const block = await lineAllocationBlock(db, postings, label);
    if (block) allocationBlocked.push({ lineId, planCode: raw.find((r) => r.lineId === lineId)?.planCode ?? "", label, units: block.units, holders: holdersText(block.holders), message: block.message });
  }
  const blockedLineIds = new Set(allocationBlocked.map((b) => b.lineId));
  const rows: VarianceRow[] = raw.map(({ entryId, ...r }) => {
    const p = byEntry.get(entryId);
    return { ...r, allocated: p?.allocated ?? 0, unallocates: blockedLineIds.has(r.lineId) ? 0 : (p?.release ?? 0), blocked: blockedLineIds.has(r.lineId) };
  });
  const withDiff = new Set(rows.filter((r) => r.delta !== 0).map((r) => r.lineId));
  const required = warehouseIds.size > 0 && (await db.select({ id: schema.warehouses.id }).from(schema.warehouses)
    .where(and(inArray(schema.warehouses.id, [...warehouseIds]), eq(schema.warehouses.mandatoryCountReason, true)))).length > 0;
  const variance = rows.filter((r) => r.delta !== 0);
  const posting = variance.filter((r) => !r.blocked);
  return {
    eligible: input.level === "plan" ? input.ids.length - blocked.length : lineIds.length,
    blocked,
    rows: variance,
    unitsUp: posting.filter((r) => r.delta > 0).reduce((s, r) => s + r.delta, 0),
    unitsDown: posting.filter((r) => r.delta < 0).reduce((s, r) => s - r.delta, 0),
    noDifferenceLines: lineIds.filter((id) => !withDiff.has(id)).length,
    reasonRequired: required || variance.length > 0,
    linesToCancel,
    countedLines: lineIds.length,
    allocationBlocked,
    unitsUnallocated: posting.reduce((s, r) => s + r.unallocates, 0),
  };
}

export { getCountLine };
