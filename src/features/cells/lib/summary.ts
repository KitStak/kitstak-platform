/**
 * Group-footer summary math, per column type (pure; the UI lives in cell-summary.tsx).
 */
import type { Label, LabelColor } from '@/server/db/schema/column-types';
import type { ColumnDto, ItemDto } from '@/server/services/contracts/dto';
import { dropdownLabelIds, labelsFromSettings, statusLabelId } from './labels';
import {
  computeProgress,
  isCellEmpty,
  rawCellValue,
  readCurrency,
  readDate,
  readFormula,
  readNumber,
  readPeople,
  readTimeline,
  isRecord,
} from './values';

export type NumericFn = 'sum' | 'average' | 'median' | 'min' | 'max' | 'count' | 'none';
export const NUMERIC_FNS: readonly NumericFn[] = ['sum', 'average', 'median', 'min', 'max', 'count', 'none'];
export const NUMERIC_FN_LABELS: Readonly<Record<NumericFn, string>> = {
  sum: 'Sum',
  average: 'Average',
  median: 'Median',
  min: 'Min',
  max: 'Max',
  count: 'Count',
  none: 'None',
};

export function numericSummary(values: readonly number[], fn: NumericFn): number | null {
  if (fn === 'none') return null;
  if (fn === 'count') return values.length;
  if (values.length === 0) return fn === 'sum' ? 0 : null;
  switch (fn) {
    case 'sum':
      return values.reduce((total, value) => total + value, 0);
    case 'average':
      return values.reduce((total, value) => total + value, 0) / values.length;
    case 'min':
      return Math.min(...values);
    case 'max':
      return Math.max(...values);
    case 'median': {
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? (sorted[mid] ?? null) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
    }
    default:
      return null;
  }
}

export interface BatterySegment {
  readonly id: string;
  readonly name: string;
  readonly color: LabelColor;
  readonly count: number;
  /** 0–100, rounded to one decimal. */
  readonly percent: number;
  readonly isDone: boolean;
}

export interface BatterySummary {
  readonly total: number;
  readonly segments: readonly BatterySegment[];
  readonly doneCount: number;
}

function toSegments(counts: ReadonlyMap<string, number>, labels: readonly Label[], total: number, empty: number): BatterySegment[] {
  const pct = (count: number) => (total ? Math.round((count / total) * 1000) / 10 : 0);
  const segments: BatterySegment[] = labels
    .filter((label) => !label.isDefault && (counts.get(label.id) ?? 0) > 0)
    .map((label) => {
      const count = counts.get(label.id) ?? 0;
      return { id: label.id, name: label.name, color: label.color, count, percent: pct(count), isDone: label.isDone === true };
    });
  if (empty > 0) {
    segments.push({ id: '__empty__', name: 'Empty', color: 'gray', count: empty, percent: pct(empty), isDone: false });
  }
  return segments;
}

/** Stacked label distribution for status / dropdown columns (board order, empty last). */
export function batterySummary(column: Pick<ColumnDto, 'key' | 'type' | 'settings'>, items: readonly Pick<ItemDto, 'values'>[]): BatterySummary {
  const labels = labelsFromSettings(column.settings);
  const known = new Set(labels.map((label) => label.id));
  const counts = new Map<string, number>();
  let empty = 0;
  let units = 0;
  for (const item of items) {
    const value = item.values[column.key];
    const ids = column.type === 'status' ? [statusLabelId(value)].filter((id): id is string => id !== null) : dropdownLabelIds(value);
    const valid = ids.filter((id) => known.has(id));
    if (valid.length === 0) {
      empty += 1;
      units += 1;
      continue;
    }
    for (const id of valid) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
      units += 1;
    }
  }
  const total = column.type === 'status' ? items.length : units;
  const segments = toSegments(counts, labels, total, empty);
  return { total, segments, doneCount: segments.filter((segment) => segment.isDone).reduce((n, s) => n + s.count, 0) };
}

export function checkboxSummary(columnKey: string, items: readonly Pick<ItemDto, 'values'>[]): { checked: number; total: number } {
  return { checked: items.filter((item) => item.values[columnKey] === true).length, total: items.length };
}

/** Numbers to aggregate for number-ish columns (number, currency, rating, progress, formula, mirror). */
export function numericValues(
  column: Pick<ColumnDto, 'key' | 'type' | 'settings'>,
  items: readonly ItemDto[],
  columns: readonly Pick<ColumnDto, 'key' | 'type' | 'settings'>[] = [],
): number[] {
  const out: number[] = [];
  for (const item of items) {
    const raw = rawCellValue(column, item);
    let value: number | null = null;
    if (column.type === 'currency') value = readCurrency(raw)?.amount ?? null;
    else if (column.type === 'progress')
      value = columns.length ? computeProgress(column, item, columns) : readNumber(raw);
    else if (column.type === 'formula') {
      const result = readFormula(raw).result;
      value = typeof result === 'number' ? result : null;
    } else if (column.type === 'mirror') {
      const values = isRecord(raw) && Array.isArray(raw.values) ? raw.values : [];
      const numbers = values
        .map((entry) => (typeof entry === 'number' ? entry : isRecord(entry) && typeof entry.amount === 'number' ? entry.amount : null))
        .filter((entry): entry is number => entry !== null);
      value = numbers.length ? numbers.reduce((a, b) => a + b, 0) : null;
    } else if (column.type === 'rating') value = readNumber(raw) || null;
    else value = readNumber(raw);
    if (value !== null && Number.isFinite(value)) out.push(value);
  }
  return out;
}

/**
 * Mirror columns only aggregate numerically when the mirrored values ARE numbers (a mirrored
 * number / currency column). Text, label or date sources fall back to a filled count.
 */
export function mirrorIsNumeric(column: Pick<ColumnDto, 'key' | 'type'>, items: readonly ItemDto[]): boolean {
  let numeric = 0;
  for (const item of items) {
    const raw = rawCellValue(column, item);
    const values = isRecord(raw) && Array.isArray(raw.values) ? raw.values : [];
    for (const entry of values) {
      if (entry === null || entry === undefined || entry === '') continue;
      if (typeof entry === 'number' && Number.isFinite(entry)) numeric += 1;
      else if (isRecord(entry) && typeof entry.amount === 'number') numeric += 1;
      else return false;
    }
  }
  return numeric > 0;
}

/** Earliest → latest across date / timeline cells. */
export function dateRangeSummary(column: Pick<ColumnDto, 'key' | 'type'>, items: readonly Pick<ItemDto, 'values'>[]): { from: string; to: string; count: number } | null {
  let from: string | null = null;
  let to: string | null = null;
  let count = 0;
  for (const item of items) {
    const value = item.values[column.key];
    const range =
      column.type === 'timeline'
        ? readTimeline(value)
        : (() => {
            const date = readDate(value);
            return date ? { from: date.date, to: date.date } : null;
          })();
    if (!range) continue;
    count += 1;
    if (from === null || range.from < from) from = range.from;
    if (to === null || range.to > to) to = range.to;
  }
  return from && to ? { from, to, count } : null;
}

/** Distinct people ids, most-assigned first. */
export function peopleSummary(columnKey: string, items: readonly Pick<ItemDto, 'values'>[]): { id: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const id of readPeople(item.values[columnKey]).ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count);
}

export function countSummary(column: Pick<ColumnDto, 'key' | 'type'>, items: readonly ItemDto[]): { filled: number; total: number } {
  const filled = items.filter((item) => !isCellEmpty(column.type, rawCellValue(column, item))).length;
  return { filled, total: items.length };
}
