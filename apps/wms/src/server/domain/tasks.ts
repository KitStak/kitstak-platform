/**
 * Task commands (BUILD_PLAN F5 `tasks.ts`): execute (dispatch to task-handlers/<type>),
 * update (target location / LP, move to another job) and cancel.
 */
import { and, eq, inArray, ne } from 'drizzle-orm';
import * as schema from '@/server/db/schema';
import { recordUpdate } from './change-log';
import { DomainError } from './errors';
import { getJob, releaseForLine } from './jobs';
import { getAllocation } from './ledger/allocations';
import { getLocation, getLp } from './ledger/rules';
import { rollupJob, rollupOrderStatus } from './progress';
import { stateMachines } from './state-machines';
import { TASK_HANDLERS, type TaskExecuteInput, type TaskExecution, type TaskRow } from './task-handlers';
import { checkScope, type DomainCtx, type Tx } from './types';

export async function getTask(tx: Tx, ctx: DomainCtx, taskId: string): Promise<TaskRow> {
  const task = (await tx.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).limit(1))[0];
  if (!task) throw new DomainError('NOT_FOUND', 'Task not found');
  checkScope(ctx, { warehouseId: task.warehouseId, clientId: task.clientId }, 'Task');
  return task;
}

export interface ExecuteInput extends TaskExecuteInput {
  readonly taskIds: readonly string[];
}

async function rollups(tx: Tx, ctx: DomainCtx, tasks: readonly TaskRow[]): Promise<void> {
  const orderIds = new Set(tasks.flatMap((t) => (t.orderId ? [t.orderId] : [])));
  for (const id of orderIds) await rollupOrderStatus(tx, ctx, id);
  const jobIds = new Set(tasks.map((t) => t.jobId));
  const extra = await tx
    .select({ jobId: schema.jobOrders.jobId })
    .from(schema.jobOrders)
    .where(inArray(schema.jobOrders.orderId, orderIds.size > 0 ? [...orderIds] : ['']));
  for (const r of extra) jobIds.add(r.jobId);
  for (const id of jobIds) await rollupJob(tx, ctx, id);
}

/**
 * Executes tasks in order. All tasks run in the caller's transaction: if one fails, the
 * whole execute call fails (scanning flows execute one task at a time).
 */
export async function execute(tx: Tx, ctx: DomainCtx, input: ExecuteInput): Promise<TaskExecution[]> {
  if (input.taskIds.length === 0) throw new DomainError('VALIDATION', 'Select at least one task');
  const target = await getLocation(tx, input.targetLocationId);
  if (input.targetLpId) await getLp(tx, input.targetLpId);
  const results: TaskExecution[] = [];
  const done: TaskRow[] = [];
  for (const id of input.taskIds) {
    const task = await getTask(tx, ctx, id);
    if (task.warehouseId !== target.warehouseId)
      throw new DomainError('VALIDATION', `Location ${target.code} is in another warehouse.`);
    const handler = TASK_HANDLERS[task.taskType];
    results.push(
      await handler(tx, ctx, task, { ...input, qty: input.taskIds.length === 1 ? input.qty : undefined }),
    );
    done.push(task);
  }
  await rollups(tx, ctx, done);
  return results;
}

export interface UpdateTaskInput {
  readonly taskId: string;
  readonly targetLocationId?: string | null;
  readonly targetLpId?: string | null;
  readonly moveToJobId?: string;
}

