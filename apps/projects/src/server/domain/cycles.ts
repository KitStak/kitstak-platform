/**
 * Cycles: time-boxed rounds of work inside a project (Linear-style cycles / sprints).
 *
 * - A task (top-level) is in at most one cycle at a time; membership history lives in
 *   pm.cycle_tasks so the report can draw scope changes.
 * - When a cycle's end date has passed, the next read closes it (lazy rollover): unfinished tasks
 *   move to the next cycle, which is created with the same length when none is planned and
 *   auto rollover is on. Closing by hand does the same, or sends the work back to the backlog.
 */
import 'server-only';
import { and, asc, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { db, type Executor } from '@/server/db';
import { cycles, cycleTasks, statuses, tasks, type Cycle } from '@/server/db/schema';
import { invalid, notFound } from '@/server/errors';
import { buildCycleReport, cycleState, nextCycleDates, type CycleMember } from '@/lib/cycle-math';
import { addDaysIso, diffDays, isIsoDate, startOfWeekIso, todayIso } from '@/lib/dates';
import type { CycleDetailDTO, CycleDTO, CycleListDTO } from '@/lib/types';
import { cleanText, iso, type DomainContext } from './_shared';
import { requireProject, type ProjectRefInput } from './access';
import { logActivity } from './activity';
import { selectTaskSummaries } from './task-queries';

export const cycleLabel = (cycle: Pick<Cycle, 'name' | 'number'>): string => cycle.name?.trim() || `Cycle ${cycle.number}`;

interface Counts {
  readonly taskCount: number;
  readonly doneCount: number;
  readonly points: number;
  readonly donePoints: number;
}

function toDTO(row: Cycle, counts: Counts, today = todayIso()): CycleDTO {
  return {
    id: row.id,
    projectId: row.projectId,
    number: row.number,
    name: row.name,
    goal: row.goal,
    startDate: row.startDate,
    endDate: row.endDate,
    autoRollover: row.autoRollover,
    completedAt: iso(row.completedAt),
    state: cycleState({ startDate: row.startDate, endDate: row.endDate, completedAt: iso(row.completedAt) }, today),
    ...counts,
  };
}

const doneSql = sql<boolean>`(${statuses.category} = 'done')`;

/** Current members (or, for a closed cycle, the rolled-over ones too) with done flags. */
async function cycleCounts(executor: Executor, cycleIds: readonly string[]): Promise<Map<string, Counts>> {
  const map = new Map<string, Counts>();
  if (!cycleIds.length) return map;
  const rows = await executor
    .select({
      cycleId: cycleTasks.cycleId,
      n: sql<number>`count(*)::int`,
      done: sql<number>`count(*) filter (where ${doneSql})::int`,
      points: sql<number>`coalesce(sum(${tasks.estimatePoints}), 0)::int`,
      donePoints: sql<number>`coalesce(sum(${tasks.estimatePoints}) filter (where ${doneSql}), 0)::int`,
    })
    .from(cycleTasks)
    .innerJoin(tasks, eq(tasks.id, cycleTasks.taskId))
    .innerJoin(statuses, eq(statuses.id, tasks.statusId))
    .where(
      and(
        inArray(cycleTasks.cycleId, [...cycleIds]),
        isNull(tasks.deletedAt),
        sql`${statuses.category} <> 'cancelled'`,
        sql`(${cycleTasks.removedAt} is null or ${cycleTasks.removedReason} = 'rolled_over')`,
      ),
    )
    .groupBy(cycleTasks.cycleId);
  for (const row of rows) map.set(row.cycleId, { taskCount: Number(row.n), doneCount: Number(row.done), points: Number(row.points), donePoints: Number(row.donePoints) });
  return map;
}

const EMPTY: Counts = { taskCount: 0, doneCount: 0, points: 0, donePoints: 0 };

async function loadCycle(executor: Executor, ctx: DomainContext, cycleId: string): Promise<Cycle> {
  const [row] = await executor
    .select()
    .from(cycles)
    .where(and(eq(cycles.id, cycleId), eq(cycles.orgId, ctx.orgId), isNull(cycles.deletedAt)))
    .limit(1);
  if (!row) throw notFound('That cycle');
  return row;
}

async function nextNumber(executor: Executor, projectId: string): Promise<number> {
  const [row] = await executor.select({ max: sql<number>`coalesce(max(${cycles.number}), 0)::int` }).from(cycles).where(eq(cycles.projectId, projectId));
  return Number(row?.max ?? 0) + 1;
}

/** Closes a cycle: open tasks roll to `target` (or the backlog when null). Returns how many moved. */
async function closeCycle(tx: Executor, ctx: DomainContext, cycle: Cycle, mode: 'next' | 'backlog'): Promise<{ moved: number; nextCycle: Cycle | null }> {
  const open = await tx
    .select({ id: cycleTasks.id, taskId: cycleTasks.taskId })
    .from(cycleTasks)
    .innerJoin(tasks, eq(tasks.id, cycleTasks.taskId))
    .innerJoin(statuses, eq(statuses.id, tasks.statusId))
    .where(and(eq(cycleTasks.cycleId, cycle.id), isNull(cycleTasks.removedAt), isNull(tasks.deletedAt), sql`${statuses.category} not in ('done', 'cancelled')`));
  const now = new Date();
  let target: Cycle | null = null;
  if (mode === 'next' && open.length) {
    const [planned] = await tx
      .select()
      .from(cycles)
      .where(and(eq(cycles.projectId, cycle.projectId), isNull(cycles.deletedAt), isNull(cycles.completedAt), sql`${cycles.number} > ${cycle.number}`))
      .orderBy(asc(cycles.startDate))
      .limit(1);
    target = planned ?? null;
    if (!target && cycle.autoRollover) {
      const dates = nextCycleDates(cycle);
      // A long-forgotten cycle rolls into one that covers today, not into the past.
      const today = todayIso();
      const length = diffDays(cycle.startDate, cycle.endDate);
      let { startDate, endDate } = dates;
      while (endDate < today) {
        startDate = addDaysIso(endDate, 1);
        endDate = addDaysIso(startDate, length);
      }
      const [created] = await tx
        .insert(cycles)
        .values({ orgId: ctx.orgId, projectId: cycle.projectId, number: await nextNumber(tx, cycle.projectId), startDate, endDate, autoRollover: true, createdBy: ctx.actorKind === 'user' ? ctx.userId : null })
        .returning();
      target = created ?? null;
      if (target) await logActivity(tx, ctx, { verb: 'cycle.created', entityType: 'cycle', entityId: target.id, projectId: cycle.projectId, after: { name: cycleLabel(target), startDate, endDate }, meta: { rollover: true } });
    }
  }
  if (open.length) {
    await tx
      .update(cycleTasks)
      .set({ removedAt: now, removedReason: 'rolled_over' })
      .where(inArray(cycleTasks.id, open.map((row) => row.id)));
    if (target) {
      const targetId = target.id;
      await tx.insert(cycleTasks).values(open.map((row) => ({ orgId: ctx.orgId, cycleId: targetId, taskId: row.taskId, addedAt: now, addedBy: null })));
    }
  }
  await tx.update(cycles).set({ completedAt: now }).where(eq(cycles.id, cycle.id));
  await logActivity(tx, ctx, {
    verb: 'cycle.completed',
    entityType: 'cycle',
    entityId: cycle.id,
    projectId: cycle.projectId,
    after: { name: cycleLabel(cycle) },
    meta: { rolledOver: open.length, to: target ? cycleLabel(target) : null },
  });
  return { moved: open.length, nextCycle: target };
}

/** Lazy rollover: close every cycle of the project whose end date has passed. */
async function rolloverEndedCycles(ctx: DomainContext, projectId: string): Promise<void> {
  const today = todayIso();
  const ended = await db
    .select()
    .from(cycles)
    .where(and(eq(cycles.projectId, projectId), eq(cycles.orgId, ctx.orgId), isNull(cycles.deletedAt), isNull(cycles.completedAt), lt(cycles.endDate, today)))
    .orderBy(asc(cycles.startDate));
  if (!ended.length) return;
  const system: DomainContext = { ...ctx, actorKind: 'system' };
  await db.transaction(async (tx) => {
    for (const cycle of ended) {
      // Re-read inside the transaction so two readers never close the same cycle twice.
      const [fresh] = await tx.select().from(cycles).where(and(eq(cycles.id, cycle.id), isNull(cycles.completedAt))).for('update');
      if (fresh) await closeCycle(tx, system, fresh, 'next');
    }
  });
}

export async function listCycles(ctx: DomainContext, ref: ProjectRefInput): Promise<CycleListDTO> {
  const { project } = await requireProject(ctx, ref);
  // Programs have no cycles (docs/programs/SPEC.md 4.1).
  if (project.kind === 'program') return { cycles: [], currentId: null, backlogCount: 0, taskCycle: {} };
  await rolloverEndedCycles(ctx, project.id);
  const rows = await db
    .select()
    .from(cycles)
    .where(and(eq(cycles.projectId, project.id), isNull(cycles.deletedAt)))
    .orderBy(desc(cycles.startDate));
  const counts = await cycleCounts(db, rows.map((row) => row.id));
  const today = todayIso();
  const list = rows.map((row) => toDTO(row, counts.get(row.id) ?? EMPTY, today));
  const current = list.filter((c) => c.state === 'current').sort((a, b) => a.startDate.localeCompare(b.startDate))[0] ?? null;
  const openIds = list.filter((c) => c.state !== 'done').map((c) => c.id);
  const membership = openIds.length
    ? await db
        .select({ taskId: cycleTasks.taskId, cycleId: cycleTasks.cycleId })
        .from(cycleTasks)
        .where(and(inArray(cycleTasks.cycleId, openIds), isNull(cycleTasks.removedAt)))
    : [];
  const [backlog] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .innerJoin(statuses, eq(statuses.id, tasks.statusId))
    .where(
      and(
        eq(tasks.projectId, project.id),
        isNull(tasks.deletedAt),
        isNull(tasks.parentTaskId),
        sql`${statuses.category} not in ('done', 'cancelled')`,
        sql`not exists (select 1 from ${cycleTasks} ct where ct.task_id = ${tasks.id} and ct.removed_at is null)`,
      ),
    );
  return {
    cycles: list,
    currentId: current?.id ?? null,
    backlogCount: Number(backlog?.n ?? 0),
    taskCycle: Object.fromEntries(membership.map((m) => [m.taskId, m.cycleId])),
  };
}

export async function getCycle(ctx: DomainContext, cycleId: string): Promise<CycleDetailDTO> {
  const cycle = await loadCycle(db, ctx, cycleId);
  await requireProject(ctx, { id: cycle.projectId });
  await rolloverEndedCycles(ctx, cycle.projectId);
  const fresh = await loadCycle(db, ctx, cycleId);
  const members = await db
    .select({
      taskId: cycleTasks.taskId,
      addedAt: cycleTasks.addedAt,
      removedAt: cycleTasks.removedAt,
      removedReason: cycleTasks.removedReason,
      completedAt: tasks.completedAt,
      category: statuses.category,
      points: tasks.estimatePoints,
    })
    .from(cycleTasks)
    .innerJoin(tasks, eq(tasks.id, cycleTasks.taskId))
    .innerJoin(statuses, eq(statuses.id, tasks.statusId))
    .where(and(eq(cycleTasks.cycleId, cycleId), isNull(tasks.deletedAt)));
  const historyMembers: CycleMember[] = members.map((m) => ({
    taskId: m.taskId,
    addedAt: m.addedAt.toISOString(),
    removedAt: iso(m.removedAt),
    removedReason: m.removedReason ?? null,
    completedAt: m.category === 'done' ? (iso(m.completedAt) ?? new Date().toISOString()) : null,
    cancelled: m.category === 'cancelled',
    points: m.points,
  }));
  const shownIds = [...new Set(members.filter((m) => m.removedAt === null || m.removedReason === 'rolled_over').map((m) => m.taskId))];
  const taskList = shownIds.length ? await selectTaskSummaries(inArray(tasks.id, shownIds)) : [];
  const counts = await cycleCounts(db, [cycleId]);
  const today = todayIso();
  return {
    cycle: toDTO(fresh, counts.get(cycleId) ?? EMPTY, today),
    tasks: taskList,
    report: buildCycleReport({ startDate: fresh.startDate, endDate: fresh.endDate, today, members: historyMembers }),
  };
}

export interface CycleInput {
  readonly name?: string | null;
  readonly goal?: string | null;
  readonly startDate?: string;
  readonly endDate?: string;
  readonly autoRollover?: boolean;
}

function checkDates(startDate: string, endDate: string) {
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) throw invalid('Pick a start and end date.', { startDate: 'Pick a start date.' });
  if (endDate < startDate) throw invalid('The end date has to be on or after the start date.', { endDate: 'The end date has to be on or after the start date.' });
  if (diffDays(startDate, endDate) > 90) throw invalid('Keep a cycle to 13 weeks or less.', { endDate: 'Keep a cycle to 13 weeks or less.' });
}

