/**
 * Job / task commands with full cascade semantics (M03, round 2 parity loop).
 *
 *   cancelJobCascade   — Logiwa "Cancel": every pending task of the job is cancelled and its
 *                        allocation released, for every operation type (Picking, Count,
 *                        Replenishment, Work Order). A part-way executed job keeps its completed
 *                        work and the downstream tasks that carry already-moved stock (pack /
 *                        sort / load of picked units, replenishment put phase); only the
 *                        remaining work is cancelled.
 *   cancelTasksCascade — cancelling a pick task also reduces (or cancels) the matching pack,
 *                        sort and loading tasks, releases the allocation and keeps the order
 *                        status consistent (fully cancelled orders go back to Open and leave
 *                        the job; partially cancelled ones are flagged pick-short).
 *   updateJobsPriority / assignJobs — wrap `domain/jobs` and bump `jobs.version` on every
 *                        mutation, rejecting stale writes with CONFLICT (optimistic concurrency).
 */
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { Priority } from "@/lib/enums";
import type { AppDb } from "@/server/api/db";
import * as schema from "@/server/db/schema";
import { allocation, DomainError, jobs as jobsDomain, runBulk, stateMachines, tasks as tasksDomain } from "@/server/domain";
import { recordUpdate } from "@/server/domain/change-log";
import { rollupJob, rollupOrderStatus } from "@/server/domain/progress";
import { getCountLine, moveLine, restoreRecountOriginal, rollupCountPlan } from "@/server/domain/task-handlers/count";
import { markOrderShort, reducePlanned } from "@/server/domain/task-handlers/shared";
import type { BulkResult, DomainCtx, Tx } from "@/server/domain/types";
import { cancelPicking as cancelWorkOrderPicking } from "./work-orders-commands";
import { qc } from "./jobs-grid";
import { settleJob } from "./jobs-settle";
import { assertEligibleAssignee } from "./wave-rules-options";

type JobRow = typeof schema.jobs.$inferSelect;
type TaskRow = typeof schema.tasks.$inferSelect;

/** Expected `version` per job id (optional per id). */
export type JobVersions = Readonly<Record<string, number>>;

const DOWNSTREAM_TYPES = ["Packing", "Sorting", "Loading"] as const;

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

function assertVersion(job: JobRow, versions: JobVersions | undefined): void {
  const expected = versions?.[job.id];
  if (expected !== undefined && expected !== job.version) {
    throw new DomainError("CONFLICT", `Job ${job.code} changed since you opened it. Reload and try again.`);
  }
}

function bumpJob(tx: Tx, ctx: DomainCtx, jobId: string): void {
  tx.update(schema.jobs).set({ version: sql`${qc(schema.jobs.version)} + 1`, updatedBy: ctx.userId }).where(eq(schema.jobs.id, jobId)).run();
}

function throwFirstFailure(res: BulkResult): void {
  const f = res.failed[0];
  if (f) throw new DomainError((f.code as ConstructorParameters<typeof DomainError>[0]) ?? "INVALID_STATE", f.message);
}

/* ------------------------------------------------------------ versioned edits */

export interface PriorityResult extends BulkResult {
  /** Jobs that already had the requested priority: nothing written (no version bump, no audit row). */
  readonly unchanged: readonly string[];
  readonly message: string;
}

/**
 * Critic R4: a no-op update (None -> None) used to bump `version` / `updated_by` without a
 * change-log row. Rows whose priority is already the requested one are skipped and reported
 * as `unchanged`, so every version bump has an audit trail.
 */
