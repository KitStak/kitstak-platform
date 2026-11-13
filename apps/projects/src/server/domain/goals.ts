/** Goals (OKRs) with key results, linked projects and progress rollups (src/lib/rollups.ts). */
import 'server-only';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { goalKeyResults, goalProjects, goals, projects, statuses, tasks, type Goal, type GoalKeyResult } from '@/server/db/schema';
import { invalid, notFound } from '@/server/errors';
import type { GoalHealth, GoalProgressMode, KeyResultKind } from '@/lib/constants';
import { isIsoDate } from '@/lib/dates';
import { rankAfter } from '@/lib/rank';
import { goalProgress, keyResultProgress, projectPercent } from '@/lib/rollups';
import type { GoalDTO, KeyResultDTO } from '@/lib/types';
import { cleanText, isoRequired, type DomainContext } from './_shared';
import { requireOrg, requireProject, visibleProjectsWhere } from './access';
import { logActivity } from './activity';

async function projectPercents(ctx: DomainContext, projectIds: readonly string[]): Promise<Map<string, number>> {
  if (projectIds.length === 0) return new Map();
  const rows = await db
    .select({
      projectId: tasks.projectId,
      total: sql<number>`count(*) filter (where ${statuses.category} <> 'cancelled')::int`,
      done: sql<number>`count(*) filter (where ${statuses.category} = 'done')::int`,
    })
    .from(tasks)
    .innerJoin(statuses, eq(statuses.id, tasks.statusId))
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(inArray(tasks.projectId, [...projectIds]), isNull(tasks.deletedAt), isNull(tasks.parentTaskId), visibleProjectsWhere(ctx)))
    .groupBy(tasks.projectId);
  return new Map(rows.map((row) => [row.projectId, projectPercent({ total: Number(row.total), done: Number(row.done) })]));
}

function krDTO(row: GoalKeyResult, percents: Map<string, number>): KeyResultDTO {
  return {
    id: row.id,
    goalId: row.goalId,
    name: row.name,
    kind: row.kind,
    startValue: row.startValue,
    targetValue: row.targetValue,
    currentValue: row.currentValue,
    unit: row.unit,
    projectId: row.projectId,
    position: row.position,
    progress: keyResultProgress({ ...row, projectPercent: row.projectId ? (percents.get(row.projectId) ?? 0) : null }),
  };
}

/** Every goal with rolled-up progress (child goals roll into parents). */
export async function listGoals(ctx: DomainContext): Promise<GoalDTO[]> {
  const goalRows = await db
    .select()
    .from(goals)
    .where(and(eq(goals.orgId, ctx.orgId), isNull(goals.deletedAt)))
    .orderBy(sql`${goals.position} COLLATE "C"`);
  if (goalRows.length === 0) return [];
  const ids = goalRows.map((g) => g.id);
  const [krRows, links] = await Promise.all([
    db.select().from(goalKeyResults).where(inArray(goalKeyResults.goalId, ids)).orderBy(sql`${goalKeyResults.position} COLLATE "C"`),
    db.select().from(goalProjects).where(inArray(goalProjects.goalId, ids)),
  ]);
  const projectIds = [...new Set([...links.map((l) => l.projectId), ...krRows.flatMap((k) => (k.projectId ? [k.projectId] : []))])];
  const percents = await projectPercents(ctx, projectIds);
  const memo = new Map<string, number>();
  const byId = new Map(goalRows.map((g) => [g.id, g]));
  const compute = (goal: Goal, depth = 0): number => {
    const cached = memo.get(goal.id);
    if (cached !== undefined) return cached;
    const children = depth > 10 ? [] : goalRows.filter((g) => g.parentGoalId === goal.id).map((child) => compute(child, depth + 1));
    const value = goalProgress({
      mode: goal.progressMode,
      manualProgress: goal.manualProgress,
      keyResults: krRows
        .filter((k) => k.goalId === goal.id)
        .map((k) => ({ ...k, projectPercent: k.projectId ? (percents.get(k.projectId) ?? 0) : null })),
      projectPercents: links.filter((l) => l.goalId === goal.id).map((l) => percents.get(l.projectId) ?? 0),
      childGoalPercents: children,
    });
    memo.set(goal.id, value);
    return value;
  };
  return goalRows.map((goal) => ({
    id: goal.id,
    parentGoalId: goal.parentGoalId && byId.has(goal.parentGoalId) ? goal.parentGoalId : null,
    name: goal.name,
    description: goal.description,
    ownerId: goal.ownerId,
    period: goal.period,
    startDate: goal.startDate,
    dueDate: goal.dueDate,
    health: goal.health,
    progressMode: goal.progressMode,
    manualProgress: goal.manualProgress,
    color: goal.color,
    position: goal.position,
    keyResults: krRows.filter((k) => k.goalId === goal.id).map((k) => krDTO(k, percents)),
    projectIds: links.filter((l) => l.goalId === goal.id).map((l) => l.projectId),
    progress: compute(goal),
    createdAt: isoRequired(goal.createdAt),
    updatedAt: isoRequired(goal.updatedAt),
  }));
}