/** New cycle. Without dates it follows the last cycle, or starts this Monday for two weeks. */
export async function createCycle(ctx: DomainContext, projectId: string, input: CycleInput & { readonly lengthDays?: number } = {}): Promise<CycleDTO> {
  const { project } = await requireProject(ctx, { id: projectId }, 'task:update');
  const row = await db.transaction(async (tx) => {
    const [last] = await tx.select().from(cycles).where(and(eq(cycles.projectId, project.id), isNull(cycles.deletedAt))).orderBy(desc(cycles.endDate)).limit(1);
    const length = Math.min(90, Math.max(0, (input.lengthDays ?? (last ? diffDays(last.startDate, last.endDate) + 1 : 14)) - 1));
    let startDate = input.startDate ?? (last ? addDaysIso(last.endDate, 1) : startOfWeekIso(todayIso()));
    if (!input.startDate && last && addDaysIso(startDate, length) < todayIso()) startDate = startOfWeekIso(todayIso());
    const endDate = input.endDate ?? addDaysIso(startDate, length);
    checkDates(startDate, endDate);
    const [created] = await tx
      .insert(cycles)
      .values({
        orgId: ctx.orgId,
        projectId: project.id,
        number: await nextNumber(tx, project.id),
        name: cleanText(input.name)?.slice(0, 80) ?? null,
        goal: cleanText(input.goal)?.slice(0, 500) ?? null,
        startDate,
        endDate,
        autoRollover: input.autoRollover ?? true,
        createdBy: ctx.userId,
      })
      .returning();
    if (!created) throw invalid("Couldn't plan the cycle.");
    await logActivity(tx, ctx, { verb: 'cycle.created', entityType: 'cycle', entityId: created.id, projectId: project.id, after: { name: cycleLabel(created), startDate, endDate } });
    return created;
  });
  return toDTO(row, EMPTY);
}

