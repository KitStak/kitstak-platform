/**
 * Plain-text projection of a cell (search, "contains" filters, CSV export, copy, auto-fit)
 * and a sortable key. Pure and client-safe.
 */
import type { ColumnDto, ItemDto, UserSummaryDto } from '@/server/services/contracts/dto';
import type { Label } from '@/server/db/schema/column-types';

export type UsersById = ReadonlyMap<string, Pick<UserSummaryDto, 'id' | 'name'>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function columnLabels(column: Pick<ColumnDto, 'settings'>): Label[] {
  const labels = (column.settings as { labels?: unknown } | null)?.labels;
  return Array.isArray(labels) ? (labels as Label[]) : [];
}

/** Raw value of a column on an item (stored value, computed value, or the name). */
export function cellRaw(
  column: Pick<ColumnDto, 'key' | 'type'>,
  item: Pick<ItemDto, 'name' | 'values' | 'computed'>,
): unknown {
  if (column.type === 'name') return item.name;
  const stored = item.values[column.key];
  if (stored !== undefined) return stored;
  return item.computed?.[column.key];
}

function numberText(
  value: number,
  settings: { unit?: string; unitPosition?: string; decimals?: number },
): string {
  const text = value.toLocaleString('en-US', { maximumFractionDigits: settings.decimals ?? 2 });
  if (!settings.unit) return text;
  return settings.unitPosition === 'prefix' ? `${settings.unit}${text}` : `${text}${settings.unit}`;
}

function idsText(ids: unknown, users: UsersById): string {
  if (!Array.isArray(ids)) return '';
  return ids
    .map((id) => (typeof id === 'string' ? (users.get(id)?.name ?? '') : ''))
    .filter(Boolean)
    .join(', ');
}

/** Human-readable text of a cell. Empty string when the cell is empty. */
export function cellText(column: ColumnDto, item: ItemDto, users: UsersById = new Map()): string {
  const raw = cellRaw(column, item);
  if (raw === undefined || raw === null) return '';
  switch (column.type) {
    case 'name':
    case 'text':
    case 'long_text':
    case 'item_id':
      return String(raw);
    case 'status': {
      const id = isRecord(raw) ? raw.labelId : undefined;
      return columnLabels(column).find((label) => label.id === id)?.name ?? '';
    }
    case 'dropdown': {
      const ids = isRecord(raw) && Array.isArray(raw.labelIds) ? raw.labelIds : [];
      const labels = columnLabels(column);
      return ids
        .map((id) => labels.find((label) => label.id === id)?.name ?? '')
        .filter(Boolean)
        .join(', ');
    }
    case 'people':
      return isRecord(raw) ? idsText(raw.ids, users) : '';
    case 'date':
      return isRecord(raw) && typeof raw.date === 'string'
        ? `${raw.date}${raw.time ? ` ${String(raw.time)}` : ''}`
        : '';
    case 'timeline':
      return isRecord(raw) && typeof raw.from === 'string' ? `${raw.from} – ${String(raw.to ?? '')}` : '';
    case 'number':
    case 'rating':
    case 'progress':
      return typeof raw === 'number' ? numberText(raw, column.settings as Record<string, never>) : '';
    case 'currency': {
      if (!isRecord(raw) || typeof raw.amount !== 'number') return '';
      const currency = typeof raw.currency === 'string' ? raw.currency : 'USD';
      try {
        return raw.amount.toLocaleString('en-US', { style: 'currency', currency, maximumFractionDigits: 0 });
      } catch {
        return `${raw.amount} ${currency}`;
      }
    }
    case 'email':
      return isRecord(raw) ? String(raw.label || raw.email || '') : '';
    case 'phone':
      return isRecord(raw) ? String(raw.phone ?? '') : '';
    case 'link':
      return isRecord(raw) ? String(raw.text || raw.url || '') : '';
    case 'tags':
      return isRecord(raw) && Array.isArray(raw.tags)
        ? raw.tags.map((tag) => `#${String(tag)}`).join(' ')
        : '';
    case 'checkbox':
      return raw === true ? 'Checked' : '';
    case 'location':
      return isRecord(raw) ? String(raw.address ?? '') : '';
    case 'country':
      return isRecord(raw) ? String(raw.code ?? '') : '';
    case 'formula':
      return isRecord(raw) && raw.result !== null && raw.result !== undefined ? String(raw.result) : '';
    case 'mirror':
      return isRecord(raw) ? String(raw.display ?? '') : '';
    case 'last_updated':
    case 'creation_log':
      return isRecord(raw) && typeof raw.at === 'string' ? raw.at.slice(0, 10) : '';
    case 'files':
      return isRecord(raw) && Array.isArray(raw.fileIds) ? `${raw.fileIds.length} file(s)` : '';
    case 'connect_boards':
      return isRecord(raw) && Array.isArray(raw.itemIds) ? `${raw.itemIds.length} linked` : '';
    default:
      return '';
  }
}

export type SortKey = number | string | null;

/** A comparable key for sorting (null = empty, always sorted last). */
export function sortKey(column: ColumnDto, item: ItemDto, users: UsersById = new Map()): SortKey {
  const raw = cellRaw(column, item);
  if (raw === undefined || raw === null) return null;
  switch (column.type) {
    case 'status': {
      const id = isRecord(raw) ? raw.labelId : undefined;
      const label = columnLabels(column).find((entry) => entry.id === id);
      return label && !label.isDefault ? label.position : null;
    }
    case 'number':
    case 'rating':
    case 'progress':
      return typeof raw === 'number' ? raw : null;
    case 'currency':
      return isRecord(raw) && typeof raw.amount === 'number' ? raw.amount : null;
    case 'checkbox':
      return raw === true ? 1 : 0;
    case 'formula':
      if (isRecord(raw) && typeof raw.result === 'number') return raw.result;
      break;
    case 'date':
      return isRecord(raw) && typeof raw.date === 'string' ? `${raw.date}${String(raw.time ?? '')}` : null;
    case 'timeline':
      return isRecord(raw) && typeof raw.from === 'string' ? raw.from : null;
    case 'last_updated':
    case 'creation_log':
      return isRecord(raw) && typeof raw.at === 'string' ? raw.at : null;
    default:
      break;
  }
  const text = cellText(column, item, users).trim().toLowerCase();
  return text ? text : null;
}

export function compareKeys(a: SortKey, b: SortKey): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'en', { numeric: true });
}

/** CSV-escape one field (RFC 4180) and neutralise spreadsheet formula injection. */
export function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(columns: readonly ColumnDto[], items: readonly ItemDto[], users: UsersById): string {
  const header = columns.map((column) => csvField(column.title)).join(',');
  const rows = items.map((item) =>
    columns.map((column) => csvField(cellText(column, item, users))).join(','),
  );
  return [header, ...rows].join('\r\n');
}
