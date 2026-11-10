/**
 * Task commands (BUILD_PLAN F5 `tasks.ts`): execute (dispatch to task-handlers/<type>),
 * update (target location / LP, move to another job) and cancel.
 */
import { and, eq, inArray, ne } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import { recordUpdate } from "./change-log";
import { DomainError } from "./errors";
import { getJob, releaseForLine } from "./jobs";
import { getAllocation } from "./ledger/allocations";
import { getLocation, getLp } from "./ledger/rules";
import { rollupJob, rollupOrderStatus } from "./progress";
import { stateMachines } from "./state-machines";
import { TASK_HANDLERS, type TaskExecuteInput, type TaskExecution, type TaskRow } from "./task-handlers";
import { checkScope, type DomainCtx, type Tx } from "./types";

export function getTask(tx: Tx, ctx: DomainCtx, taskId: string): TaskRow {
  const task = tx.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
  if (!task) throw new DomainError("NOT_FOUND", "Task not found");
  checkScope(ctx, { warehouseId: task.warehouseId, clientId: task.clientId }, "Task");
  return task;
}

export interface ExecuteInput extends TaskExecuteInput {
  readonly taskIds: readonly string[];
}

function rollups(tx: Tx, ctx: DomainCtx, tasks: readonly TaskRow[]): void {
  const orderIds = new Set(tasks.flatMap((t) => (t.orderId ? [t.orderId] : [])));
  for (const id of orderIds) rollupOrderStatus(tx, ctx, id);
  const jobIds = new Set(tasks.map((t) => t.jobId));
  const extra = tx.select({ jobId: schema.jobOrders.jobId }).from(schema.jobOrders)
    .where(inArray(schema.jobOrders.orderId, orderIds.size > 0 ? [...orderIds] : [""])).all();
  for (const r of extra) jobIds.add(r.jobId);
  for (const id of jobIds) rollupJob(tx, ctx, id);
}

/**
 * Executes tasks in order. All tasks run in the caller's transaction: if one fails, the
 * whole execute call fails (scanning flows execute one task at a time).
 */
export function execute(tx: Tx, ctx: DomainCtx, input: ExecuteInput): TaskExecution[] {
  if (input.taskIds.length === 0) throw new DomainError("VALIDATION", "Select at least one task");
  const target = getLocation(tx, input.targetLocationId);
  if (input.targetLpId) getLp(tx, input.targetLpId);
  const results: TaskExecution[] = [];
  const done: TaskRow[] = [];
  for (const id of input.taskIds) {
    const task = getTask(tx, ctx, id);
    if (task.warehouseId !== target.warehouseId) throw new DomainError("VALIDATION", `Location ${target.code} is in another warehouse.`);
    const handler = TASK_HANDLERS[task.taskType];
    results.push(handler(tx, ctx, task, { ...input, qty: input.taskIds.length === 1 ? input.qty : undefined }));
    done.push(task);
  }
  rollups(tx, ctx, done);
  return results;
}

export interface UpdateTaskInput {
  readonly taskId: string;
  readonly targetLocationId?: string | null;
  readonly targetLpId?: string | null;
  readonly moveToJobId?: string;
}

