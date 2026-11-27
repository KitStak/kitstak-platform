/**
 * Portfolio team domain: project status updates, goal check-ins and reports (portfolio rollup
 * and per-project). Status updates and check-ins are stored in the append-only activity log
 * (verbs `project.update_posted`, `goal.checked_in`) so their history can never be edited.
 */
import 'server-only';
import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { db } from '@/server/db';
import { activity, goalKeyResults, goals, projectMembers, projects, statuses, tasks } from '@/server/db/schema';
import { invalid, notFound } from '@/server/errors';
import type { GoalHealth, ProjectHealth, ProjectStatus, StatusCategory } from '@/lib/constants';
import { addDaysIso, todayIso } from '@/lib/dates';
import { buildReport, dayOf, type ReportTaskRow, type StatusMeta } from '@/lib/report-math';
import { goalProgress } from '@/lib/rollups';
import type { GoalCheckInDTO, GoalDTO, ProjectDetail, ProjectUpdateDTO, ReportDTO } from '@/lib/types';
import { cleanText, isoRequired, type DomainContext } from './_shared';
import { requireOrg, requireProject, visibleProjectsWhere, type ProjectRefInput } from './access';
import { logActivity } from './activity';
import { getGoal, listGoals } from './goals';
import { notify } from './notifications';
import { updateProject } from './projects';

const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {});

// --- Project status updates -----------------------------------------------------------------

export interface PostProjectUpdateInput {
  readonly health: ProjectHealth;
  readonly note?: string | null;
  readonly status?: ProjectStatus;
}

function toUpdateDTO(row: typeof activity.$inferSelect): ProjectUpdateDTO {
  const after = record(row.after);
  return {
    id: row.id,
    projectId: row.projectId ?? '',
    authorId: row.actorId,
    health: (after.health as ProjectHealth) ?? 'on_track',
    status: (after.status as ProjectStatus | undefined) ?? null,
    note: typeof after.note === 'string' ? after.note : null,
    progress: Number(record(row.meta).progress ?? 0),
    createdAt: isoRequired(row.createdAt),
  };
}

/**
 * Post a status update: sets health (+ optional status) and the headline note on the project,
 * appends the update to the history and tells the project's members.
 */
export async function postProjectUpdate(
  ctx: DomainContext,
  projectId: string,
  input: PostProjectUpdateInput,
): Promise<{ project: ProjectDetail; update: ProjectUpdateDTO }> {
  const { project } = await requireProject(ctx, { id: projectId }, 'project:update');
  const note = cleanText(input.note)?.slice(0, 2000) ?? null;
  const statusChanged = input.status !== undefined && input.status !== project.status;
  const healthChanged = input.health !== project.health;
  const detail = await updateProject(ctx, projectId, {
    health: input.health,
    healthNote: note ? note.split('\n')[0]?.slice(0, 280) ?? null : null,
    ...(statusChanged ? { status: input.status } : {}),
  });
  const [row] = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(activity)
      .values({
        orgId: ctx.orgId,
        projectId,
        actorId: ctx.actorKind === 'user' || ctx.actorKind === 'integration' ? ctx.userId : null,
        actorKind: ctx.actorKind,
        verb: 'project.update_posted',
        entityType: 'project',
        entityId: projectId,
        before: { health: project.health, status: project.status },
        after: { health: input.health, note, status: statusChanged ? input.status : null },
        meta: { progress: detail.progress.percent },
      })
      .returning();
    // updateProject already alerts members when health turns at risk / off track.
    if (!(healthChanged && input.health !== 'on_track')) {
      const members = await tx.select({ userId: projectMembers.userId }).from(projectMembers).where(eq(projectMembers.projectId, projectId));
      await notify(tx, ctx, {
        recipients: members.map((m) => m.userId),
        kind: 'project',
        title: `${ctx.userName} posted an update on ${detail.name}`,
        body: note,
        url: `/p/${detail.key}`,
        projectId,
      });
    }
    return inserted;
  });
  if (!row) throw notFound('That update');
  return { project: detail, update: toUpdateDTO(row) };
}

export async function listProjectUpdates(ctx: DomainContext, projectId: string, limit = 50): Promise<ProjectUpdateDTO[]> {
  await requireProject(ctx, { id: projectId });
  const rows = await db
    .select()
    .from(activity)
    .where(and(eq(activity.orgId, ctx.orgId), eq(activity.projectId, projectId), eq(activity.verb, 'project.update_posted')))
    .orderBy(desc(activity.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));
  return rows.map(toUpdateDTO);
}

// --- Goal check-ins -----------------------------------------------------------------------

export interface GoalCheckInInput {
  readonly health: GoalHealth;
  readonly note?: string | null;
  /** New current values for number/percent/currency/boolean key results. */
  readonly keyResults?: readonly { readonly id: string; readonly currentValue: number }[];
  /** New progress (0-100) when the goal tracks progress by hand. */
  readonly manualProgress?: number;
}