export async function getGoal(ctx: DomainContext, goalId: string): Promise<GoalDTO> {
  const goal = (await listGoals(ctx)).find((g) => g.id === goalId);
  if (!goal) throw notFound('That goal');
  return goal;
}

/** Goals a project contributes to (project overview). */
export async function listGoalsForProject(ctx: DomainContext, projectId: string): Promise<GoalDTO[]> {
  await requireProject(ctx, { id: projectId });
  const all = await listGoals(ctx);
  return all.filter((goal) => goal.projectIds.includes(projectId) || goal.keyResults.some((kr) => kr.projectId === projectId));
}

export interface GoalInput {
  readonly name: string;
  readonly description?: string | null;
  readonly ownerId?: string | null;
  readonly parentGoalId?: string | null;
  readonly period?: string | null;
  readonly startDate?: string | null;
  readonly dueDate?: string | null;
  readonly health?: GoalHealth;
  readonly progressMode?: GoalProgressMode;
  readonly manualProgress?: number;
  readonly color?: string;
}

function checkDates(start: string | null | undefined, due: string | null | undefined): void {
  if ((start && !isIsoDate(start)) || (due && !isIsoDate(due))) throw invalid('Pick valid dates.');
  if (start && due && start > due) throw invalid('The start date has to be on or before the due date.');
}

export async function createGoal(ctx: DomainContext, input: GoalInput): Promise<GoalDTO> {
  requireOrg(ctx, 'goal:manage');
  const name = cleanText(input.name);
  if (!name) throw invalid('Give the goal a name.', { name: 'Give the goal a name.' });
  checkDates(input.startDate, input.dueDate);
  const [row] = await db.transaction(async (tx) => {
    const [last] = await tx.select({ position: goals.position }).from(goals).where(eq(goals.orgId, ctx.orgId)).orderBy(sql`${goals.position} COLLATE "C" desc`).limit(1);
    const inserted = await tx
      .insert(goals)
      .values({
        orgId: ctx.orgId,
        parentGoalId: input.parentGoalId ?? null,
        name,
        description: cleanText(input.description),
        ownerId: input.ownerId ?? ctx.userId,
        period: cleanText(input.period),
        startDate: input.startDate ?? null,
        dueDate: input.dueDate ?? null,
        health: input.health ?? 'on_track',
        progressMode: input.progressMode ?? 'key_results',
        manualProgress: Math.max(0, Math.min(100, Math.round(input.manualProgress ?? 0))),
        color: input.color ?? 'blue',
        position: rankAfter(last?.position),
        createdBy: ctx.userId,
      })
      .returning();
    await logActivity(tx, ctx, { verb: 'goal.created', entityType: 'goal', entityId: inserted[0].id, after: { name } });
    return inserted;
  });
  return getGoal(ctx, row.id);
}

