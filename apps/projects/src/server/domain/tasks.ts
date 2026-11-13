/**
 * Tasks: create / update / move / reorder / bulk / duplicate / move-to-project / delete+restore,
 * labels, dependencies and detail reads. Every mutation:
 *   1. checks permissions (access.ts),
 *   2. writes inside one transaction with activity rows (activity.ts),
 *   3. emits notifications (notifications.ts) and auto-follows participants,
 *   4. after commit, runs automations for the resulting task events (automations.ts).
 */
import 'server-only';
import { and, asc, desc, eq, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { db, type Executor } from '@/server/db';
import {
  integrationLinks,
  labels,
  milestones,
  projects,
  sections,
  statuses,
  taskDependencies,
  taskLabels,
  tasks,
  timeEntries,
  watchers,
  type Project,
  type Status,
  type Task,
  type TaskRecurrence,
} from '@/server/db/schema';
import { invalid, notFound } from '@/server/errors';
import { sanitizeRichText } from '@/server/sanitize';
import type { DependencyKind, Priority, StatusCategory } from '@/lib/constants';
import { addDaysIso, isIsoDate, todayIso } from '@/lib/dates';
import { compareRank, rankAfter, rankBefore, rankBetween } from '@/lib/rank';
import { routes } from '@/lib/routes';
import { taskKey } from '@/lib/task-key';
import type { TaskDetail, TaskSummary } from '@/lib/types';
import type { TaskEvent } from '@/server/automations/engine';
import { cleanText, toIntegrationLinkDTO, toTimeEntryDTO, type DomainContext } from './_shared';
import { requireProject, requireTask, visibleProjectsWhere } from './access';
import { logActivity, type ActivityEntry } from './activity';
import { addWatchers, listWatcherIds, notify } from './notifications';
import { filterOrgMembers, isOrgMember } from './people';
import { selectTaskRefs, selectTaskSummaries, selectTaskSummary } from './task-queries';

// --- Inputs ---------------------------------------------------------------------------------

/** Where to place a task: explicit rank, or between two neighbours (drag and drop). */
export interface PlacementInput {
  /** The task that should end up directly above this one (null = top). */
  readonly afterTaskId?: string | null;
  /** The task that should end up directly below this one (null = bottom). */
  readonly beforeTaskId?: string | null;
  /** Shortcut: 'top' | 'bottom' of the scope. */
  readonly at?: 'top' | 'bottom';
}

export interface CreateTaskInput extends PlacementInput {
  readonly projectId: string;
  readonly title: string;
  readonly description?: string | null;
  readonly statusId?: string | null;
  readonly sectionId?: string | null;
  readonly priority?: Priority;
  readonly assigneeId?: string | null;
  readonly startDate?: string | null;
  readonly dueDate?: string | null;
  readonly estimatePoints?: number | null;
  readonly estimateMinutes?: number | null;
  readonly parentTaskId?: string | null;
  readonly milestoneId?: string | null;
  readonly isMilestone?: boolean;
  readonly labelIds?: readonly string[];
  readonly customFields?: Readonly<Record<string, unknown>>;
  readonly recurrence?: TaskRecurrence | null;
  readonly watcherIds?: readonly string[];
}

export interface UpdateTaskInput {
  readonly title?: string;
  readonly description?: string | null;
  readonly statusId?: string;
  readonly sectionId?: string | null;
  readonly priority?: Priority;
  readonly assigneeId?: string | null;
  readonly reporterId?: string | null;
  readonly startDate?: string | null;
  readonly dueDate?: string | null;
  readonly estimatePoints?: number | null;
  readonly estimateMinutes?: number | null;
  readonly milestoneId?: string | null;
  readonly isMilestone?: boolean;
  /** Partial merge: a key set to null removes that field value. */
  readonly customFields?: Readonly<Record<string, unknown>>;
  readonly recurrence?: TaskRecurrence | null;
}

export interface MoveTaskInput extends PlacementInput {
  readonly statusId?: string;
  readonly sectionId?: string | null;
  /** Re-parent (null = make top-level). */
  readonly parentTaskId?: string | null;
}

// --- Helpers --------------------------------------------------------------------------------

function assertDate(value: string | null | undefined, field: string): void {
  if (value !== null && value !== undefined && !isIsoDate(value)) {
    throw invalid('Pick a valid date.', { [field]: 'Pick a valid date.' });
  }
}

function assertDateOrder(start: string | null, due: string | null): void {
  if (start && due && start > due) {
    throw invalid('The start date has to be on or before the due date.', {
      startDate: 'Start date is after the due date.',
    });
  }
}

async function projectStatuses(executor: Executor, projectId: string): Promise<Status[]> {
  return executor
    .select()
    .from(statuses)
    .where(eq(statuses.projectId, projectId))
    .orderBy(sql`${statuses.position} COLLATE "C"`);
}

function defaultStatus(list: readonly Status[]): Status {
  const status = list.find((s) => s.isDefault) ?? list.find((s) => s.category === 'todo') ?? list[0];
  if (!status) throw invalid('This project has no statuses yet. Add one in project settings.');
  return status;
}

async function assertSection(executor: Executor, projectId: string, sectionId: string | null | undefined): Promise<void> {
  if (!sectionId) return;
  const [row] = await executor
    .select({ id: sections.id })
    .from(sections)
    .where(and(eq(sections.id, sectionId), eq(sections.projectId, projectId)));
  if (!row) throw invalid('That section is not part of this project.');
}

async function assertMilestone(executor: Executor, projectId: string, milestoneId: string | null | undefined): Promise<void> {
  if (!milestoneId) return;
  const [row] = await executor
    .select({ id: milestones.id })
    .from(milestones)
    .where(and(eq(milestones.id, milestoneId), eq(milestones.projectId, projectId), isNull(milestones.deletedAt)));
  if (!row) throw invalid('That milestone is not part of this project.');
}

async function assertAssignee(ctx: DomainContext, executor: Executor, userId: string | null | undefined): Promise<void> {
  if (!userId) return;
  if (!(await isOrgMember(ctx, userId, executor))) throw invalid('That person is not in this workspace.');
}

/** Labels usable in a project: its own + workspace-wide. Returns the valid subset. */
async function validLabelIds(
  executor: Executor,
  ctx: DomainContext,
  projectId: string,
  labelIds: readonly string[],
): Promise<string[]> {
  if (labelIds.length === 0) return [];
  const rows = await executor
    .select({ id: labels.id })
    .from(labels)
    .where(
      and(
        eq(labels.orgId, ctx.orgId),
        inArray(labels.id, [...new Set(labelIds)]),
        or(eq(labels.projectId, projectId), isNull(labels.projectId)),
      ),
    );
  return rows.map((row) => row.id);
}

/** Rank for a placement inside (project, parent) scope. */
async function placementRank(
  executor: Executor,
  projectId: string,
  parentTaskId: string | null,
  placement: PlacementInput,
  excludeTaskId?: string,
): Promise<string> {
  const ids = [placement.afterTaskId, placement.beforeTaskId].filter((id): id is string => Boolean(id));
  const neighbours = ids.length
    ? await executor
        .select({ id: tasks.id, position: tasks.position })
        .from(tasks)
        .where(and(inArray(tasks.id, ids), eq(tasks.projectId, projectId)))
    : [];
  const pos = (id: string | null | undefined) => (id ? neighbours.find((n) => n.id === id)?.position : undefined);
  const after = pos(placement.afterTaskId);
  const before = pos(placement.beforeTaskId);
  if (after !== undefined || before !== undefined) {
    if (after !== undefined && before !== undefined && compareRank(after, before) >= 0) return rankAfter(after);
    return rankBetween(after ?? null, before ?? null);
  }
  const scope = and(
    eq(tasks.projectId, projectId),
    parentTaskId ? eq(tasks.parentTaskId, parentTaskId) : isNull(tasks.parentTaskId),
    excludeTaskId ? ne(tasks.id, excludeTaskId) : undefined,
  );
  if (placement.at === 'top') {
    const [first] = await executor
      .select({ position: tasks.position })
      .from(tasks)
      .where(scope)
      .orderBy(sql`${tasks.position} COLLATE "C" asc`)
      .limit(1);
    return rankBefore(first?.position);
  }
  const [last] = await executor
    .select({ position: tasks.position })
    .from(tasks)
    .where(scope)
    .orderBy(sql`${tasks.position} COLLATE "C" desc`)
    .limit(1);
  return rankAfter(last?.position);
}

async function nextTaskNumber(executor: Executor, projectId: string): Promise<number> {
  const [row] = await executor
    .update(projects)
    .set({ taskSeq: sql`${projects.taskSeq} + 1` })
    .where(eq(projects.id, projectId))
    .returning({ seq: projects.taskSeq });
  if (!row) throw notFound('That project');
  return row.seq;
}

function taskUrl(projectKey: string, number: number): string {
  return routes.task(projectKey, number);
}

/** Snapshot for the automation engine. */
async function engineTask(executor: Executor, taskId: string): Promise<TaskEvent['task'] | null> {
  const summary = await selectTaskSummary(taskId, executor);
  if (!summary) return null;
  return {
    id: summary.id,
    projectId: summary.projectId,
    title: summary.title,
    statusId: summary.statusId,
    statusCategory: summary.statusCategory,
    priority: summary.priority,
    assigneeId: summary.assigneeId,
    sectionId: summary.sectionId,
    dueDate: summary.dueDate,
    labelIds: summary.labelIds,
    parentTaskId: summary.parentTaskId,
  };
}

/** Runs automations for events after the mutation committed (never throws into the caller). */
async function afterCommit(ctx: DomainContext, events: readonly TaskEvent[]): Promise<void> {
  if (events.length === 0) return;
  const { runAutomationsForEvents } = await import('./automations');
  await runAutomationsForEvents(ctx, events);
}

const isClosedCategory = (category: StatusCategory): boolean => category === 'done' || category === 'cancelled';

// --- Reads ----------------------------------------------------------------------------------

export interface ListProjectTasksOptions {
  /** Include done/cancelled tasks (default true). */
  readonly includeCompleted?: boolean;
  /** Include subtasks (default true). */
  readonly includeSubtasks?: boolean;
}

/** Every live task of a project, in manual (position) order. */
export async function listProjectTasks(
  ctx: DomainContext,
  projectId: string,
  options: ListProjectTasksOptions = {},
): Promise<TaskSummary[]> {
  await requireProject(ctx, { id: projectId });
  const conditions: SQL[] = [eq(tasks.projectId, projectId), eq(tasks.orgId, ctx.orgId)];
  if (options.includeSubtasks === false) conditions.push(isNull(tasks.parentTaskId));
  if (options.includeCompleted === false) conditions.push(sql`${statuses.category} not in ('done', 'cancelled')`);
  return selectTaskSummaries(and(...conditions));
}

export type MyTasksScope = 'assigned' | 'created' | 'watching' | 'all';

/** Tasks across every project the actor can see (My Work, Home). */
export async function listMyTasks(
  ctx: DomainContext,
  options: { readonly scope?: MyTasksScope; readonly includeCompleted?: boolean; readonly limit?: number } = {},
): Promise<TaskSummary[]> {
  const scope = options.scope ?? 'assigned';
  const conditions: SQL[] = [eq(tasks.orgId, ctx.orgId), visibleProjectsWhere(ctx), isNull(projects.archivedAt)];
  const watching = sql`exists (select 1 from ${watchers} w where w.task_id = ${tasks.id} and w.user_id = ${ctx.userId})`;
  if (scope === 'assigned') conditions.push(eq(tasks.assigneeId, ctx.userId));
  if (scope === 'created') conditions.push(eq(tasks.createdBy, ctx.userId));
  if (scope === 'watching') conditions.push(watching);
  if (scope === 'all') {
    conditions.push(or(eq(tasks.assigneeId, ctx.userId), eq(tasks.createdBy, ctx.userId), watching) as SQL);
  }
  if (options.includeCompleted === false) {
    conditions.push(sql`${statuses.category} not in ('done', 'cancelled')`);
  } else if (options.includeCompleted !== true) {
    // Default: open tasks + anything completed in the last 7 days.
    conditions.push(
      sql`(${statuses.category} not in ('done', 'cancelled') or ${tasks.completedAt} > now() - interval '7 days')`,
    );
  }
  return selectTaskSummaries(and(...conditions), {
    limit: Math.min(options.limit ?? 500, 2000),
    orderBy: sql`${tasks.dueDate} asc nulls last, ${tasks.position} COLLATE "C"`,
  });
}

export async function getTaskSummary(ctx: DomainContext, taskId: string): Promise<TaskSummary> {
  await requireTask(ctx, taskId);
  const summary = await selectTaskSummary(taskId);
  if (!summary) throw notFound('That task');
  return summary;
}

/** Resolve `OPS-42` (project key + number) to a task id the actor can see. */
export async function resolveTaskKey(ctx: DomainContext, projectKey: string, number: number): Promise<string> {
  const { project } = await requireProject(ctx, { key: projectKey });
  const [row] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.projectId, project.id), eq(tasks.number, number), isNull(tasks.deletedAt)));
  if (!row) throw notFound('That task');
  return row.id;
}