function toCheckInDTO(row: typeof activity.$inferSelect): GoalCheckInDTO {
  const after = record(row.after);
  const meta = record(row.meta);
  const krs = Array.isArray(meta.keyResults) ? (meta.keyResults as Record<string, unknown>[]) : [];
  return {
    id: row.id,
    goalId: row.entityId ?? '',
    authorId: row.actorId,
    health: (after.health as GoalHealth) ?? 'on_track',
    note: typeof after.note === 'string' ? after.note : null,
    progress: Number(meta.progress ?? 0),
    keyResults: krs.map((kr) => ({
      id: String(kr.id ?? ''),
      name: String(kr.name ?? ''),
      before: Number(kr.before ?? 0),
      after: Number(kr.after ?? 0),
      unit: typeof kr.unit === 'string' ? kr.unit : null,
    })),
    createdAt: isoRequired(row.createdAt),
  };
}

/** Projected progress after a check-in (same rollup the goal list uses). */
function projectedProgress(goal: GoalDTO, all: readonly GoalDTO[], values: ReadonlyMap<string, number>, manual: number | undefined): number {
  const children = all.filter((g) => g.parentGoalId === goal.id).map((g) => g.progress);
  if (goal.progressMode === 'projects') return goal.progress;
  return goalProgress({
    mode: goal.progressMode,
    manualProgress: manual ?? goal.manualProgress,
    keyResults: goal.keyResults.map((kr) => ({
      kind: kr.kind,
      startValue: kr.startValue,
      targetValue: kr.targetValue,
      currentValue: values.get(kr.id) ?? kr.currentValue,
      projectPercent: kr.kind === 'project' ? kr.progress : null,
    })),
    projectPercents: [],
    childGoalPercents: children,
  });
}

export async function checkInGoal(ctx: DomainContext, goalId: string, input: GoalCheckInInput): Promise<{ goal: GoalDTO; checkIn: GoalCheckInDTO }> {
  requireOrg(ctx, 'goal:manage');
  const all = await listGoals(ctx);
  const goal = all.find((g) => g.id === goalId);
  if (!goal) throw notFound('That goal');
  const note = cleanText(input.note)?.slice(0, 2000) ?? null;
  const values = new Map<string, number>();
  for (const change of input.keyResults ?? []) {
    const kr = goal.keyResults.find((k) => k.id === change.id);
    if (!kr) throw invalid('One of those key results is not part of this goal.');
    if (kr.kind === 'project') continue;
    if (!Number.isFinite(change.currentValue)) throw invalid(`Enter a number for “${kr.name}”.`);
    if (change.currentValue !== kr.currentValue) values.set(kr.id, change.currentValue);
  }
  const manual = input.manualProgress === undefined ? undefined : Math.max(0, Math.min(100, Math.round(input.manualProgress)));
  const progress = projectedProgress(goal, all, values, manual);
  const [row] = await db.transaction(async (tx) => {
    for (const [id, currentValue] of values) {
      await tx.update(goalKeyResults).set({ currentValue, updatedAt: new Date() }).where(and(eq(goalKeyResults.id, id), eq(goalKeyResults.goalId, goalId)));
    }
    await tx
      .update(goals)
      .set({ health: input.health, ...(manual !== undefined && goal.progressMode === 'manual' ? { manualProgress: manual } : {}), updatedAt: new Date() })
      .where(eq(goals.id, goalId));
    await logActivity(tx, ctx, {
      verb: 'goal.updated',
      entityType: 'goal',
      entityId: goalId,
      before: { name: goal.name, health: goal.health },
      after: { name: goal.name, health: input.health },
    });
    return tx
      .insert(activity)
      .values({
        orgId: ctx.orgId,
        actorId: ctx.actorKind === 'user' || ctx.actorKind === 'integration' ? ctx.userId : null,
        actorKind: ctx.actorKind,
        verb: 'goal.checked_in',
        entityType: 'goal',
        entityId: goalId,
        before: { health: goal.health, progress: goal.progress },
        after: { health: input.health, note },
        meta: {
          progress,
          keyResults: goal.keyResults
            .filter((kr) => values.has(kr.id))
            .map((kr) => ({ id: kr.id, name: kr.name, before: kr.currentValue, after: values.get(kr.id), unit: kr.unit })),
        },
      })
      .returning();
  });
  if (!row) throw notFound('That check-in');
  if (goal.ownerId && goal.ownerId !== ctx.userId) {
    await notify(db, ctx, {
      recipients: [goal.ownerId],
      kind: 'project',
      title: `${ctx.userName} checked in on “${goal.name}”`,
      body: note,
      url: `/goals?goal=${goalId}`,
    });
  }
  return { goal: await getGoal(ctx, goalId), checkIn: toCheckInDTO(row) };
}

