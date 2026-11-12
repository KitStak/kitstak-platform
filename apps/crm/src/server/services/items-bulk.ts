/** Bulk item operations (multi-select action bar, imports). All-or-nothing per request. */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { items } from '@/server/db/schema';
import { BadRequestError, NotFoundError } from '@/server/http/errors';
import { requireBoard, type BoardRow, type ItemRow } from './access';
import { validateValues } from './cell-validation';
import { inTransaction, type ServiceContext } from './context';
import type { ItemDto } from './contracts/dto';
import type { BulkCreateItemsInput, BulkItemsInput } from './contracts/item-inputs';
import type { ItemEvent } from './item-events';
import { hydrateMixedItems, loadBoardColumns } from './item-reads';
import { persistItemChanges } from './item-values';
import {
  applyLifecycle,
  duplicateItemRow,
  finishItemMutation,
  insertItem,
  moveItem,
  requireGroup,
} from './items';

export async function bulkCreateItems(
  ctx: ServiceContext,
  boardId: string,
  input: BulkCreateItemsInput,
): Promise<ItemDto[]> {
  return inTransaction(ctx, async (tx) => {
    const board = await requireBoard(tx, boardId, 'write');
    const boardColumns = await loadBoardColumns(tx, boardId);
    const group = await requireGroup(tx, boardId, input.groupId);
    const rows: ItemRow[] = [];
    const events: ItemEvent[] = [];
    for (const entry of input.items) {
      const result = await insertItem(tx, board, boardColumns, { ...entry, groupId: group.id });
      rows.push(result.row);
      events.push(...result.events);
    }
    await finishItemMutation(
      tx,
      board,
      rows.map((row) => row.id),
      events,
    );
    return hydrateMixedItems(tx, rows);
  });
}

async function loadBulkTargets(
  ctx: ServiceContext,
  itemIds: readonly string[],
  includeDeleted: boolean,
): Promise<{ board: BoardRow; rows: ItemRow[] }> {
  const rows = await ctx.db
    .select()
    .from(items)
    .where(
      and(
        eq(items.orgId, ctx.orgId),
        inArray(items.id, [...new Set(itemIds)]),
        ...(includeDeleted ? [] : [isNull(items.deletedAt)]),
      ),
    );
  if (rows.length !== new Set(itemIds).size)
    throw new NotFoundError('Item', 'One or more items were not found');
  const boardIds = new Set(rows.map((row) => row.boardId));
  if (boardIds.size !== 1) throw new BadRequestError('Bulk actions apply to items of a single board');
  const board = await requireBoard(ctx, rows[0]?.boardId as string, 'write');
  return { board, rows };
}

export interface BulkResult {
  readonly action: BulkItemsInput['action'];
  readonly itemIds: readonly string[];
  readonly items?: readonly ItemDto[];
}

export async function bulkItems(ctx: ServiceContext, input: BulkItemsInput): Promise<BulkResult> {
  if (input.action === 'move') {
    // Each move re-validates placement; reuse the single-item path inside one transaction.
    return inTransaction(ctx, async (tx) => {
      await loadBulkTargets(tx, input.itemIds, false);
      const moved: ItemDto[] = [];
      for (const itemId of input.itemIds) {
        moved.push(await moveItem(tx, itemId, { groupId: input.groupId, boardId: input.boardId }));
      }
      return { action: input.action, itemIds: input.itemIds, items: moved };
    });
  }

  return inTransaction(ctx, async (tx) => {
    const { board, rows } = await loadBulkTargets(tx, input.itemIds, input.action === 'restore');
    switch (input.action) {
      case 'update': {
        const boardColumns = await loadBoardColumns(tx, board.id);
        const scopes = new Set(rows.map((row) => (row.parentItemId ? 'subitem' : 'item')));
        if (scopes.size > 1) throw new BadRequestError('Cannot bulk-edit items and subitems together');
        const scope = scopes.has('subitem') ? 'subitem' : 'item';
        const patch = await validateValues(tx, boardColumns, input.values, scope);
        const events: ItemEvent[] = [];
        const updated: ItemRow[] = [];
        for (const row of rows) {
          const result = await persistItemChanges(tx, row, board, boardColumns, patch);
          events.push(...result.events);
          updated.push(result.row);
        }
        await finishItemMutation(tx, board, input.itemIds, events);
        return { action: input.action, itemIds: input.itemIds, items: await hydrateMixedItems(tx, updated) };
      }
      case 'duplicate': {
        const copies: ItemRow[] = [];
        for (const row of rows)
          copies.push(await duplicateItemRow(tx, row, { withSubitems: true, withUpdates: false }));
        await finishItemMutation(
          tx,
          board,
          copies.map((copy) => copy.id),
          copies.map((copy) => ({ type: 'item_created', boardId: board.id, itemId: copy.id })),
        );
        return {
          action: input.action,
          itemIds: copies.map((copy) => copy.id),
          items: await hydrateMixedItems(tx, copies),
        };
      }
      case 'archive':
      case 'delete':
      case 'restore': {
        const ids = await applyLifecycle(tx, board, rows, input.action);
        return { action: input.action, itemIds: ids };
      }
    }
  });
}
