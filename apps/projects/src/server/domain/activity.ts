/**
 * The immutable activity log (pm.activity). EVERY mutation in the domain layer calls
 * `logActivity` inside its transaction with a dotted verb:
 *
 *   project.created | project.updated | project.archived | project.restored | project.deleted
 *   project.member_added | project.member_updated | project.member_removed
 *   task.created | task.updated (field + before/after) | task.moved | task.deleted | task.restored
 *   task.label_added | task.label_removed | task.dependency_added | task.dependency_removed
 *   task.link_added | task.link_removed | comment.added | comment.edited | comment.deleted
 *   attachment.added | attachment.deleted | time.logged | status.* | section.* | label.* |
 *   field.* | milestone.* | goal.* | automation.* | automation.ran | form.submitted | view.*
 */
import 'server-only';
import { and, desc, eq, inArray, lt, type SQL } from 'drizzle-orm';
import { db, type Executor } from '@/server/db';
import { activity } from '@/server/db/schema';
import type { ActivityDTO } from '@/lib/types';
import { isoRequired, type DomainContext } from './_shared';
import { requireProject, requireTask } from './access';

export interface ActivityEntry {
  readonly verb: string;
  readonly entityType: string;
  readonly entityId?: string | null;
  readonly projectId?: string | null;
  readonly taskId?: string | null;
  readonly field?: string | null;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly meta?: Record<string, unknown>;
}

/** Append one or more events. Call inside the mutation's transaction. */
export async function logActivity(
  executor: Executor,
  ctx: DomainContext,
  entries: ActivityEntry | readonly ActivityEntry[],
): Promise<void> {
  const list = Array.isArray(entries) ? entries : [entries as ActivityEntry];
  if (list.length === 0) return;
  await executor.insert(activity).values(
    list.map((entry) => ({
      orgId: ctx.orgId,
      projectId: entry.projectId ?? null,
      taskId: entry.taskId ?? null,
      actorId: ctx.actorKind === 'user' || ctx.actorKind === 'integration' ? ctx.userId : null,
      actorKind: ctx.actorKind,
      verb: entry.verb,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      field: entry.field ?? null,
      before: entry.before === undefined ? null : (entry.before as object),
      after: entry.after === undefined ? null : (entry.after as object),
      meta: entry.meta ?? {},
    })),
  );
}

function toDTO(row: typeof activity.$inferSelect): ActivityDTO {
  return {
    id: row.id,
    projectId: row.projectId,
    taskId: row.taskId,
    actorId: row.actorId,
    actorKind: row.actorKind,
    verb: row.verb,
    entityType: row.entityType,
    entityId: row.entityId,
    field: row.field,
    before: row.before,
    after: row.after,
    meta: row.meta,
    createdAt: isoRequired(row.createdAt),
  };
}

export interface ActivityPage {
  readonly items: readonly ActivityDTO[];
  /** Pass as `before` to load older events; null when exhausted. */
  readonly nextCursor: string | null;
}

async function page(where: SQL, before: string | undefined, limit: number): Promise<ActivityPage> {
  const conditions = before ? and(where, lt(activity.createdAt, new Date(before))) : where;
  const rows = await db
    .select()
    .from(activity)
    .where(conditions)
    .orderBy(desc(activity.createdAt))
    .limit(limit + 1);
  const items = rows.slice(0, limit).map(toDTO);
  return { items, nextCursor: rows.length > limit ? (items.at(-1)?.createdAt ?? null) : null };
}

export async function listProjectActivity(
  ctx: DomainContext,
  projectId: string,
  options: { readonly before?: string; readonly limit?: number; readonly verbs?: readonly string[] } = {},
): Promise<ActivityPage> {
  await requireProject(ctx, { id: projectId });
  const base = and(eq(activity.orgId, ctx.orgId), eq(activity.projectId, projectId)) as SQL;
  const where = options.verbs?.length ? (and(base, inArray(activity.verb, [...options.verbs])) as SQL) : base;
  return page(where, options.before, Math.min(options.limit ?? 50, 200));
}

export async function listTaskActivity(
  ctx: DomainContext,
  taskId: string,
  options: { readonly before?: string; readonly limit?: number } = {},
): Promise<ActivityPage> {
  await requireTask(ctx, taskId);
  return page(
    and(eq(activity.orgId, ctx.orgId), eq(activity.taskId, taskId)) as SQL,
    options.before,
    Math.min(options.limit ?? 100, 300),
  );
}

/** The actor's own recent activity (Home "Recently worked on"). */
export async function listMyActivity(ctx: DomainContext, limit = 30): Promise<readonly ActivityDTO[]> {
  const rows = await db
    .select()
    .from(activity)
    .where(and(eq(activity.orgId, ctx.orgId), eq(activity.actorId, ctx.userId)))
    .orderBy(desc(activity.createdAt))
    .limit(limit);
  return rows.map(toDTO);
}