export function update(tx: Tx, ctx: DomainCtx, input: UpdateTaskInput): TaskRow {
  const task = getTask(tx, ctx, input.taskId);
  if (task.status !== "Pending") throw new DomainError("INVALID_STATE", `Only pending tasks can be changed; task ${task.taskNo} is ${task.status.toLowerCase()}.`);
  const patch: Partial<typeof schema.tasks.$inferInsert> = { updatedBy: ctx.userId };
  if (input.targetLocationId !== undefined) {
    if (input.targetLocationId) {
      const loc = getLocation(tx, input.targetLocationId);
      if (loc.warehouseId !== task.warehouseId) throw new DomainError("VALIDATION", `Location ${loc.code} is in another warehouse.`);
    }
    patch.targetLocationId = input.targetLocationId;
  }
  if (input.targetLpId !== undefined) {
    if (input.targetLpId) getLp(tx, input.targetLpId);
    patch.targetLpId = input.targetLpId;
  }
  const fromJobId = task.jobId;
  if (input.moveToJobId && input.moveToJobId !== task.jobId) {
    const job = getJob(tx, ctx, input.moveToJobId);
    if (job.warehouseId !== task.warehouseId) throw new DomainError("VALIDATION", `Job ${job.code} is in another warehouse.`);
    if (job.status === "Completed" || job.status === "Cancelled") throw new DomainError("INVALID_STATE", `Job ${job.code} is ${job.status}.`);
    patch.jobId = job.id;
    if (task.allocationId) tx.update(schema.inventoryAllocations).set({ jobId: job.id }).where(eq(schema.inventoryAllocations.id, task.allocationId)).run();
    if (task.orderId) tx.insert(schema.jobOrders).values({ jobId: job.id, orderId: task.orderId }).onConflictDoNothing().run();
  }
  const updated = tx.update(schema.tasks).set(patch).where(eq(schema.tasks.id, task.id)).returning().get();
  recordUpdate(tx, ctx, {
    entityType: "task", entityId: task.id, entityCode: String(task.taskNo),
    before: { targetLocationId: task.targetLocationId, targetLpId: task.targetLpId, jobId: task.jobId },
    after: { targetLocationId: updated.targetLocationId, targetLpId: updated.targetLpId, jobId: updated.jobId },
  });
  if (updated.jobId !== fromJobId) {
    rollupJob(tx, ctx, fromJobId);
    rollupJob(tx, ctx, updated.jobId);
  }
  return updated;
}

/** Cancels pending tasks. A cancelled picking task releases its allocation. */
export function cancel(tx: Tx, ctx: DomainCtx, input: { taskIds: readonly string[] }): number {
  const cancelled: TaskRow[] = [];
  for (const id of new Set(input.taskIds)) {
    const task = getTask(tx, ctx, id);
    if (task.status !== "Pending") throw new DomainError("INVALID_STATE", `Only pending tasks can be cancelled; task ${task.taskNo} is ${task.status.toLowerCase()}.`);
    const status = stateMachines.task.transition(task.status, "Cancelled");
    if (task.taskType === "Picking" && task.allocationId) {
      const alloc = getAllocation(tx, task.allocationId);
      if (alloc.status === "Allocated") releaseForLine(tx, ctx, alloc, alloc.qty);
    }
    tx.update(schema.tasks).set({ status, updatedBy: ctx.userId }).where(eq(schema.tasks.id, task.id)).run();
    cancelled.push(task);
  }
  for (const orderId of new Set(cancelled.flatMap((t) => (t.orderId ? [t.orderId] : [])))) reopenIfEmpty(tx, ctx, orderId);
  rollups(tx, ctx, cancelled);
  return cancelled.length;
}

/** An order whose picking tasks were all cancelled before any pick goes back to Open. */
function reopenIfEmpty(tx: Tx, ctx: DomainCtx, orderId: string): void {
  const live = tx.select({ id: schema.tasks.id }).from(schema.tasks)
    .where(and(eq(schema.tasks.orderId, orderId), eq(schema.tasks.taskType, "Picking"), ne(schema.tasks.status, "Cancelled"))).get();
  if (live) return;
  const order = tx.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, orderId)).get();
  if (!order || order.status !== "Ready to Pick") return;
  tx.update(schema.tasks).set({ status: "Cancelled" }).where(and(eq(schema.tasks.orderId, orderId), eq(schema.tasks.status, "Pending"))).run();
  tx.update(schema.shipmentOrders).set({ status: stateMachines.shipmentOrder.transition(order.status, "Open"), jobId: null, updatedBy: ctx.userId })
    .where(eq(schema.shipmentOrders.id, orderId)).run();
  recordUpdate(tx, ctx, { entityType: "shipment_order", entityId: order.id, entityCode: order.code, before: { status: order.status }, after: { status: "Open" } });
}
