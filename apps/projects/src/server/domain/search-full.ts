/**
 * Full search for the /search page (nav team): tasks (title + description full text + key),
 * comments, projects, people and goals, with filters. The command palette keeps using the
 * lighter `search()` in ./search.ts.
 */
import 'server-only';
import { and, count, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import { db } from '@/server/db';
import { comments, projects, statuses, tasks } from '@/server/db/schema';
import { commentPlainText, excerptAround } from '@/lib/search-text';
import { parseTaskKey, taskKey } from '@/lib/task-key';
import type { CommentSearchHit, FullSearchResults, FullSearchType } from '@/lib/types';
import type { DomainContext } from './_shared';
import { visibleProjectsWhere } from './access';
import { listGoals } from './goals';
import { listOrgPeople } from './people';
import { listProjects } from './projects';
import { selectTaskSummaries } from './task-queries';

export interface FullSearchOptions {
  readonly type?: FullSearchType;
  /** Limit tasks and comments to one project (id). */
  readonly projectId?: string | null;
  /** Task state. Default 'any'. */
  readonly status?: 'open' | 'done' | 'any';
  /** Task assignee: a user id, 'me' or 'none'. */
  readonly assignee?: string | null;
  /** Results per type (default 8 for "all", 50 for a single type). */
  readonly limit?: number;
}

const EMPTY: FullSearchResults = {
  query: '',
  tasks: [],
  projects: [],
  comments: [],
  people: [],
  goals: [],
  counts: { tasks: 0, projects: 0, comments: 0, people: 0, goals: 0 },
};

const escapeLike = (value: string) => `%${value.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;

export async function searchFull(ctx: DomainContext, rawQuery: string, options: FullSearchOptions = {}): Promise<FullSearchResults> {
  const query = rawQuery.trim().slice(0, 200);
  // No words but a person or project filter: browse those tasks (e.g. "Maya's open tasks").
  const browse = !query && Boolean(options.assignee || options.projectId);
  if (!query && !browse) return EMPTY;
  const type = browse ? 'tasks' : (options.type ?? 'all');
  const limit = Math.min(Math.max(options.limit ?? (type === 'all' ? 8 : 50), 1), 200);
  const want = (t: Exclude<FullSearchType, 'all'>) => type === 'all' || type === t;
  const term = escapeLike(query);
  const ref = parseTaskKey(query);
  const words = query
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean)
    .map((word) => `${word}:*`)
    .join(' & ');
  const tsQuery = words ? sql`to_tsquery('simple', ${words})` : null;

  // --- Tasks --------------------------------------------------------------------------------
  const taskConditions: SQL[] = [
    eq(tasks.orgId, ctx.orgId),
    visibleProjectsWhere(ctx),
    isNull(projects.archivedAt),
  ];
  if (!browse) {
    taskConditions.push(
      or(
        ilike(tasks.title, term),
        tsQuery ? sql`${tasks.search} @@ ${tsQuery}` : undefined,
        ref ? and(eq(projects.key, ref.projectKey), eq(tasks.number, ref.number)) : undefined,
      ) as SQL,
    );
  }
  if (options.projectId) taskConditions.push(eq(tasks.projectId, options.projectId));
  if (options.status === 'open') taskConditions.push(sql`${statuses.category} not in ('done', 'cancelled')`);
  if (options.status === 'done') taskConditions.push(sql`${statuses.category} in ('done', 'cancelled')`);
  if (options.assignee === 'me') taskConditions.push(eq(tasks.assigneeId, ctx.userId));
  else if (options.assignee === 'none') taskConditions.push(isNull(tasks.assigneeId));
  else if (options.assignee) taskConditions.push(eq(tasks.assigneeId, options.assignee));
  const taskWhere = and(...taskConditions);
  const exactKey = ref ? sql`case when ${projects.key} = ${ref.projectKey} and ${tasks.number} = ${ref.number} then 0 else 1 end` : sql`1`;
  const rank = tsQuery ? sql`ts_rank(${tasks.search}, ${tsQuery})` : sql`0`;
  const taskOrder = browse
    ? sql`case when ${tasks.completedAt} is null then 0 else 1 end, ${tasks.dueDate} asc nulls last, ${tasks.updatedAt} desc`
    : sql`${exactKey}, case when ${tasks.title} ilike ${term} then 0 else 1 end, case when ${tasks.completedAt} is null then 0 else 1 end, ${rank} desc, ${tasks.updatedAt} desc`;

  // --- Comments -----------------------------------------------------------------------------
  const commentConditions: SQL[] = [
    eq(comments.orgId, ctx.orgId),
    isNull(comments.deletedAt),
    isNull(tasks.deletedAt),
    isNull(projects.deletedAt),
    isNull(projects.archivedAt),
    visibleProjectsWhere(ctx),
    ilike(comments.body, term),
  ];
  if (options.projectId) commentConditions.push(eq(comments.projectId, options.projectId));
  const commentWhere = and(...commentConditions);

  const [taskRows, taskTotal, commentRows, commentTotal, projectRows, people, goals] = await Promise.all([
    want('tasks') ? selectTaskSummaries(taskWhere, { limit, orderBy: taskOrder }) : Promise.resolve([]),
    want('tasks')
      ? db
          .select({ n: count() })
          .from(tasks)
          .innerJoin(projects, eq(projects.id, tasks.projectId))
          .innerJoin(statuses, eq(statuses.id, tasks.statusId))
          .where(and(isNull(tasks.deletedAt), isNull(projects.deletedAt), taskWhere))
          .then((rows) => Number(rows[0]?.n ?? 0))
      : Promise.resolve(0),
    want('comments')
      ? db
          .select({
            id: comments.id,
            taskId: comments.taskId,
            authorId: comments.authorId,
            body: comments.body,
            createdAt: comments.createdAt,
            taskNumber: tasks.number,
            taskTitle: tasks.title,
            projectId: projects.id,
            projectKey: projects.key,
            projectName: projects.name,
          })
          .from(comments)
          .innerJoin(tasks, eq(tasks.id, comments.taskId))
          .innerJoin(projects, eq(projects.id, comments.projectId))
          .where(commentWhere)
          .orderBy(desc(comments.createdAt))
          .limit(limit)
      : Promise.resolve([]),
    want('comments')
      ? db
          .select({ n: count() })
          .from(comments)
          .innerJoin(tasks, eq(tasks.id, comments.taskId))
          .innerJoin(projects, eq(projects.id, comments.projectId))
          .where(commentWhere)
          .then((rows) => Number(rows[0]?.n ?? 0))
      : Promise.resolve(0),
    want('projects') && !options.projectId ? listProjects(ctx, { search: query }) : Promise.resolve([]),
    want('people') ? listOrgPeople(ctx) : Promise.resolve([]),
    want('goals') ? listGoals(ctx) : Promise.resolve([]),
  ]);

  const lower = query.toLowerCase();
  const matchedPeople = people.filter(
    (p) => p.name.toLowerCase().includes(lower) || p.email.toLowerCase().includes(lower) || (p.title ?? '').toLowerCase().includes(lower),
  );
  const matchedGoals = goals.filter((g) => g.name.toLowerCase().includes(lower) || (g.description ?? '').toLowerCase().includes(lower));
  const commentHits: CommentSearchHit[] = commentRows.map((row) => ({
    id: row.id,
    taskId: row.taskId,
    taskKey: taskKey(row.projectKey, row.taskNumber),
    taskTitle: row.taskTitle,
    projectId: row.projectId,
    projectKey: row.projectKey,
    projectName: row.projectName,
    authorId: row.authorId,
    excerpt: excerptAround(commentPlainText(row.body), query),
    createdAt: row.createdAt.toISOString(),
  }));

  return {
    query,
    tasks: taskRows,
    projects: projectRows.slice(0, limit),
    comments: commentHits,
    people: matchedPeople.slice(0, limit),
    goals: matchedGoals.slice(0, limit),
    counts: {
      tasks: taskTotal,
      projects: projectRows.length,
      comments: commentTotal,
      people: matchedPeople.length,
      goals: matchedGoals.length,
    },
  };
}
