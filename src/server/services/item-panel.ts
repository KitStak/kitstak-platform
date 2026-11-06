/**
 * Item panel backend: item subscribers and update read receipts ("Seen by").
 *
 * Subscribers have no table of their own (schema is frozen for this module), so explicit
 * subscribe / unsubscribe choices live in `boards.settings.itemSubscribers[itemId]` and are
 * written under a row lock (SELECT … FOR UPDATE) with a targeted jsonb merge, so concurrent
 * subscriber changes serialize and other settings writers are not clobbered.
 * Effective subscribers = (people-column assignees ∪ creator ∪ update authors ∪ added) − removed.
 */
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { boards, columns, member, updateReads, updates, user } from '@/server/db/schema';
import { ForbiddenError, NotFoundError } from '@/server/http/errors';
import { requireBoard, requireItem } from './access';
import type { ServiceContext } from './context';
import type { UserSummaryDto } from './contracts/dto';
import { applySubscriberChange, type ExplicitSubscribers, type ItemSubscribersDto, type UpdateReaderDto } from './contracts/item-panel';

export type { ItemSubscribersDto, UpdateReaderDto };


export const changeSubscribersSchema = z
  .object({
    add: z.array(z.uuid()).max(100).default([]),
    remove: z.array(z.uuid()).max(100).default([]),
  })
  .refine((value) => value.add.length + value.remove.length > 0, { message: 'Nothing to change' });
export type ChangeSubscribersInput = z.infer<typeof changeSubscribersSchema>;



function readExplicit(settings: Record<string, unknown>, itemId: string): ExplicitSubscribers {
  const map = settings.itemSubscribers;
  const entry = typeof map === 'object' && map !== null ? (map as Record<string, unknown>)[itemId] : undefined;
  const list = (value: unknown) =>
    Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  if (typeof entry !== 'object' || entry === null) return { added: [], removed: [] };
  const record = entry as Record<string, unknown>;
  return { added: list(record.added), removed: list(record.removed) };
}

function peopleIds(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return [];
  const ids = (value as { ids?: unknown }).ids;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}

async function orgUsers(ctx: ServiceContext, ids: readonly string[]): Promise<UserSummaryDto[]> {
  if (ids.length === 0) return [];
  return ctx.db
    .select({ id: user.id, name: user.name, email: user.email, image: user.image, title: user.title })
    .from(user)
    .innerJoin(member, and(eq(member.userId, user.id), eq(member.organizationId, ctx.orgId)))
    .where(inArray(user.id, [...ids]))
    .orderBy(asc(user.name));
}

export async function getItemSubscribers(ctx: ServiceContext, itemId: string): Promise<ItemSubscribersDto> {
  const { item, board } = await requireItem(ctx, itemId, 'read');
  const [peopleColumns, authors] = await Promise.all([
    ctx.db
      .select({ key: columns.key })
      .from(columns)
      .where(and(eq(columns.boardId, board.id), eq(columns.orgId, ctx.orgId), eq(columns.type, 'people'), isNull(columns.deletedAt))),
    ctx.db
      .selectDistinct({ authorId: updates.authorId })
      .from(updates)
      .where(and(eq(updates.itemId, itemId), eq(updates.orgId, ctx.orgId), isNull(updates.deletedAt))),
  ]);
  const explicit = readExplicit(board.settings as Record<string, unknown>, itemId);
  const values = item.values as Record<string, unknown>;
  const derived = new Set<string>();
  for (const column of peopleColumns) for (const id of peopleIds(values[column.key])) derived.add(id);
  if (item.createdBy) derived.add(item.createdBy);
  for (const row of authors) if (row.authorId) derived.add(row.authorId);
  for (const id of explicit.added) derived.add(id);
  for (const id of explicit.removed) derived.delete(id);
  const users = await orgUsers(ctx, [...derived]);
  const userIds = users.map((entry) => entry.id);
  return { itemId, userIds, users, subscribedByMe: ctx.userId ? userIds.includes(ctx.userId) : false };
}

/**
 * Subscribe / unsubscribe people. Anyone who can read the item may change their own
 * subscription; changing other people requires write access to the board.
 */
export async function changeItemSubscribers(
  ctx: ServiceContext,
  itemId: string,
  input: ChangeSubscribersInput,
): Promise<ItemSubscribersDto> {
  const { board } = await requireItem(ctx, itemId, 'read');
  const touched = [...new Set([...input.add, ...input.remove])];
  const onlySelf = touched.every((id) => id === ctx.userId);
  if (!onlySelf) await requireBoard(ctx, board.id, 'write');
  const known = new Set((await orgUsers(ctx, touched)).map((entry) => entry.id));
  if (touched.some((id) => !known.has(id))) throw new NotFoundError('User');
  if (!ctx.userId && onlySelf) throw new ForbiddenError();

  // Lock the board row so concurrent subscriber changes on the same item serialize instead of
  // overwriting each other's read-modify-write (settings are re-read under the lock).
  await ctx.db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ settings: boards.settings })
      .from(boards)
      .where(and(eq(boards.id, board.id), eq(boards.orgId, ctx.orgId)))
      .for('update');
    if (!locked) throw new NotFoundError('Board');
    const next = applySubscriberChange(readExplicit((locked.settings ?? {}) as Record<string, unknown>, itemId), input);
    await tx
      .update(boards)
      .set({
        settings: sql`coalesce(${boards.settings}, '{}'::jsonb) || jsonb_build_object('itemSubscribers', coalesce(${boards.settings}->'itemSubscribers', '{}'::jsonb) || jsonb_build_object(${itemId}::text, ${JSON.stringify(next)}::jsonb))`,
      })
      .where(and(eq(boards.id, board.id), eq(boards.orgId, ctx.orgId)));
  });
  return getItemSubscribers(ctx, itemId);
}

/** Everyone who has read an update (newest first), for the "Seen by" popover. */
export async function listUpdateReaders(ctx: ServiceContext, updateId: string): Promise<UpdateReaderDto[]> {
  const [row] = await ctx.db
    .select({ boardId: updates.boardId })
    .from(updates)
    .where(and(eq(updates.id, updateId), eq(updates.orgId, ctx.orgId), isNull(updates.deletedAt)))
    .limit(1);
  if (!row) throw new NotFoundError('Update');
  await requireBoard(ctx, row.boardId, 'read');
  const readers = await ctx.db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      title: user.title,
      readAt: updateReads.readAt,
    })
    .from(updateReads)
    .innerJoin(user, eq(user.id, updateReads.userId))
    .where(and(eq(updateReads.updateId, updateId), eq(updateReads.orgId, ctx.orgId)))
    .orderBy(sql`${updateReads.readAt} desc`)
    .limit(200);
  return readers.map((reader) => ({ ...reader, readAt: reader.readAt.toISOString() }));
}