export async function updateCycle(ctx: DomainContext, cycleId: string, patch: CycleInput): Promise<CycleDTO> {
  const cycle = await loadCycle(db, ctx, cycleId);
  await requireProject(ctx, { id: cycle.projectId }, 'task:update');
  const startDate = patch.startDate ?? cycle.startDate;
  const endDate = patch.endDate ?? cycle.endDate;
  checkDates(startDate, endDate);
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(cycles)
      .set({
        ...(patch.name !== undefined ? { name: cleanText(patch.name)?.slice(0, 80) ?? null } : {}),
        ...(patch.goal !== undefined ? { goal: cleanText(patch.goal)?.slice(0, 500) ?? null } : {}),
        startDate,
        endDate,
        ...(patch.autoRollover !== undefined ? { autoRollover: patch.autoRollover } : {}),
      })
      .where(eq(cycles.id, cycleId))
      .returning();
    if (!updated) throw notFound('That cycle');
    await logActivity(tx, ctx, { verb: 'cycle.updated', entityType: 'cycle', entityId: cycleId, projectId: cycle.projectId, before: { name: cycleLabel(cycle) }, after: { name: cycleLabel(updated) } });
    return updated;
  });
  const counts = await cycleCounts(db, [cycleId]);
  return toDTO(row, counts.get(cycleId) ?? EMPTY);
}

