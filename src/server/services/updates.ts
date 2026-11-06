/** Item updates (comments): threads, replies, edit, delete, pin, reactions, read receipts. */
import { and, asc, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import { columns, files, member, updateReactions, updateReads, updates, user } from '@/server/db/schema';
import { BadRequestError, ForbiddenError, NotFoundError } from '@/server/http/errors';
import { publish } from '@/server/realtime/publisher';
import { requireBoard, requireItem } from './access';
import { logActivity } from './activity';
import { inTransaction, isOrgAdmin, type ServiceContext, concurrently } from './context';
import type { FileDto, ReactionDto, UpdateDto, UserSummaryDto } from './contracts/dto';
import type { CreateUpdateInput, EditUpdateInput } from './contracts/item-inputs';
import { toFileDto } from './files';
import { notify, retractUpdateNotifications } from './notifications';
import { sanitizeRichText } from './rich-text';

type UpdateRow = typeof updates.$inferSelect;

async function decorate(
  ctx: ServiceContext,
  rows: readonly UpdateRow[],
): Promise<Map<string, Omit<UpdateDto, 'replies'>>> {
  if (rows.length === 0) return new Map();
  const ids = rows.map((row) => row.id);
  const authorIds = [...new Set(rows.map((row) => row.authorId).filter((id): id is string => id !== null))];
  const [authors, reactions, reads, readCounts, attachments] = await concurrently(ctx, [
    () =>
      authorIds.length
        ? ctx.db
            .select({ id: user.id, name: user.name, email: user.email, image: user.image, title: user.title })
            .from(user)
            .where(inArray(user.id, authorIds))
        : Promise.resolve([] as UserSummaryDto[]),
    () =>
      ctx.db
        .select({
          updateId: updateReactions.updateId,
          emoji: updateReactions.emoji,
          userId: updateReactions.userId,
        })
        .from(updateReactions)
        .where(inArray(updateReactions.updateId, ids))
        .orderBy(asc(updateReactions.createdAt)),
    () =>
      ctx.userId
        ? ctx.db
            .select({ updateId: updateReads.updateId })
            .from(updateReads)
            .where(and(inArray(updateReads.updateId, ids), eq(updateReads.userId, ctx.userId)))
        : Promise.resolve([] as { updateId: string }[]),
    () =>
      ctx.db
        .select({ updateId: updateReads.updateId, total: count() })
        .from(updateReads)
        .where(inArray(updateReads.updateId, ids))
        .groupBy(updateReads.updateId),
    () =>
      ctx.db
        .select()
        .from(files)
        .where(and(inArray(files.updateId, ids), isNull(files.deletedAt)))
        .orderBy(asc(files.createdAt)),
  ]);
  const authorById = new Map(authors.map((author) => [author.id, author]));
  const readSet = new Set(reads.map((row) => row.updateId));
  const readCountById = new Map(readCounts.map((row) => [row.updateId, row.total]));
  const reactionMap = new Map<string, Map<string, string[]>>();
  for (const reaction of reactions) {
    const byEmoji = reactionMap.get(reaction.updateId) ?? new Map<string, string[]>();
    byEmoji.set(reaction.emoji, [...(byEmoji.get(reaction.emoji) ?? []), reaction.userId]);
    reactionMap.set(reaction.updateId, byEmoji);
  }
  const filesByUpdate = new Map<string, FileDto[]>();
  for (const file of attachments) {
    if (!file.updateId) continue;
    filesByUpdate.set(file.updateId, [...(filesByUpdate.get(file.updateId) ?? []), toFileDto(file)]);
  }
  const out = new Map<string, Omit<UpdateDto, 'replies'>>();
  for (const row of rows) {
    const reactionList: ReactionDto[] = [
      ...(reactionMap.get(row.id) ?? new Map<string, string[]>()).entries(),
    ].map(([emoji, userIds]) => ({
      emoji,
      count: userIds.length,
      userIds,
      reactedByMe: ctx.userId ? userIds.includes(ctx.userId) : false,
    }));
    out.set(row.id, {
      id: row.id,
      boardId: row.boardId,
      itemId: row.itemId,
      parentUpdateId: row.parentUpdateId,
      author: row.authorId ? (authorById.get(row.authorId) ?? null) : null,
      body: row.body,
      bodyText: row.bodyText,
      mentionedUserIds: row.mentionedUserIds,
      pinned: row.pinned,
      editedAt: row.editedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      reactions: reactionList,
      readByMe: readSet.has(row.id) || row.authorId === ctx.userId,
      readCount: readCountById.get(row.id) ?? 0,
      files: filesByUpdate.get(row.id) ?? [],
    });
  }
  return out;
}

/** Threads for an item: pinned first, then newest first; replies oldest first. */
export async function listItemUpdates(ctx: ServiceContext, itemId: string): Promise<UpdateDto[]> {
  await requireItem(ctx, itemId, 'read');
  const rows = await ctx.db
    .select()
    .from(updates)
    .where(and(eq(updates.itemId, itemId), eq(updates.orgId, ctx.orgId), isNull(updates.deletedAt)))
    .orderBy(desc(updates.createdAt));
  const decorated = await decorate(ctx, rows);
  const replies = new Map<string, UpdateDto[]>();
  for (const row of [...rows].reverse()) {
    if (!row.parentUpdateId) continue;
    const dto = decorated.get(row.id);
    if (dto)
      replies.set(row.parentUpdateId, [...(replies.get(row.parentUpdateId) ?? []), { ...dto, replies: [] }]);
  }
  const threads = rows
    .filter((row) => !row.parentUpdateId)
    .map((row) => ({
      ...(decorated.get(row.id) as Omit<UpdateDto, 'replies'>),
      replies: replies.get(row.id) ?? [],
    }));
  return [...threads.filter((thread) => thread.pinned), ...threads.filter((thread) => !thread.pinned)];
}

async function requireUpdate(ctx: ServiceContext, updateId: string): Promise<UpdateRow> {
  const [row] = await ctx.db
    .select()
    .from(updates)
    .where(and(eq(updates.id, updateId), eq(updates.orgId, ctx.orgId), isNull(updates.deletedAt)))
    .limit(1);
  if (!row) throw new NotFoundError('Update');
  await requireBoard(ctx, row.boardId, 'read');
  return row;
}

async function orgMemberIds(ctx: ServiceContext, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await ctx.db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, ctx.orgId), inArray(member.userId, [...ids])));
  return rows.map((row) => row.userId);
}