async function loadGoal(ctx: DomainContext, goalId: string): Promise<Goal> {
  const [row] = await db.select().from(goals).where(and(eq(goals.id, goalId), eq(goals.orgId, ctx.orgId), isNull(goals.deletedAt)));
  if (!row) throw notFound('That goal');
  return row;
}

export async function updateGoal(ctx: DomainContext, goalId: string, patch: Partial<GoalInput> & { position?: string }): Promise<GoalDTO> {
  requireOrg(ctx, 'goal:manage');
  const current = await loadGoal(ctx, goalId);
  const set: Partial<typeof goals.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) {
    const name = cleanText(patch.name);
    if (!name) throw invalid('Give the goal a name.', { name: 'Give the goal a name.' });
    set.name = name;
  }
  if (patch.description !== undefined) set.description = cleanText(patch.description);
  if (patch.ownerId !== undefined) set.ownerId = patch.ownerId;
  if (patch.parentGoalId !== undefined) {
    if (patch.parentGoalId === goalId) throw invalid('A goal can’t be inside itself.');
    set.parentGoalId = patch.parentGoalId;
  }
  if (patch.period !== undefined) set.period = cleanText(patch.period);
  if (patch.startDate !== undefined) set.startDate = patch.startDate;
  if (patch.dueDate !== undefined) set.dueDate = patch.dueDate;
  checkDates(set.startDate !== undefined ? set.startDate : current.startDate, set.dueDate !== undefined ? set.dueDate : current.dueDate);
  if (patch.health !== undefined) set.health = patch.health;
  if (patch.progressMode !== undefined) set.progressMode = patch.progressMode;
  if (patch.manualProgress !== undefined) set.manualProgress = Math.max(0, Math.min(100, Math.round(patch.manualProgress)));
  if (patch.color !== undefined) set.color = patch.color;
  if (patch.position !== undefined) set.position = patch.position;
  await db.transaction(async (tx) => {
    await tx.update(goals).set(set).where(eq(goals.id, goalId));
    await logActivity(tx, ctx, {
      verb: 'goal.updated',
      entityType: 'goal',
      entityId: goalId,
      before: { name: current.name, health: current.health },
      after: { name: set.name ?? current.name, health: set.health ?? current.health },
    });
  });
  return getGoal(ctx, goalId);
}

export async function deleteGoal(ctx: DomainContext, goalId: string): Promise<void> {
  requireOrg(ctx, 'goal:manage');
  const current = await loadGoal(ctx, goalId);
  await db.transaction(async (tx) => {
    await tx.update(goals).set({ deletedAt: new Date() }).where(eq(goals.id, goalId));
    await tx.update(goals).set({ parentGoalId: current.parentGoalId }).where(eq(goals.parentGoalId, goalId));
    await logActivity(tx, ctx, { verb: 'goal.deleted', entityType: 'goal', entityId: goalId, before: { name: current.name } });
  });
}

export async function restoreGoal(ctx: DomainContext, goalId: string): Promise<GoalDTO> {
  requireOrg(ctx, 'goal:manage');
  await db.update(goals).set({ deletedAt: null }).where(and(eq(goals.id, goalId), eq(goals.orgId, ctx.orgId)));
  return getGoal(ctx, goalId);
}

export interface KeyResultInput {
  readonly name: string;
  readonly kind?: KeyResultKind;
  readonly startValue?: number;
  readonly targetValue?: number;
  readonly currentValue?: number;
  readonly unit?: string | null;
  readonly projectId?: string | null;
}

