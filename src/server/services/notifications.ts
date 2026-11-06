/** In-app notifications (bell / inbox). */
import { and, count, desc, eq, ilike, inArray, isNotNull, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { boards, items, member, notifications, updates, user } from '@/server/db/schema';
import { NotFoundError } from '@/server/http/errors';
import { publish } from '@/server/realtime/publisher';
import { concurrently, type ServiceContext } from './context';
import type { NotificationDto, NotificationKind } from './contracts/dto';
import { decodeCursor, encodeCursor, timeIdCursorSchema, toPage, type Page } from './pagination';

export interface NotifyInput {
  readonly kind: NotificationKind;
  readonly recipients: readonly string[];
  readonly boardId?: string | null;
  readonly itemId?: string | null;
  readonly updateId?: string | null;
  readonly payload?: Record<string, unknown>;
  /** Notify the actor too (default false: never notify yourself). */
  readonly includeActor?: boolean;
}

/** Directly addressed events still notify after an item is muted (monday parity). */
const DIRECT_KINDS: ReadonlySet<NotificationKind> = new Set(['mention', 'assigned', 'invitation']);

/** Users who unsubscribed from an item (board settings `itemSubscribers[itemId].removed`). */
async function mutedForItem(ctx: ServiceContext, boardId: string, itemId: string): Promise<Set<string>> {
  const [row] = await ctx.db
    .select({ settings: boards.settings })
    .from(boards)
    .where(and(eq(boards.id, boardId), eq(boards.orgId, ctx.orgId)))
    .limit(1);
  const map = (row?.settings as { itemSubscribers?: Record<string, { removed?: unknown }> } | undefined)
    ?.itemSubscribers;
  const removed = map?.[itemId]?.removed;
  return new Set(Array.isArray(removed) ? removed.filter((id): id is string => typeof id === 'string') : []);
}

/** Create notifications for org members among `recipients`. Returns recipient ids notified. */
export async function notify(ctx: ServiceContext, input: NotifyInput): Promise<string[]> {
  let recipients = [...new Set(input.recipients)];
  if (!input.includeActor && ctx.userId) recipients = recipients.filter((id) => id !== ctx.userId);
  if (recipients.length > 0 && input.itemId && input.boardId && !DIRECT_KINDS.has(input.kind)) {
    // People who turned notifications off for this item (item panel / notification "…" menu).
    const muted = await mutedForItem(ctx, input.boardId, input.itemId);
    if (muted.size > 0) recipients = recipients.filter((id) => !muted.has(id));
  }
  if (recipients.length === 0) return [];
  const members = await ctx.db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, ctx.orgId), inArray(member.userId, recipients)));
  const valid = members.map((row) => row.userId);
  if (valid.length === 0) return [];
  await ctx.db.insert(notifications).values(
    valid.map((userId) => ({
      orgId: ctx.orgId,
      userId,
      kind: input.kind,
      actorId: ctx.userId,
      boardId: input.boardId ?? null,
      itemId: input.itemId ?? null,
      updateId: input.updateId ?? null,
      payload: {
        ...(input.payload ?? {}),
        ...(ctx.automation ? { automationId: ctx.automation.automationId } : {}),
      },
    })),
  );
  await publish(ctx.db, {
    type: 'notifications.changed',
    orgId: ctx.orgId,
    userIds: valid,
    actorId: ctx.userId,
  });
  return valid;
}

export const listNotificationsQuerySchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  filter: z.enum(['all', 'unread', 'mentions', 'assigned']).default('all'),
  /** Only notifications about this board. */
  boardId: z.uuid().optional(),
  /** Case-insensitive match on item / board name or the payload preview. */
  q: z.string().trim().max(120).optional(),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