export async function getTaskDetail(ctx: DomainContext, taskId: string): Promise<TaskDetail> {
  const { task, capabilities } = await requireTask(ctx, taskId);
  const [summary, subtasks, depsBlocked, depsBlocking, watcherIds, links, timeTotal, running] = await Promise.all([
    selectTaskSummary(taskId),
    selectTaskSummaries(eq(tasks.parentTaskId, taskId)),
    db.select().from(taskDependencies).where(eq(taskDependencies.blockedTaskId, taskId)),
    db.select().from(taskDependencies).where(eq(taskDependencies.blockingTaskId, taskId)),
    listWatcherIds(taskId),
    db.select().from(integrationLinks).where(eq(integrationLinks.taskId, taskId)).orderBy(asc(integrationLinks.createdAt)),
    db
      .select({ total: sql<number>`coalesce(sum(${timeEntries.durationMinutes}), 0)::int` })
      .from(timeEntries)
      .where(and(eq(timeEntries.taskId, taskId), isNull(timeEntries.deletedAt))),
    db
      .select()
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.taskId, taskId),
          eq(timeEntries.userId, ctx.userId),
          isNull(timeEntries.endedAt),
          isNull(timeEntries.deletedAt),
        ),
      )
      .limit(1),
  ]);
  if (!summary) throw notFound('That task');
  const refs = await selectTaskRefs([
    ...depsBlocked.map((d) => d.blockingTaskId),
    ...depsBlocking.map((d) => d.blockedTaskId),
    ...(task.parentTaskId ? [task.parentTaskId] : []),
  ]);
  const dep = (id: string, row: (typeof depsBlocked)[number]) => {
    const ref = refs.get(id);
    return ref ? [{ id: row.id, kind: row.kind, lagDays: row.lagDays, task: ref }] : [];
  };
  return {
    ...summary,
    description: task.description,
    recurrence: task.recurrence ?? null,
    createdBy: task.createdBy,
    parent: task.parentTaskId ? (refs.get(task.parentTaskId) ?? null) : null,
    subtasks,
    blockedBy: depsBlocked.flatMap((row) => dep(row.blockingTaskId, row)),
    blocking: depsBlocking.flatMap((row) => dep(row.blockedTaskId, row)),
    watcherIds,
    links: links.map(toIntegrationLinkDTO),
    timeTotalMinutes: Number(timeTotal[0]?.total ?? 0),
    runningTimer: running[0] ? toTimeEntryDTO(running[0]) : null,
    capabilities,
  };
}

