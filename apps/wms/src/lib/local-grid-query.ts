/**
 * Evaluates the KitStaks grid query grammar (BUILD_PLAN 0.2) against in-memory rows, so a
 * client-side list (pickers, previews, /dev/ui) behaves exactly like a server grid.
 */
import type { GridFilter, GridQuery, SortSpec } from '@/server/query/grid-query';
import { resolveDateRange } from '@/server/query/date-presets';

export type FieldValue = string | number | boolean | null | undefined;

export interface LocalQueryOptions<T> {
  /** Reads a field (grid-query field name) from a row. */
  readonly get: (row: T, field: string) => FieldValue;
  /** Fields matched by quick search `q` (Equal / Starts With). */
  readonly searchFields: readonly string[];
  readonly now?: Date;
}

export interface LocalQueryResult<T> {
  readonly rows: readonly T[];
  readonly total: number;
}

function isBlank(value: FieldValue): boolean {
  return value === null || value === undefined || value === '';
}

function text(value: FieldValue): string {
  return isBlank(value) ? '' : String(value).toLowerCase();
}

function inRange(value: FieldValue, min?: string, max?: string): boolean {
  if (isBlank(value)) return false;
  const n = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(n)) return false;
  if (min !== undefined && min !== '' && n < Number(min)) return false;
  return !(max !== undefined && max !== '' && n > Number(max));
}

/** True when `value` satisfies one grid filter. */
export function matchesFilter(value: FieldValue, filter: GridFilter, now: Date = new Date()): boolean {
  switch (filter.op) {
    case 'in':
      return filter.values.some((v) => text(v) === text(value));
    case 'nin':
      return !filter.values.some((v) => text(v) === text(value));
    case 'eq':
      return text(value) === text(filter.value);
    case 'ct':
      return text(value).includes(text(filter.value));
    case 'sw':
      return text(value).startsWith(text(filter.value));
    case 'ew':
      return text(value).endsWith(text(filter.value));
    case 'ex':
      return !isBlank(value);
    case 'empty':
      return isBlank(value);
    case 'rng':
      return inRange(value, filter.min, filter.max);
    case 'bool':
      return Boolean(value) === filter.value;
    case 'date': {
      if (isBlank(value)) return false;
      const at = Date.parse(String(value));
      if (Number.isNaN(at)) return false;
      const range = resolveDateRange(filter.date, now);
      return (
        (range.from === null || at >= Date.parse(range.from)) &&
        (range.to === null || at <= Date.parse(range.to))
      );
    }
    default:
      return true;
  }
}

function compare(a: FieldValue, b: FieldValue): number {
  if (isBlank(a) && isBlank(b)) return 0;
  if (isBlank(a)) return 1;
  if (isBlank(b)) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

export function sortRows<T>(
  rows: readonly T[],
  sort: readonly SortSpec[],
  get: LocalQueryOptions<T>['get'],
): readonly T[] {
  if (sort.length === 0) return rows;
  return [...rows].sort((x, y) => {
    for (const spec of sort) {
      const result = compare(get(x, spec.field), get(y, spec.field));
      if (result !== 0) return spec.dir === 'asc' ? result : -result;
    }
    return 0;
  });
}

/** Filter → quick search → sort → page. Returns the page and the total match count. */
export function applyLocalGridQuery<T>(
  rows: readonly T[],
  query: GridQuery,
  options: LocalQueryOptions<T>,
): LocalQueryResult<T> {
  const now = options.now ?? new Date();
  const needle = query.q?.trim().toLowerCase() ?? '';
  const matched = rows.filter((row) => {
    if (!query.filters.every((filter) => matchesFilter(options.get(row, filter.field), filter, now)))
      return false;
    if (!needle) return true;
    return options.searchFields.some((field) => {
      const value = text(options.get(row, field));
      return query.qm === 'eq' ? value === needle : value.startsWith(needle);
    });
  });
  const sorted = sortRows(matched, query.sort, options.get);
  const start = (Math.max(1, query.page) - 1) * query.pageSize;
  return { rows: sorted.slice(start, start + query.pageSize), total: matched.length };
}
