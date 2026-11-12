/**
 * Read-side helpers that turn stored / computed cell values into what the views plot:
 * label ids, date ranges, numbers and people. Pure; shared by every board view.
 */
import { labelsFromSettings } from '@/features/cells';
import { toLabelColor, type LabelColor } from '@/components/ui/label-color';
import type { Label } from '@/server/db/schema/column-types';
import type { ColumnDto, GroupDto, ItemDto } from '@/server/services/contracts/dto';
import { isIsoDate, type IsoDate } from './dates';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const GROUP_KEY = '__group';

export function cellOf(item: Pick<ItemDto, 'values' | 'computed'>, columnKey: string): unknown {
  return item.values[columnKey] ?? item.computed[columnKey];
}

export function columnLabels(column: ColumnDto | undefined): Label[] {
  return column ? labelsFromSettings(column.settings) : [];
}

export function statusLabelId(value: unknown): string | null {
  return isRecord(value) && typeof value.labelId === 'string' ? value.labelId : null;
}

export function dropdownLabelIds(value: unknown): string[] {
  return isRecord(value) && Array.isArray(value.labelIds)
    ? value.labelIds.filter((id): id is string => typeof id === 'string')
    : [];
}

export function peopleIds(value: unknown): string[] {
  return isRecord(value) && Array.isArray(value.ids) ? value.ids.filter((id): id is string => typeof id === 'string') : [];
}

/** Numeric value of number / currency / rating / progress / formula / mirror cells. */
export function numericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!isRecord(value)) return null;
  if (typeof value.amount === 'number' && Number.isFinite(value.amount)) return value.amount;
  if (typeof value.result === 'number' && Number.isFinite(value.result)) return value.result;
  if (Array.isArray(value.values)) {
    const numbers = value.values.filter((entry): entry is number => typeof entry === 'number');
    return numbers.length ? numbers.reduce((sum, entry) => sum + entry, 0) : null;
  }
  return null;
}

export interface DateRange {
  readonly start: IsoDate;
  readonly end: IsoDate;
  readonly time?: string;
}

/** Start/end of a date or timeline cell (date cells are one-day ranges). */
export function dateRangeOf(value: unknown): DateRange | null {
  if (!isRecord(value)) return null;
  if (isIsoDate(value.date)) {
    const date = value.date.slice(0, 10);
    return { start: date, end: date, ...(typeof value.time === 'string' && { time: value.time }) };
  }
  if (isIsoDate(value.from) && isIsoDate(value.to)) {
    const from = value.from.slice(0, 10);
    const to = value.to.slice(0, 10);
    return from <= to ? { start: from, end: to } : { start: to, end: from };
  }
  if (isIsoDate(value.at)) return { start: value.at.slice(0, 10), end: value.at.slice(0, 10) };
  return null;
}

export const DATE_COLUMN_TYPES = new Set(['date', 'timeline', 'last_updated', 'creation_log']);
export const WRITABLE_DATE_TYPES = new Set(['date', 'timeline']);
export const NUMERIC_COLUMN_TYPES = new Set(['number', 'currency', 'rating', 'formula', 'mirror', 'progress']);
export const LABEL_COLUMN_TYPES = new Set(['status', 'dropdown']);

/** The value to store when an item is rescheduled to [start, end]. */
export function rescheduledValue(column: ColumnDto, previous: unknown, start: IsoDate, end: IsoDate): unknown {
  if (column.type === 'timeline') return { from: start, to: end < start ? start : end };
  const time = isRecord(previous) && typeof previous.time === 'string' ? previous.time : undefined;
  return time ? { date: start, time } : { date: start };
}

export interface ColorSource {
  readonly kind: 'group' | 'column' | 'none';
  readonly column?: ColumnDto;
}

export function resolveColorSource(columns: readonly ColumnDto[], colorBy: string | null | undefined): ColorSource {
  if (colorBy === 'none') return { kind: 'none' };
  if (!colorBy || colorBy === GROUP_KEY) return { kind: 'group' };
  const column = columns.find((entry) => entry.key === colorBy && LABEL_COLUMN_TYPES.has(entry.type));
  return column ? { kind: 'column', column } : { kind: 'group' };
}

/** Palette color of an item under a color-by setting (status label, group or the default blue). */
export function itemColor(
  item: ItemDto,
  source: ColorSource,
  groups: readonly GroupDto[],
): { color: LabelColor; label: string | null } {
  if (source.kind === 'column' && source.column) {
    const raw = cellOf(item, source.column.key);
    const id = source.column.type === 'dropdown' ? dropdownLabelIds(raw)[0] : statusLabelId(raw);
    const label = columnLabels(source.column).find((entry) => entry.id === id);
    return label ? { color: label.color, label: label.name || null } : { color: 'gray', label: null };
  }
  if (source.kind === 'group') {
    const group = groups.find((entry) => entry.id === item.groupId);
    return { color: toLabelColor(group?.color, 'blue'), label: group?.title ?? null };
  }
  return { color: 'blue', label: null };
}

const COMPACT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

/** "$1.2M" / "1.2K" — compact, locale-formatted. */
export function formatCompact(value: number, currency?: string | null): string {
  if (!currency) return COMPACT.format(value);
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    return COMPACT.format(value);
  }
}

export function formatFull(value: number, currency?: string | null): string {
  if (!currency) return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return String(value);
  }
}

/** Currency code a column formats with (currency columns only). */
export function columnCurrency(column: ColumnDto | undefined): string | null {
  if (!column || column.type !== 'currency') return null;
  const settings = column.settings as { currency?: unknown };
  return typeof settings.currency === 'string' ? settings.currency : 'USD';
}

/** Item terminology helpers ("Deal" → "deals"). */
export function pluralNoun(noun: string, count: number): string {
  const lower = noun.toLowerCase();
  if (count === 1) return lower;
  if (/(s|x|ch|sh)$/.test(lower)) return `${lower}es`;
  if (/[^aeiou]y$/.test(lower)) return `${lower.slice(0, -1)}ies`;
  return `${lower}s`;
}