// --- Create ---------------------------------------------------------------------------------

/** Inserts a task inside an existing transaction (shared by create, duplicate, templates, forms). */
export async function insertTask(
  tx: Executor,
  ctx: DomainContext,
  project: Project,
  input: CreateTaskInput,
  options: { readonly statusList?: readonly Status[]; readonly logVerb?: string; readonly activityMeta?: Record<string, unknown> } = {},
): Promise<Task> {
  const title = cleanText(input.title);
  if (!title) throw invalid('Give the task a name.', { title: 'Give the task a name.' });
  if (title.length > 500) throw invalid('Task names can be up to 500 characters.', { title: 'Too long.' });
  assertDate(input.startDate, 'startDate');
  assertDate(input.dueDate, 'dueDate');
  assertDateOrder(input.startDate ?? null, input.dueDate ?? null);
  const statusList = options.statusList ?? (await projectStatuses(tx, project.id));
  const status = input.statusId ? statusList.find((s) => s.id === input.statusId) : defaultStatus(statusList);
  if (!status) throw invalid('That status is not part of this project.');
  await assertSection(tx, project.id, input.sectionId);
  await assertMilestone(tx, project.id, input.milestoneId);
  await assertAssignee(ctx, tx, input.assigneeId);
  if (input.parentTaskId) {
    const [parent] = await tx
      .select({ id: tasks.id, projectId: tasks.projectId })
      .from(tasks)
      .where(and(eq(tasks.id, input.parentTaskId), isNull(tasks.deletedAt)));
    if (!parent || parent.projectId !== project.id) throw invalid('Subtasks must live in the same project as their parent.');
  }
  const number = await nextTaskNumber(tx, project.id);
  const position = await placementRank(tx, project.id, input.parentTaskId ?? null, input);
  const reporterId = ctx.actorKind === 'user' || ctx.actorKind === 'integration' ? ctx.userId : null;
  const [task] = await tx
    .insert(tasks)
    .values({
      orgId: ctx.orgId,
      projectId: project.id,
      number,
      title,
      description: sanitizeRichText(input.description ?? null),
      statusId: status.id,
      sectionId: input.sectionId ?? null,
      priority: input.priority ?? 'none',
      assigneeId: input.assigneeId ?? null,
      reporterId,
      startDate: input.startDate ?? null,
      dueDate: input.dueDate ?? null,
      estimatePoints: input.estimatePoints ?? null,
      estimateMinutes: input.estimateMinutes ?? null,
      parentTaskId: input.parentTaskId ?? null,
      position,
      isMilestone: input.isMilestone ?? false,
      milestoneId: input.milestoneId ?? null,
      customFields: { ...(input.customFields ?? {}) },
      recurrence: input.recurrence ?? null,
      completedAt: isClosedCategory(status.category) ? new Date() : null,
      createdBy: reporterId,
    })
    .returning();
  const labelIds = await validLabelIds(tx, ctx, project.id, input.labelIds ?? []);
  if (labelIds.length) {
    await tx.insert(taskLabels).values(labelIds.map((labelId) => ({ taskId: task.id, labelId, orgId: ctx.orgId })));
  }
  await addWatchers(tx, ctx, task.id, [reporterId, input.assigneeId, ...(input.watcherIds ?? [])]);
  await logActivity(tx, ctx, {
    verb: options.logVerb ?? 'task.created',
    entityType: 'task',
    entityId: task.id,
    projectId: project.id,
    taskId: task.id,
    after: { title, number, statusId: status.id, parentTaskId: task.parentTaskId },
    meta: options.activityMeta,
  });
  if (input.assigneeId) {
    await notify(tx, ctx, {
      recipients: [input.assigneeId],
      kind: 'assigned',
      title: `${ctx.userName} assigned you ${taskKey(project.key, number)}: ${title}`,
      url: taskUrl(project.key, number),
      projectId: project.id,
      taskId: task.id,
    });
  }
  return task;
}

export async function createTask(ctx: DomainContext, input: CreateTaskInput): Promise<TaskSummary> {
  const { project } = await requireProject(ctx, { id: input.projectId }, 'task:create');
  if (project.archivedAt) throw invalid('This project is archived. Restore it to add tasks.');
  const task = await db.transaction((tx) => insertTask(tx, ctx, project, input));
  const snapshot = await engineTask(db, task.id);
  if (snapshot) await afterCommit(ctx, [{ type: 'task_created', task: snapshot }]);
  const summary = await selectTaskSummary(task.id);
  if (!summary) throw notFound('That task');
  return summary;
}

