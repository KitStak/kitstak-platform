/** Global search (command palette, /search): tasks (full text + key), projects, people, goals. */
import 'server-only';
import { and, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { goals, projects, tasks } from '@/server/db/schema';
import { parseTaskKey } from '@/lib/task-key';
import type { SearchResults } from '@/lib/types';
import type { DomainContext } from './_shared';
import { visibleProjectsWhere } from './access';
import { listOrgPeople } from './people';
import { selectTaskSummaries } from './task-queries';

export async function search(ctx: DomainContext, rawQuery: string, limit = 8): Promise<SearchResults> {
  const query = rawQuery.trim().slice(0, 200);
  if (!query) return { tasks: [], projects: [], programs: [], people: [], goals: [] };
  const term = `%${query.replace(/[%_]/g, (m) => `\\${m}`)}%`;
  const ref = parseTaskKey(query);
  const words = query
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean)
    .map((word) => `${word}:*`)
    .join(' & ');
  const taskMatch = or(
    ilike(tasks.title, term),
    words ? sql`${tasks.search} @@ to_tsquery('simple', ${words})` : undefined,
    ref ? and(eq(projects.key, ref.projectKey), eq(tasks.number, ref.number)) : undefined,
  );
  const live = and(eq(projects.isTemplate, false), isNull(projects.archivedAt), or(ilike(projects.name, term), ilike(projects.key, term)));
  const [taskRows, projectRows, programRows, people, goalRows] = await Promise.all([
    selectTaskSummaries(and(eq(tasks.orgId, ctx.orgId), visibleProjectsWhere(ctx, { kind: 'any' }), isNull(projects.archivedAt), taskMatch), {
      limit,
      orderBy: sql`(${statusOpenOrder}) , ${tasks.updatedAt} desc`,
    }),
    db
      .select({ id: projects.id, key: projects.key, name: projects.name, color: projects.color, icon: projects.icon, status: projects.status })
      .from(projects)
      .where(and(visibleProjectsWhere(ctx, { kind: 'project' }), live))
      .orderBy(projects.name)
      .limit(limit),
    db
      .select({ id: projects.id, key: projects.key, name: projects.name, color: projects.color, icon: projects.icon, status: projects.status })
      .from(projects)
      .where(and(visibleProjectsWhere(ctx, { kind: 'program' }), live))
      .orderBy(projects.name)
      .limit(limit),
    listOrgPeople(ctx),
    db
      .select({ id: goals.id, name: goals.name, health: goals.health })
      .from(goals)
      .where(and(eq(goals.orgId, ctx.orgId), isNull(goals.deletedAt), ilike(goals.name, term)))
      .limit(limit),
  ]);
  const projectNames = new Map<string, string>();
  if (taskRows.length) {
    const rows = await db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.orgId, ctx.orgId));
    for (const row of rows) projectNames.set(row.id, row.name);
  }
  const lower = query.toLowerCase();
  return {
    tasks: taskRows.map((task) => ({
      id: task.id,
      projectId: task.projectId,
      projectKey: task.projectKey,
      number: task.number,
      key: task.key,
      title: task.title,
      statusId: task.statusId,
      statusCategory: task.statusCategory,
      projectName: projectNames.get(task.projectId) ?? task.projectKey,
      assigneeId: task.assigneeId,
      kind: task.kind,
      projectKind: task.projectKind,
    })),
    projects: projectRows,
    programs: programRows,
    people: people.filter((p) => p.name.toLowerCase().includes(lower) || p.email.toLowerCase().includes(lower)).slice(0, limit),
    goals: goalRows,
  };
}

/** Open tasks first. */
const statusOpenOrder = sql`case when ${tasks.completedAt} is null then 0 else 1 end`;
