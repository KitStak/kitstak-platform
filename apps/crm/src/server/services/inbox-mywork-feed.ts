/**
 * Inbox: update threads on items the caller follows — assigned to them, created by them,
 * items they posted on — or threads that mention them. Threads only show up when someone
 * else posted in them. Ordered by latest activity (thread or reply), cursor paginated.
 */
import { and, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { boards, groups, items, updateReads, updates } from '@/server/db/schema';
import { NotFoundError } from '@/server/http/errors';
import { visibleBoardsPredicate } from './access';
import type { ServiceContext } from './context';
import type {
  InboxBoardOptionDto,
  InboxQuery,
  InboxReadInput,
  InboxThreadDto,
} from './contracts/inbox-mywork';
import { decodeCursor, encodeCursor, timeIdCursorSchema, toPage, type Page } from './pagination';
import { decorateThreads } from './updates';

function requireUser(ctx: ServiceContext): string {
  if (!ctx.userId) throw new NotFoundError('Inbox');
  return ctx.userId;
}

/** Shared SQL fragments for one caller (expressions over the outer `updates` row). */
function fragments(userId: string) {
  const assignedPath = `$.*.ids[*] ? (@ == "${userId.replace(/[^0-9a-f-]/gi, '')}")`;
  const inThread = sql`(r.id = ${updates.id} or r.parent_update_id = ${updates.id}) and r.deleted_at is null`;
  const lastActivity = sql<Date>`date_trunc('milliseconds', greatest(${updates.createdAt}, coalesce((select max(r.created_at) from updates r where r.parent_update_id = ${updates.id} and r.deleted_at is null), ${updates.createdAt})))`;
  const mentionsMe = sql<boolean>`exists (select 1 from updates r where ${inThread} and ${userId}::uuid = any(r.mentioned_user_ids))`;
  const unread = sql<boolean>`exists (select 1 from updates r where ${inThread} and r.author_id is distinct from ${userId}::uuid and not exists (select 1 from update_reads ur where ur.update_id = r.id and ur.user_id = ${userId}::uuid))`;
  const othersPosted = sql`exists (select 1 from updates r where ${inThread} and r.author_id is distinct from ${userId}::uuid)`;
  const follows = sql`(${items.values} @? ${assignedPath}::jsonpath or ${items.createdBy} = ${userId}::uuid or exists (select 1 from updates r where r.item_id = ${items.id} and r.author_id = ${userId}::uuid and r.deleted_at is null) or ${mentionsMe})`;
  return { lastActivity, mentionsMe, unread, othersPosted, follows };
}

function baseConditions(ctx: ServiceContext, userId: string): SQL[] {
  const f = fragments(userId);
  return [
    eq(updates.orgId, ctx.orgId),
    isNull(updates.deletedAt),
    isNull(updates.parentUpdateId),
    isNull(items.deletedAt),
    isNull(boards.archivedAt),
    visibleBoardsPredicate(ctx),
    f.follows,
    f.othersPosted,
  ];
}

export async function listInboxFeed(
  ctx: ServiceContext,
  query: InboxQuery,
): Promise<Page<InboxThreadDto> & { unreadCount: number }> {
  const userId = requireUser(ctx);
  const f = fragments(userId);
  const conditions = baseConditions(ctx, userId);
  if (query.boardId) conditions.push(eq(updates.boardId, query.boardId));
  if (query.filter === 'mentions') conditions.push(f.mentionsMe);
  if (query.filter === 'unread') conditions.push(f.unread);
  const cursor = decodeCursor(query.cursor, timeIdCursorSchema);
  if (cursor)
    conditions.push(
      sql`(${f.lastActivity}, ${updates.id}) < (${cursor[0]}::timestamptz, ${cursor[1]}::uuid)`,
    );

  const [rows, unreadRows] = await Promise.all([
    ctx.db
      .select({
        update: updates,
        boardName: boards.name,
        itemName: items.name,
        groupTitle: groups.title,
        lastActivityAt: f.lastActivity,
        unread: f.unread,
        mentionsMe: f.mentionsMe,
      })
      .from(updates)
      .innerJoin(items, eq(items.id, updates.itemId))
      .innerJoin(boards, eq(boards.id, updates.boardId))
      .leftJoin(groups, eq(groups.id, items.groupId))
      .where(and(...conditions))
      .orderBy(desc(f.lastActivity), desc(updates.id))
      .limit(query.limit + 1),
    ctx.db
      .select({ total: sql<number>`count(*)::int` })
      .from(updates)
      .innerJoin(items, eq(items.id, updates.itemId))
      .innerJoin(boards, eq(boards.id, updates.boardId))
      .where(and(...baseConditions(ctx, userId), f.unread)),
  ]);

  const toIso = (value: Date | string) => (value instanceof Date ? value : new Date(value)).toISOString();
  const page = toPage(rows, query.limit, (row) => encodeCursor([toIso(row.lastActivityAt), row.update.id]));
  const threadIds = page.items.map((row) => row.update.id);
  const replyRows = threadIds.length
    ? await ctx.db
        .select()
        .from(updates)
        .where(
          and(
            eq(updates.orgId, ctx.orgId),
            inArray(updates.parentUpdateId, threadIds),
            isNull(updates.deletedAt),
          ),
        )
    : [];
  const threads = await decorateThreads(
    ctx,
    page.items.map((row) => row.update),
    replyRows,
  );
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  return {
    unreadCount: unreadRows[0]?.total ?? 0,
    nextCursor: page.nextCursor,
    items: page.items.flatMap((row) => {
      const update = byId.get(row.update.id);
      if (!update) return [];
      return [
        {
          update,
          boardId: row.update.boardId,
          boardName: row.boardName,
          itemId: row.update.itemId,
          itemName: row.itemName,
          groupTitle: row.groupTitle ?? null,
          lastActivityAt: toIso(row.lastActivityAt),
          unread: Boolean(row.unread),
          mentionsMe: Boolean(row.mentionsMe),
        },
      ];
    }),
  };
}

/** Boards that currently have inbox threads (for the board filter). */
export async function listInboxBoards(ctx: ServiceContext): Promise<InboxBoardOptionDto[]> {
  const userId = requireUser(ctx);
  const rows = await ctx.db
    .selectDistinct({ id: boards.id, name: boards.name })
    .from(updates)
    .innerJoin(items, eq(items.id, updates.itemId))
    .innerJoin(boards, eq(boards.id, updates.boardId))
    .where(and(...baseConditions(ctx, userId)))
    .limit(200);
  return [...rows].sort((a, b) => a.name.localeCompare(b.name));
}

/** Mark updates (threads and/or replies) read or unread for the caller. Visible boards only. */
export async function markInboxRead(
  ctx: ServiceContext,
  input: InboxReadInput,
): Promise<{ updated: number }> {
  const userId = requireUser(ctx);
  const visible = await ctx.db
    .select({ id: updates.id })
    .from(updates)
    .innerJoin(boards, eq(boards.id, updates.boardId))
    .where(
      and(
        eq(updates.orgId, ctx.orgId),
        inArray(updates.id, input.updateIds),
        isNull(updates.deletedAt),
        visibleBoardsPredicate(ctx),
      ),
    );
  const ids = visible.map((row) => row.id);
  if (ids.length === 0) return { updated: 0 };
  if (input.read) {
    const inserted = await ctx.db
      .insert(updateReads)
      .values(ids.map((updateId) => ({ orgId: ctx.orgId, updateId, userId })))
      .onConflictDoNothing()
      .returning({ id: updateReads.id });
    return { updated: inserted.length };
  }
  const removed = await ctx.db
    .delete(updateReads)
    .where(
      and(
        eq(updateReads.orgId, ctx.orgId),
        eq(updateReads.userId, userId),
        inArray(updateReads.updateId, ids),
      ),
    )
    .returning({ id: updateReads.id });
  return { updated: removed.length };
}
