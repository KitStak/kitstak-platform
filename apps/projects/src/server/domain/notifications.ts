/**
 * Inbox notifications + task watchers.
 *
 * Emission rules (called by the domain layer, inside the mutation's transaction):
 *  - assign: the new assignee gets `assigned` (unless they assigned themselves).
 *  - mention: each mentioned member gets `mention`.
 *  - comment: watchers (minus author + mentioned) get `comment`.
 *  - status change: watchers + assignee (minus actor) get `status_changed`.
 * The actor never notifies themselves. Per-user kind toggles (prefs.notifications) are honored.
 * Participants (creator, assignee, commenters, mentioned) automatically become watchers.
 */
import 'server-only';
import { and, count, desc, eq, inArray, isNotNull, isNull, lt, type SQL } from 'drizzle-orm';
import { db, type Executor } from '@/server/db';
import { notifications, userPrefs, watchers } from '@/server/db/schema';
import type { NotificationKind } from '@/lib/constants';
import type { NotificationDTO } from '@/lib/types';
import { iso, isoRequired, type DomainContext } from './_shared';
import { requireTask } from './access';
import { scheduleAutomationSweep } from './automation-sweep';
import { scheduleIntegrationEvents } from '@/server/integrations/events';
import { ensureDueReminders } from './due-reminders';
import { filterOrgMembers } from './people';

export interface NotifyInput {
  readonly recipients: readonly (string | null | undefined)[];
  readonly kind: NotificationKind;
  readonly title: string;
  readonly body?: string | null;
  readonly url?: string | null;
  readonly projectId?: string | null;
  readonly taskId?: string | null;
  readonly commentId?: string | null;
}

/** Insert notifications for each eligible recipient. Returns how many were created. */
export async function notify(executor: Executor, ctx: DomainContext, input: NotifyInput): Promise<number> {
  const candidates = [...new Set(input.recipients.filter((id): id is string => Boolean(id)))].filter(
    (id) => !(ctx.actorKind === 'user' && id === ctx.userId),
  );
  if (candidates.length === 0) return 0;
  const members = await filterOrgMembers(ctx, candidates, executor);
  if (members.length === 0) return 0;
  const prefRows = await executor
    .select({ userId: userPrefs.userId, prefs: userPrefs.prefs })
    .from(userPrefs)
    .where(and(eq(userPrefs.orgId, ctx.orgId), inArray(userPrefs.userId, members)));
  const muted = new Set(
    prefRows
      .filter((row) => {
        const toggles = (row.prefs as { notifications?: Record<string, boolean> }).notifications;
        return toggles?.[input.kind] === false;
      })
      .map((row) => row.userId),
  );
  const recipients = members.filter((id) => !muted.has(id));
  if (recipients.length === 0) return 0;
  await executor.insert(notifications).values(
    recipients.map((userId) => ({
      orgId: ctx.orgId,
      userId,
      actorId: ctx.actorKind === 'user' ? ctx.userId : null,
      kind: input.kind,
      projectId: input.projectId ?? null,
      taskId: input.taskId ?? null,
      commentId: input.commentId ?? null,
      title: input.title.slice(0, 300),
      body: input.body ? input.body.slice(0, 1000) : null,
      url: input.url ?? null,
    })),
  );
  return recipients.length;
}

function toDTO(row: typeof notifications.$inferSelect): NotificationDTO {
  return {
    id: row.id,
    kind: row.kind,
    actorId: row.actorId,
    projectId: row.projectId,
    taskId: row.taskId,
    commentId: row.commentId,
    title: row.title,
    body: row.body,
    url: row.url,
    readAt: iso(row.readAt),
    archivedAt: iso(row.archivedAt),
    createdAt: isoRequired(row.createdAt),
  };
}

export type InboxFilter = 'all' | 'unread' | 'archived' | 'mentions' | 'assigned' | 'comments' | 'due';

export interface InboxPage {
  readonly items: readonly NotificationDTO[];
  readonly nextCursor: string | null;
  readonly unread: number;
}

