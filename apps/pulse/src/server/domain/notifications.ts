/**
 * In app notifications (pulse.notifications). Rows hold `{ kind, params }` only: numbers and
 * ids, never a sentence. Words are made at read time for the reader, so a person who may not
 * see money never receives it. The actor is never notified.
 */
import 'server-only';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db, type Executor } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { notifications } from '@/server/db/schema';
import type { NotificationDTO } from '@/lib/types';
import { iso, isoRequired, isUuid, type DomainContext } from './_shared';
import { pulseAccessFor } from './access';
import { renderAlertWords } from './alert-words';

export interface NotifyInput {
  readonly kind: string;
  readonly params?: Record<string, unknown>;
  /** A path inside Pulse that starts with one slash. */
  readonly url?: string | null;
  readonly alertId?: string | null;
  readonly jobId?: string | null;
}

/** Fans one notification out to `userIds`, minus the actor. Call inside the write transaction. */
export const notify = scoped(async function notify(executor: Executor, ctx: DomainContext, userIds: readonly string[], input: NotifyInput): Promise<number> {
  const wanted = [...new Set(userIds)].filter((id) => id !== ctx.userId || ctx.actorKind !== 'user');
  if (wanted.length === 0) return 0;
  // People can turn a kind of notification off for themselves (Settings, Notifications).
  const switchKey = input.kind.replace(/^alert:/, '');
  const muted = new Set(
    (
      await executor.execute(
        sql`SELECT user_id FROM pulse.user_prefs WHERE org_id = ${ctx.orgId} AND prefs->'notify'->>${switchKey} = 'false' AND user_id = ANY(ARRAY[${sql.join(
          wanted.map((id) => sql`${id}`),
          sql`, `,
        )}]::uuid[])`,
      )
    ).rows.map((row) => String((row as { user_id: string }).user_id)),
  );
  const targets = wanted.filter((id) => !muted.has(id));
  if (targets.length === 0) return 0;
  const url = input.url && input.url.startsWith('/') && !input.url.startsWith('//') ? input.url : null;
  await executor.insert(notifications).values(targets.map((userId) => ({ orgId: ctx.orgId, userId, kind: input.kind, params: input.params ?? {}, url, alertId: input.alertId ?? null, jobId: input.jobId ?? null })));
  return targets.length;
}, 1);

export const listNotifications = scoped(async function listNotifications(ctx: DomainContext, options: { unreadOnly?: boolean; limit?: number } = {}): Promise<NotificationDTO[]> {
  const access = await pulseAccessFor(ctx);
  if (access.role === 'none') return [];
  const found = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.orgId, ctx.orgId), eq(notifications.userId, ctx.userId), isNull(notifications.archivedAt), options.unreadOnly ? isNull(notifications.readAt) : undefined))
    .orderBy(desc(notifications.createdAt))
    .limit(Math.min(options.limit ?? 50, 200));
  return found.map((row) => {
    const words = renderAlertWords(row.kind.replace(/^alert:/, ''), row.params ?? {}, access.seesMoney);
    return { id: row.id, kind: row.kind, title: words.title, body: words.body, url: row.url, alertId: row.alertId, jobId: row.jobId, readAt: iso(row.readAt), createdAt: isoRequired(row.createdAt) };
  });
});

export const countUnreadNotifications = scoped(async function countUnreadNotifications(ctx: DomainContext): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.orgId, ctx.orgId), eq(notifications.userId, ctx.userId), isNull(notifications.readAt), isNull(notifications.archivedAt)));
  return row?.n ?? 0;
});

/** Marks the caller's notifications read: the given ids, or all of them. Returns how many changed. */
export const markNotificationsRead = scoped(async function markNotificationsRead(ctx: DomainContext, ids?: readonly string[]): Promise<number> {
  const list = ids?.filter(isUuid);
  if (ids && (!list || list.length === 0)) return 0;
  const changed = await db
    .update(notifications)
    .set({ readAt: new Date(), updatedAt: new Date() })
    .where(and(eq(notifications.orgId, ctx.orgId), eq(notifications.userId, ctx.userId), isNull(notifications.readAt), list ? inArray(notifications.id, list) : undefined))
    .returning({ id: notifications.id });
  return changed.length;
});

export const archiveNotifications = scoped(async function archiveNotifications(ctx: DomainContext, ids: readonly string[]): Promise<number> {
  const list = ids.filter(isUuid);
  if (list.length === 0) return 0;
  const changed = await db
    .update(notifications)
    .set({ archivedAt: new Date(), readAt: sql`coalesce(${notifications.readAt}, now())`, updatedAt: new Date() })
    .where(and(eq(notifications.orgId, ctx.orgId), eq(notifications.userId, ctx.userId), inArray(notifications.id, list)))
    .returning({ id: notifications.id });
  return changed.length;
});