async function oneUpdate(ctx: ServiceContext, row: UpdateRow): Promise<UpdateDto> {
  const decorated = await decorate(ctx, [row]);
  return { ...(decorated.get(row.id) as Omit<UpdateDto, 'replies'>), replies: [] };
}

export async function createUpdate(
  ctx: ServiceContext,
  itemId: string,
  input: CreateUpdateInput,
): Promise<UpdateDto> {
  return inTransaction(ctx, async (tx) => {
    const { item, board } = await requireItem(tx, itemId, 'read');
    const sanitized = sanitizeRichText(input.body);
    if (sanitized.text.length === 0 && sanitized.mentionedUserIds.length === 0) {
      throw new BadRequestError('An update cannot be empty');
    }
    let parent: UpdateRow | null = null;
    if (input.parentUpdateId) {
      parent = await requireUpdate(tx, input.parentUpdateId);
      if (parent.itemId !== itemId) throw new BadRequestError('Replies must belong to the same item');
      if (parent.parentUpdateId) throw new BadRequestError('Replies cannot be nested further');
    }
    const mentioned = await orgMemberIds(tx, sanitized.mentionedUserIds);
    const [row] = await tx.db
      .insert(updates)
      .values({
        orgId: tx.orgId,
        boardId: board.id,
        itemId,
        authorId: tx.userId,
        parentUpdateId: parent?.id ?? null,
        body: sanitized.doc,
        bodyText: sanitized.text,
        mentionedUserIds: mentioned,
      })
      .returning();
    if (!row) throw new Error('Update insert returned no row');
    const preview = sanitized.text.slice(0, 280);
    const payload = { itemName: item.name, boardName: board.name, preview };
    const notified = new Set(
      await notify(tx, {
        kind: 'mention',
        recipients: mentioned,
        boardId: board.id,
        itemId,
        updateId: row.id,
        payload,
      }),
    );
    if (parent?.authorId && !notified.has(parent.authorId)) {
      for (const id of await notify(tx, {
        kind: 'update_reply',
        recipients: [parent.authorId],
        boardId: board.id,
        itemId,
        updateId: row.id,
        payload,
      }))
        notified.add(id);
    }
    if (!parent) {
      // Item "subscribers": everyone assigned in a people column of the item.
      const peopleColumns = await tx.db
        .select({ key: columns.key })
        .from(columns)
        .where(and(eq(columns.boardId, board.id), eq(columns.type, 'people'), isNull(columns.deletedAt)));
      const subscribers = new Set<string>();
      for (const column of peopleColumns) {
        const ids = (item.values[column.key] as { ids?: string[] } | undefined)?.ids ?? [];
        for (const id of ids) if (!notified.has(id)) subscribers.add(id);
      }
      await notify(tx, {
        kind: 'update_on_subscribed',
        recipients: [...subscribers],
        boardId: board.id,
        itemId,
        updateId: row.id,
        payload,
      });
    }
    await logActivity(tx, {
      boardId: board.id,
      itemId,
      action: parent ? 'update.replied' : 'update.created',
      after: { updateId: row.id, preview: preview.slice(0, 120) },
    });
    await publish(tx.db, {
      type: 'updates.changed',
      orgId: tx.orgId,
      boardId: board.id,
      ids: [itemId],
      actorId: tx.userId,
    });
    await publish(tx.db, {
      type: 'items.changed',
      orgId: tx.orgId,
      boardId: board.id,
      ids: [itemId],
      actorId: tx.userId,
    });
    return oneUpdate(tx, row);
  });
}

