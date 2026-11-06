/**
 * Item & subitem mutations. Every mutation: org-scoped → board access check → Zod/cell
 * validation → transactional write → activity_log → realtime NOTIFY → automation events.
 */
import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, or, type SQL } from 'drizzle-orm';
import { groups, itemLinks, items, updates } from '@/server/db/schema';
import type { StoredCellValue } from '@/server/db/schema/cell-values';
import { BadRequestError, NotFoundError } from '@/server/http/errors';
import { publish } from '@/server/realtime/publisher';
import { requireBoard, requireItem, type BoardRow, type ItemRow } from './access';
import { logActivity } from './activity';
import { validateValues, type ValidationColumn } from './cell-validation';
import { inTransaction, type ServiceContext, concurrently } from './context';
import type { ItemDto } from './contracts/dto';
import type {
  CreateItemInput,
  DuplicateItemInput,
  MoveItemInput,
  SetCellInput,
  UpdateItemInput,
} from './contracts/item-inputs';
import { dispatchItemEvents, type ItemEvent } from './item-events';
import { hydrateMixedItems, loadBoardColumns } from './item-reads';
import { persistItemChanges, syncConnectLinks } from './item-values';
import { positionAfter, positionBefore, positionBetween } from './positions';

// ---------------------------------------------------------------------------------------------
// Positioning
// ---------------------------------------------------------------------------------------------

function siblingScope(ctx: ServiceContext, target: { groupId: string; parentItemId: string | null }): SQL {
  return and(
    eq(items.orgId, ctx.orgId),
    isNull(items.deletedAt),
    target.parentItemId
      ? eq(items.parentItemId, target.parentItemId)
      : and(eq(items.groupId, target.groupId), isNull(items.parentItemId)),
  ) as SQL;
}

/** Compute a position key for an item placed into `target` (append by default). */
export async function placeItem(
  ctx: ServiceContext,
  target: { groupId: string; parentItemId: string | null },
  placement: { afterId?: string | null; beforeId?: string | null; position?: 'top' | 'bottom' },
  excludeId?: string,
): Promise<string> {
  const scope = siblingScope(ctx, target);
  const notSelf = excludeId ? (and(scope, ne(items.id, excludeId)) as SQL) : scope;
  const positionOf = async (id: string): Promise<string> => {
    const [row] = await ctx.db
      .select({ position: items.position })
      .from(items)
      .where(and(scope, eq(items.id, id)))
      .limit(1);
    if (!row) throw new BadRequestError('The reference item is not in the target group');
    return row.position;
  };
  if (placement.afterId) {
    const anchor = await positionOf(placement.afterId);
    const [next] = await ctx.db
      .select({ position: items.position })
      .from(items)
      .where(and(notSelf, gt(items.position, anchor)))
      .orderBy(asc(items.position))
      .limit(1);
    return positionBetween(anchor, next?.position);
  }
  if (placement.beforeId) {
    const anchor = await positionOf(placement.beforeId);
    const [previous] = await ctx.db
      .select({ position: items.position })
      .from(items)
      .where(and(notSelf, lt(items.position, anchor)))
      .orderBy(desc(items.position))
      .limit(1);
    return positionBetween(previous?.position, anchor);
  }
  if (placement.position === 'top') {
    const [first] = await ctx.db
      .select({ position: items.position })
      .from(items)
      .where(notSelf)
      .orderBy(asc(items.position))
      .limit(1);
    return positionBefore(first?.position);
  }
  const [last] = await ctx.db
    .select({ position: items.position })
    .from(items)
    .where(notSelf)
    .orderBy(desc(items.position))
    .limit(1);
  return positionAfter(last?.position);
}

