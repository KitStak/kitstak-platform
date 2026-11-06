/**
 * Cell → export value projection (formatted text for CSV, typed cells for XLSX), plus the
 * board → table projection used by both export formats. Pure; runs on the server.
 */
import type { ColumnDto, GroupDto, ItemDto, UserSummaryDto } from '@/server/services/contracts/dto';
import { isComputedColumnType } from '@/server/db/schema/cell-values';
import type { XlsxCell } from './xlsx-writer';

type Rec = Record<string, unknown>;

function isRecord(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function labelName(column: ColumnDto, id: unknown): string {
  const labels = (column.settings as { labels?: { id: string; name: string }[] } | null)?.labels ?? [];
  return labels.find((label) => label.id === id)?.name ?? '';
}

export interface ExportContext {
  readonly users: ReadonlyMap<string, UserSummaryDto>;
  /** Item id → name (connect_boards targets loaded with the export). */
  readonly linkedNames?: ReadonlyMap<string, string>;
}

function computedValue(value: unknown): XlsxCell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return /^\d{4}-\d{2}-\d{2}$/.test(value) ? { date: value } : value;
  if (!isRecord(value)) return null;
  if ('display' in value && typeof value.display === 'string') return value.display;
  if ('result' in value) return computedValue(value.result);
  if ('value' in value) return computedValue(value.value);
  if (typeof value.at === 'string') return value.at.slice(0, 16).replace('T', ' ');
  return null;
}

/** Typed export value for a cell (XLSX keeps numbers/dates native). */
export function exportCell(column: ColumnDto, item: ItemDto, ctx: ExportContext): XlsxCell {
  if (column.type === 'name') return item.name;
  if (column.type === 'item_id') return item.id;
  if (isComputedColumnType(column.type) || column.key in item.computed) {
    return computedValue(item.computed[column.key]);
  }
  const value: unknown = item.values[column.key];
  if (value === null || value === undefined) return column.type === 'checkbox' ? false : null;
  switch (column.type) {
    case 'status':
      return isRecord(value) ? labelName(column, value.labelId) || null : null;
    case 'dropdown':
      return isRecord(value) ? strings(value.labelIds).map((id) => labelName(column, id)).filter(Boolean).join(', ') : null;
    case 'people':
      return isRecord(value)
        ? strings(value.ids).map((id) => ctx.users.get(id)?.name ?? '').filter(Boolean).join(', ')
        : null;
    case 'date':
      return isRecord(value) && typeof value.date === 'string'
        ? value.time
          ? `${value.date} ${String(value.time)}`
          : { date: value.date }
        : null;
    case 'timeline':
      return isRecord(value) ? `${String(value.from ?? '')} – ${String(value.to ?? '')}` : null;
    case 'number':
    case 'rating':
      return typeof value === 'number' ? value : null;
    case 'currency':
      return isRecord(value) && typeof value.amount === 'number'
        ? { number: value.amount, format: 'currency', symbol: String(value.currency ?? '') }
        : null;
    case 'email':
      return isRecord(value) ? String(value.email ?? '') : null;
    case 'phone':
      return isRecord(value) ? String(value.phone ?? '') : null;
    case 'link':
      return isRecord(value) ? String(value.url ?? '') : null;
    case 'tags':
      return isRecord(value) ? strings(value.tags).join(', ') : null;
    case 'checkbox':
      return value === true;
    case 'location':
      return isRecord(value) ? String(value.address ?? '') : null;
    case 'country':
      return isRecord(value) ? String(value.code ?? '') : null;
    case 'connect_boards':
      return isRecord(value)
        ? strings(value.itemIds).map((id) => ctx.linkedNames?.get(id) ?? '').filter(Boolean).join(', ')
        : null;
    case 'files':
      return isRecord(value) ? `${strings(value.fileIds).length} file(s)` : null;
    default:
      return typeof value === 'string' ? value : null;
  }
}

/** Plain text for CSV / search (currency keeps its code, dates are ISO). */
export function cellText(cell: XlsxCell): string {
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'boolean') return cell ? 'Yes' : 'No';
  if (typeof cell === 'number') return String(cell);
  if (typeof cell === 'string') return cell;
  if ('date' in cell) return cell.date;
  return cell.symbol ? `${cell.number} ${cell.symbol}` : String(cell.number);
}

export interface ExportTable {
  readonly header: string[];
  readonly rows: XlsxCell[][];
}

export interface ProjectionInput {
  readonly columns: readonly ColumnDto[];
  readonly items: readonly ItemDto[];
  readonly groups: readonly GroupDto[];
  readonly ctx: ExportContext;
}

/** Item table: name, group, every visible column (+ raw extras where useful). */
export function projectItems(input: ProjectionInput, terminology = 'Item'): ExportTable {
  const groupTitle = new Map(input.groups.map((group) => [group.id, group.title]));
  const nameColumn = input.columns.find((column) => column.type === 'name');
  const others = input.columns.filter((column) => column.type !== 'name' && column.type !== 'button');
  const header: string[] = [nameColumn?.title || terminology, 'Group'];
  for (const column of others) {
    header.push(column.title);
    if (column.type === 'currency') header.push(`${column.title} (currency)`);
    if (column.type === 'people') header.push(`${column.title} (emails)`);
  }
  const rows = input.items.map((item) => {
    const row: XlsxCell[] = [item.name, groupTitle.get(item.groupId) ?? ''];
    for (const column of others) {
      const cell = exportCell(column, item, input.ctx);
      if (column.type === 'currency') {
        row.push(cell && typeof cell === 'object' && 'number' in cell ? { number: cell.number, format: 'decimal' } : null);
        row.push(cell && typeof cell === 'object' && 'symbol' in cell ? (cell.symbol ?? null) : null);
        continue;
      }
      row.push(cell);
      if (column.type === 'people') {
        const value = item.values[column.key] as unknown;
        row.push(
          isRecord(value) ? strings(value.ids).map((id) => input.ctx.users.get(id)?.email ?? '').filter(Boolean).join(', ') : null,
        );
      }
    }
    return row;
  });
  return { header, rows };
}

/** Subitem table with a leading "Parent item" column. */
export function projectSubitems(
  columns: readonly ColumnDto[],
  subitems: readonly ItemDto[],
  parents: ReadonlyMap<string, string>,
  ctx: ExportContext,
): ExportTable {
  const others = columns.filter((column) => column.type !== 'name' && column.type !== 'button');
  const header = ['Parent item', 'Subitem', ...others.map((column) => column.title)];
  const rows = subitems.map((item) => [
    parents.get(item.parentItemId ?? '') ?? '',
    item.name,
    ...others.map((column) => exportCell(column, item, ctx)),
  ]);
  return { header, rows };
}

export function exportFileName(boardName: string, extension: 'csv' | 'xlsx', now = new Date()): string {
  const safe = boardName.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Board';
  return `${safe} ${now.toISOString().slice(0, 10)}.${extension}`;
}