export async function listNotifications(
  ctx: DomainContext,
  options: { readonly filter?: InboxFilter; readonly before?: string; readonly limit?: number } = {},
): Promise<InboxPage> {
  const filter = options.filter ?? 'all';
  const limit = Math.min(options.limit ?? 50, 200);
  const conditions: SQL[] = [eq(notifications.orgId, ctx.orgId), eq(notifications.userId, ctx.userId)];
  if (filter === 'archived') conditions.push(isNotNull(notifications.archivedAt));
  else conditions.push(isNull(notifications.archivedAt));
  if (filter === 'unread') conditions.push(isNull(notifications.readAt));
  if (filter === 'mentions') conditions.push(eq(notifications.kind, 'mention'));
  if (filter === 'assigned') conditions.push(eq(notifications.kind, 'assigned'));
  if (filter === 'comments') conditions.push(eq(notifications.kind, 'comment'));
  if (filter === 'due') conditions.push(inArray(notifications.kind, ['due_soon', 'overdue']));
  if (options.before) conditions.push(lt(notifications.createdAt, new Date(options.before)));
  const rows = await db
    .select()
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt))
    .limit(limit + 1);
  const items = rows.slice(0, limit).map(toDTO);
  return {
    items,
    nextCursor: rows.length > limit ? (items.at(-1)?.createdAt ?? null) : null,
    unread: await unreadCount(ctx),
  };
}

export async function unreadCount(ctx: DomainContext): Promise<number> {
  // Lazily create due-today / overdue reminders (throttled per person, see due-reminders.ts).
  await ensureDueReminders(ctx);
  // Scheduled automation triggers (due soon / overdue / CRM / WMS) run after the response.
  scheduleAutomationSweep(ctx);
  // CRM/WMS events (deal stage changes, orders shipped, tasks created there) → automations.
  scheduleIntegrationEvents(ctx);
  const [row] = await db
    .select({ n: count() })
    .from(notifications)
    .where(
      and(
        eq(notifications.orgId, ctx.orgId),
        eq(notifications.userId, ctx.userId),
        isNull(notifications.readAt),
        isNull(notifications.archivedAt),
      ),
    );
  return Number(row?.n ?? 0);
}

function own(ctx: DomainContext, ids: readonly string[]): SQL {
  return and(
    eq(notifications.orgId, ctx.orgId),
    eq(notifications.userId, ctx.userId),
    inArray(notifications.id, [...ids]),
  ) as SQL;
}

export async function markNotificationsRead(ctx: DomainContext, ids: readonly string[], read = true): Promise<void> {
  if (ids.length === 0) return;
  await db.update(notifications).set({ readAt: read ? new Date() : null }).where(own(ctx, ids));
}

export async function markAllNotificationsRead(ctx: DomainContext): Promise<number> {
  const rows = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.orgId, ctx.orgId),
        eq(notifications.userId, ctx.userId),
        isNull(notifications.readAt),
        isNull(notifications.archivedAt),
      ),
    )
    .returning({ id: notifications.id });
  return rows.length;
}

export async function archiveNotifications(ctx: DomainContext, ids: readonly string[], archived = true): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(notifications)
    // Archiving leaves the read state alone, so Undo brings an unread item back as unread.
    .set({ archivedAt: archived ? new Date() : null })
    .where(own(ctx, ids));
}

// --- Watchers -------------------------------------------------------------------------------

export async function listWatcherIds(taskId: string, executor: Executor = db): Promise<string[]> {
  const rows = await executor.select({ userId: watchers.userId }).from(watchers).where(eq(watchers.taskId, taskId));
  return rows.map((row) => row.userId);
}

/** Idempotently adds watchers (participants auto-follow). */
export async function addWatchers(
  executor: Executor,
  ctx: DomainContext,
  taskId: string,
  userIds: readonly (string | null | undefined)[],
): Promise<void> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return;
  const members = await filterOrgMembers(ctx, ids, executor);
  if (members.length === 0) return;
  await executor
    .insert(watchers)
    .values(members.map((userId) => ({ taskId, userId, orgId: ctx.orgId })))
    .onConflictDoNothing();
}

/** Follow / unfollow a task as the actor (or, with `userId`, someone else — editors only). */
export async function setWatching(ctx: DomainContext, taskId: string, watching: boolean, userId?: string): Promise<void> {
  const target = userId ?? ctx.userId;
  await requireTask(ctx, taskId, target === ctx.userId ? 'project:read' : 'task:update');
  if (watching) {
    await addWatchers(db, ctx, taskId, [target]);
  } else {
    await db.delete(watchers).where(and(eq(watchers.taskId, taskId), eq(watchers.userId, target)));
  }
}
