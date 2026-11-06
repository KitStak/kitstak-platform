/**
 * Persisting cell value changes: diffing, activity rows, connect_boards link sync (with
 * reciprocal columns), people-assignment notifications and automation events.
 */
import { and, eq, inArray, isNull, notInArray } from 'drizzle-orm';
import { columns, itemLinks, items } from '@/server/db/schema';
import type { StoredCellValue } from '@/server/db/schema/cell-values';
import type { BoardRow, ItemRow } from './access';
import { logActivity, type ActivityInput } from './activity';
import { applyPatch, sameValue, type ValidationColumn, type ValuesPatch } from './cell-validation';
import type { ServiceContext } from './context';
import type { ItemEvent } from './item-events';
import { notify } from './notifications';

function connectIds(value: unknown): string[] {
  const ids = (value as { itemIds?: unknown } | null | undefined)?.itemIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}

function peopleIds(value: unknown): string[] {
  const ids = (value as { ids?: unknown } | null | undefined)?.ids;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}

/** Update the reciprocal connect column on linked items (add or remove `sourceItemId`). */
async function updateReciprocal(
  ctx: ServiceContext,
  sourceItemId: string,
  targetIds: readonly string[],
  reciprocalKey: string,
  mode: 'add' | 'remove',
): Promise<void> {
  if (targetIds.length === 0) return;
  const targets = await ctx.db
    .select({ id: items.id, boardId: items.boardId, values: items.values })
    .from(items)
    .where(and(eq(items.orgId, ctx.orgId), inArray(items.id, [...targetIds]), isNull(items.deletedAt)));
  if (targets.length === 0) return;
  const boardIds = [...new Set(targets.map((target) => target.boardId))];
  const reciprocalColumns = await ctx.db
    .select({ boardId: columns.boardId })
    .from(columns)
    .where(
      and(
        inArray(columns.boardId, boardIds),
        eq(columns.key, reciprocalKey),
        eq(columns.type, 'connect_boards'),
        isNull(columns.deletedAt),
      ),
    );
  const boardsWithColumn = new Set(reciprocalColumns.map((column) => column.boardId));
  for (const target of targets) {
    if (!boardsWithColumn.has(target.boardId)) continue;
    const current = connectIds(target.values[reciprocalKey]);
    const next =
      mode === 'add'
        ? current.includes(sourceItemId)
          ? current
          : [...current, sourceItemId]
        : current.filter((id) => id !== sourceItemId);
    if (next.length === current.length && mode === 'add') continue;
    const values: Record<string, StoredCellValue> = { ...target.values };
    if (next.length === 0) delete values[reciprocalKey];
    else values[reciprocalKey] = { itemIds: next };
    await ctx.db.update(items).set({ values, updatedAt: new Date() }).where(eq(items.id, target.id));
    if (mode === 'add') {
      await ctx.db
        .insert(itemLinks)
        .values({
          orgId: ctx.orgId,
          fromItemId: target.id,
          toItemId: sourceItemId,
          columnKey: reciprocalKey,
          createdBy: ctx.userId,
        })
        .onConflictDoNothing();
    } else {
      await ctx.db
        .delete(itemLinks)
        .where(
          and(
            eq(itemLinks.fromItemId, target.id),
            eq(itemLinks.toItemId, sourceItemId),
            eq(itemLinks.columnKey, reciprocalKey),
          ),
        );
    }
  }
}