/** Case-insensitive match on item / board / actor name or payload text (needs those joins). */
function textMatch(q: string): SQL {
  const pattern = `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  return or(
    ilike(items.name, pattern),
    ilike(boards.name, pattern),
    ilike(user.name, pattern),
    sql`${notifications.payload}->>'preview' ilike ${pattern}`,
    sql`${notifications.payload}->>'message' ilike ${pattern}`,
  ) as SQL;
}

/** Hide notifications whose update was deleted (soft delete keeps the row around). */
const notDangling: SQL = sql`not exists (select 1 from ${updates} where ${updates.id} = ${notifications.updateId} and ${updates.deletedAt} is not null)`;

function requireUser(ctx: ServiceContext): string {
  if (!ctx.userId) throw new Error('Notifications require a user context');
  return ctx.userId;
}

export async function listNotifications(
  ctx: ServiceContext,
  query: ListNotificationsQuery,
): Promise<Page<NotificationDto> & { unreadCount: number }> {
  const userId = requireUser(ctx);
  const cursor = decodeCursor(query.cursor, timeIdCursorSchema);
  const conditions: SQL[] = [eq(notifications.orgId, ctx.orgId), eq(notifications.userId, userId), notDangling];
  if (query.filter === 'unread') conditions.push(isNull(notifications.readAt));
  if (query.filter === 'mentions') conditions.push(eq(notifications.kind, 'mention'));
  if (query.filter === 'assigned') conditions.push(eq(notifications.kind, 'assigned'));
  if (query.boardId) conditions.push(eq(notifications.boardId, query.boardId));
  if (query.q) conditions.push(textMatch(query.q));
  if (cursor) {
    const at = new Date(cursor[0]);
    conditions.push(
      or(
        lt(notifications.createdAt, at),
        and(eq(notifications.createdAt, at), lt(notifications.id, cursor[1])),
      ) as SQL,
    );
  }
  const [rows, unreadCount] = await concurrently(ctx, [
    () =>
      ctx.db
        .select({
          notification: notifications,
          actorName: user.name,
          actorEmail: user.email,
          actorImage: user.image,
          actorTitle: user.title,
          boardName: boards.name,
          itemName: items.name,
        })
        .from(notifications)
        .leftJoin(user, eq(user.id, notifications.actorId))
        .leftJoin(boards, eq(boards.id, notifications.boardId))
        .leftJoin(items, eq(items.id, notifications.itemId))
        .where(and(...conditions))
        .orderBy(desc(notifications.createdAt), desc(notifications.id))
        .limit(query.limit + 1),
    () => countUnread(ctx),
  ]);
  const page = toPage(rows, query.limit, (row) =>
    encodeCursor([row.notification.createdAt.toISOString(), row.notification.id]),
  );
  return {
    unreadCount,
    nextCursor: page.nextCursor,
    items: page.items.map((row) => ({
      id: row.notification.id,
      kind: row.notification.kind,
      actor:
        row.notification.actorId && row.actorName
          ? {
              id: row.notification.actorId,
              name: row.actorName,
              email: row.actorEmail ?? '',
              image: row.actorImage,
              title: row.actorTitle,
            }
          : null,
      boardId: row.notification.boardId,
      boardName: row.boardName,
      itemId: row.notification.itemId,
      itemName: row.itemName,
      updateId: row.notification.updateId,
      payload: row.notification.payload,
      readAt: row.notification.readAt?.toISOString() ?? null,
      createdAt: row.notification.createdAt.toISOString(),
    })),
  };
}

export async function countUnread(ctx: ServiceContext): Promise<number> {
  const userId = requireUser(ctx);
  const [row] = await ctx.db
    .select({ total: count() })
    .from(notifications)
    .where(
      and(
        eq(notifications.orgId, ctx.orgId),
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
        notDangling,
      ),
    );
  return row?.total ?? 0;
}

export const markNotificationsSchema = z
  .object({
    ids: z.array(z.uuid()).max(500).optional(),
    all: z.boolean().optional(),
    read: z.boolean().default(true),
    /** With `all`: limit to the panel's active board filter / search. */
    boardId: z.uuid().optional(),
    q: z.string().trim().max(120).optional(),
  })
  .refine((value) => value.all === true || (value.ids && value.ids.length > 0), {
    message: 'Provide ids or all: true',
  });
export type MarkNotificationsInput = z.infer<typeof markNotificationsSchema>;

export async function markNotifications(
  ctx: ServiceContext,
  input: MarkNotificationsInput,
): Promise<{ updated: number; unreadCount: number; ids: string[] }> {
  const userId = requireUser(ctx);
  const conditions: SQL[] = [
    eq(notifications.orgId, ctx.orgId),
    eq(notifications.userId, userId),
    // Only rows whose state actually changes, so `ids` is exactly what an Undo must revert.
    input.read ? isNull(notifications.readAt) : isNotNull(notifications.readAt),
  ];
  if (!input.all && input.ids) conditions.push(inArray(notifications.id, input.ids));
  if (input.all && input.boardId) conditions.push(eq(notifications.boardId, input.boardId));
  if (input.all && input.q) {
    const matching = ctx.db
      .select({ id: notifications.id })
      .from(notifications)
      .leftJoin(boards, eq(boards.id, notifications.boardId))
      .leftJoin(items, eq(items.id, notifications.itemId))
      .leftJoin(user, eq(user.id, notifications.actorId))
      .where(and(eq(notifications.orgId, ctx.orgId), eq(notifications.userId, userId), textMatch(input.q)));
    conditions.push(inArray(notifications.id, matching));
  }
  const updated = await ctx.db
    .update(notifications)
    .set({ readAt: input.read ? new Date() : null })
    .where(and(...conditions))
    .returning({ id: notifications.id });
  await publish(ctx.db, {
    type: 'notifications.changed',
    orgId: ctx.orgId,
    userIds: [userId],
    actorId: userId,
  });
  return {
    updated: updated.length,
    unreadCount: await countUnread(ctx),
    ids: updated.map((row) => row.id),
  };
}

/** Permanently remove one of the caller's notifications (row "…" → Delete). */
export async function deleteNotification(
  ctx: ServiceContext,
  notificationId: string,
): Promise<{ id: string; unreadCount: number }> {
  const userId = requireUser(ctx);
  const removed = await ctx.db
    .delete(notifications)
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.orgId, ctx.orgId),
        eq(notifications.userId, userId),
      ),
    )
    .returning({ id: notifications.id });
  if (removed.length === 0) throw new NotFoundError('Notification');
  await publish(ctx.db, {
    type: 'notifications.changed',
    orgId: ctx.orgId,
    userIds: [userId],
    actorId: userId,
  });
  return { id: notificationId, unreadCount: await countUnread(ctx) };
}

/**
 * Remove the notifications an update (and its replies) created, for every recipient, and tell
 * their open panels. Called when an update is deleted so no panel keeps showing its preview or
 * deep-links to it.
 */
export async function retractUpdateNotifications(
  ctx: ServiceContext,
  updateIds: readonly string[],
): Promise<number> {
  if (updateIds.length === 0) return 0;
  const removed = await ctx.db
    .delete(notifications)
    .where(and(eq(notifications.orgId, ctx.orgId), inArray(notifications.updateId, [...updateIds])))
    .returning({ userId: notifications.userId });
  const userIds = [...new Set(removed.map((row) => row.userId))];
  if (userIds.length > 0)
    await publish(ctx.db, { type: 'notifications.changed', orgId: ctx.orgId, userIds, actorId: ctx.userId });
  return removed.length;
}
