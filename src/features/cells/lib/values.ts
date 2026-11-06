/**
 * Safe readers for stored / computed cell values (data arrives as `unknown` from jsonb), plus the
 * client-side progress computation used for instant (optimistic) progress bars.
 */
import type { ColumnType } from '@/server/db/schema/cell-values';
import type { ColumnDto, ItemDto } from '@/server/services/contracts/dto';
import { dropdownLabelIds, labelsFromSettings, statusLabelId } from './labels';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

/** Raw cell value (computed values win for computed columns). */
export function rawCellValue(column: Pick<ColumnDto, 'key' | 'type'>, item: Pick<ItemDto, 'values' | 'computed' | 'name'>): unknown {
  if (column.type === 'name') return item.name;
  if (column.key in item.computed) return item.computed[column.key];
  return item.values[column.key];
}

export interface DateCell {
  readonly date: string;
  readonly time?: string;
}
export function readDate(value: unknown): DateCell | null {
  if (!isRecord(value)) return null;
  const date = str(value, 'date');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const time = str(value, 'time');
  return time ? { date, time } : { date };
}

export function readTimeline(value: unknown): { from: string; to: string } | null {
  if (!isRecord(value)) return null;
  const from = str(value, 'from');
  const to = str(value, 'to');
  return from && to ? { from, to } : null;
}

export function readPeople(value: unknown): { ids: string[]; teamIds: string[] } {
  if (!isRecord(value)) return { ids: [], teamIds: [] };
  return { ids: strings(value.ids), teamIds: strings(value.teamIds) };
}

export function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function readCurrency(value: unknown): { amount: number; currency: string } | null {
  if (!isRecord(value) || typeof value.amount !== 'number') return null;
  return { amount: value.amount, currency: str(value, 'currency') ?? 'USD' };
}

export function readEmail(value: unknown): { email: string; label?: string } | null {
  if (!isRecord(value)) return null;
  const email = str(value, 'email');
  if (!email) return null;
  const label = str(value, 'label');
  return label ? { email, label } : { email };
}

export function readPhone(value: unknown): { phone: string; country?: string } | null {
  if (!isRecord(value)) return null;
  const phone = str(value, 'phone');
  if (!phone) return null;
  const country = str(value, 'country');
  return country ? { phone, country } : { phone };
}

export function readLink(value: unknown): { url: string; text?: string } | null {
  if (!isRecord(value)) return null;
  const url = str(value, 'url');
  if (!url) return null;
  const text = str(value, 'text');
  return text ? { url, text } : { url };
}

export function readTags(value: unknown): string[] {
  return isRecord(value) ? strings(value.tags) : [];
}

export function readIds(value: unknown, key: 'fileIds' | 'itemIds'): string[] {
  return isRecord(value) ? strings(value[key]) : [];
}

export function readLocation(value: unknown): { address: string; lat?: number; lng?: number } | null {
  if (!isRecord(value)) return null;
  const address = str(value, 'address');
  if (!address) return null;
  return {
    address,
    ...(typeof value.lat === 'number' && { lat: value.lat }),
    ...(typeof value.lng === 'number' && { lng: value.lng }),
  };
}

export function readCountry(value: unknown): string | null {
  return isRecord(value) ? (str(value, 'code') ?? null) : null;
}

export function readText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function readLog(value: unknown): { at: string; userId: string | null } | null {
  if (!isRecord(value)) return null;
  const at = str(value, 'at');
  if (!at) return null;
  return { at, userId: str(value, 'userId') ?? null };
}

export function readFormula(value: unknown): { result: number | string | boolean | null; error?: string } {
  if (!isRecord(value)) {
    return typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean'
      ? { result: value }
      : { result: null };
  }
  const result = value.result;
  const safe = typeof result === 'number' || typeof result === 'string' || typeof result === 'boolean' ? result : null;
  const error = str(value, 'error');
  return error ? { result: safe, error } : { result: safe };
}

export function readMirror(value: unknown): { display: string; values: unknown[] } {
  if (!isRecord(value)) return { display: typeof value === 'string' ? value : '', values: [] };
  return { display: str(value, 'display') ?? '', values: Array.isArray(value.values) ? value.values : [] };
}

