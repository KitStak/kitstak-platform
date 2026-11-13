/**
 * Dead-job settlement (critic R4 major: "zombie jobs").
 *
 * `rollupJob` (domain/progress.ts) only moves a job forward to Started / Completed. When the last
 * live task of a job is cancelled from outside the job (Cancel Picking on the order, task cancel,
 * remove order, order cancel), the job used to stay Pending with 0 tasks forever, and its
 * `job_orders` row kept counting a released order.
 *
 * `settleJob` closes that gap for one job:
 *   1. drops `job_orders` links whose order has no live (non-cancelled) task left in the job;
 *   2. re-runs `rollupJob` so counters (order count, task count, units) are exact;
 *   3. a live job with no Pending / Started task left moves to Cancelled (nothing was done) or
 *      Completed (some tasks were completed; the rest was cancelled), with a change-log row
 *      ("Status is modified. Pending --> Cancelled · last order released").
 *
 * `settleDeadJobs` finds every such job with one indexed query and settles each in its own
 * savepoint. It is called by M03 command paths, the Job Management read routes (throttled) and
 * the wave-rules scheduler tick, so paths owned by other modules are healed too.
 */
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { AppDb } from '@/server/api/db';
import * as schema from '@/server/db/schema';
import { stateMachines } from '@/server/domain';
import { rollupJob } from '@/server/domain/progress';
import { nowIso, systemCtx, type DomainCtx, type Tx } from '@/server/domain/types';
import { dbAll, withWriteTx } from '@/server/db/sql';
import { modifiedMessage } from '@/lib/change-log-text';

type JobStatus = (typeof schema.jobs.$inferSelect)['status'];

const LIVE_JOB: readonly JobStatus[] = ['Pending', 'Started', 'In Progress'];
const OPEN_TASK = ['Pending', 'Started'] as const;

export interface SettleOutcome {
  readonly jobId: string;
  readonly code: string;
  /** Status before / after; equal when only the order links were cleaned up. */
  readonly from: JobStatus;
  readonly to: JobStatus;
  /** `job_orders` links removed (orders no longer worked by the job). */
  readonly ordersReleased: number;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Removes links to orders the job no longer works on. Returns the number removed. */
async function dropReleasedOrders(tx: Tx, jobId: string): Promise<number> {
  const links = await tx
    .select({ orderId: schema.jobOrders.orderId, soJob: schema.shipmentOrders.jobId })
    .from(schema.jobOrders)
    .leftJoin(schema.shipmentOrders, eq(schema.shipmentOrders.id, schema.jobOrders.orderId))
    .where(eq(schema.jobOrders.jobId, jobId));
  let removed = 0;
  for (const link of links) {
    const live = (
      await tx
        .select({ id: schema.tasks.id })
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.jobId, jobId),
            eq(schema.tasks.orderId, link.orderId),
            ne(schema.tasks.status, 'Cancelled'),
          ),
        )
        .limit(1)
    )[0];
    if (live) continue;
    // No task was ever built for it and the order still points here: mid-build, leave it.
    const any = (
      await tx
        .select({ id: schema.tasks.id })
        .from(schema.tasks)
        .where(and(eq(schema.tasks.jobId, jobId), eq(schema.tasks.orderId, link.orderId)))
        .limit(1)
    )[0];
    if (!any && link.soJob === jobId) continue;
    await tx
      .delete(schema.jobOrders)
      .where(and(eq(schema.jobOrders.jobId, jobId), eq(schema.jobOrders.orderId, link.orderId)));
    if (link.soJob === jobId) {
      await tx
        .update(schema.shipmentOrders)
        .set({ jobId: null })
        .where(eq(schema.shipmentOrders.id, link.orderId));
    }
    removed += 1;
  }
  return removed;
}

async function closingReason(tx: Tx, jobId: string, released: number, to: JobStatus): Promise<string> {
  const cancelled =
    (
      await tx
        .select({ n: sql<number>`COUNT(*)` })
        .from(schema.tasks)
        .where(and(eq(schema.tasks.jobId, jobId), eq(schema.tasks.status, 'Cancelled')))
        .limit(1)
    )[0]?.n ?? 0;
  const tasks = Number(cancelled) > 0 ? ` (${plural(Number(cancelled), 'task')} cancelled)` : '';
  if (to === 'Completed') return `remaining work cancelled${tasks}`;
  if (released > 0)
    return `${released === 1 ? 'last order released' : `${released} orders released`}${tasks}`;
  return `no open tasks left${tasks}`;
}

