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
 *
 * Programs (docs/programs/SPEC.md 4.10):
 *   program.created | program.updated | program.status_changed | program.archived | program.restored |
 *   program.deleted | program.copied | program.settings_changed | program.month_closed |
 *   program.month_reopened | program.update_posted | variant.created | variant.updated |
 *   variant.retired | variant.restored | variant.deleted | variant.kit_linked | attributes.changed |
 *   price_card.draft_created | price_card.version_published | price_card.version_replaced |
 *   price_card.unpublished | price_card.version_deleted | price_card.variant_rate_changed |
 *   price_card.review_requested | price_card.sent_back | one_time.added | one_time.updated |
 *   one_time.deleted | build.created (kept as task.created with after.kind 'build') | build.planned |
 *   build.updated | build.moved | build.split | build.closed_short | build.rate_override_set |
 *   build.output_logged | build.output_deleted | build.repriced | run.moved | run.cancelled |
 *   run.copied | run.closed | schedule.created | schedule.updated | schedule.paused |
 *   schedule.resumed | schedule.ended | schedule.generated | link.added | link.removed |
 *   program.pulse_job_linked | program.pulse_job_unlinked | calendar.updated
 *
 * Money in an activity row lives only under a `money` key (`before.money`, `after.money`,
 * `meta.money`); `toDTO` callers strip those keys for readers without `money:read` on the
 * activity's program.
 */
import 'server-only';
import { and, desc, eq, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
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

/** Removes `money` keys from a JSON value (one level, as written by the program domain). */
function withoutMoney(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  if (!('money' in (value as Record<string, unknown>))) return value;
  const { money: _money, ...rest } = value as Record<string, unknown>;
  void _money;
  return rest;
}

/** Strips money from rows of programs the reader may not see money on (4.10). */
export async function stripActivityMoney(ctx: DomainContext, items: readonly ActivityDTO[]): Promise<ActivityDTO[]> {
  const projectIds = [...new Set(items.map((item) => item.projectId).filter((id): id is string => Boolean(id)))];
  if (projectIds.length === 0) return [...items];
  const { programIdsAmong, seesMoneyFor } = await import('./programs/access');
  const programs = await programIdsAmong(ctx, projectIds);
  if (programs.size === 0) return [...items];
  const allowed = await seesMoneyFor(ctx, [...programs]);
  return items.map((item) =>
    item.projectId && programs.has(item.projectId) && !allowed.has(item.projectId)
      ? { ...item, before: withoutMoney(item.before), after: withoutMoney(item.after), meta: withoutMoney(item.meta) as typeof item.meta }
      : item,
  );
}

async function page(where: SQL, before: string | undefined, limit: number, ctx?: DomainContext): Promise<ActivityPage> {
  const conditions = before ? and(where, lt(activity.createdAt, new Date(before))) : where;
  const rows = await db
    .select()
    .from(activity)
    .where(conditions)
    .orderBy(desc(activity.createdAt))
    .limit(limit + 1);
  const raw = rows.slice(0, limit).map(toDTO);
  const items = ctx ? await stripActivityMoney(ctx, raw) : raw;
  return { items, nextCursor: rows.length > limit ? (raw.at(-1)?.createdAt ?? null) : null };
}

export async function listProjectActivity(
  ctx: DomainContext,
  projectId: string,
  options: { readonly before?: string; readonly limit?: number; readonly verbs?: readonly string[] } = {},
): Promise<ActivityPage> {
  await requireProject(ctx, { id: projectId });
  const base = and(eq(activity.orgId, ctx.orgId), eq(activity.projectId, projectId)) as SQL;
  const where = options.verbs?.length ? (and(base, inArray(activity.verb, [...options.verbs])) as SQL) : base;
  return page(where, options.before, Math.min(options.limit ?? 50, 200), ctx);
}

export async function listTaskActivity(
  ctx: DomainContext,
  taskId: string,
  options: { readonly before?: string; readonly limit?: number } = {},
): Promise<ActivityPage> {
  await requireTask(ctx, taskId);
  return page(
    and(
      eq(activity.orgId, ctx.orgId),
      // The task's own events plus "added a subtask" (a child's task.created names its parent).
      or(
        eq(activity.taskId, taskId),
        and(eq(activity.verb, 'task.created'), sql`${activity.after} ->> 'parentTaskId' = ${taskId}`),
      ),
    ) as SQL,
    options.before,
    Math.min(options.limit ?? 100, 300),
    ctx,
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
  return stripActivityMoney(ctx, rows.map(toDTO));
}