export async function addKeyResult(ctx: DomainContext, goalId: string, input: KeyResultInput): Promise<GoalDTO> {
  requireOrg(ctx, 'goal:manage');
  await loadGoal(ctx, goalId);
  const name = cleanText(input.name);
  if (!name) throw invalid('Give the key result a name.', { name: 'Give the key result a name.' });
  if (input.projectId) await requireProject(ctx, { id: input.projectId });
  const kind = input.kind ?? (input.projectId ? 'project' : 'number');
  await db.transaction(async (tx) => {
    const [last] = await tx.select({ position: goalKeyResults.position }).from(goalKeyResults).where(eq(goalKeyResults.goalId, goalId)).orderBy(sql`${goalKeyResults.position} COLLATE "C" desc`).limit(1);
    await tx.insert(goalKeyResults).values({
      orgId: ctx.orgId,
      goalId,
      name,
      kind,
      startValue: input.startValue ?? 0,
      targetValue: input.targetValue ?? (kind === 'boolean' ? 1 : 100),
      currentValue: input.currentValue ?? input.startValue ?? 0,
      unit: cleanText(input.unit),
      projectId: input.projectId ?? null,
      position: rankAfter(last?.position),
    });
    await tx.update(goals).set({ updatedAt: new Date() }).where(eq(goals.id, goalId));
    await logActivity(tx, ctx, { verb: 'goal.key_result_added', entityType: 'goal', entityId: goalId, after: { name } });
  });
  return getGoal(ctx, goalId);
}

export async function updateKeyResult(ctx: DomainContext, keyResultId: string, patch: Partial<KeyResultInput> & { position?: string }): Promise<GoalDTO> {
  requireOrg(ctx, 'goal:manage');
  const [current] = await db.select().from(goalKeyResults).where(and(eq(goalKeyResults.id, keyResultId), eq(goalKeyResults.orgId, ctx.orgId)));
  if (!current) throw notFound('That key result');
  const set: Partial<typeof goalKeyResults.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) {
    const name = cleanText(patch.name);
    if (!name) throw invalid('Give the key result a name.');
    set.name = name;
  }
  if (patch.kind !== undefined) set.kind = patch.kind;
  if (patch.startValue !== undefined) set.startValue = patch.startValue;
  if (patch.targetValue !== undefined) set.targetValue = patch.targetValue;
  if (patch.currentValue !== undefined) set.currentValue = patch.currentValue;
  if (patch.unit !== undefined) set.unit = cleanText(patch.unit);
  if (patch.projectId !== undefined) {
    if (patch.projectId) await requireProject(ctx, { id: patch.projectId });
    set.projectId = patch.projectId;
  }
  if (patch.position !== undefined) set.position = patch.position;
  await db.transaction(async (tx) => {
    await tx.update(goalKeyResults).set(set).where(eq(goalKeyResults.id, keyResultId));
    await tx.update(goals).set({ updatedAt: new Date() }).where(eq(goals.id, current.goalId));
    await logActivity(tx, ctx, {
      verb: 'goal.key_result_updated',
      entityType: 'goal',
      entityId: current.goalId,
      before: { name: current.name, currentValue: current.currentValue },
      after: { name: set.name ?? current.name, currentValue: set.currentValue ?? current.currentValue },
    });
  });
  return getGoal(ctx, current.goalId);
}

export async function deleteKeyResult(ctx: DomainContext, keyResultId: string): Promise<GoalDTO> {
  requireOrg(ctx, 'goal:manage');
  const [current] = await db.select().from(goalKeyResults).where(and(eq(goalKeyResults.id, keyResultId), eq(goalKeyResults.orgId, ctx.orgId)));
  if (!current) throw notFound('That key result');
  await db.delete(goalKeyResults).where(eq(goalKeyResults.id, keyResultId));
  return getGoal(ctx, current.goalId);
}

export async function linkGoalProject(ctx: DomainContext, goalId: string, projectId: string, linked: boolean): Promise<GoalDTO> {
  requireOrg(ctx, 'goal:manage');
  await loadGoal(ctx, goalId);
  await requireProject(ctx, { id: projectId });
  await db.transaction(async (tx) => {
    if (linked) await tx.insert(goalProjects).values({ goalId, projectId, orgId: ctx.orgId }).onConflictDoNothing();
    else await tx.delete(goalProjects).where(and(eq(goalProjects.goalId, goalId), eq(goalProjects.projectId, projectId)));
    await logActivity(tx, ctx, { verb: linked ? 'goal.project_linked' : 'goal.project_unlinked', entityType: 'goal', entityId: goalId, projectId });
  });
  return getGoal(ctx, goalId);
}