/** Quick subtask creation under a parent. */
export async function createSubtask(
  ctx: DomainContext,
  parentTaskId: string,
  input: Omit<CreateTaskInput, 'projectId' | 'parentTaskId'>,
): Promise<TaskSummary> {
  const { task } = await requireTask(ctx, parentTaskId, 'task:create');
  return createTask(ctx, { ...input, projectId: task.projectId, parentTaskId });
}

// --- Update ---------------------------------------------------------------------------------

const TRACKED_FIELDS = [
  'title',
  'description',
  'statusId',
  'sectionId',
  'priority',
  'assigneeId',
  'reporterId',
  'startDate',
  'dueDate',
  'estimatePoints',
  'estimateMinutes',
  'milestoneId',
  'isMilestone',
  'recurrence',
] as const;

type TrackedField = (typeof TRACKED_FIELDS)[number];

/** Field name as stored in activity rows (snake-ish, stable across refactors). */
const ACTIVITY_FIELD: Readonly<Record<TrackedField, string>> = {
  title: 'title',
  description: 'description',
  statusId: 'status',
  sectionId: 'section',
  priority: 'priority',
  assigneeId: 'assignee',
  reporterId: 'reporter',
  startDate: 'start_date',
  dueDate: 'due_date',
  estimatePoints: 'estimate_points',
  estimateMinutes: 'estimate_minutes',
  milestoneId: 'milestone',
  isMilestone: 'is_milestone',
  recurrence: 'recurrence',
};

interface UpdateOutcome {
  readonly task: Task;
  readonly events: TaskEvent[];
}

/** Applies a patch inside `tx`. Returns the updated row and the automation events it produced. */
export async function applyTaskUpdate(
  tx: Executor,
  ctx: DomainContext,
  project: Project,
  current: Task,
  patch: UpdateTaskInput,
): Promise<UpdateOutcome> {
  const next: Partial<Record<TrackedField, unknown>> = {};
  if (patch.title !== undefined) {
    const title = cleanText(patch.title);
    if (!title) throw invalid('Give the task a name.', { title: 'Give the task a name.' });
    next.title = title.slice(0, 500);
  }
  if (patch.description !== undefined) next.description = sanitizeRichText(patch.description);
  if (patch.priority !== undefined) next.priority = patch.priority;
  if (patch.isMilestone !== undefined) next.isMilestone = patch.isMilestone;
  if (patch.recurrence !== undefined) next.recurrence = patch.recurrence;
  if (patch.estimatePoints !== undefined) next.estimatePoints = patch.estimatePoints;
  if (patch.estimateMinutes !== undefined) next.estimateMinutes = patch.estimateMinutes;
  if (patch.startDate !== undefined) {
    assertDate(patch.startDate, 'startDate');
    next.startDate = patch.startDate;
  }
  if (patch.dueDate !== undefined) {
    assertDate(patch.dueDate, 'dueDate');
    next.dueDate = patch.dueDate;
  }
  assertDateOrder(
    (next.startDate !== undefined ? next.startDate : current.startDate) as string | null,
    (next.dueDate !== undefined ? next.dueDate : current.dueDate) as string | null,
  );
  let statusList: Status[] | null = null;
  if (patch.statusId !== undefined) {
    statusList = await projectStatuses(tx, project.id);
    if (!statusList.some((s) => s.id === patch.statusId)) throw invalid('That status is not part of this project.');
    next.statusId = patch.statusId;
  }
  if (patch.sectionId !== undefined) {
    await assertSection(tx, project.id, patch.sectionId);
    next.sectionId = patch.sectionId;
  }
  if (patch.milestoneId !== undefined) {
    await assertMilestone(tx, project.id, patch.milestoneId);
    next.milestoneId = patch.milestoneId;
  }
  if (patch.assigneeId !== undefined) {
    await assertAssignee(ctx, tx, patch.assigneeId);
    next.assigneeId = patch.assigneeId;
  }
  if (patch.reporterId !== undefined) {
    await assertAssignee(ctx, tx, patch.reporterId);
    next.reporterId = patch.reporterId;
  }

  const changed = TRACKED_FIELDS.filter(
    (field) => next[field] !== undefined && JSON.stringify(next[field]) !== JSON.stringify(current[field] ?? null),
  );
  let customFieldsChanged: string[] = [];
  let mergedCustom = current.customFields;
  if (patch.customFields) {
    const merged: Record<string, unknown> = { ...current.customFields };
    for (const [key, value] of Object.entries(patch.customFields)) {
      if (value === null || value === undefined || value === '') delete merged[key];
      else merged[key] = value;
    }
    customFieldsChanged = Object.keys(patch.customFields).filter(
      (key) => JSON.stringify(current.customFields[key] ?? null) !== JSON.stringify(merged[key] ?? null),
    );
    mergedCustom = merged;
  }
  if (changed.length === 0 && customFieldsChanged.length === 0) return { task: current, events: [] };

  const set: Partial<typeof tasks.$inferInsert> = {};
  for (const field of changed) (set as Record<string, unknown>)[field] = next[field];
  if (customFieldsChanged.length) set.customFields = mergedCustom;

  let statusEvent: { before: Status | undefined; after: Status | undefined } | null = null;
  if (changed.includes('statusId') && statusList) {
    const before = statusList.find((s) => s.id === current.statusId);
    const after = statusList.find((s) => s.id === next.statusId);
    statusEvent = { before, after };
    if (after && isClosedCategory(after.category) && !current.completedAt) set.completedAt = new Date();
    if (after && !isClosedCategory(after.category)) set.completedAt = null;
  }
  set.updatedAt = new Date();
  const [updated] = await tx.update(tasks).set(set).where(eq(tasks.id, current.id)).returning();

  const entries: ActivityEntry[] = changed.map((field) => ({
    verb: 'task.updated',
    entityType: 'task',
    entityId: current.id,
    projectId: project.id,
    taskId: current.id,
    field: ACTIVITY_FIELD[field],
    before: field === 'description' ? null : (current[field] ?? null),
    after: field === 'description' ? null : (next[field] ?? null),
    meta:
      field === 'statusId' && statusEvent
        ? { fromName: statusEvent.before?.name, toName: statusEvent.after?.name, toCategory: statusEvent.after?.category }
        : {},
  }));
  for (const key of customFieldsChanged) {
    entries.push({
      verb: 'task.updated',
      entityType: 'task',
      entityId: current.id,
      projectId: project.id,
      taskId: current.id,
      field: `custom:${key}`,
      before: current.customFields[key] ?? null,
      after: mergedCustom[key] ?? null,
    });
  }
  await logActivity(tx, ctx, entries);

  const key = taskKey(project.key, current.number);
  const url = taskUrl(project.key, current.number);
  if (changed.includes('assigneeId') && updated.assigneeId) {
    await addWatchers(tx, ctx, current.id, [updated.assigneeId]);
    await notify(tx, ctx, {
      recipients: [updated.assigneeId],
      kind: 'assigned',
      title: `${ctx.userName} assigned you ${key}: ${updated.title}`,
      url,
      projectId: project.id,
      taskId: current.id,
    });
  }
  if (statusEvent?.after) {
    const followers = await listWatcherIds(current.id, tx);
    await notify(tx, ctx, {
      recipients: [...followers, updated.assigneeId],
      kind: 'status_changed',
      title: `${ctx.userName} moved ${key} to ${statusEvent.after.name}`,
      body: updated.title,
      url,
      projectId: project.id,
      taskId: current.id,
    });
  }

  // Automation events (evaluated after commit).
  const snapshot = await engineTask(tx, current.id);
  const events: TaskEvent[] = [];
  if (snapshot) {
    if (statusEvent) {
      events.push({
        type: 'status_changed',
        task: snapshot,
        previous: { statusId: current.statusId, statusCategory: statusEvent.before?.category },
      });
    }
    if (changed.includes('assigneeId')) events.push({ type: 'assignee_changed', task: snapshot, previous: { assigneeId: current.assigneeId } });
    if (changed.includes('priority')) events.push({ type: 'priority_changed', task: snapshot, previous: { priority: current.priority } });
    if (changed.includes('dueDate')) events.push({ type: 'due_date_changed', task: snapshot, previous: { dueDate: current.dueDate } });
    if (changed.includes('sectionId')) events.push({ type: 'section_changed', task: snapshot, previous: { sectionId: current.sectionId } });
  }

  // Closing a task: spawn the next occurrence of a recurring task; tell the parent when all subtasks are done.
  if (statusEvent?.after && isClosedCategory(statusEvent.after.category) && !isClosedCategory(statusEvent.before?.category ?? 'todo')) {
    if (updated.recurrence && statusEvent.after.category === 'done') {
      await spawnNextOccurrence(tx, ctx, project, updated);
    }
    if (updated.parentTaskId) {
      const [open] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(tasks)
        .innerJoin(statuses, eq(statuses.id, tasks.statusId))
        .where(
          and(
            eq(tasks.parentTaskId, updated.parentTaskId),
            isNull(tasks.deletedAt),
            sql`${statuses.category} not in ('done', 'cancelled')`,
          ),
        );
      if (Number(open?.n ?? 0) === 0) {
        const parent = await engineTask(tx, updated.parentTaskId);
        if (parent) events.push({ type: 'subtasks_completed', task: parent });
      }
    }
  }
  return { task: updated, events };
}

