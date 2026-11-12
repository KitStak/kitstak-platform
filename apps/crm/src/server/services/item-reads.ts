/** Item read paths: paginated lists, hydration (computed values, counts), detail. */
import { and, asc, count, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { boards, columns, groups, itemLinks, items, updates } from '@/server/db/schema';
import { NotFoundError } from '@/server/http/errors';
import { filterVisibleBoardIds, requireBoard, requireItem, type ItemRow } from './access';
import { computeItemValues, hasComputedColumns, type ComputeColumn, type ComputeItem } from './computed';
import { concurrently, type ServiceContext } from './context';
import type { ColumnDto, ItemDetailDto, ItemDto, LinkedItemDto } from './contracts/dto';
import type { ListItemsQuery } from './contracts/item-inputs';
import { toBoardSummaryDto, toColumnDto, toGroupDto, toItemDto } from './mappers';
import { decodeCursor, encodeCursor, toPage, type Page } from './pagination';

export type ColumnRow = typeof columns.$inferSelect;

export async function loadBoardColumns(ctx: ServiceContext, boardId: string): Promise<ColumnRow[]> {
  return ctx.db
    .select()
    .from(columns)
    .where(and(eq(columns.boardId, boardId), eq(columns.orgId, ctx.orgId), isNull(columns.deletedAt)))
    .orderBy(asc(columns.scope), asc(columns.position), asc(columns.id));
}

async function loadCounts(ctx: ServiceContext, itemIds: readonly string[]) {
  if (itemIds.length === 0)
    return { subitems: new Map<string, number>(), updates: new Map<string, number>() };
  const ids = [...itemIds];
  const [subRows, updateRows] = await concurrently(ctx, [
    () =>
      ctx.db
        .select({ parentId: items.parentItemId, total: count() })
        .from(items)
        .where(and(inArray(items.parentItemId, ids), isNull(items.deletedAt), isNull(items.archivedAt)))
        .groupBy(items.parentItemId),
    () =>
      ctx.db
        .select({ itemId: updates.itemId, total: count() })
        .from(updates)
        .where(and(inArray(updates.itemId, ids), isNull(updates.deletedAt), isNull(updates.parentUpdateId)))
        .groupBy(updates.itemId),
  ]);
  return {
    subitems: new Map(subRows.map((row) => [row.parentId as string, row.total])),
    updates: new Map(updateRows.map((row) => [row.itemId, row.total])),
  };
}

function asComputeItem(row: ItemRow): ComputeItem {
  return {
    id: row.id,
    boardId: row.boardId,
    name: row.name,
    values: row.values as Record<string, unknown>,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
  };
}

async function loadMirrorSources(
  ctx: ServiceContext,
  rows: readonly ItemRow[],
  boardColumns: readonly ComputeColumn[],
) {
  const connectKeys = new Set<string>();
  for (const column of boardColumns) {
    if (column.type !== 'mirror') continue;
    const key = (column.settings as { connectColumnKey?: string } | null)?.connectColumnKey;
    if (key) connectKeys.add(key);
  }
  if (connectKeys.size === 0 || rows.length === 0) return { linked: new Map(), foreignColumns: new Map() };
  const links = await ctx.db
    .select({
      fromItemId: itemLinks.fromItemId,
      toItemId: itemLinks.toItemId,
      columnKey: itemLinks.columnKey,
    })
    .from(itemLinks)
    .where(
      and(
        eq(itemLinks.orgId, ctx.orgId),
        inArray(
          itemLinks.fromItemId,
          rows.map((row) => row.id),
        ),
        inArray(itemLinks.columnKey, [...connectKeys]),
      ),
    );
  if (links.length === 0) return { linked: new Map(), foreignColumns: new Map() };
  const targets = await ctx.db
    .select()
    .from(items)
    .where(
      and(
        eq(items.orgId, ctx.orgId),
        inArray(items.id, [...new Set(links.map((link) => link.toItemId))]),
        isNull(items.deletedAt),
      ),
    );
  const targetById = new Map(targets.map((target) => [target.id, asComputeItem(target)]));
  const boardIds = [...new Set(targets.map((target) => target.boardId))];
  const foreignRows = boardIds.length
    ? await ctx.db
        .select({
          boardId: columns.boardId,
          key: columns.key,
          type: columns.type,
          settings: columns.settings,
        })
        .from(columns)
        .where(and(inArray(columns.boardId, boardIds), isNull(columns.deletedAt)))
    : [];
  const foreignColumns = new Map<string, ComputeColumn[]>();
  for (const column of foreignRows) {
    const list = foreignColumns.get(column.boardId) ?? [];
    list.push(column);
    foreignColumns.set(column.boardId, list);
  }
  const linked = new Map<string, Map<string, ComputeItem[]>>();
  for (const link of links) {
    const target = targetById.get(link.toItemId);
    if (!target) continue;
    const byColumn = linked.get(link.fromItemId) ?? new Map<string, ComputeItem[]>();
    const list = byColumn.get(link.columnKey) ?? [];
    list.push(target);
    byColumn.set(link.columnKey, list);
    linked.set(link.fromItemId, byColumn);
  }
  return { linked, foreignColumns };
}

/** Rows → DTOs with computed values and subitem / update counts. */
export async function hydrateItems(
  ctx: ServiceContext,
  rows: readonly ItemRow[],
  boardColumns: readonly ComputeColumn[],
): Promise<ItemDto[]> {
  if (rows.length === 0) return [];
  const [counts, mirror] = await concurrently(ctx, [
    () =>
      loadCounts(
        ctx,
        rows.map((row) => row.id),
      ),
    () =>
      hasComputedColumns(boardColumns) ? loadMirrorSources(ctx, rows, boardColumns) : Promise.resolve(null),
  ]);
  const computeAll = hasComputedColumns(boardColumns);
  return rows.map((row) =>
    toItemDto(row, {
      computed: computeAll ? computeItemValues(asComputeItem(row), boardColumns, mirror ?? {}) : {},
      subitemCount: counts.subitems.get(row.id) ?? 0,
      updateCount: counts.updates.get(row.id) ?? 0,
    }),
  );
}

/** Hydrate items that may belong to different boards (search, dashboards, bulk results). */
export async function hydrateMixedItems(ctx: ServiceContext, rows: readonly ItemRow[]): Promise<ItemDto[]> {
  const boardIds = [...new Set(rows.map((row) => row.boardId))];
  const columnRows = boardIds.length
    ? await ctx.db
        .select()
        .from(columns)
        .where(and(inArray(columns.boardId, boardIds), isNull(columns.deletedAt)))
    : [];
  const out = new Map<string, ItemDto>();
  for (const boardId of boardIds) {
    const boardRows = rows.filter((row) => row.boardId === boardId);
    const boardColumns = columnRows.filter((column) => column.boardId === boardId);
    const scopedColumns = (scope: 'item' | 'subitem') =>
      boardColumns.filter((column) => column.scope === scope);
    const top = boardRows.filter((row) => row.parentItemId === null);
    const sub = boardRows.filter((row) => row.parentItemId !== null);
    for (const dto of await hydrateItems(ctx, top, scopedColumns('item'))) out.set(dto.id, dto);
    for (const dto of await hydrateItems(ctx, sub, scopedColumns('subitem'))) out.set(dto.id, dto);
  }
  return rows.map((row) => out.get(row.id)).filter((dto): dto is ItemDto => dto !== undefined);
}

const boardCursorSchema = z.tuple([z.string().max(128), z.string().max(128), z.uuid()]);
const groupCursorSchema = z.tuple([z.string().max(128), z.uuid()]);

function stateConditions(state: ListItemsQuery['state']): SQL[] {
  switch (state) {
    case 'archived':
      return [isNull(items.deletedAt), isNotNull(items.archivedAt)];
    case 'deleted':
      return [isNotNull(items.deletedAt)];
    default:
      return [isNull(items.deletedAt), isNull(items.archivedAt)];
  }
}

/**
 * Top-level items of a board in display order (group position → item position), cursor
 * paginated. With `groupId`, pages within that group only.
 */
export async function listBoardItems(
  ctx: ServiceContext,
  boardId: string,
  query: ListItemsQuery,
  preloadedColumns?: readonly ColumnRow[],
): Promise<Page<ItemDto>> {
  await requireBoard(ctx, boardId, 'read');
  const boardColumns = (preloadedColumns ?? (await loadBoardColumns(ctx, boardId))).filter(
    (column) => column.scope === 'item',
  );
  const conditions: SQL[] = [
    eq(items.boardId, boardId),
    eq(items.orgId, ctx.orgId),
    isNull(items.parentItemId),
    ...stateConditions(query.state),
  ];
  if (query.q) {
    const byName = ilike(items.name, `%${query.q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`);
    // The Item ID column shows the uuid's first 8 hex chars ("#3f9a01c2"); accept that as a query too.
    const idPrefix = /^#?([0-9a-f]{6,36})$/i.exec(query.q.trim())?.[1]?.toLowerCase();
    conditions.push(idPrefix ? ((or(byName, sql`${items.id}::text like ${`${idPrefix}%`}`) ?? byName) as SQL) : byName);
  }
  if (query.state === 'active') conditions.push(isNull(groups.archivedAt), isNull(groups.deletedAt));

  if (query.groupId) {
    conditions.push(eq(items.groupId, query.groupId));
    const cursor = decodeCursor(query.cursor, groupCursorSchema);
    if (cursor) conditions.push(sql`(${items.position}, ${items.id}) > (${cursor[0]}, ${cursor[1]}::uuid)`);
    const rows = await ctx.db
      .select({ item: items })
      .from(items)
      .innerJoin(groups, eq(groups.id, items.groupId))
      .where(and(...conditions))
      .orderBy(asc(items.position), asc(items.id))
      .limit(query.limit + 1);
    const page = toPage(
      rows.map((row) => row.item),
      query.limit,
      (row) => encodeCursor([row.position, row.id]),
    );
    return { items: await hydrateItems(ctx, page.items, boardColumns), nextCursor: page.nextCursor };
  }

  const cursor = decodeCursor(query.cursor, boardCursorSchema);
  if (cursor) {
    conditions.push(
      sql`(${groups.position}, ${items.position}, ${items.id}) > (${cursor[0]}, ${cursor[1]}, ${cursor[2]}::uuid)`,
    );
  }
  const rows = await ctx.db
    .select({ item: items, groupPosition: groups.position })
    .from(items)
    .innerJoin(groups, eq(groups.id, items.groupId))
    .where(and(...conditions))
    .orderBy(asc(groups.position), asc(items.position), asc(items.id))
    .limit(query.limit + 1);
  const page = toPage(rows, query.limit, (row) =>
    encodeCursor([row.groupPosition, row.item.position, row.item.id]),
  );
  return {
    items: await hydrateItems(
      ctx,
      page.items.map((row) => row.item),
      boardColumns,
    ),
    nextCursor: page.nextCursor,
  };
}

export async function countBoardItems(ctx: ServiceContext, boardId: string): Promise<number> {
  const [row] = await ctx.db
    .select({ total: count() })
    .from(items)
    .innerJoin(groups, eq(groups.id, items.groupId))
    .where(
      and(
        eq(items.boardId, boardId),
        eq(items.orgId, ctx.orgId),
        isNull(items.parentItemId),
        isNull(items.deletedAt),
        isNull(items.archivedAt),
        isNull(groups.archivedAt),
        isNull(groups.deletedAt),
      ),
    );
  return row?.total ?? 0;
}

export async function getItem(ctx: ServiceContext, itemId: string): Promise<ItemDto> {
  const { item } = await requireItem(ctx, itemId, 'read', { includeDeleted: true });
  const [dto] = await hydrateMixedItems(ctx, [item]);
  if (!dto) throw new NotFoundError('Item');
  return dto;
}

export async function listSubitems(ctx: ServiceContext, parentItemId: string): Promise<ItemDto[]> {
  const { item } = await requireItem(ctx, parentItemId, 'read');
  const rows = await ctx.db
    .select()
    .from(items)
    .where(
      and(
        eq(items.parentItemId, parentItemId),
        eq(items.orgId, ctx.orgId),
        isNull(items.deletedAt),
        isNull(items.archivedAt),
      ),
    )
    .orderBy(asc(items.position), asc(items.id));
  const subColumns = (await loadBoardColumns(ctx, item.boardId)).filter(
    (column) => column.scope === 'subitem',
  );
  return hydrateItems(ctx, rows, subColumns);
}

/** Connected items in both directions, limited to boards the caller can see. */
export async function listLinkedItems(ctx: ServiceContext, itemId: string): Promise<LinkedItemDto[]> {
  await requireItem(ctx, itemId, 'read');
  const outgoing = await ctx.db
    .select({
      id: items.id,
      name: items.name,
      boardId: items.boardId,
      boardName: boards.name,
      columnKey: itemLinks.columnKey,
    })
    .from(itemLinks)
    .innerJoin(items, eq(items.id, itemLinks.toItemId))
    .innerJoin(boards, eq(boards.id, items.boardId))
    .where(and(eq(itemLinks.fromItemId, itemId), eq(itemLinks.orgId, ctx.orgId), isNull(items.deletedAt)))
    .orderBy(asc(itemLinks.position));
  const incoming = await ctx.db
    .select({
      id: items.id,
      name: items.name,
      boardId: items.boardId,
      boardName: boards.name,
      columnKey: itemLinks.columnKey,
    })
    .from(itemLinks)
    .innerJoin(items, eq(items.id, itemLinks.fromItemId))
    .innerJoin(boards, eq(boards.id, items.boardId))
    .where(and(eq(itemLinks.toItemId, itemId), eq(itemLinks.orgId, ctx.orgId), isNull(items.deletedAt)));
  const visible = new Set(
    await filterVisibleBoardIds(ctx, [...new Set([...outgoing, ...incoming].map((row) => row.boardId))]),
  );
  const seen = new Set<string>();
  const result: LinkedItemDto[] = [];
  for (const row of outgoing) {
    if (!visible.has(row.boardId)) continue;
    seen.add(`${row.id}:${row.columnKey}`);
    result.push({ ...row, direction: 'outgoing' });
  }
  for (const row of incoming) {
    if (!visible.has(row.boardId) || seen.has(`${row.id}:${row.columnKey}`)) continue;
    result.push({ ...row, direction: 'incoming' });
  }
  return result;
}

export async function getItemDetail(ctx: ServiceContext, itemId: string): Promise<ItemDetailDto> {
  const { item, board } = await requireItem(ctx, itemId, 'read', { includeDeleted: true });
  const boardColumns = await loadBoardColumns(ctx, board.id);
  const scope = item.parentItemId ? 'subitem' : 'item';
  const [hydrated, [group], subitems, linkedItems] = await concurrently(ctx, [
    () =>
      hydrateItems(
        ctx,
        [item],
        boardColumns.filter((column) => column.scope === scope),
      ),
    () => ctx.db.select().from(groups).where(eq(groups.id, item.groupId)).limit(1),
    () => (item.parentItemId || item.deletedAt ? Promise.resolve([]) : listSubitems(ctx, item.id)),
    () => (item.deletedAt ? Promise.resolve([]) : listLinkedItems(ctx, item.id)),
  ]);
  const dto = hydrated[0];
  if (!dto) throw new NotFoundError('Item');
  return {
    item: dto,
    board: toBoardSummaryDto(board),
    columns: boardColumns.map(toColumnDto) as ColumnDto[],
    group: group ? toGroupDto(group) : null,
    subitems,
    linkedItems,
  };
}