export function updateJobsPriority(db: AppDb, ctx: DomainCtx, ids: readonly string[], priority: Priority, versions?: JobVersions): PriorityResult {
  const unchanged = new Set<string>();
  const res = runBulk(db, ids, (tx, id) => {
    const job = jobsDomain.getJob(tx, ctx, id);
    assertVersion(job, versions);
    if (job.status === "Completed" || job.status === "Cancelled") throw new DomainError("INVALID_STATE", `Job ${job.code} is ${job.status}.`);
    if (job.priority === priority) {
      unchanged.add(id);
      return;
    }
    throwFirstFailure(jobsDomain.updatePriority(tx, ctx, { jobIds: [id], priority }));
    // The domain bumps jobs.version itself (fulfillment-jobs R2-5 / R2-11).
  });
  const succeeded = res.succeeded.filter((id) => !unchanged.has(id));
  const parts: string[] = [];
  if (succeeded.length > 0) parts.push(`${plural(succeeded.length, "job")} set to ${priority}`);
  if (unchanged.size > 0) parts.push(`${plural(unchanged.size, "job")} already ${priority}`);
  return { succeeded, failed: res.failed, unchanged: [...unchanged], message: parts.join(" · ") };
}

export function assignJobs(db: AppDb, ctx: DomainCtx, ids: readonly string[], userId: string | null, versions?: JobVersions): BulkResult {
  if (userId) {
    const warehouses = db.select({ wh: schema.jobs.warehouseId }).from(schema.jobs).where(inArray(schema.jobs.id, [...ids])).all().map((r) => r.wh);
    assertEligibleAssignee(db, userId, warehouses);
  }
  return runBulk(db, ids, (tx, id) => {
    const job = jobsDomain.getJob(tx, ctx, id);
    assertVersion(job, versions);
    if (!userId && !job.assignedToUserId) throw new DomainError("INVALID_STATE", `Job ${job.code} has no assignee.`);
    throwFirstFailure(jobsDomain.assign(tx, ctx, { jobIds: [id], userId }));
    // The domain bumps jobs.version itself.
  });
}

/* --------------------------------------------------------------- task cancel */

function cancelRows(tx: Tx, ctx: DomainCtx, ids: readonly string[]): void {
  if (ids.length === 0) return;
  tx.update(schema.tasks).set({ status: "Cancelled", updatedBy: ctx.userId, version: sql`${qc(schema.tasks.version)} + 1` })
    .where(and(inArray(schema.tasks.id, [...ids]), inArray(schema.tasks.status, ["Pending", "Started"]))).run();
}

function orderTasks(tx: Tx, orderId: string): TaskRow[] {
  return tx.select().from(schema.tasks).where(and(eq(schema.tasks.orderId, orderId), ne(schema.tasks.status, "Cancelled"))).all();
}

/** Detaches an order whose picking was fully cancelled: pending tasks cancelled, out of the job, back to Open. */
function reopenOrder(tx: Tx, ctx: DomainCtx, orderId: string, jobIds: ReadonlySet<string>): void {
  const order = tx.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, orderId)).get();
  if (!order) return;
  cancelRows(tx, ctx, orderTasks(tx, orderId).filter((t) => t.status === "Pending" && jobIds.has(t.jobId)).map((t) => t.id));
  for (const jobId of jobIds) {
    const live = tx.select({ id: schema.tasks.id }).from(schema.tasks)
      .where(and(eq(schema.tasks.jobId, jobId), eq(schema.tasks.orderId, orderId), ne(schema.tasks.status, "Cancelled"))).get();
    if (!live) tx.delete(schema.jobOrders).where(and(eq(schema.jobOrders.jobId, jobId), eq(schema.jobOrders.orderId, orderId))).run();
    tx.update(schema.inventoryAllocations).set({ jobId: null, taskId: null, updatedBy: ctx.userId })
      .where(and(eq(schema.inventoryAllocations.orderId, orderId), eq(schema.inventoryAllocations.jobId, jobId))).run();
  }
  const fresh = tx.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, orderId)).get();
  if (!fresh) return;
  if (fresh.jobId && jobIds.has(fresh.jobId)) {
    tx.update(schema.shipmentOrders).set({ jobId: null, updatedBy: ctx.userId }).where(eq(schema.shipmentOrders.id, orderId)).run();
  }
  if (fresh.status === "Ready to Pick" || fresh.status === "Shortage") allocation.deallocateOrder(tx, ctx, { ...fresh, jobId: null });
}

export interface CancelTasksOutcome {
  readonly cancelled: number;
  readonly downstreamReduced: number;
  readonly downstreamCancelled: number;
  readonly ordersReopened: number;
  readonly ordersShort: number;
}