export async function requireGroup(
  ctx: ServiceContext,
  boardId: string,
  groupId?: string,
): Promise<typeof groups.$inferSelect> {
  const conditions: SQL[] = [
    eq(groups.boardId, boardId),
    eq(groups.orgId, ctx.orgId),
    isNull(groups.deletedAt),
  ];
  if (groupId) conditions.push(eq(groups.id, groupId));
  else conditions.push(isNull(groups.archivedAt));
  const [group] = await ctx.db
    .select()
    .from(groups)
    .where(and(...conditions))
    .orderBy(asc(groups.position))
    .limit(1);
  if (!group)
    throw groupId
      ? new NotFoundError('Group')
      : new BadRequestError('The board has no groups; add a group first');
  return group;
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

export async function finishItemMutation(
  ctx: ServiceContext,
  board: { id: string },
  itemIds: readonly string[],
  events: readonly ItemEvent[],
  type: 'items.changed' | 'items.deleted' = 'items.changed',
): Promise<void> {
  await publish(ctx.db, { type, orgId: ctx.orgId, boardId: board.id, ids: itemIds, actorId: ctx.userId });
  await dispatchItemEvents(ctx, events);
}

async function hydrateOne(ctx: ServiceContext, row: ItemRow): Promise<ItemDto> {
  const [dto] = await hydrateMixedItems(ctx, [row]);
  if (!dto) throw new NotFoundError('Item');
  return dto;
}

async function reloadItem(ctx: ServiceContext, itemId: string): Promise<ItemRow> {
  const [row] = await ctx.db
    .select()
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.orgId, ctx.orgId)))
    .limit(1);
  if (!row) throw new NotFoundError('Item');
  return row;
}

function scopeOf(item: { parentItemId: string | null }): 'item' | 'subitem' {
  return item.parentItemId ? 'subitem' : 'item';
}

// ---------------------------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------------------------

/** Insert one item inside an existing transaction context (no hydration). */
export async function insertItem(
  tx: ServiceContext,
  board: BoardRow,
  boardColumns: readonly ValidationColumn[],
  input: CreateItemInput,
): Promise<{ row: ItemRow; events: ItemEvent[] }> {
  let parent: ItemRow | null = null;
  if (input.parentItemId) {
    const [found] = await tx.db
      .select()
      .from(items)
      .where(and(eq(items.id, input.parentItemId), eq(items.orgId, tx.orgId), isNull(items.deletedAt)))
      .limit(1);
    if (!found || found.boardId !== board.id) throw new NotFoundError('Parent item');
    if (found.parentItemId) throw new BadRequestError('Subitems cannot have their own subitems');
    parent = found;
  }
  const group = parent ? { id: parent.groupId } : await requireGroup(tx, board.id, input.groupId);
  const scope = parent ? 'subitem' : 'item';
  const patch = input.values ? await validateValues(tx, boardColumns, input.values, scope) : {};
  const values = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== null)) as Record<
    string,
    StoredCellValue
  >;
  const position = await placeItem(tx, { groupId: group.id, parentItemId: parent?.id ?? null }, input);
  const [row] = await tx.db
    .insert(items)
    .values({
      orgId: tx.orgId,
      boardId: board.id,
      groupId: group.id,
      parentItemId: parent?.id ?? null,
      name: input.name,
      position,
      values,
      createdBy: tx.userId,
      updatedBy: tx.userId,
    })
    .returning();
  if (!row) throw new Error('Item insert returned no row');
  for (const column of boardColumns) {
    if (column.type === 'connect_boards' && values[column.key] !== undefined) {
      await syncConnectLinks(tx, row.id, column, null, values[column.key]);
    }
  }
  await logActivity(tx, {
    boardId: board.id,
    itemId: row.id,
    action: parent ? 'subitem.created' : 'item.created',
    after: { name: row.name, groupId: row.groupId, parentItemId: row.parentItemId },
  });
  // Notify initially assigned people.
  const assigned = Object.fromEntries(
    boardColumns
      .filter((column) => column.type === 'people' && values[column.key])
      .map((column) => [column.key, values[column.key] ?? null]),
  );
  // Start from every non-people value so the write below keeps them (persistItemChanges
  // replaces `values` with base + patch).
  const empty = {
    ...row,
    values: Object.fromEntries(Object.entries(row.values).filter(([key]) => !(key in assigned))),
  };
  if (Object.keys(assigned).length > 0) {
    await persistItemChanges(tx, empty, board, boardColumns, assigned, { silentEvents: true });
  }
  return { row, events: [{ type: 'item_created', boardId: board.id, itemId: row.id }] };
}