function assertAuthorOrModerator(ctx: ServiceContext, row: UpdateRow): void {
  if (ctx.userId !== null && row.authorId !== ctx.userId && !isOrgAdmin(ctx)) {
    throw new ForbiddenError('Only the author can change this update');
  }
}

export async function editUpdate(
  ctx: ServiceContext,
  updateId: string,
  input: EditUpdateInput,
): Promise<UpdateDto> {
  return inTransaction(ctx, async (tx) => {
    const existing = await requireUpdate(tx, updateId);
    if (existing.authorId !== tx.userId) throw new ForbiddenError('Only the author can edit this update');
    const sanitized = sanitizeRichText(input.body);
    if (sanitized.text.length === 0) throw new BadRequestError('An update cannot be empty');
    const mentioned = await orgMemberIds(tx, sanitized.mentionedUserIds);
    const [row] = await tx.db
      .update(updates)
      .set({
        body: sanitized.doc,
        bodyText: sanitized.text,
        mentionedUserIds: mentioned,
        editedAt: new Date(),
      })
      .where(eq(updates.id, updateId))
      .returning();
    if (!row) throw new NotFoundError('Update');
    const newlyMentioned = mentioned.filter((id) => !existing.mentionedUserIds.includes(id));
    await notify(tx, {
      kind: 'mention',
      recipients: newlyMentioned,
      boardId: row.boardId,
      itemId: row.itemId,
      updateId: row.id,
      payload: { preview: sanitized.text.slice(0, 280) },
    });
    await publish(tx.db, {
      type: 'updates.changed',
      orgId: tx.orgId,
      boardId: row.boardId,
      ids: [row.itemId],
      actorId: tx.userId,
    });
    return oneUpdate(tx, row);
  });
}

export async function deleteUpdate(ctx: ServiceContext, updateId: string): Promise<{ id: string }> {
  return inTransaction(ctx, async (tx) => {
    const row = await requireUpdate(tx, updateId);
    assertAuthorOrModerator(tx, row);
    const now = new Date();
    await tx.db.update(updates).set({ deletedAt: now }).where(eq(updates.id, updateId));
    const replies = await tx.db
      .update(updates)
      .set({ deletedAt: now })
      .where(and(eq(updates.parentUpdateId, updateId), isNull(updates.deletedAt)))
      .returning({ id: updates.id });
    // Mention / reply notifications must not outlive the update they point at.
    await retractUpdateNotifications(tx, [updateId, ...replies.map((reply) => reply.id)]);
    await logActivity(tx, {
      boardId: row.boardId,
      itemId: row.itemId,
      action: 'update.deleted',
      before: { updateId },
    });
    await publish(tx.db, {
      type: 'updates.changed',
      orgId: tx.orgId,
      boardId: row.boardId,
      ids: [row.itemId],
      actorId: tx.userId,
    });
    await publish(tx.db, {
      type: 'items.changed',
      orgId: tx.orgId,
      boardId: row.boardId,
      ids: [row.itemId],
      actorId: tx.userId,
    });
    return { id: updateId };
  });
}