/**
 * Cancels pending tasks with the downstream cascade. Runs inside the caller's transaction;
 * any task that is not Pending fails the whole call.
 */
export function cancelTasksCascade(tx: Tx, ctx: DomainCtx, taskIds: readonly string[]): CancelTasksOutcome {
  const tasks = [...new Set(taskIds)].map((id) => tasksDomain.getTask(tx, ctx, id));
  for (const t of tasks) {
    if (t.status !== "Pending") throw new DomainError("INVALID_STATE", `Only pending tasks can be cancelled; task ${t.taskNo} is ${t.status.toLowerCase()}.`);
  }
  // Picking first so their downstream reductions see the final state.
  const ordered = [...tasks].sort((a, b) => Number(b.taskType === "Picking") - Number(a.taskType === "Picking"));
  const perOrder = new Map<string, { jobIds: Set<string>; lines: Map<string, number>; units: number }>();
  let cancelled = 0;
  for (const task of ordered) {
    const fresh = tx.select({ status: schema.tasks.status }).from(schema.tasks).where(eq(schema.tasks.id, task.id)).get();
    if (fresh?.status !== "Pending") continue; // already cancelled by an earlier cascade step
    tasksDomain.cancel(tx, ctx, { taskIds: [task.id] });
    cancelled += 1;
    if (task.taskType === "Picking" && task.orderId) {
      const entry = perOrder.get(task.orderId) ?? { jobIds: new Set<string>(), lines: new Map<string, number>(), units: 0 };
      const qty = Math.max(0, task.plannedQty - task.actualQty);
      entry.jobIds.add(task.jobId);
      if (task.orderLineId) entry.lines.set(task.orderLineId, (entry.lines.get(task.orderLineId) ?? 0) + qty);
      entry.units += qty;
      perOrder.set(task.orderId, entry);
    }
  }
  let downstreamReduced = 0;
  let downstreamCancelled = 0;
  let ordersReopened = 0;
  let ordersShort = 0;
  const touchedJobs = new Set(tasks.map((t) => t.jobId));
  for (const [orderId, entry] of perOrder) {
    const live = orderTasks(tx, orderId);
    const picks = live.filter((t) => t.taskType === "Picking");
    if (picks.length === 0) {
      reopenOrder(tx, ctx, orderId, entry.jobIds);
      ordersReopened += 1;
    } else {
      const before = new Map(live.filter((t) => t.status === "Pending" && (DOWNSTREAM_TYPES as readonly string[]).includes(t.taskType)).map((t) => [t.id, t.plannedQty]));
      for (const [lineId, qty] of entry.lines) reducePlanned(tx, lineId, qty);
      if (entry.units > 0) {
        tx.update(schema.tasks).set({ plannedQty: sql`MAX(${qc(schema.tasks.plannedQty)} - ${entry.units}, 0)` })
          .where(and(eq(schema.tasks.orderId, orderId), eq(schema.tasks.taskType, "Loading"), eq(schema.tasks.status, "Pending"))).run();
      }
      const after = orderTasks(tx, orderId).filter((t) => before.has(t.id));
      downstreamReduced += after.filter((t) => t.plannedQty > 0 && t.plannedQty !== before.get(t.id)).length;
      const empty = after.filter((t) => t.plannedQty <= 0).map((t) => t.id);
      cancelRows(tx, ctx, empty);
      downstreamCancelled += empty.length;
      markOrderShort(tx, ctx, orderId, "pick");
      ordersShort += 1;
      rollupOrderStatus(tx, ctx, orderId);
    }
    for (const id of entry.jobIds) touchedJobs.add(id);
  }
  for (const jobId of touchedJobs) {
    rollupJob(tx, ctx, jobId);
    // Critic R4: the last live task gone -> the job closes (Cancelled / Completed) instead of staying Pending.
    settleJob(tx, ctx, jobId);
  }
  return { cancelled, downstreamReduced, downstreamCancelled, ordersReopened, ordersShort };
}

