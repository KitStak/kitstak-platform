/**
 * Order-status and job-progress roll-ups after task execution.
 *
 * The order's target status is derived from its (non-cancelled) tasks; the move is
 * validated against the SO state machine by walking the shortest valid path.
 */
import { and, eq, ne, sql } from 'drizzle-orm';
import type { SoStatus } from '@/lib/enums';
import * as schema from '@/server/db/schema';
import { recordUpdate } from './change-log';
import { DomainError } from './errors';
import { stateMachines } from './state-machines';
import { nowIso, type DomainCtx, type Tx } from './types';
import { dbGet } from '@/server/db/sql';

type TaskRow = typeof schema.tasks.$inferSelect;
type Stage = 'none' | 'pending' | 'started' | 'done';

const PIPELINE: readonly SoStatus[] = [
  'Ready to Pick',
  'Picking Started',
  'Ready to Sort',
  'Sorting Started',
  'Ready to Pack',
  'Packing Started',
  'Ready to Load',
  'Loading Started',
  'Ready to Ship',
];

function stage(tasks: readonly TaskRow[]): Stage {
  if (tasks.length === 0) return 'none';
  if (tasks.every((t) => t.status === 'Completed')) return 'done';
  return tasks.some((t) => t.status === 'Completed' || t.status === 'Started') ? 'started' : 'pending';
}

export function targetOrderStatus(tasks: readonly TaskRow[]): SoStatus | null {
  const by = (type: TaskRow['taskType']) => tasks.filter((t) => t.taskType === type);
  const pick = stage(by('Picking'));
  if (pick === 'none') return null;
  if (pick !== 'done') return pick === 'started' ? 'Picking Started' : 'Ready to Pick';
  const steps: [TaskRow['taskType'], SoStatus, SoStatus][] = [
    ['Sorting', 'Ready to Sort', 'Sorting Started'],
    ['Packing', 'Ready to Pack', 'Packing Started'],
    ['Loading', 'Ready to Load', 'Loading Started'],
  ];
  for (const [type, ready, started] of steps) {
    const s = stage(by(type));
    if (s === 'pending') return ready;
    if (s === 'started') return started;
  }
  return 'Ready to Ship';
}

/** Moves the order along the fulfilment pipeline to match its tasks. Returns the new status. */
export async function rollupOrderStatus(tx: Tx, ctx: DomainCtx, orderId: string): Promise<SoStatus> {
  const order = (
    await tx.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, orderId)).limit(1)
  )[0];
  if (!order) throw new DomainError('NOT_FOUND', 'Shipment order not found');
  if (!PIPELINE.includes(order.status)) return order.status;
  const tasks = await tx
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.orderId, orderId), ne(schema.tasks.status, 'Cancelled')));
  const target = targetOrderStatus(tasks);
  if (!target || target === order.status) return order.status;
  const path = stateMachines.shipmentOrder.path(order.status, target);
  if (!path)
    throw new DomainError(
      'INVALID_STATE',
      `Order ${order.code} can't move from ${order.status} to ${target}.`,
    );
  await tx
    .update(schema.shipmentOrders)
    .set({ status: target, updatedBy: ctx.userId, version: sql`${schema.shipmentOrders.version} + 1` })
    .where(eq(schema.shipmentOrders.id, orderId));
  await recordUpdate(tx, ctx, {
    entityType: 'shipment_order',
    entityId: order.id,
    entityCode: order.code,
    before: { status: order.status },
    after: { status: target },
  });
  return target;
}

export interface JobProgress {
  readonly taskCount: number;
  readonly completedTaskCount: number;
  readonly unitCount: number;
  readonly completedUnits: number;
  readonly percent: number;
}

export async function jobProgress(tx: Tx, jobId: string): Promise<JobProgress> {
  const tasks = await tx
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.jobId, jobId), ne(schema.tasks.status, 'Cancelled')));
  const picking = tasks.filter(
    (t) =>
      t.taskType === 'Picking' ||
      t.taskType === 'Count' ||
      t.taskType === 'Replenishment' ||
      t.taskType === 'Kitting',
  );
  const taskCount = tasks.length;
  const completedTaskCount = tasks.filter((t) => t.status === 'Completed').length;
  return {
    taskCount,
    completedTaskCount,
    unitCount: picking.reduce((s, t) => s + t.plannedQty, 0),
    completedUnits: picking.reduce((s, t) => s + t.actualQty, 0),
    percent: taskCount === 0 ? 0 : Math.round((completedTaskCount / taskCount) * 100),
  };
}

/** Recomputes job counters and moves Pending -> Started -> Completed. */
export async function rollupJob(tx: Tx, ctx: DomainCtx, jobId: string): Promise<void> {
  const job = (await tx.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).limit(1))[0];
  if (!job) throw new DomainError('NOT_FOUND', 'Job not found');
  const p = await jobProgress(tx, jobId);
  const orderCount =
    (
      await tx
        .select({ n: sql<number>`COUNT(*)` })
        .from(schema.jobOrders)
        .where(eq(schema.jobOrders.jobId, jobId))
        .limit(1)
    )[0]?.n ?? 0;
  let status = job.status;
  const patch: Partial<typeof schema.jobs.$inferInsert> = {};
  if (status !== 'Completed' && status !== 'Cancelled') {
    if (p.taskCount > 0 && p.completedTaskCount === p.taskCount) {
      status = stateMachines.job.transition(status, 'Completed');
      patch.completedAt = nowIso();
      // Pending -> Completed in one step (one-task jobs, instant counts) still gets an Actual Start.
      if (!job.startedAt) {
        const first = (
          await dbGet<{ at: string | null }>(
            tx,
            sql`SELECT MIN(COALESCE(started_at, finished_at)) AS at FROM tasks WHERE job_id = ${jobId} AND status <> 'Cancelled'`,
          )
        )?.at;
        patch.startedAt = first ?? patch.completedAt;
      }
    } else if (status === 'Pending' && p.completedTaskCount > 0) {
      status = stateMachines.job.transition(status, 'Started');
      patch.startedAt = job.startedAt ?? nowIso();
    }
  }
  await tx
    .update(schema.jobs)
    .set({
      ...patch,
      status,
      taskCount: p.taskCount,
      completedTaskCount: p.completedTaskCount,
      unitCount: p.unitCount,
      completedUnits: p.completedUnits,
      orderCount: Number(orderCount),
      updatedBy: ctx.userId,
    })
    .where(eq(schema.jobs.id, jobId));
  if (status !== job.status) {
    await recordUpdate(tx, ctx, {
      entityType: 'job',
      entityId: job.id,
      entityCode: job.code,
      before: { status: job.status },
      after: { status },
    });
  }
}
