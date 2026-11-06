/**
 * Board export to CSV / XLSX. Respects the caller's view (filters, search, person filter,
 * sort, hidden columns, column order), can scope to a group or a selection, and optionally
 * includes subitems (a second sheet in XLSX, a trailing section in CSV).
 */
import 'server-only';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { items } from '@/server/db/schema';
import { toCsv, UTF8_BOM, type CsvCell } from '@/features/import-export/lib/csv';
import { cellText, exportFileName, projectItems, projectSubitems, type ExportTable } from '@/features/import-export/lib/export-format';
import { applyViewToItems, visibleColumns, type ExportViewConfig } from '@/features/import-export/lib/view-filter';
import { buildXlsx, XLSX_MIME } from '@/features/import-export/lib/xlsx-writer';
import { BadRequestError } from '@/server/http/errors';
import { requireBoard } from './access';
import { listOrgUsers } from './boards';
import type { ServiceContext } from './context';
import type { ItemDto } from './contracts/dto';
import { listGroups } from './groups';
import { hydrateItems, listBoardItems, loadBoardColumns } from './item-reads';
import { toColumnDto } from './mappers';
import type { ExportInput } from './import-export-contracts';

export const EXPORT_MAX_ITEMS = 50_000;

export interface ExportFile {
  readonly fileName: string;
  readonly contentType: string;
  readonly body: Uint8Array;
  readonly rowCount: number;
  readonly boardName: string;
}

async function loadAllItems(ctx: ServiceContext, boardId: string, groupId?: string): Promise<ItemDto[]> {
  const all: ItemDto[] = [];
  let cursor: string | undefined;
  do {
    const page = await listBoardItems(ctx, boardId, { limit: 500, cursor, state: 'active', groupId });
    all.push(...page.items);
    cursor = page.nextCursor ?? undefined;
    if (all.length > EXPORT_MAX_ITEMS) {
      throw new BadRequestError(`Boards larger than ${EXPORT_MAX_ITEMS.toLocaleString('en-US')} items can't be exported at once. Filter the view first.`);
    }
  } while (cursor);
  return all;
}

async function loadLinkedNames(ctx: ServiceContext, list: readonly ItemDto[]): Promise<Map<string, string>> {
  const ids = new Set<string>();
  for (const item of list) {
    for (const value of Object.values(item.values) as unknown[]) {
      const linked = (value as { itemIds?: unknown } | null)?.itemIds;
      if (Array.isArray(linked)) for (const id of linked) if (typeof id === 'string') ids.add(id);
    }
  }
  const names = new Map<string, string>();
  const all = [...ids];
  for (let start = 0; start < all.length; start += 1_000) {
    const rows = await ctx.db
      .select({ id: items.id, name: items.name })
      .from(items)
      .where(and(eq(items.orgId, ctx.orgId), inArray(items.id, all.slice(start, start + 1_000))));
    for (const row of rows) names.set(row.id, row.name);
  }
  return names;
}

function toCsvRows(table: ExportTable): CsvCell[][] {
  return [table.header, ...table.rows.map((row) => row.map((cell) => cellText(cell)))];
}

export async function exportBoard(ctx: ServiceContext, input: ExportInput): Promise<ExportFile> {
  const board = await requireBoard(ctx, input.boardId, 'read');
  const columnRows = await loadBoardColumns(ctx, board.id);
  const allColumns = columnRows.map(toColumnDto);
  const itemColumns = allColumns.filter((column) => column.scope === 'item');
  const config = input.viewConfig as ExportViewConfig | undefined;
  const [groupsList, users, loaded] = [
    await listGroups(ctx, board.id),
    await listOrgUsers(ctx),
    await loadAllItems(ctx, board.id, input.groupId),
  ];
  const userMap = new Map(users.map((user) => [user.id, user]));
  const selected = input.itemIds?.length ? loaded.filter((item) => input.itemIds?.includes(item.id)) : loaded;
  const baseCtx = { users: userMap };
  const filtered = applyViewToItems(selected, itemColumns, config, baseCtx);

  let subitems: ItemDto[] = [];
  const subColumns = allColumns.filter((column) => column.scope === 'subitem');
  if (input.includeSubitems && filtered.length) {
    const parentIds = filtered.map((item) => item.id);
    for (let start = 0; start < parentIds.length; start += 1_000) {
      const rows = await ctx.db
        .select()
        .from(items)
        .where(
          and(
            eq(items.orgId, ctx.orgId),
            eq(items.boardId, board.id),
            isNotNull(items.parentItemId),
            inArray(items.parentItemId, parentIds.slice(start, start + 1_000)),
            isNull(items.deletedAt),
            isNull(items.archivedAt),
          ),
        )
        .orderBy(items.position);
      subitems.push(...(await hydrateItems(ctx, rows, columnRows.filter((column) => column.scope === 'subitem'))));
    }
    const order = new Map(parentIds.map((id, index) => [id, index]));
    subitems = subitems.sort((a, b) => (order.get(a.parentItemId ?? '') ?? 0) - (order.get(b.parentItemId ?? '') ?? 0));
  }

  const linkedNames = await loadLinkedNames(ctx, [...filtered, ...subitems]);
  const exportCtx = { users: userMap, linkedNames };
  const table = projectItems(
    { columns: visibleColumns(itemColumns, config), items: filtered, groups: groupsList, ctx: exportCtx },
    board.itemTerminology,
  );
  const parents = new Map(filtered.map((item) => [item.id, item.name]));
  const subTable = input.includeSubitems ? projectSubitems(subColumns, subitems, parents, exportCtx) : null;

  if (input.format === 'xlsx') {
    const sheets = [{ name: board.name, rows: [table.header, ...table.rows] }];
    if (subTable) sheets.push({ name: 'Subitems', rows: [subTable.header, ...subTable.rows] });
    return {
      fileName: exportFileName(board.name, 'xlsx'),
      contentType: XLSX_MIME,
      body: buildXlsx(sheets),
      rowCount: filtered.length,
      boardName: board.name,
    };
  }
  const blocks = [toCsv(toCsvRows(table))];
  if (subTable && subTable.rows.length) blocks.push('', toCsv(toCsvRows(subTable)));
  return {
    fileName: exportFileName(board.name, 'csv'),
    contentType: 'text/csv; charset=utf-8',
    body: new TextEncoder().encode(UTF8_BOM + blocks.join('\r\n')),
    rowCount: filtered.length,
    boardName: board.name,
  };
}