/** Close a cycle now. `next` moves unfinished work to the next cycle; `backlog` takes it out. */
export async function completeCycle(ctx: DomainContext, cycleId: string, mode: 'next' | 'backlog' = 'next'): Promise<{ moved: number; nextCycleId: string | null }> {
  const cycle = await loadCycle(db, ctx, cycleId);
  await requireProject(ctx, { id: cycle.projectId }, 'task:update');
  if (cycle.completedAt) throw invalid('This cycle is already closed.');
  const today = todayIso();
  const result = await db.transaction(async (tx) => {
    // Closing early ends the cycle today, so a rolled-over cycle starts tomorrow (no gap).
    let closing = cycle;
    if (today >= cycle.startDate && today < cycle.endDate) {
      await tx.update(cycles).set({ endDate: today }).where(eq(cycles.id, cycle.id));
      // The next cycle keeps the planned length (closeCycle derives it from start and end).
      closing = { ...cycle, endDate: today, startDate: addDaysIso(today, -diffDays(cycle.startDate, cycle.endDate)) };
    }
    return closeCycle(tx, ctx, closing, mode);
  });
  return { moved: result.moved, nextCycleId: result.nextCycle?.id ?? null };
}

export async function deleteCycle(ctx: DomainContext, cycleId: string): Promise<{ id: string }> {
  const cycle = await loadCycle(db, ctx, cycleId);
  await requireProject(ctx, { id: cycle.projectId }, 'task:update');
  await db.transaction(async (tx) => {
    await tx.update(cycleTasks).set({ removedAt: new Date(), removedReason: 'removed' }).where(and(eq(cycleTasks.cycleId, cycleId), isNull(cycleTasks.removedAt)));
    await tx.update(cycles).set({ deletedAt: new Date() }).where(eq(cycles.id, cycleId));
    await logActivity(tx, ctx, { verb: 'cycle.deleted', entityType: 'cycle', entityId: cycleId, projectId: cycle.projectId, before: { name: cycleLabel(cycle) } });
  });
  return { id: cycleId };
}