export async function createItem(
  ctx: ServiceContext,
  boardId: string,
  input: CreateItemInput,
): Promise<ItemDto> {
  return inTransaction(ctx, async (tx) => {
    const board = await requireBoard(tx, boardId, 'write');
    const boardColumns = await loadBoardColumns(tx, boardId);
    const { row, events } = await insertItem(tx, board, boardColumns, input);
    await finishItemMutation(tx, board, [row.id, ...(row.parentItemId ? [row.parentItemId] : [])], events);
    return hydrateOne(tx, await reloadItem(tx, row.id));
  });
}

// ---------------------------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------------------------

export async function updateItem(
  ctx: ServiceContext,
  itemId: string,
  input: UpdateItemInput,
): Promise<ItemDto> {
  return inTransaction(ctx, async (tx) => {
    const { item, board } = await requireItem(tx, itemId, 'write');
    const boardColumns = await loadBoardColumns(tx, board.id);
    const patch = input.values ? await validateValues(tx, boardColumns, input.values, scopeOf(item)) : {};
    const result = await persistItemChanges(tx, item, board, boardColumns, patch, { name: input.name });
    if (result.changedKeys.length > 0 || input.name !== undefined) {
      await finishItemMutation(tx, board, [item.id], result.events);
    }
    return hydrateOne(tx, await reloadItem(tx, item.id));
  });
}

export async function setCellValue(
  ctx: ServiceContext,
  itemId: string,
  input: SetCellInput,
): Promise<ItemDto> {
  return updateItem(ctx, itemId, { values: { [input.columnKey]: input.value } });
}

// ---------------------------------------------------------------------------------------------
// Move
// ---------------------------------------------------------------------------------------------

export async function moveItem(ctx: ServiceContext, itemId: string, input: MoveItemInput): Promise<ItemDto> {
  return inTransaction(ctx, async (tx) => {
    const { item, board } = await requireItem(tx, itemId, 'write');
    if (item.parentItemId) {
      // Subitems reorder within their parent only.
      const position = await placeItem(
        tx,
        { groupId: item.groupId, parentItemId: item.parentItemId },
        input,
        item.id,
      );
      const [row] = await tx.db
        .update(items)
        .set({ position, updatedAt: new Date() })
        .where(eq(items.id, item.id))
        .returning();
      await finishItemMutation(tx, board, [item.id], []);
      return hydrateOne(tx, row ?? item);
    }

    const crossBoard = input.boardId !== undefined && input.boardId !== board.id;
    const targetBoard = crossBoard ? await requireBoard(tx, input.boardId as string, 'write') : board;
    const group = await requireGroup(
      tx,
      targetBoard.id,
      input.groupId ?? (crossBoard ? undefined : item.groupId),
    );
    const position = await placeItem(tx, { groupId: group.id, parentItemId: null }, input, item.id);

    let values = item.values;
    if (crossBoard) {
      const [sourceColumns, targetColumns] = await concurrently(tx, [
        () => loadBoardColumns(tx, board.id),
        () => loadBoardColumns(tx, targetBoard.id),
      ]);
      const targetByKey = new Map(targetColumns.map((column) => [column.key, column]));
      const sourceByKey = new Map(sourceColumns.map((column) => [column.key, column]));
      const next: Record<string, StoredCellValue> = {};
      for (const [key, value] of Object.entries(item.values)) {
        const mapped = input.columnMapping?.[key];
        if (mapped === null) continue;
        const targetKey = mapped ?? key;
        const target = targetByKey.get(targetKey);
        if (target && target.type === sourceByKey.get(key)?.type && target.scope === 'item')
          next[targetKey] = value;
      }
      values = next;
      await tx.db.delete(itemLinks).where(eq(itemLinks.fromItemId, item.id));
      for (const column of targetColumns) {
        if (column.type === 'connect_boards' && values[column.key])
          await syncConnectLinks(tx, item.id, column, null, values[column.key]);
      }
      const subitems = await tx.db
        .select()
        .from(items)
        .where(and(eq(items.parentItemId, item.id), eq(items.orgId, tx.orgId)));
      for (const sub of subitems) {
        const kept = Object.fromEntries(
          Object.entries(sub.values).filter(([key]) => {
            const target = targetByKey.get(key);
            return target?.scope === 'subitem' && target.type === sourceByKey.get(key)?.type;
          }),
        );
        await tx.db
          .update(items)
          .set({ boardId: targetBoard.id, groupId: group.id, values: kept, updatedAt: new Date() })
          .where(eq(items.id, sub.id));
      }
      await tx.db.update(updates).set({ boardId: targetBoard.id }).where(eq(updates.itemId, item.id));
    }

    const [row] = await tx.db
      .update(items)
      .set({
        boardId: targetBoard.id,
        groupId: group.id,
        position,
        values,
        updatedBy: tx.userId,
        updatedAt: new Date(),
      })
      .where(and(eq(items.id, item.id), eq(items.orgId, tx.orgId)))
      .returning();
    if (!row) throw new NotFoundError('Item');
    if (!crossBoard && group.id !== item.groupId) {
      await tx.db.update(items).set({ groupId: group.id }).where(eq(items.parentItemId, item.id));
    }
    const moved = group.id !== item.groupId || crossBoard;
    await logActivity(tx, {
      boardId: targetBoard.id,
      itemId: item.id,
      action: crossBoard ? 'item.moved_board' : moved ? 'item.moved' : 'item.reordered',
      before: { boardId: board.id, groupId: item.groupId, position: item.position },
      after: { boardId: targetBoard.id, groupId: group.id, position },
    });
    const events: ItemEvent[] =
      moved && !crossBoard
        ? [
            {
              type: 'item_moved',
              boardId: board.id,
              itemId: item.id,
              fromGroupId: item.groupId,
              toGroupId: group.id,
            },
          ]
        : crossBoard
          ? [{ type: 'item_created', boardId: targetBoard.id, itemId: item.id }]
          : [];
    if (crossBoard)
      await publish(tx.db, {
        type: 'items.deleted',
        orgId: tx.orgId,
        boardId: board.id,
        ids: [item.id],
        actorId: tx.userId,
      });
    await finishItemMutation(tx, targetBoard, [item.id], events);
    return hydrateOne(tx, row);
  });
}