export async function listGoalCheckIns(ctx: DomainContext, goalId: string, limit = 50): Promise<GoalCheckInDTO[]> {
  if (!/^[0-9a-f-]{36}$/i.test(goalId)) throw notFound('That goal');
  const [goal] = await db.select({ id: goals.id }).from(goals).where(and(eq(goals.id, goalId), eq(goals.orgId, ctx.orgId)));
  if (!goal) throw notFound('That goal');
  const rows = await db
    .select()
    .from(activity)
    .where(and(eq(activity.orgId, ctx.orgId), eq(activity.entityType, 'goal'), eq(activity.entityId, goalId), eq(activity.verb, 'goal.checked_in')))
    .orderBy(desc(activity.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));
  return rows.map(toCheckInDTO);
}

// --- Reports ------------------------------------------------------------------------------

async function loadReportRows(where: SQL): Promise<ReportTaskRow[]> {
  const startedAt = sql<Date | null>`(
    select min(a.created_at) from pm.activity a
    where a.task_id = ${tasks.id} and a.field = 'status' and a.meta->>'toCategory' = 'in_progress'
  )`;
  const rows = await db
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      projectKey: projects.key,
      number: tasks.number,
      title: tasks.title,
      statusId: tasks.statusId,
      category: statuses.category,
      assigneeId: tasks.assigneeId,
      createdAt: tasks.createdAt,
      completedAt: tasks.completedAt,
      startedAt,
      dueDate: tasks.dueDate,
      points: tasks.estimatePoints,
    })
    .from(tasks)
    .innerJoin(statuses, eq(statuses.id, tasks.statusId))
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(where, isNull(tasks.deletedAt), isNull(tasks.parentTaskId)));
  const toIso = (value: Date | string | null) => (value === null ? null : new Date(value).toISOString());
  return rows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    key: `${row.projectKey}-${row.number}`,
    title: row.title,
    statusId: row.statusId,
    category: row.category as StatusCategory,
    assigneeId: row.assigneeId,
    createdAt: toIso(row.createdAt) as string,
    completedAt: toIso(row.completedAt),
    startedAt: toIso(row.startedAt),
    dueDate: row.dueDate,
    points: row.points,
  }));
}

const clampWeeks = (weeks: number | undefined) => Math.max(4, Math.min(26, Math.round(weeks ?? 8)));

/**
 * Reports for one project: burndown to its due date, velocity, cycle time, people. Projects only
 * (docs/programs/SPEC.md 4.1): a program's builds are not tasks to burn down, and its dashboard
 * panels come from `dashboardPrograms`.
 */
export async function getProjectReport(ctx: DomainContext, ref: ProjectRefInput, options: { readonly weeks?: number } = {}): Promise<ReportDTO> {
  const { project } = await requireProject(ctx, ref, 'project:read', db, { kind: 'project' });
  const [rows, statusRows] = await Promise.all([
    loadReportRows(eq(tasks.projectId, project.id)),
    db.select().from(statuses).where(eq(statuses.projectId, project.id)).orderBy(sql`${statuses.position} COLLATE "C"`),
  ]);
  const today = todayIso();
  const firstCreated = rows.reduce<string | null>((min, row) => {
    const day = dayOf(row.createdAt);
    return !min || day < min ? day : min;
  }, null);
  const from = project.startDate ?? firstCreated ?? today;
  const metas: StatusMeta[] = statusRows.map((s) => ({ id: s.id, name: s.name, category: s.category, color: s.color, position: s.position }));
  const data = buildReport({ rows, statuses: metas, byCategory: false, today, from, dueDate: project.dueDate, weeks: clampWeeks(options.weeks) });
  return { ...data, scope: { kind: 'project', projectId: project.id, key: project.key, name: project.name } };
}

/** Portfolio rollup across every live (not archived, not template) project the viewer can see. */
export async function getPortfolioReport(ctx: DomainContext, options: { readonly weeks?: number; readonly spaceId?: string | null } = {}): Promise<ReportDTO> {
  const weeks = clampWeeks(options.weeks);
  const scope = and(
    visibleProjectsWhere(ctx),
    isNull(projects.archivedAt),
    eq(projects.isTemplate, false),
    options.spaceId ? eq(projects.spaceId, options.spaceId) : undefined,
  ) as SQL;
  const [rows, projectRows] = await Promise.all([loadReportRows(scope), db.select({ id: projects.id }).from(projects).where(scope)]);
  const today = todayIso();
  const data = buildReport({
    rows,
    statuses: [],
    byCategory: true,
    today,
    from: addDaysIso(today, -weeks * 7),
    dueDate: null,
    weeks,
  });
  return { ...data, scope: { kind: 'portfolio', projectCount: projectRows.length, spaceId: options.spaceId ?? null } };
}