/** True when the cell has nothing to show (drives empty-state affordances). */
export function isCellEmpty(type: ColumnType, value: unknown): boolean {
  switch (type) {
    case 'status':
      return statusLabelId(value) === null;
    case 'dropdown':
      return dropdownLabelIds(value).length === 0;
    case 'people': {
      const people = readPeople(value);
      return people.ids.length + people.teamIds.length === 0;
    }
    case 'date':
      return readDate(value) === null;
    case 'timeline':
      return readTimeline(value) === null;
    case 'number':
    case 'rating':
      return readNumber(value) === null || (type === 'rating' && value === 0);
    case 'currency':
      return readCurrency(value) === null;
    case 'tags':
      return readTags(value).length === 0;
    case 'files':
      return readIds(value, 'fileIds').length === 0;
    case 'connect_boards':
      return readIds(value, 'itemIds').length === 0;
    case 'checkbox':
      return value !== true;
    case 'text':
    case 'long_text':
    case 'name':
      return readText(value).trim().length === 0;
    case 'email':
      return readEmail(value) === null;
    case 'phone':
      return readPhone(value) === null;
    case 'link':
      return readLink(value) === null;
    case 'location':
      return readLocation(value) === null;
    case 'country':
      return readCountry(value) === null;
    default:
      return value === null || value === undefined;
  }
}

/**
 * Progress 0–100 from status/checkbox columns (mirrors the server's computed value, so the bar
 * moves the instant a status changes, before the server round-trip).
 */
export function computeProgress(
  column: Pick<ColumnDto, 'settings'>,
  item: Pick<ItemDto, 'values'>,
  columns: readonly Pick<ColumnDto, 'key' | 'type' | 'settings'>[],
): number {
  const settings: unknown = column.settings;
  const configured = isRecord(settings) ? strings(settings.sourceColumnKeys) : [];
  const sources = columns.filter(
    (candidate) =>
      (candidate.type === 'status' || candidate.type === 'checkbox') &&
      (configured.length === 0 || configured.includes(candidate.key)),
  );
  if (sources.length === 0) return 0;
  let done = 0;
  for (const source of sources) {
    const value = item.values[source.key];
    if (source.type === 'checkbox') {
      if (value === true) done += 1;
      continue;
    }
    const labelId = statusLabelId(value);
    if (labelsFromSettings(source.settings).some((label) => label.id === labelId && label.isDone)) done += 1;
  }
  return Math.round((done / sources.length) * 100);
}

/** Is this item "done" according to the board's status columns (any done label set)? */
export function isItemDone(
  item: Pick<ItemDto, 'values'>,
  columns: readonly Pick<ColumnDto, 'key' | 'type' | 'settings'>[],
): boolean {
  return columns.some((column) => {
    if (column.type !== 'status') return false;
    const labelId = statusLabelId(item.values[column.key]);
    return labelsFromSettings(column.settings).some((label) => label.id === labelId && label.isDone);
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every linked item id referenced by connect_boards values (`{ itemIds }`) of `items`, sorted. */
export function collectLinkedIds(items: readonly Pick<ItemDto, 'values'>[], max = 500): string[] {
  const ids = new Set<string>();
  for (const item of items) {
    for (const value of Object.values(item.values ?? {}) as unknown[]) {
      if (!isRecord(value) || !Array.isArray(value.itemIds)) continue;
      for (const id of strings(value.itemIds)) if (UUID_RE.test(id)) ids.add(id);
    }
  }
  return [...ids].sort().slice(0, max);
}

/**
 * Stable, human-friendly short ID for an item: 6 base-36 chars from a 32-bit FNV-1a hash of the
 * full id (e.g. "K3F9A2"). Values that are already short (numeric / per-board sequences) pass through.
 */
export function shortItemId(id: string): string {
  if (/^\d{1,9}$/.test(id) || id.length <= 8) return id.toLowerCase();
  // First 8 hex chars of the uuid: quotable, and the board search accepts it as a prefix.
  const hex = id.replace(/-/g, '').toLowerCase();
  return /^[0-9a-f]{8}/.test(hex) ? hex.slice(0, 8) : id.slice(0, 8).toLowerCase();
}
