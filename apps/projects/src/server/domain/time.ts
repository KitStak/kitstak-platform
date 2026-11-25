/** Time tracking: one running timer per person, manual entries, per-task and per-person totals. */
import 'server-only';
import { and, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { db, type Executor } from '@/server/db';
import { projects, tasks, timeEntries, type TimeEntry } from '@/server/db/schema';
import { forbidden, invalid, notFound } from '@/server/errors';
import type { TimeEntryDTO } from '@/lib/types';
import { timerMinutes } from '@/lib/dates';
import { cleanText, toTimeEntryDTO, type DomainContext } from './_shared';
import { requireTask } from './access';
import { logActivity } from './activity';
import { assertTimeOpen, lockTimeScopes, refreshTimeLedger, timeScope, type TimeScope } from './programs/build-hooks';

// A stopped timer logs at least one minute, with the same rounding the UI shows right away.
const minutesBetween = (start: Date, end: Date): number => timerMinutes(end.getTime() - start.getTime());

/** The actor's running timer anywhere in the org, or null. */
export async function getRunningTimer(ctx: DomainContext): Promise<TimeEntryDTO | null> {
  // The task's key and title ride along, so the top-bar timer pill needs no second request.
  const [row] = await db
    .select({ entry: timeEntries, number: tasks.number, title: tasks.title, projectKey: projects.key })
    .from(timeEntries)
    .leftJoin(tasks, eq(tasks.id, timeEntries.taskId))
    .leftJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(eq(timeEntries.orgId, ctx.orgId), eq(timeEntries.userId, ctx.userId), isNull(timeEntries.endedAt), isNull(timeEntries.deletedAt)))
    .limit(1);
  if (!row) return null;
  const task = row.projectKey && row.number !== null && row.title !== null ? { key: `${row.projectKey}-${row.number}`, title: row.title } : null;
  return { ...toTimeEntryDTO(row.entry), task };
}

/** Stops a running timer inside the caller's transaction (its per hour fees refresh with it). */
async function stopRow(tx: Executor, ctx: DomainContext, row: TimeEntry, scope: TimeScope | null): Promise<TimeEntry> {
  // Time counts on the day it started; a day closed while the timer ran stays frozen (4.3.4).
  await assertTimeOpen(tx, ctx, scope, [row.startedAt]);
  const ended = new Date();
  const updated = await tx
    .update(timeEntries)
    .set({ endedAt: ended, durationMinutes: minutesBetween(row.startedAt, ended), updatedAt: ended })
    .where(eq(timeEntries.id, row.id))
    .returning();
  await logActivity(tx, ctx, {
    verb: 'time.logged',
    entityType: 'time_entry',
    entityId: row.id,
    projectId: row.projectId,
    taskId: row.taskId,
    after: { minutes: updated[0].durationMinutes, source: 'timer' },
  });
  await refreshTimeLedger(tx, ctx, scope, [row.startedAt]);
  return updated[0];
}

/** Tell KitStak Pulse (when installed) that this project's logged time changed. Never throws. */
async function timeChanged(ctx: DomainContext, projectId: string): Promise<void> {
  const { notifyPulseOfTime } = await import('@/server/integrations/pulse-profit');
  await notifyPulseOfTime(db, ctx.orgId, projectId);
}

/**
 * Starts a timer on a task, stopping any other running timer first. On program work the lock
 * check, the write and the per hour ledger refresh share one transaction (4.1, 4.3.2).
 */
export async function startTimer(ctx: DomainContext, taskId: string, note?: string | null): Promise<TimeEntryDTO> {
  const { task } = await requireTask(ctx, taskId, 'time:log');
  const scope = await timeScope(db, ctx, taskId);
  const [running] = await db
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.orgId, ctx.orgId), eq(timeEntries.userId, ctx.userId), isNull(timeEntries.endedAt), isNull(timeEntries.deletedAt)));
  if (running && running.taskId === taskId) return toTimeEntryDTO(running);
  const runningScope = running ? await timeScope(db, ctx, running.taskId) : null;
  const row = await db.transaction(async (tx) => {
    await lockTimeScopes(tx, [scope, runningScope]);
    const startedAt = new Date();
    await assertTimeOpen(tx, ctx, scope, [startedAt]);
    if (running) await stopRow(tx, ctx, running, runningScope);
    const [inserted] = await tx
      .insert(timeEntries)
      .values({ orgId: ctx.orgId, projectId: task.projectId, taskId, userId: ctx.userId, startedAt, note: cleanText(note), source: 'timer', billable: scope?.billableDefault ?? false })
      .returning();
    return inserted;
  });
  if (running) await timeChanged(ctx, running.projectId);
  return toTimeEntryDTO(row);
}

export async function stopTimer(ctx: DomainContext): Promise<TimeEntryDTO | null> {
  const [running] = await db
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.orgId, ctx.orgId), eq(timeEntries.userId, ctx.userId), isNull(timeEntries.endedAt), isNull(timeEntries.deletedAt)));
  if (!running) return null;
  const scope = await timeScope(db, ctx, running.taskId);
  const stopped = await db.transaction(async (tx) => {
    await lockTimeScopes(tx, [scope]);
    return stopRow(tx, ctx, running, scope);
  });
  await timeChanged(ctx, stopped.projectId);
  return toTimeEntryDTO(stopped);
}

