/** Time tracking: one running timer per person, manual entries, per-task and per-person totals. */
import 'server-only';
import { and, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { projects, tasks, timeEntries, type TimeEntry } from '@/server/db/schema';
import { forbidden, invalid, notFound } from '@/server/errors';
import type { TimeEntryDTO } from '@/lib/types';
import { timerMinutes } from '@/lib/dates';
import { cleanText, toTimeEntryDTO, type DomainContext } from './_shared';
import { requireTask } from './access';
import { logActivity } from './activity';

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

async function stopRow(ctx: DomainContext, row: TimeEntry): Promise<TimeEntry> {
  const ended = new Date();
  const [stopped] = await db.transaction(async (tx) => {
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
    return updated;
  });
  return stopped;
}

/** Starts a timer on a task, stopping any other running timer first. */
export async function startTimer(ctx: DomainContext, taskId: string, note?: string | null): Promise<TimeEntryDTO> {
  const { task } = await requireTask(ctx, taskId, 'time:log');
  const [running] = await db
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.userId, ctx.userId), isNull(timeEntries.endedAt), isNull(timeEntries.deletedAt)));
  if (running) {
    if (running.taskId === taskId) return toTimeEntryDTO(running);
    await stopRow(ctx, running);
  }
  const [row] = await db
    .insert(timeEntries)
    .values({ orgId: ctx.orgId, projectId: task.projectId, taskId, userId: ctx.userId, startedAt: new Date(), note: cleanText(note), source: 'timer' })
    .returning();
  return toTimeEntryDTO(row);
}

/** Tell KitStak Pulse (when installed) that this project's logged time changed. Never throws. */
async function timeChanged(ctx: DomainContext, projectId: string): Promise<void> {
  const { notifyPulseOfTime } = await import('@/server/integrations/pulse-profit');
  await notifyPulseOfTime(db, ctx.orgId, projectId);
}

export async function stopTimer(ctx: DomainContext): Promise<TimeEntryDTO | null> {
  const [running] = await db
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.orgId, ctx.orgId), eq(timeEntries.userId, ctx.userId), isNull(timeEntries.endedAt), isNull(timeEntries.deletedAt)));
  if (!running) return null;
  const stopped = await stopRow(ctx, running);
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
  const [row] = await db.transaction(async (tx) => {
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
        billable: input.billable ?? false,
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
  const set: Partial<typeof timeEntries.$inferInsert> = { updatedAt: new Date() };
  if (patch.minutes !== undefined) {
    if (patch.minutes <= 0 || patch.minutes > 24 * 60) throw invalid('Enter between 1 minute and 24 hours.');
    set.durationMinutes = Math.round(patch.minutes);
    set.endedAt = new Date(current.startedAt.getTime() + patch.minutes * 60_000);
  }
  if (patch.note !== undefined) set.note = cleanText(patch.note);
  if (patch.billable !== undefined) set.billable = patch.billable;
  const [row] = await db.update(timeEntries).set(set).where(eq(timeEntries.id, entryId)).returning();
  await timeChanged(ctx, current.projectId);
  return toTimeEntryDTO(row);
}

export async function deleteTimeEntry(ctx: DomainContext, entryId: string): Promise<void> {
  const current = await ownEntry(ctx, entryId);
  await db.update(timeEntries).set({ deletedAt: new Date() }).where(eq(timeEntries.id, entryId));
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