function nextOccurrenceDate(from: string, rule: TaskRecurrence): string {
  const interval = Math.max(1, rule.interval || 1);
  switch (rule.frequency) {
    case 'daily':
      return addDaysIso(from, interval);
    case 'weekly': {
      if (rule.weekdays && rule.weekdays.length > 0) {
        for (let i = 1; i <= 7 * interval; i += 1) {
          const candidate = addDaysIso(from, i);
          const [y, m, d] = candidate.split('-').map(Number);
          if (rule.weekdays.includes(new Date(y, m - 1, d).getDay())) return candidate;
        }
      }
      return addDaysIso(from, 7 * interval);
    }
    case 'monthly': {
      const [y, m, d] = from.split('-').map(Number);
      const date = new Date(y, m - 1 + interval, 1);
      const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
      date.setDate(Math.min(d, lastDay));
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }
    case 'yearly': {
      const [y, m, d] = from.split('-').map(Number);
      return `${y + interval}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }
}

async function spawnNextOccurrence(tx: Executor, ctx: DomainContext, project: Project, done: Task): Promise<void> {
  const base = done.dueDate ?? todayIso();
  const due = nextOccurrenceDate(base, done.recurrence as TaskRecurrence);
  const span = done.startDate && done.dueDate ? Math.round((Date.parse(done.dueDate) - Date.parse(done.startDate)) / 86_400_000) : null;
  const labelRows = await tx.select({ labelId: taskLabels.labelId }).from(taskLabels).where(eq(taskLabels.taskId, done.id));
  await insertTask(
    tx,
    ctx,
    project,
    {
      projectId: project.id,
      title: done.title,
      description: done.description,
      sectionId: done.sectionId,
      priority: done.priority,
      assigneeId: done.assigneeId,
      dueDate: due,
      startDate: span !== null ? addDaysIso(due, -span) : null,
      estimatePoints: done.estimatePoints,
      estimateMinutes: done.estimateMinutes,
      parentTaskId: done.parentTaskId,
      milestoneId: null,
      labelIds: labelRows.map((row) => row.labelId),
      customFields: done.customFields,
      recurrence: done.recurrence,
      afterTaskId: done.id,
    },
    { logVerb: 'task.created', activityMeta: { recurringFrom: done.id } },
  );
}

export async function updateTask(ctx: DomainContext, taskId: string, patch: UpdateTaskInput): Promise<TaskSummary> {
  const { task, project } = await requireTask(ctx, taskId, 'task:update');
  const outcome = await db.transaction((tx) => applyTaskUpdate(tx, ctx, project, task, patch));
  await afterCommit(ctx, outcome.events);
  const summary = await selectTaskSummary(taskId);
  if (!summary) throw notFound('That task');
  return summary;
}

/** Applies the same patch to many tasks (multi-select bulk edit). Returns updated summaries. */
export async function bulkUpdateTasks(
  ctx: DomainContext,
  taskIds: readonly string[],
  patch: UpdateTaskInput & { readonly addLabelIds?: readonly string[]; readonly removeLabelIds?: readonly string[] },
): Promise<TaskSummary[]> {
  const ids = [...new Set(taskIds)].slice(0, 500);
  const allEvents: TaskEvent[] = [];
  for (const id of ids) {
    const { task, project } = await requireTask(ctx, id, 'task:update');
    const { addLabelIds, removeLabelIds, ...fieldPatch } = patch;
    // Statuses are per project: a status id from another project is skipped for that task.
    const effective = { ...fieldPatch };
    if (effective.statusId) {
      const list = await projectStatuses(db, project.id);
      if (!list.some((s) => s.id === effective.statusId)) delete (effective as { statusId?: string }).statusId;
    }
    const outcome = await db.transaction(async (tx) => {
      const result = await applyTaskUpdate(tx, ctx, project, task, effective);
      if (addLabelIds?.length || removeLabelIds?.length) {
        const labelEvents = await changeLabels(tx, ctx, project, task, addLabelIds ?? [], removeLabelIds ?? []);
        result.events.push(...labelEvents);
      }
      return result;
    });
    allEvents.push(...outcome.events);
  }
  await afterCommit(ctx, allEvents);
  return selectTaskSummaries(inArray(tasks.id, ids));
}

// --- Move / reorder -------------------------------------------------------------------------

export interface MoveResult {
  readonly task: TaskSummary;
  readonly position: string;
}

/** Drag and drop: change status/section/parent and/or position in one step. */
export async function moveTask(ctx: DomainContext, taskId: string, input: MoveTaskInput): Promise<MoveResult> {
  const { task, project } = await requireTask(ctx, taskId, 'task:update');
  const outcome = await db.transaction(async (tx) => {
    let parentTaskId = task.parentTaskId;
    if (input.parentTaskId !== undefined && input.parentTaskId !== task.parentTaskId) {
      if (input.parentTaskId) {
        if (input.parentTaskId === task.id) throw invalid("A task can't be its own subtask.");
        const [parent] = await tx
          .select({ id: tasks.id, projectId: tasks.projectId, parentTaskId: tasks.parentTaskId })
          .from(tasks)
          .where(and(eq(tasks.id, input.parentTaskId), isNull(tasks.deletedAt)));
        if (!parent || parent.projectId !== project.id) throw invalid('Subtasks must live in the same project as their parent.');
        // Prevent cycles: walk up from the new parent.
        let cursor: string | null = parent.parentTaskId;
        for (let depth = 0; cursor && depth < 50; depth += 1) {
          if (cursor === task.id) throw invalid("That would put a task inside its own subtask.");
          const [up] = await tx.select({ parentTaskId: tasks.parentTaskId }).from(tasks).where(eq(tasks.id, cursor));
          cursor = up?.parentTaskId ?? null;
        }
      }
      parentTaskId = input.parentTaskId;
    }
    const placementGiven = input.afterTaskId !== undefined || input.beforeTaskId !== undefined || input.at !== undefined;
    const position = placementGiven || parentTaskId !== task.parentTaskId
      ? await placementRank(tx, project.id, parentTaskId, input, task.id)
      : task.position;
    const patch: UpdateTaskInput = {
      ...(input.statusId !== undefined ? { statusId: input.statusId } : {}),
      ...(input.sectionId !== undefined ? { sectionId: input.sectionId } : {}),
    };
    const result = await applyTaskUpdate(tx, ctx, project, task, patch);
    if (position !== task.position || parentTaskId !== task.parentTaskId) {
      await tx.update(tasks).set({ position, parentTaskId, updatedAt: new Date() }).where(eq(tasks.id, task.id));
      // One drag is one history entry: a new spot that comes with a status or section change is
      // already told by that change ("moved this to In progress"), so only a plain reorder or a
      // new parent gets its own entry, worded with where it went ("moved this up in To do").
      const statusOrSectionChanged =
        result.task.statusId !== task.statusId || (result.task.sectionId ?? null) !== (task.sectionId ?? null);
      if (parentTaskId !== task.parentTaskId || !statusOrSectionChanged) {
        const [statusRow] = await tx.select({ name: statuses.name }).from(statuses).where(eq(statuses.id, task.statusId));
        await logActivity(tx, ctx, {
          verb: 'task.moved',
          entityType: 'task',
          entityId: task.id,
          projectId: project.id,
          taskId: task.id,
          before: { position: task.position, parentTaskId: task.parentTaskId },
          after: {
            position,
            parentTaskId,
            direction: position < task.position ? 'up' : 'down',
            statusName: statusRow?.name ?? null,
          },
        });
      }
    }
    return { events: result.events, position };
  });
  await afterCommit(ctx, outcome.events);
  const summary = await selectTaskSummary(taskId);
  if (!summary) throw notFound('That task');
  return { task: summary, position: outcome.position };
}

/** Move a task (and its subtasks) to another project. Status maps by category; project-only fields reset. */
export async function moveTaskToProject(
  ctx: DomainContext,
  taskId: string,
  targetProjectId: string,
  options: { readonly statusId?: string } = {},
): Promise<TaskSummary> {
  const { task, project: source } = await requireTask(ctx, taskId, 'task:delete');
  if (task.parentTaskId) throw invalid('Move the parent task instead; subtasks move with it.');
  const { project: target } = await requireProject(ctx, { id: targetProjectId }, 'task:create');
  if (target.id === source.id) return getTaskSummary(ctx, taskId);
  await db.transaction(async (tx) => {
    const [sourceStatuses, targetStatuses] = await Promise.all([projectStatuses(tx, source.id), projectStatuses(tx, target.id)]);
    const mapStatus = (statusId: string): string => {
      if (options.statusId && targetStatuses.some((s) => s.id === options.statusId)) return options.statusId;
      const category = sourceStatuses.find((s) => s.id === statusId)?.category ?? 'todo';
      return (targetStatuses.find((s) => s.category === category) ?? defaultStatus(targetStatuses)).id;
    };
    const family = await tx
      .select()
      .from(tasks)
      .where(and(or(eq(tasks.id, task.id), eq(tasks.parentTaskId, task.id)), isNull(tasks.deletedAt)));
    const [last] = await tx
      .select({ position: tasks.position })
      .from(tasks)
      .where(and(eq(tasks.projectId, target.id), isNull(tasks.parentTaskId)))
      .orderBy(sql`${tasks.position} COLLATE "C" desc`)
      .limit(1);
    for (const member of family) {
      const number = await nextTaskNumber(tx, target.id);
      await tx
        .update(tasks)
        .set({
          projectId: target.id,
          number,
          statusId: mapStatus(member.statusId),
          sectionId: null,
          milestoneId: null,
          position: member.id === task.id ? rankAfter(last?.position) : member.position,
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, member.id));
      // Project-scoped labels don't exist in the target; keep workspace-wide ones.
      await tx.execute(sql`
        delete from ${taskLabels} tl using ${labels} l
        where tl.task_id = ${member.id} and l.id = tl.label_id and l.project_id is not null`);
      await tx.execute(sql`update pm.comments set project_id = ${target.id} where task_id = ${member.id}`);
      await tx.execute(sql`update pm.attachments set project_id = ${target.id} where task_id = ${member.id}`);
      await tx.execute(sql`update pm.time_entries set project_id = ${target.id} where task_id = ${member.id}`);
      await logActivity(tx, ctx, [
        {
          verb: 'task.moved_project',
          entityType: 'task',
          entityId: member.id,
          projectId: source.id,
          taskId: member.id,
          before: { projectId: source.id, key: taskKey(source.key, member.number) },
          after: { projectId: target.id, key: taskKey(target.key, number) },
        },
        {
          verb: 'task.moved_project',
          entityType: 'task',
          entityId: member.id,
          projectId: target.id,
          taskId: member.id,
          before: { projectId: source.id, key: taskKey(source.key, member.number) },
          after: { projectId: target.id, key: taskKey(target.key, number) },
        },
      ]);
    }
  });
  return getTaskSummary(ctx, taskId);
}

// --- Duplicate / delete ---------------------------------------------------------------------

export async function duplicateTask(
  ctx: DomainContext,
  taskId: string,
  options: { readonly includeSubtasks?: boolean; readonly title?: string } = {},
): Promise<TaskSummary> {
  const { task, project } = await requireTask(ctx, taskId, 'task:create');
  const copy = await db.transaction(async (tx) => {
    const labelRows = await tx.select({ labelId: taskLabels.labelId }).from(taskLabels).where(eq(taskLabels.taskId, task.id));
    const base = (source: Task, parentTaskId: string | null, labelIds: string[], title: string): CreateTaskInput => ({
      projectId: project.id,
      title,
      description: source.description,
      statusId: source.statusId,
      sectionId: source.sectionId,
      priority: source.priority,
      assigneeId: source.assigneeId,
      startDate: source.startDate,
      dueDate: source.dueDate,
      estimatePoints: source.estimatePoints,
      estimateMinutes: source.estimateMinutes,
      parentTaskId,
      milestoneId: source.milestoneId,
      isMilestone: source.isMilestone,
      labelIds,
      customFields: source.customFields,
      recurrence: source.recurrence,
      afterTaskId: source.id,
    });
    const created = await insertTask(
      tx,
      ctx,
      project,
      base(task, task.parentTaskId, labelRows.map((r) => r.labelId), cleanText(options.title) ?? `${task.title} (copy)`),
      { activityMeta: { duplicatedFrom: task.id } },
    );
    if (options.includeSubtasks !== false) {
      const children = await tx
        .select()
        .from(tasks)
        .where(and(eq(tasks.parentTaskId, task.id), isNull(tasks.deletedAt)))
        .orderBy(sql`${tasks.position} COLLATE "C"`);
      for (const child of children) {
        const childLabels = await tx.select({ labelId: taskLabels.labelId }).from(taskLabels).where(eq(taskLabels.taskId, child.id));
        await insertTask(tx, ctx, project, { ...base(child, created.id, childLabels.map((r) => r.labelId), child.title), afterTaskId: undefined, at: 'bottom' });
      }
    }
    return created;
  });
  return getTaskSummary(ctx, copy.id);
}

/** Soft-deletes a task and its subtasks. Returns the ids deleted (pass to `restoreTasks` for undo). */
export async function deleteTasks(ctx: DomainContext, taskIds: readonly string[]): Promise<string[]> {
  const deleted: string[] = [];
  for (const id of [...new Set(taskIds)]) {
    const { task, project } = await requireTask(ctx, id, 'task:delete');
    await db.transaction(async (tx) => {
      const now = new Date();
      const rows = await tx
        .update(tasks)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(or(eq(tasks.id, task.id), eq(tasks.parentTaskId, task.id)), isNull(tasks.deletedAt)))
        .returning({ id: tasks.id });
      deleted.push(...rows.map((row) => row.id));
      await logActivity(tx, ctx, {
        verb: 'task.deleted',
        entityType: 'task',
        entityId: task.id,
        projectId: project.id,
        taskId: task.id,
        before: { title: task.title, key: taskKey(project.key, task.number) },
        meta: { subtasks: rows.length - 1 },
      });
    });
  }
  return deleted;
}

/** Undo for `deleteTasks` (also used by the trash in project settings). */
export async function restoreTasks(ctx: DomainContext, taskIds: readonly string[]): Promise<number> {
  if (taskIds.length === 0) return 0;
  const rows = await db
    .select({ id: tasks.id, projectId: tasks.projectId, title: tasks.title })
    .from(tasks)
    .where(and(inArray(tasks.id, [...taskIds]), eq(tasks.orgId, ctx.orgId)));
  let restored = 0;
  for (const row of rows) {
    await requireProject(ctx, { id: row.projectId }, 'task:delete');
    await db.transaction(async (tx) => {
      await tx.update(tasks).set({ deletedAt: null, updatedAt: new Date() }).where(eq(tasks.id, row.id));
      await logActivity(tx, ctx, {
        verb: 'task.restored',
        entityType: 'task',
        entityId: row.id,
        projectId: row.projectId,
        taskId: row.id,
        after: { title: row.title },
      });
    });
    restored += 1;
  }
  return restored;
}

/** Recently deleted tasks of a project (trash). */
export async function listDeletedTasks(ctx: DomainContext, projectId: string): Promise<{ id: string; key: string; title: string; deletedAt: string }[]> {
  const { project } = await requireProject(ctx, { id: projectId }, 'task:delete');
  const rows = await db
    .select({ id: tasks.id, number: tasks.number, title: tasks.title, deletedAt: tasks.deletedAt })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), sql`${tasks.deletedAt} is not null`))
    .orderBy(desc(tasks.deletedAt))
    .limit(100);
  return rows.map((row) => ({
    id: row.id,
    key: taskKey(project.key, row.number),
    title: row.title,
    deletedAt: (row.deletedAt as Date).toISOString(),
  }));
}

// --- Labels ---------------------------------------------------------------------------------

async function changeLabels(
  tx: Executor,
  ctx: DomainContext,
  project: Project,
  task: Task,
  add: readonly string[],
  remove: readonly string[],
): Promise<TaskEvent[]> {
  const existing = new Set(
    (await tx.select({ labelId: taskLabels.labelId }).from(taskLabels).where(eq(taskLabels.taskId, task.id))).map((r) => r.labelId),
  );
  const toAdd = (await validLabelIds(tx, ctx, project.id, add)).filter((id) => !existing.has(id));
  const toRemove = remove.filter((id) => existing.has(id));
  if (toAdd.length) {
    await tx.insert(taskLabels).values(toAdd.map((labelId) => ({ taskId: task.id, labelId, orgId: ctx.orgId }))).onConflictDoNothing();
  }
  if (toRemove.length) {
    await tx.delete(taskLabels).where(and(eq(taskLabels.taskId, task.id), inArray(taskLabels.labelId, toRemove)));
  }
  await logActivity(tx, ctx, [
    ...toAdd.map((labelId) => ({ verb: 'task.label_added', entityType: 'task', entityId: task.id, projectId: project.id, taskId: task.id, after: labelId })),
    ...toRemove.map((labelId) => ({ verb: 'task.label_removed', entityType: 'task', entityId: task.id, projectId: project.id, taskId: task.id, before: labelId })),
  ]);
  if (toAdd.length) await tx.update(tasks).set({ updatedAt: new Date() }).where(eq(tasks.id, task.id));
  const snapshot = toAdd.length ? await engineTask(tx, task.id) : null;
  return snapshot ? toAdd.map((labelId) => ({ type: 'label_added' as const, task: snapshot, labelId })) : [];
}

/** Replace a task's labels with exactly `labelIds`. */
export async function setTaskLabels(ctx: DomainContext, taskId: string, labelIds: readonly string[]): Promise<TaskSummary> {
  const { task, project } = await requireTask(ctx, taskId, 'task:update');
  const events = await db.transaction(async (tx) => {
    const current = (await tx.select({ labelId: taskLabels.labelId }).from(taskLabels).where(eq(taskLabels.taskId, task.id))).map((r) => r.labelId);
    const wanted = new Set(labelIds);
    return changeLabels(tx, ctx, project, task, [...wanted].filter((id) => !current.includes(id)), current.filter((id) => !wanted.has(id)));
  });
  await afterCommit(ctx, events);
  return getTaskSummary(ctx, taskId);
}

export async function addTaskLabel(ctx: DomainContext, taskId: string, labelId: string): Promise<TaskSummary> {
  const { task, project } = await requireTask(ctx, taskId, 'task:update');
  const events = await db.transaction((tx) => changeLabels(tx, ctx, project, task, [labelId], []));
  await afterCommit(ctx, events);
  return getTaskSummary(ctx, taskId);
}

export async function removeTaskLabel(ctx: DomainContext, taskId: string, labelId: string): Promise<TaskSummary> {
  const { task, project } = await requireTask(ctx, taskId, 'task:update');
  await db.transaction((tx) => changeLabels(tx, ctx, project, task, [], [labelId]));
  return getTaskSummary(ctx, taskId);
}

// --- Dependencies ---------------------------------------------------------------------------

/** True when adding blocking → blocked would create a cycle (blocked already reaches blocking). */
export async function wouldCreateCycle(executor: Executor, blockingTaskId: string, blockedTaskId: string): Promise<boolean> {
  const result = await executor.execute<{ found: boolean }>(sql`
    with recursive chain(id) as (
      select ${blockedTaskId}::uuid
      union
      select d.blocked_task_id from ${taskDependencies} d join chain on d.blocking_task_id = chain.id
    )
    select exists (select 1 from chain where id = ${blockingTaskId}::uuid) as found`);
  return Boolean(result.rows[0]?.found);
}

export async function addDependency(
  ctx: DomainContext,
  input: { readonly blockingTaskId: string; readonly blockedTaskId: string; readonly kind?: DependencyKind; readonly lagDays?: number },
): Promise<TaskDetail> {
  if (input.blockingTaskId === input.blockedTaskId) throw invalid("A task can't wait on itself.");
  const blocked = await requireTask(ctx, input.blockedTaskId, 'task:update');
  const blocking = await requireTask(ctx, input.blockingTaskId);
  await db.transaction(async (tx) => {
    if (await wouldCreateCycle(tx, input.blockingTaskId, input.blockedTaskId)) {
      throw invalid('That would create a loop: these tasks would be waiting on each other.');
    }
    const [row] = await tx
      .insert(taskDependencies)
      .values({
        orgId: ctx.orgId,
        blockingTaskId: input.blockingTaskId,
        blockedTaskId: input.blockedTaskId,
        kind: input.kind ?? 'finish_to_start',
        lagDays: input.lagDays ?? 0,
        createdBy: ctx.userId,
      })
      .onConflictDoNothing()
      .returning();
    if (row) {
      await logActivity(tx, ctx, [
        {
          verb: 'task.dependency_added',
          entityType: 'task',
          entityId: blocked.task.id,
          projectId: blocked.project.id,
          taskId: blocked.task.id,
          after: { blockedBy: input.blockingTaskId, key: taskKey(blocking.project.key, blocking.task.number) },
        },
        {
          verb: 'task.dependency_added',
          entityType: 'task',
          entityId: blocking.task.id,
          projectId: blocking.project.id,
          taskId: blocking.task.id,
          after: { blocks: input.blockedTaskId, key: taskKey(blocked.project.key, blocked.task.number) },
        },
      ]);
    }
  });
  return getTaskDetail(ctx, input.blockedTaskId);
}

export async function removeDependency(ctx: DomainContext, dependencyId: string): Promise<void> {
  const [dep] = await db
    .select()
    .from(taskDependencies)
    .where(and(eq(taskDependencies.id, dependencyId), eq(taskDependencies.orgId, ctx.orgId)));
  if (!dep) throw notFound('That dependency');
  const blocked = await requireTask(ctx, dep.blockedTaskId, 'task:update');
  await db.transaction(async (tx) => {
    await tx.delete(taskDependencies).where(eq(taskDependencies.id, dependencyId));
    await logActivity(tx, ctx, {
      verb: 'task.dependency_removed',
      entityType: 'task',
      entityId: blocked.task.id,
      projectId: blocked.project.id,
      taskId: blocked.task.id,
      before: { blockedBy: dep.blockingTaskId },
    });
  });
}

/** Every dependency inside a project (timeline arrows). */
export async function listProjectDependencies(
  ctx: DomainContext,
  projectId: string,
): Promise<{ id: string; blockingTaskId: string; blockedTaskId: string; kind: string; lagDays: number }[]> {
  await requireProject(ctx, { id: projectId });
  return db
    .select({
      id: taskDependencies.id,
      blockingTaskId: taskDependencies.blockingTaskId,
      blockedTaskId: taskDependencies.blockedTaskId,
      kind: taskDependencies.kind,
      lagDays: taskDependencies.lagDays,
    })
    .from(taskDependencies)
    .innerJoin(tasks, eq(tasks.id, taskDependencies.blockedTaskId))
    .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt)));
}

/** Validates people ids for bulk assignment pickers. */
export async function validAssignees(ctx: DomainContext, ids: readonly string[]): Promise<string[]> {
  return filterOrgMembers(ctx, ids);
}

/**
 * Mark a task done (first "done" status of its project) or reopen it (first "to do" status).
 * Used by checkboxes in cross-project lists where the caller doesn't know the project's workflow.
 */
export async function setTaskDone(ctx: DomainContext, taskId: string, done: boolean): Promise<TaskSummary> {
  const { task } = await requireTask(ctx, taskId, 'task:update');
  const list = await projectStatuses(db, task.projectId);
  const target = done
    ? list.find((s) => s.category === 'done')
    : (list.find((s) => s.isDefault && s.category === 'todo') ?? list.find((s) => s.category === 'todo') ?? list.find((s) => s.category === 'in_progress'));
  if (!target) throw invalid(done ? 'This project has no “done” status yet.' : 'This project has no “to do” status yet.');
  if (target.id === task.statusId) return getTaskSummary(ctx, taskId);
  return updateTask(ctx, taskId, { statusId: target.id });
}