export async function addManualTime(
  ctx: DomainContext,
  input: { taskId: string; minutes: number; date?: string; note?: string | null; billable?: boolean },
): Promise<TimeEntryDTO> {
  const { task } = await requireTask(ctx, input.taskId, 'time:log');
  if (!Number.isFinite(input.minutes) || input.minutes <= 0 || input.minutes > 24 * 60) {
    throw invalid('Enter between 1 minute and 24 hours.', { minutes: 'Enter between 1 minute and 24 hours.' });
  }
  const start = input.date ? new Date(`${input.date}T09:00:00`) : new Date(Date.now() - input.minutes * 60_000);
  if (Number.isNaN(start.getTime())) throw invalid('Pick a valid date.');
  const end = new Date(start.getTime() + input.minutes * 60_000);
  const scope = await timeScope(db, ctx, task.id);
  const [row] = await db.transaction(async (tx) => {
    await lockTimeScopes(tx, [scope]);
    await assertTimeOpen(tx, ctx, scope, [start]);
    const inserted = await tx
      .insert(timeEntries)
      .values({
        orgId: ctx.orgId,
        projectId: task.projectId,
        taskId: task.id,
        userId: ctx.userId,
        startedAt: start,
        endedAt: end,
        durationMinutes: Math.round(input.minutes),
        note: cleanText(input.note),
        billable: input.billable ?? scope?.billableDefault ?? false,
        source: 'manual',
      })
      .returning();
    await logActivity(tx, ctx, {
      verb: 'time.logged',
      entityType: 'time_entry',
      entityId: inserted[0].id,
      projectId: task.projectId,
      taskId: task.id,
      after: { minutes: Math.round(input.minutes), source: 'manual' },
    });
    await refreshTimeLedger(tx, ctx, scope, [start]);
    return inserted;
  });
  await timeChanged(ctx, task.projectId);
  return toTimeEntryDTO(row);
}

async function ownEntry(ctx: DomainContext, entryId: string): Promise<TimeEntry> {
  const [row] = await db.select().from(timeEntries).where(and(eq(timeEntries.id, entryId), eq(timeEntries.orgId, ctx.orgId), isNull(timeEntries.deletedAt)));
  if (!row) throw notFound('That time entry');
  if (row.userId !== ctx.userId) {
    const { capabilities } = await requireTask(ctx, row.taskId);
    if (!capabilities['project:manage_members']) throw forbidden('You can only change your own time.');
  }
  return row;
}

export async function updateTimeEntry(
  ctx: DomainContext,
  entryId: string,
  patch: { minutes?: number; note?: string | null; billable?: boolean },
): Promise<TimeEntryDTO> {
  const current = await ownEntry(ctx, entryId);
  const scope = await timeScope(db, ctx, current.taskId);
  const set: Partial<typeof timeEntries.$inferInsert> = { updatedAt: new Date() };
  if (patch.minutes !== undefined) {
    if (patch.minutes <= 0 || patch.minutes > 24 * 60) throw invalid('Enter between 1 minute and 24 hours.');
    set.durationMinutes = Math.round(patch.minutes);
    set.endedAt = new Date(current.startedAt.getTime() + patch.minutes * 60_000);
  }
  if (patch.note !== undefined) set.note = cleanText(patch.note);
  if (patch.billable !== undefined) set.billable = patch.billable;
  const row = await db.transaction(async (tx) => {
    await lockTimeScopes(tx, [scope]);
    await assertTimeOpen(tx, ctx, scope, [current.startedAt]);
    const [updated] = await tx.update(timeEntries).set(set).where(and(eq(timeEntries.id, entryId), isNull(timeEntries.deletedAt))).returning();
    if (!updated) throw notFound('That time entry');
    await refreshTimeLedger(tx, ctx, scope, [current.startedAt]);
    return updated;
  });
  await timeChanged(ctx, current.projectId);
  return toTimeEntryDTO(row);
}

export async function deleteTimeEntry(ctx: DomainContext, entryId: string): Promise<void> {
  const current = await ownEntry(ctx, entryId);
  const scope = await timeScope(db, ctx, current.taskId);
  await db.transaction(async (tx) => {
    await lockTimeScopes(tx, [scope]);
    await assertTimeOpen(tx, ctx, scope, [current.startedAt]);
    await tx.update(timeEntries).set({ deletedAt: new Date() }).where(eq(timeEntries.id, entryId));
    await refreshTimeLedger(tx, ctx, scope, [current.startedAt]);
  });
  await timeChanged(ctx, current.projectId);
}

export async function listTaskTime(ctx: DomainContext, taskId: string): Promise<TimeEntryDTO[]> {
  await requireTask(ctx, taskId);
  const rows = await db
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.taskId, taskId), isNull(timeEntries.deletedAt)))
    .orderBy(desc(timeEntries.startedAt));
  return rows.map(toTimeEntryDTO);
}

/** Minutes per day for the actor between two dates (timesheet). */
export async function myTimeByDay(ctx: DomainContext, from: string, to: string): Promise<{ date: string; minutes: number }[]> {
  const rows = await db
    .select({
      date: sql<string>`to_char(${timeEntries.startedAt}, 'YYYY-MM-DD')`,
      minutes: sql<number>`coalesce(sum(${timeEntries.durationMinutes}), 0)::int`,
    })
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.orgId, ctx.orgId),
        eq(timeEntries.userId, ctx.userId),
        isNull(timeEntries.deletedAt),
        gte(timeEntries.startedAt, new Date(`${from}T00:00:00`)),
        lt(timeEntries.startedAt, new Date(`${to}T23:59:59`)),
      ),
    )
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  return rows.map((row) => ({ date: row.date, minutes: Number(row.minutes) }));
}