/** Settles one job (see the module comment). Returns null when nothing changed. */
export async function settleJob(tx: Tx, ctx: DomainCtx, jobId: string): Promise<SettleOutcome | null> {
  const job = (await tx.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).limit(1))[0];
  if (!job || !LIVE_JOB.includes(job.status)) return null;
  const released = await dropReleasedOrders(tx, jobId);
  await rollupJob(tx, ctx, jobId);
  const after = (await tx.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).limit(1))[0];
  if (!after) return null;
  let to: JobStatus = after.status;
  if (LIVE_JOB.includes(after.status)) {
    const open = (
      await tx
        .select({ id: schema.tasks.id })
        .from(schema.tasks)
        .where(and(eq(schema.tasks.jobId, jobId), inArray(schema.tasks.status, [...OPEN_TASK])))
        .limit(1)
    )[0];
    const any = (
      await tx
        .select({ id: schema.tasks.id })
        .from(schema.tasks)
        .where(eq(schema.tasks.jobId, jobId))
        .limit(1)
    )[0];
    if (!open && any) {
      const completed = Number(
        (
          await tx
            .select({ n: sql<number>`COUNT(*)` })
            .from(schema.tasks)
            .where(and(eq(schema.tasks.jobId, jobId), eq(schema.tasks.status, 'Completed')))
            .limit(1)
        )[0]?.n ?? 0,
      );
      to = stateMachines.job.transition(after.status, completed > 0 ? 'Completed' : 'Cancelled');
      const now = nowIso();
      await tx
        .update(schema.jobs)
        .set({
          status: to,
          updatedBy: ctx.userId,
          version: sql`${schema.jobs.version} + 1`,
          ...(to === 'Completed'
            ? { completedAt: after.completedAt ?? now, startedAt: after.startedAt ?? now }
            : {}),
        })
        .where(eq(schema.jobs.id, jobId));
      await tx.insert(schema.changeLog).values({
        entityType: 'job',
        entityId: jobId,
        entityCode: job.code,
        type: 'Update',
        field: 'status',
        fieldLabel: 'Status',
        fromValue: after.status,
        toValue: to,
        message: `${modifiedMessage('Status', after.status, to)} · ${await closingReason(tx, jobId, released, to)}`,
        userId: ctx.userId,
        source: ctx.source,
      });
    } else if (released > 0) {
      await tx
        .update(schema.jobs)
        .set({ version: sql`${schema.jobs.version} + 1` })
        .where(eq(schema.jobs.id, jobId));
    }
  }
  if (to === job.status && released === 0) return null;
  return { jobId, code: job.code, from: job.status, to, ordersReleased: released };
}

/** Live jobs with no open task, or with a link to an order the job no longer works on. */
export async function deadJobCandidates(db: AppDb | Tx, jobIds?: readonly string[]): Promise<string[]> {
  const scope = jobIds
    ? jobIds.length === 0
      ? null
      : sql`AND j.id IN (${sql.join(
          jobIds.map((id) => sql`${id}`),
          sql`, `,
        )})`
    : sql``;
  if (scope === null) return [];
  const rows = await dbAll<{ id: string }>(
    db,
    sql`
    SELECT j.id AS id FROM jobs j
    WHERE j.status IN ('Pending', 'Started', 'In Progress') ${scope}
      AND EXISTS (SELECT 1 FROM tasks t WHERE t.job_id = j.id)
      AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.job_id = j.id AND t.status IN ('Pending', 'Started'))
    UNION
    SELECT jo.job_id AS id FROM job_orders jo JOIN jobs j ON j.id = jo.job_id
    WHERE j.status IN ('Pending', 'Started', 'In Progress') ${scope}
      AND EXISTS (SELECT 1 FROM tasks t WHERE t.job_id = jo.job_id AND t.order_id = jo.order_id)
      AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.job_id = jo.job_id AND t.order_id = jo.order_id AND t.status <> 'Cancelled')`,
  );
  return rows.map((r) => r.id);
}

/** Settles every dead job (optionally only among `jobIds`), one savepoint each. */
export async function settleDeadJobs(
  db: AppDb | Tx,
  ctx: DomainCtx,
  jobIds?: readonly string[],
): Promise<SettleOutcome[]> {
  const out: SettleOutcome[] = [];
  for (const id of await deadJobCandidates(db, jobIds)) {
    try {
      const res = await withWriteTx(db, async (tx) => await settleJob(tx, ctx, id));
      if (res) out.push(res);
    } catch (error) {
      console.warn('[jobs] settle skipped', id, error);
    }
  }
  return out;
}

const SWEEP_EVERY_MS = 5_000;
let lastSweep = 0;

/** Throttled self-heal for read routes: at most every 5 s per server process; never throws. */
export async function sweepDeadJobs(db: AppDb, now: number = Date.now()): Promise<readonly SettleOutcome[]> {
  if (now - lastSweep < SWEEP_EVERY_MS) return [];
  lastSweep = now;
  try {
    return await settleDeadJobs(db, systemCtx('System'));
  } catch (error) {
    console.warn('[jobs] dead-job sweep skipped', error);
    return [];
  }
}

/** Test hook: lets the next `sweepDeadJobs` call run immediately. */
export function resetDeadJobSweep(): void {
  lastSweep = 0;
}