export async function pinUpdate(ctx: ServiceContext, updateId: string, pinned: boolean): Promise<UpdateDto> {
  return inTransaction(ctx, async (tx) => {
    const row = await requireUpdate(tx, updateId);
    if (row.parentUpdateId) throw new BadRequestError('Only top-level updates can be pinned');
    await requireBoard(tx, row.boardId, 'write');
    const [updated] = await tx.db.update(updates).set({ pinned }).where(eq(updates.id, updateId)).returning();
    if (!updated) throw new NotFoundError('Update');
    await publish(tx.db, {
      type: 'updates.changed',
      orgId: tx.orgId,
      boardId: row.boardId,
      ids: [row.itemId],
      actorId: tx.userId,
    });
    return oneUpdate(tx, updated);
  });
}

/** Toggle the caller's reaction. */
export async function toggleReaction(
  ctx: ServiceContext,
  updateId: string,
  emoji: string,
): Promise<UpdateDto> {
  return inTransaction(ctx, async (tx) => {
    if (!tx.userId) throw new ForbiddenError();
    const row = await requireUpdate(tx, updateId);
    const removed = await tx.db
      .delete(updateReactions)
      .where(
        and(
          eq(updateReactions.updateId, updateId),
          eq(updateReactions.userId, tx.userId),
          eq(updateReactions.emoji, emoji),
        ),
      )
      .returning({ id: updateReactions.id });
    if (removed.length === 0) {
      const existing = await tx.db
        .select({ emoji: updateReactions.emoji })
        .from(updateReactions)
        .where(eq(updateReactions.updateId, updateId));
      if (new Set([...existing.map((entry) => entry.emoji), emoji]).size > 20)
        throw new BadRequestError('Too many different reactions');
      await tx.db.insert(updateReactions).values({ orgId: tx.orgId, updateId, userId: tx.userId, emoji });
      if (row.authorId) {
        await notify(tx, {
          kind: 'reaction',
          recipients: [row.authorId],
          boardId: row.boardId,
          itemId: row.itemId,
          updateId,
          payload: { emoji },
        });
      }
    }
    await publish(tx.db, {
      type: 'updates.changed',
      orgId: tx.orgId,
      boardId: row.boardId,
      ids: [row.itemId],
      actorId: tx.userId,
    });
    return oneUpdate(tx, row);
  });
}

/** Mark every update of an item (or one update) as read by the caller. */
export async function markUpdatesRead(
  ctx: ServiceContext,
  target: { itemId?: string; updateId?: string },
): Promise<{ marked: number }> {
  if (!ctx.userId) throw new ForbiddenError();
  let ids: string[];
  if (target.updateId) {
    ids = [(await requireUpdate(ctx, target.updateId)).id];
  } else if (target.itemId) {
    await requireItem(ctx, target.itemId, 'read');
    const rows = await ctx.db
      .select({ id: updates.id })
      .from(updates)
      .where(and(eq(updates.itemId, target.itemId), eq(updates.orgId, ctx.orgId), isNull(updates.deletedAt)));
    ids = rows.map((row) => row.id);
  } else {
    throw new BadRequestError('Provide an item or an update');
  }
  if (ids.length === 0) return { marked: 0 };
  const inserted = await ctx.db
    .insert(updateReads)
    .values(ids.map((updateId) => ({ orgId: ctx.orgId, updateId, userId: ctx.userId as string })))
    .onConflictDoNothing()
    .returning({ id: updateReads.id });
  return { marked: inserted.length };
}

/** Create an update on behalf of an automation (plain text, no mentions). */
export async function createSystemUpdate(
  ctx: ServiceContext,
  itemId: string,
  body: UpdateRow['body'],
): Promise<UpdateDto> {
  return createUpdate(ctx, itemId, { body: body as CreateUpdateInput['body'] });
}

/**
 * Decorate top-level update rows plus their reply rows into threads (replies oldest first).
 * Used by cross-item feeds (inbox) that already applied access filtering.
 */
export async function decorateThreads(
  ctx: ServiceContext,
  threadRows: readonly UpdateRow[],
  replyRows: readonly UpdateRow[],
): Promise<UpdateDto[]> {
  const decorated = await decorate(ctx, [...threadRows, ...replyRows]);
  const replies = new Map<string, UpdateDto[]>();
  for (const row of [...replyRows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    const dto = row.parentUpdateId ? decorated.get(row.id) : undefined;
    if (dto && row.parentUpdateId)
      replies.set(row.parentUpdateId, [...(replies.get(row.parentUpdateId) ?? []), { ...dto, replies: [] }]);
  }
  return threadRows.flatMap((row) => {
    const dto = decorated.get(row.id);
    return dto ? [{ ...dto, replies: replies.get(row.id) ?? [] }] : [];
  });
}