/** Mirror a connect_boards cell into `item_links` (+ reciprocal column when configured). */
export async function syncConnectLinks(
  ctx: ServiceContext,
  itemId: string,
  column: ValidationColumn,
  before: unknown,
  after: unknown,
): Promise<void> {
  const beforeIds = connectIds(before);
  const afterIds = connectIds(after);
  if (afterIds.length === 0) {
    await ctx.db
      .delete(itemLinks)
      .where(and(eq(itemLinks.fromItemId, itemId), eq(itemLinks.columnKey, column.key)));
  } else {
    await ctx.db
      .delete(itemLinks)
      .where(
        and(
          eq(itemLinks.fromItemId, itemId),
          eq(itemLinks.columnKey, column.key),
          notInArray(itemLinks.toItemId, afterIds),
        ),
      );
    await ctx.db
      .insert(itemLinks)
      .values(
        afterIds.map((toItemId, position) => ({
          orgId: ctx.orgId,
          fromItemId: itemId,
          toItemId,
          columnKey: column.key,
          position,
          createdBy: ctx.userId,
        })),
      )
      .onConflictDoNothing();
  }
  const reciprocalKey = (column.settings as { reciprocalColumnKey?: string } | null)?.reciprocalColumnKey;
  if (!reciprocalKey) return;
  const added = afterIds.filter((id) => !beforeIds.includes(id));
  const removed = beforeIds.filter((id) => !afterIds.includes(id));
  await updateReciprocal(ctx, itemId, added, reciprocalKey, 'add');
  await updateReciprocal(ctx, itemId, removed, reciprocalKey, 'remove');
}

export interface ValueChangeResult {
  readonly row: ItemRow;
  readonly events: ItemEvent[];
  readonly changedKeys: string[];
}

/**
 * Apply a validated patch (and optional rename) to an item row. Writes activity, syncs links,
 * notifies newly assigned people and returns the automation events to dispatch.
 */
export async function persistItemChanges(
  ctx: ServiceContext,
  item: ItemRow,
  board: BoardRow,
  boardColumns: readonly ValidationColumn[],
  patch: ValuesPatch,
  options: { readonly name?: string; readonly silentEvents?: boolean } = {},
): Promise<ValueChangeResult> {
  const byKey = new Map(boardColumns.map((column) => [column.key, column]));
  const changedKeys = Object.keys(patch).filter((key) => !sameValue(item.values[key], patch[key]));
  const renamed = options.name !== undefined && options.name !== item.name;
  if (changedKeys.length === 0 && !renamed) return { row: item, events: [], changedKeys: [] };

  const effectivePatch: ValuesPatch = Object.fromEntries(changedKeys.map((key) => [key, patch[key] ?? null]));
  const nextValues = applyPatch(item.values, effectivePatch);
  const [row] = await ctx.db
    .update(items)
    .set({
      values: nextValues,
      ...(renamed && { name: options.name }),
      updatedBy: ctx.userId,
      updatedAt: new Date(),
    })
    .where(and(eq(items.id, item.id), eq(items.orgId, ctx.orgId)))
    .returning();
  if (!row) throw new Error('Item update returned no row');

  const activities: ActivityInput[] = [];
  const events: ItemEvent[] = [];
  if (renamed) {
    activities.push({
      boardId: board.id,
      itemId: item.id,
      action: 'item.renamed',
      columnKey: 'name',
      before: item.name,
      after: options.name,
    });
  }
  for (const key of changedKeys) {
    const column = byKey.get(key);
    if (!column) continue;
    const before = item.values[key] ?? null;
    const after = effectivePatch[key] ?? null;
    activities.push({
      boardId: board.id,
      itemId: item.id,
      action: 'item.value_changed',
      columnKey: key,
      before,
      after,
    });
    if (column.type === 'connect_boards') await syncConnectLinks(ctx, item.id, column, before, after);
    if (column.type === 'people') {
      const added = peopleIds(after).filter((id) => !peopleIds(before).includes(id));
      if (added.length > 0) {
        await notify(ctx, {
          kind: 'assigned',
          recipients: added,
          boardId: board.id,
          itemId: item.id,
          payload: { columnKey: key, columnTitle: column.title, itemName: row.name, boardName: board.name },
        });
      }
    }
    if (!options.silentEvents) {
      events.push({
        type: 'column_changed',
        boardId: board.id,
        itemId: item.id,
        columnKey: key,
        columnType: column.type,
        before,
        after,
      });
    }
  }
  await logActivity(ctx, activities);
  return { row, events, changedKeys };
}