// ---------------------------------------------------------------------------------------------
// Duplicate
// ---------------------------------------------------------------------------------------------

export async function duplicateItemRow(
  tx: ServiceContext,
  item: ItemRow,
  options: DuplicateItemInput & { readonly position?: string; readonly nameSuffix?: string },
): Promise<ItemRow> {
  const position =
    options.position ??
    (await placeItem(tx, { groupId: item.groupId, parentItemId: item.parentItemId }, { afterId: item.id }));
  const [copy] = await tx.db
    .insert(items)
    .values({
      orgId: tx.orgId,
      boardId: item.boardId,
      groupId: item.groupId,
      parentItemId: item.parentItemId,
      name: `${item.name}${options.nameSuffix ?? ' (copy)'}`.slice(0, 2_000),
      position,
      values: item.values,
      createdBy: tx.userId,
      updatedBy: tx.userId,
    })
    .returning();
  if (!copy) throw new Error('Item duplicate returned no row');
  const links = await tx.db.select().from(itemLinks).where(eq(itemLinks.fromItemId, item.id));
  if (links.length > 0) {
    await tx.db
      .insert(itemLinks)
      .values(
        links.map((link) => ({
          orgId: tx.orgId,
          fromItemId: copy.id,
          toItemId: link.toItemId,
          columnKey: link.columnKey,
          position: link.position,
          createdBy: tx.userId,
        })),
      )
      .onConflictDoNothing();
  }
  if (options.withSubitems && !item.parentItemId) {
    const subitems = await tx.db
      .select()
      .from(items)
      .where(and(eq(items.parentItemId, item.id), isNull(items.deletedAt)))
      .orderBy(asc(items.position));
    if (subitems.length > 0) {
      await tx.db.insert(items).values(
        subitems.map((sub) => ({
          orgId: tx.orgId,
          boardId: item.boardId,
          groupId: item.groupId,
          parentItemId: copy.id,
          name: sub.name,
          position: sub.position,
          values: sub.values,
          createdBy: tx.userId,
          updatedBy: tx.userId,
        })),
      );
    }
  }
  if (options.withUpdates) {
    const threads = await tx.db
      .select()
      .from(updates)
      .where(and(eq(updates.itemId, item.id), isNull(updates.deletedAt), isNull(updates.parentUpdateId)));
    if (threads.length > 0) {
      await tx.db.insert(updates).values(
        threads.map((update) => ({
          orgId: tx.orgId,
          boardId: item.boardId,
          itemId: copy.id,
          authorId: update.authorId,
          body: update.body,
          bodyText: update.bodyText,
          mentionedUserIds: update.mentionedUserIds,
          pinned: update.pinned,
        })),
      );
    }
  }
  await logActivity(tx, {
    boardId: item.boardId,
    itemId: copy.id,
    action: 'item.duplicated',
    before: { sourceItemId: item.id },
    after: { name: copy.name },
  });
  return copy;
}