/** Put tasks in a cycle (moving them out of any other), or take them out (`cycleId: null`). */
export async function setTasksCycle(ctx: DomainContext, taskIds: readonly string[], cycleId: string | null): Promise<{ changed: number }> {
  const ids = [...new Set(taskIds)].slice(0, 500);
  if (!ids.length) return { changed: 0 };
  const rows = await db
    .select({ id: tasks.id, projectId: tasks.projectId, parentTaskId: tasks.parentTaskId, kind: tasks.kind })
    .from(tasks)
    .where(and(inArray(tasks.id, ids), eq(tasks.orgId, ctx.orgId), isNull(tasks.deletedAt)));
  if (rows.length !== ids.length) throw notFound('One of those tasks');
  if (rows.some((row) => row.kind === 'build')) throw invalid('Builds are planned by date, not in cycles.');
  const projectIds = new Set(rows.map((row) => row.projectId));
  if (projectIds.size !== 1) throw invalid('Pick tasks from one project at a time.');
  const projectId = rows[0]!.projectId;
  await requireProject(ctx, { id: projectId }, 'task:update');
  let target: Cycle | null = null;
  if (cycleId) {
    target = await loadCycle(db, ctx, cycleId);
    if (target.projectId !== projectId) throw invalid('That cycle belongs to another project.');
    if (target.completedAt) throw invalid('That cycle is closed. Pick a current or upcoming one.');
  }
  if (rows.some((row) => row.parentTaskId)) throw invalid('Subtasks follow their parent task. Add the parent task to the cycle.');
  return db.transaction(async (tx) => {
    const current = await tx
      .select({ id: cycleTasks.id, taskId: cycleTasks.taskId, cycleId: cycleTasks.cycleId, name: cycles.name, number: cycles.number })
      .from(cycleTasks)
      .innerJoin(cycles, eq(cycles.id, cycleTasks.cycleId))
      .where(and(inArray(cycleTasks.taskId, ids), isNull(cycleTasks.removedAt)));
    const byTask = new Map(current.map((row) => [row.taskId, row]));
    const changing = ids.filter((id) => (byTask.get(id)?.cycleId ?? null) !== cycleId);
    if (!changing.length) return { changed: 0 };
    const now = new Date();
    const leaving = changing.map((id) => byTask.get(id)).filter((row): row is NonNullable<typeof row> => Boolean(row));
    if (leaving.length) {
      await tx
        .update(cycleTasks)
        .set({ removedAt: now, removedReason: cycleId ? 'moved' : 'removed' })
        .where(inArray(cycleTasks.id, leaving.map((row) => row.id)));
    }
    if (target) {
      const targetId = target.id;
      await tx.insert(cycleTasks).values(changing.map((taskId) => ({ orgId: ctx.orgId, cycleId: targetId, taskId, addedAt: now, addedBy: ctx.userId })));
    }
    await logActivity(
      tx,
      ctx,
      changing.map((taskId) => {
        const before = byTask.get(taskId);
        return {
          verb: 'task.cycle_changed',
          entityType: 'task',
          entityId: taskId,
          taskId,
          projectId,
          field: 'cycle',
          before: before ? { id: before.cycleId, name: cycleLabel(before) } : null,
          after: target ? { id: target.id, name: cycleLabel(target) } : null,
        };
      }),
    );
    return { changed: changing.length };
  });
}