export async function update(tx: Tx, ctx: DomainCtx, input: UpdateTaskInput): Promise<TaskRow> {
  const task = await getTask(tx, ctx, input.taskId);
  if (task.status !== 'Pending')
    throw new DomainError(
      'INVALID_STATE',
      `Only pending tasks can be changed; task ${task.taskNo} is ${task.status.toLowerCase()}.`,
    );
  const patch: Partial<typeof schema.tasks.$inferInsert> = { updatedBy: ctx.userId };
  if (input.targetLocationId !== undefined) {
    if (input.targetLocationId) {
      const loc = await getLocation(tx, input.targetLocationId);
      if (loc.warehouseId !== task.warehouseId)
        throw new DomainError('VALIDATION', `Location ${loc.code} is in another warehouse.`);
    }
    patch.targetLocationId = input.targetLocationId;
  }
  if (input.targetLpId !== undefined) {
    if (input.targetLpId) await getLp(tx, input.targetLpId);
    patch.targetLpId = input.targetLpId;
  }
  const fromJobId = task.jobId;
  if (input.moveToJobId && input.moveToJobId !== task.jobId) {
    const job = await getJob(tx, ctx, input.moveToJobId);
    if (job.warehouseId !== task.warehouseId)
      throw new DomainError('VALIDATION', `Job ${job.code} is in another warehouse.`);
    if (job.status === 'Completed' || job.status === 'Cancelled')
      throw new DomainError('INVALID_STATE', `Job ${job.code} is ${job.status}.`);
    patch.jobId = job.id;
    if (task.allocationId)
      await tx
        .update(schema.inventoryAllocations)
        .set({ jobId: job.id })
        .where(eq(schema.inventoryAllocations.id, task.allocationId));
    if (task.orderId)
      await tx
        .insert(schema.jobOrders)
        .values({ jobId: job.id, orderId: task.orderId })
        .onConflictDoNothing();
  }
  const updated = (
    await tx.update(schema.tasks).set(patch).where(eq(schema.tasks.id, task.id)).returning()
  )[0];
  await recordUpdate(tx, ctx, {
    entityType: 'task',
    entityId: task.id,
    entityCode: String(task.taskNo),
    before: { targetLocationId: task.targetLocationId, targetLpId: task.targetLpId, jobId: task.jobId },
    after: {
      targetLocationId: updated.targetLocationId,
      targetLpId: updated.targetLpId,
      jobId: updated.jobId,
    },
  });
  if (updated.jobId !== fromJobId) {
    await rollupJob(tx, ctx, fromJobId);
    await rollupJob(tx, ctx, updated.jobId);
  }
  return updated;
}

/** Cancels pending tasks. A cancelled picking task releases its allocation. */
export async function cancel(tx: Tx, ctx: DomainCtx, input: { taskIds: readonly string[] }): Promise<number> {
  const cancelled: TaskRow[] = [];
  for (const id of new Set(input.taskIds)) {
    const task = await getTask(tx, ctx, id);
    if (task.status !== 'Pending')
      throw new DomainError(
        'INVALID_STATE',
        `Only pending tasks can be cancelled; task ${task.taskNo} is ${task.status.toLowerCase()}.`,
      );
    const status = stateMachines.task.transition(task.status, 'Cancelled');
    if (task.taskType === 'Picking' && task.allocationId) {
      const alloc = await getAllocation(tx, task.allocationId);
      if (alloc.status === 'Allocated') await releaseForLine(tx, ctx, alloc, alloc.qty);
    }
    await tx.update(schema.tasks).set({ status, updatedBy: ctx.userId }).where(eq(schema.tasks.id, task.id));
    cancelled.push(task);
  }
  for (const orderId of new Set(cancelled.flatMap((t) => (t.orderId ? [t.orderId] : []))))
    await reopenIfEmpty(tx, ctx, orderId);
  await rollups(tx, ctx, cancelled);
  return cancelled.length;
}

/** An order whose picking tasks were all cancelled before any pick goes back to Open. */
async function reopenIfEmpty(tx: Tx, ctx: DomainCtx, orderId: string): Promise<void> {
  const live = (
    await tx
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.orderId, orderId),
          eq(schema.tasks.taskType, 'Picking'),
          ne(schema.tasks.status, 'Cancelled'),
        ),
      )
      .limit(1)
  )[0];
  if (live) return;
  const order = (
    await tx.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, orderId)).limit(1)
  )[0];
  if (!order || order.status !== 'Ready to Pick') return;
  await tx
    .update(schema.tasks)
    .set({ status: 'Cancelled' })
    .where(and(eq(schema.tasks.orderId, orderId), eq(schema.tasks.status, 'Pending')));
  await tx
    .update(schema.shipmentOrders)
    .set({
      status: stateMachines.shipmentOrder.transition(order.status, 'Open'),
      jobId: null,
      updatedBy: ctx.userId,
    })
    .where(eq(schema.shipmentOrders.id, orderId));
  await recordUpdate(tx, ctx, {
    entityType: 'shipment_order',
    entityId: order.id,
    entityCode: order.code,
    before: { status: order.status },
    after: { status: 'Open' },
  });
}
