/**
 * Read side for tasks: the TaskSummary projection (one query with correlated aggregates) and
 * helpers shared by tasks.ts, search.ts, my-work and the API routes.
 */
import 'server-only';
import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { db, type Executor } from '@/server/db';
import {
  attachments,
  comments,
  integrationLinks,
  projects,
  statuses,
  taskDependencies,
  taskLabels,
  tasks,
} from '@/server/db/schema';
import { taskKey } from '@/lib/task-key';
import type { TaskRef, TaskSummary } from '@/lib/types';
import { isoRequired, iso } from './_shared';

/** Correlated aggregates, aliased so the outer query can read them. */
const labelIdsSql = sql<string[]>`coalesce((select array_agg(tl.label_id::text order by tl.created_at) from ${taskLabels} tl where tl.task_id = ${tasks.id}), '{}')`;
const subtaskCountSql = sql<number>`(select count(*)::int from ${tasks} st where st.parent_task_id = ${tasks.id} and st.deleted_at is null)`;
const subtaskDoneSql = sql<number>`(select count(*)::int from ${tasks} st join ${statuses} ss on ss.id = st.status_id where st.parent_task_id = ${tasks.id} and st.deleted_at is null and ss.category in ('done', 'cancelled'))`;
const commentCountSql = sql<number>`(select count(*)::int from ${comments} c where c.task_id = ${tasks.id} and c.deleted_at is null)`;
const attachmentCountSql = sql<number>`(select count(*)::int from ${attachments} a where a.task_id = ${tasks.id} and a.deleted_at is null)`;
const blockedBySql = sql<number>`(select count(*)::int from ${taskDependencies} d join ${tasks} bt on bt.id = d.blocking_task_id join ${statuses} bs on bs.id = bt.status_id where d.blocked_task_id = ${tasks.id} and bt.deleted_at is null and bs.category not in ('done', 'cancelled'))`;
const blockingSql = sql<number>`(select count(*)::int from ${taskDependencies} d where d.blocking_task_id = ${tasks.id})`;
const linkCountSql = sql<number>`(select count(*)::int from ${integrationLinks} l where l.task_id = ${tasks.id})`;

export const taskSummaryColumns = {
  id: tasks.id,
  projectId: tasks.projectId,
  projectKey: projects.key,
  number: tasks.number,
  title: tasks.title,
  statusId: tasks.statusId,
  statusCategory: statuses.category,
  sectionId: tasks.sectionId,
  priority: tasks.priority,
  assigneeId: tasks.assigneeId,
  reporterId: tasks.reporterId,
  startDate: tasks.startDate,
  dueDate: tasks.dueDate,
  estimatePoints: tasks.estimatePoints,
  estimateMinutes: tasks.estimateMinutes,
  parentTaskId: tasks.parentTaskId,
  position: tasks.position,
  isMilestone: tasks.isMilestone,
  milestoneId: tasks.milestoneId,
  customFields: tasks.customFields,
  completedAt: tasks.completedAt,
  createdAt: tasks.createdAt,
  updatedAt: tasks.updatedAt,
  labelIds: labelIdsSql,
  subtaskCount: subtaskCountSql,
  subtaskDoneCount: subtaskDoneSql,
  commentCount: commentCountSql,
  attachmentCount: attachmentCountSql,
  blockedByCount: blockedBySql,
  blockingCount: blockingSql,
  linkCount: linkCountSql,
};

function summaryQuery(executor: Executor) {
  return executor
    .select(taskSummaryColumns)
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .innerJoin(statuses, eq(statuses.id, tasks.statusId));
}

type SummaryRow = Awaited<ReturnType<ReturnType<typeof summaryQuery>['execute']>>[number];

function toSummary(row: SummaryRow): TaskSummary {
  return {
    id: row.id,
    projectId: row.projectId,
    projectKey: row.projectKey,
    number: row.number,
    key: taskKey(row.projectKey, row.number),
    title: row.title,
    statusId: row.statusId,
    statusCategory: row.statusCategory,
    sectionId: row.sectionId,
    priority: row.priority,
    assigneeId: row.assigneeId,
    reporterId: row.reporterId,
    startDate: row.startDate,
    dueDate: row.dueDate,
    estimatePoints: row.estimatePoints,
    estimateMinutes: row.estimateMinutes,
    parentTaskId: row.parentTaskId,
    position: row.position,
    isMilestone: row.isMilestone,
    milestoneId: row.milestoneId,
    labelIds: row.labelIds ?? [],
    customFields: row.customFields ?? {},
    completedAt: iso(row.completedAt),
    createdAt: isoRequired(row.createdAt),
    updatedAt: isoRequired(row.updatedAt),
    subtaskCount: Number(row.subtaskCount ?? 0),
    subtaskDoneCount: Number(row.subtaskDoneCount ?? 0),
    commentCount: Number(row.commentCount ?? 0),
    attachmentCount: Number(row.attachmentCount ?? 0),
    blockedByCount: Number(row.blockedByCount ?? 0),
    blockingCount: Number(row.blockingCount ?? 0),
    linkCount: Number(row.linkCount ?? 0),
  };
}

/** TaskSummary rows for an arbitrary WHERE (always excludes soft-deleted tasks and projects). */
export async function selectTaskSummaries(
  where: SQL | undefined,
  options: { readonly limit?: number; readonly orderBy?: SQL; readonly executor?: Executor } = {},
): Promise<TaskSummary[]> {
  const executor = options.executor ?? db;
  const base = and(isNull(tasks.deletedAt), isNull(projects.deletedAt), where);
  const query = summaryQuery(executor)
    .where(base)
    .orderBy(options.orderBy ?? sql`${tasks.position} COLLATE "C"`);
  const rows = options.limit ? await query.limit(options.limit) : await query;
  return rows.map(toSummary);
}

export async function selectTaskSummary(taskId: string, executor: Executor = db): Promise<TaskSummary | null> {
  const [row] = await selectTaskSummaries(eq(tasks.id, taskId), { executor, limit: 1 });
  return row ?? null;
}

/** Lightweight refs (dependencies, parents). */
export async function selectTaskRefs(taskIds: readonly string[], executor: Executor = db): Promise<Map<string, TaskRef>> {
  if (taskIds.length === 0) return new Map();
  const rows = await executor
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      projectKey: projects.key,
      number: tasks.number,
      title: tasks.title,
      statusId: tasks.statusId,
      statusCategory: statuses.category,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .innerJoin(statuses, eq(statuses.id, tasks.statusId))
    .where(and(inArray(tasks.id, [...new Set(taskIds)]), isNull(tasks.deletedAt)));
  return new Map(
    rows.map((row) => [row.id, { ...row, key: taskKey(row.projectKey, row.number) } satisfies TaskRef]),
  );
}