export async function duplicateItem(
  ctx: ServiceContext,
  itemId: string,
  input: DuplicateItemInput,
): Promise<ItemDto> {
  return inTransaction(ctx, async (tx) => {
    const { item, board } = await requireItem(tx, itemId, 'write');
    const copy = await duplicateItemRow(tx, item, input);
    await finishItemMutation(
      tx,
      board,
      [copy.id],
      [{ type: 'item_created', boardId: board.id, itemId: copy.id }],
    );
    return hydrateOne(tx, copy);
  });
}

// ---------------------------------------------------------------------------------------------
// Archive / delete / restore
// ---------------------------------------------------------------------------------------------

export type LifecycleAction = 'archive' | 'delete' | 'restore';

/** Apply a lifecycle action to items (and their subitems) of one board. */
export async function applyLifecycle(
  tx: ServiceContext,
  board: BoardRow,
  rows: readonly ItemRow[],
  action: LifecycleAction,
): Promise<string[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const now = new Date();
  const set =
    action === 'archive'
      ? { archivedAt: now }
      : action === 'delete'
        ? { deletedAt: now }
        : { archivedAt: null, deletedAt: null };
  const target = or(inArray(items.id, ids), inArray(items.parentItemId, ids)) as SQL;
  await tx.db
    .update(items)
    .set({ ...set, updatedBy: tx.userId, updatedAt: now })
    .where(and(eq(items.orgId, tx.orgId), target));
  if (action === 'restore') {
    // Restoring into an archived/deleted group would hide the item again: move it to the first live group.
    const liveGroups = await tx.db
      .select({ id: groups.id })
      .from(groups)
      .where(and(eq(groups.boardId, board.id), isNull(groups.deletedAt), isNull(groups.archivedAt)));
    const liveIds = new Set(liveGroups.map((row) => row.id));
    const stranded = rows.filter((row) => !liveIds.has(row.groupId)).map((row) => row.id);
    if (stranded.length > 0) {
      const live = await requireGroup(tx, board.id);
      await tx.db
        .update(items)
        .set({ groupId: live.id })
        .where(
          and(
            eq(items.orgId, tx.orgId),
            or(inArray(items.id, stranded), inArray(items.parentItemId, stranded)) as SQL,
          ),
        );
    }
  }
  await logActivity(
    tx,
    rows.map((row) => ({
      boardId: board.id,
      itemId: row.id,
      action: `item.${action === 'archive' ? 'archived' : action === 'delete' ? 'deleted' : 'restored'}`,
      before: { name: row.name, groupId: row.groupId },
    })),
  );
  await publish(tx.db, {
    type: action === 'restore' ? 'items.changed' : 'items.deleted',
    orgId: tx.orgId,
    boardId: board.id,
    ids,
    actorId: tx.userId,
  });
  return ids;
}

export async function changeItemLifecycle(
  ctx: ServiceContext,
  itemId: string,
  action: LifecycleAction,
): Promise<{ id: string }> {
  return inTransaction(ctx, async (tx) => {
    const { item, board } = await requireItem(tx, itemId, 'write', { includeDeleted: action === 'restore' });
    await applyLifecycle(tx, board, [item], action);
    return { id: item.id };
  });
}