/** Per-id task cancel with cascade (a failing task does not block the others). */
export function cancelTasks(db: AppDb, ctx: DomainCtx, ids: readonly string[]): BulkResult & { message: string } {
  let reduced = 0;
  let reopened = 0;
  let short = 0;
  const res = runBulk(db, ids, (tx, id) => {
    const out = cancelTasksCascade(tx, ctx, [id]);
    reduced += out.downstreamReduced + out.downstreamCancelled;
    reopened += out.ordersReopened;
    short += out.ordersShort;
  });
  const parts = [`${plural(res.succeeded.length, "task")} cancelled`];
  if (reduced > 0) parts.push(`${plural(reduced, "dependent task")} adjusted`);
  if (reopened > 0) parts.push(`${plural(reopened, "order")} back to Open`);
  if (short > 0) parts.push(`${plural(short, "order")} flagged pick short`);
  return { ...res, message: parts.join(" · ") };
}

/* ---------------------------------------------------------------- job cancel */

export interface CancelJobOutcome {
  readonly jobId: string;
  readonly code: string;
  readonly cancelledTasks: number;
  readonly keptTasks: number;
  readonly status: JobRow["status"];
}

/** Tasks a part-way executed job keeps: downstream work of picked units and put-phase moves. */
function keepsInPartialCancel(t: TaskRow): boolean {
  if ((DOWNSTREAM_TYPES as readonly string[]).includes(t.taskType)) return true;
  return t.taskType === "Replenishment" && t.replenishmentPhase === "Replenishment Put Phase";
}

/** Count lines a cancelled count job can release (not counted yet). Counted lines keep their result. */
const RELEASABLE_LINE_STATUSES = ["Pending", "Ready To Count", "Count Started"] as const;

/**
 * Critic R3 / R2-14: cancelling a count job releases its uncounted count-plan lines (line → Cancelled,
 * which lifts any Lock Locations lock) and rolls the plan up, so nothing stays locked or open behind a
 * cancelled job. A line still worked by another live task is left alone.
 */
export function releaseCountLines(tx: Tx, ctx: DomainCtx, jobId: string): number {
  const lineIds = [...new Set(tx.select({ l: schema.tasks.countLineId }).from(schema.tasks).where(eq(schema.tasks.jobId, jobId)).all().map((r) => r.l).filter((l): l is string => Boolean(l)))];
  const plans = new Set<string>();
  let released = 0;
  for (const id of lineIds) {
    const line = getCountLine(tx, id);
    if (!(RELEASABLE_LINE_STATUSES as readonly string[]).includes(line.status)) continue;
    const live = tx.select({ id: schema.tasks.id }).from(schema.tasks).where(and(eq(schema.tasks.countLineId, id), inArray(schema.tasks.status, ["Pending", "Started"]))).get();
    if (live) continue;
    moveLine(tx, ctx, line, "Cancelled");
    restoreRecountOriginal(tx, ctx, line);
    plans.add(line.planId);
    released += 1;
  }
  for (const planId of plans) rollupCountPlan(tx, ctx, planId);
  return released;
}

export function cancelJobCascade(tx: Tx, ctx: DomainCtx, jobId: string, versions?: JobVersions): CancelJobOutcome {
  const job = jobsDomain.getJob(tx, ctx, jobId);
  assertVersion(job, versions);
  stateMachines.job.transition(job.status, "Cancelled"); // Completed / Cancelled fail here
  const all = tx.select().from(schema.tasks).where(and(eq(schema.tasks.jobId, job.id), ne(schema.tasks.status, "Cancelled"))).all();
  const inProgress = all.filter((t) => t.status === "Started");
  if (inProgress.length > 0) {
    throw new DomainError("INVALID_STATE", `${plural(inProgress.length, "task")} of job ${job.code} ${inProgress.length === 1 ? "is" : "are"} in progress (task ${inProgress.map((t) => t.taskNo).slice(0, 3).join(", ")}). Finish or short-pick ${inProgress.length === 1 ? "it" : "them"} before cancelling the job.`);
  }
  const completed = all.filter((t) => t.status === "Completed");
  const pending = all.filter((t) => t.status === "Pending");
  let cancelledTasks = pending.length;

  if (completed.length === 0) {
    if (job.operationType === "Work Order" && job.workOrderId) {
      cancelWorkOrderPicking(tx, ctx, job.workOrderId);
    } else {
      const hasOrders = tx.select({ id: schema.jobOrders.orderId }).from(schema.jobOrders).where(eq(schema.jobOrders.jobId, job.id)).get();
      if (hasOrders) jobsDomain.cancelJob(tx, ctx, { jobId: job.id });
    }
    // Sweep everything still open (count / replenishment / kitting tasks have no order to detach).
    const leftover = tx.select().from(schema.tasks).where(and(eq(schema.tasks.jobId, job.id), eq(schema.tasks.status, "Pending"))).all();
    const picks = leftover.filter((t) => t.taskType === "Picking" && t.allocationId);
    if (picks.length > 0) cancelTasksCascade(tx, ctx, picks.map((t) => t.id));
    cancelRows(tx, ctx, tx.select({ id: schema.tasks.id }).from(schema.tasks).where(and(eq(schema.tasks.jobId, job.id), eq(schema.tasks.status, "Pending"))).all().map((t) => t.id));
    const current = tx.select().from(schema.jobs).where(eq(schema.jobs.id, job.id)).get() as JobRow;
    if (current.status !== "Cancelled") {
      tx.update(schema.jobs).set({ status: stateMachines.job.transition(current.status, "Cancelled"), updatedBy: ctx.userId }).where(eq(schema.jobs.id, job.id)).run();
      recordUpdate(tx, ctx, { entityType: "job", entityId: job.id, entityCode: job.code, before: { status: current.status }, after: { status: "Cancelled" } });
    }
    rollupJob(tx, ctx, job.id);
  } else {
    if (job.operationType === "Work Order") {
      throw new DomainError("INVALID_STATE", `Components of job ${job.code} are already picked to the kitting area. Build the kits or cancel picking from the work order.`);
    }
    const toCancel = pending.filter((t) => !keepsInPartialCancel(t));
    cancelledTasks = toCancel.length;
    if (toCancel.length === 0) throw new DomainError("INVALID_STATE", `Job ${job.code} has no remaining work to cancel; its open tasks carry already-picked stock.`);
    cancelTasksCascade(tx, ctx, toCancel.map((t) => t.id));
    rollupJob(tx, ctx, job.id);
    recordUpdate(tx, ctx, {
      entityType: "job", entityId: job.id, entityCode: job.code,
      before: { remainingTasks: pending.length }, after: { remainingTasks: pending.length - toCancel.length },
    });
  }
  if (job.operationType === "Count") releaseCountLines(tx, ctx, job.id);
  bumpJob(tx, ctx, job.id);
  const final = tx.select().from(schema.jobs).where(eq(schema.jobs.id, job.id)).get() as JobRow;
  const kept = tx.select({ n: sql<number>`COUNT(*)` }).from(schema.tasks).where(and(eq(schema.tasks.jobId, job.id), ne(schema.tasks.status, "Cancelled"))).get()?.n ?? 0;
  return { jobId: job.id, code: job.code, cancelledTasks, keptTasks: Number(kept), status: final.status };
}

/** Bulk Cancel for Job Management (per-id savepoints) with a human summary. */
export function cancelJobs(db: AppDb, ctx: DomainCtx, ids: readonly string[], versions?: JobVersions): BulkResult & { message: string; outcomes: CancelJobOutcome[] } {
  const outcomes: CancelJobOutcome[] = [];
  const res = runBulk(db, ids, (tx, id) => { outcomes.push(cancelJobCascade(tx, ctx, id, versions)); });
  const tasks = outcomes.reduce((s, o) => s + o.cancelledTasks, 0);
  const partial = outcomes.filter((o) => o.status !== "Cancelled");
  const parts = [`${plural(outcomes.length - partial.length, "job")} cancelled`];
  if (partial.length > 0) parts.push(`remaining work cancelled on ${partial.map((o) => o.code).join(", ")} (completed work kept)`);
  parts.push(`${plural(tasks, "pending task")} cancelled`);
  return { ...res, message: parts.join(" · "), outcomes };
}
