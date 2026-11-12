/**
 * Pure helpers for dashboard insights: value extraction, filtering, bucketing, aggregation.
 * No database access — `dashboards-insights.ts` loads the dataset and calls these.
 */
import type { Label } from '@/server/db/schema/cell-values';
import { cellToScalar } from './computed';
import type { ColumnDto, ItemDto, UserSummaryDto } from './contracts/dto';
import {
  GROUP_BY_BOARD,
  GROUP_BY_DATE,
  GROUP_BY_GROUP,
  type Aggregate,
  type DateBucket,
  type InsightFilters,
  type WidgetSettings,
} from './contracts/dashboard-insights';

export interface InsightGroup {
  readonly id: string;
  readonly boardId: string;
  readonly title: string;
  readonly color: string;
}

export interface InsightDataset {
  readonly boards: readonly { readonly id: string; readonly name: string }[];
  readonly columns: readonly ColumnDto[];
  readonly groups: readonly InsightGroup[];
  readonly items: readonly ItemDto[];
  readonly users: readonly UserSummaryDto[];
}

export interface DateRange {
  readonly from?: string;
  readonly to?: string;
}

const DAY_MS = 86_400_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function labelsOf(column: Pick<ColumnDto, 'settings'> | undefined): readonly Label[] {
  const settings: unknown = column?.settings;
  const list = isRecord(settings) ? settings.labels : undefined;
  return Array.isArray(list) ? (list as Label[]) : [];
}

export function columnFor(dataset: InsightDataset, boardId: string, key: string | undefined): ColumnDto | undefined {
  if (!key) return undefined;
  return dataset.columns.find((column) => column.boardId === boardId && column.key === key);
}

/** Numeric value of a cell (stored number/currency/rating, formula result or mirror sum). */
export function numericValue(item: ItemDto, column: ColumnDto | undefined): number | null {
  if (!column) return null;
  const computed: unknown = item.computed[column.key];
  if (computed !== undefined) {
    if (typeof computed === 'number') return computed;
    if (isRecord(computed)) {
      if (typeof computed.result === 'number') return computed.result;
      if (typeof computed.value === 'number') return computed.value;
      if (Array.isArray(computed.values)) {
        return computed.values.reduce<number>((sum, value) => sum + (typeof value === 'number' ? value : 0), 0);
      }
    }
    return null;
  }
  const scalar = cellToScalar(column, item.values[column.key]);
  return typeof scalar === 'number' && Number.isFinite(scalar) ? scalar : null;
}

const DATE_TYPES = new Set(['date', 'timeline', 'creation_log', 'last_updated']);

/** Date column a widget measures time with on a given board (explicit, else first date-like column). */
export function dateColumnFor(dataset: InsightDataset, boardId: string, settings: WidgetSettings): ColumnDto | undefined {
  const explicit = columnFor(dataset, boardId, settings.dateColumnKey);
  if (explicit && DATE_TYPES.has(explicit.type)) return explicit;
  const boardColumns = dataset.columns.filter((column) => column.boardId === boardId);
  return boardColumns.find((column) => column.type === 'date') ?? boardColumns.find((column) => column.type === 'timeline');
}

/** `YYYY-MM-DD` of an item on a date-like column; falls back to the item's creation date. */
export function itemDate(item: ItemDto, column: ColumnDto | undefined): string | null {
  if (!column) return item.createdAt.slice(0, 10);
  if (column.type === 'creation_log') return item.createdAt.slice(0, 10);
  if (column.type === 'last_updated') return item.updatedAt.slice(0, 10);
  const raw: unknown = item.values[column.key];
  if (!isRecord(raw)) return null;
  if (column.type === 'timeline') return typeof raw.from === 'string' ? raw.from.slice(0, 10) : null;
  return typeof raw.date === 'string' ? raw.date.slice(0, 10) : null;
}

/** Timeline span (`from`/`to`) or a single date as a zero-length span. */
export function itemSpan(item: ItemDto, column: ColumnDto | undefined): { from: string; to: string } | null {
  if (column?.type === 'timeline') {
    const raw: unknown = item.values[column.key];
    if (isRecord(raw) && typeof raw.from === 'string') {
      const to = typeof raw.to === 'string' ? raw.to : raw.from;
      return { from: raw.from.slice(0, 10), to: to.slice(0, 10) };
    }
    return null;
  }
  const date = itemDate(item, column);
  return date ? { from: date, to: date } : null;
}

export function peopleIds(item: ItemDto, columns: readonly ColumnDto[]): string[] {
  const ids = new Set<string>();
  for (const column of columns) {
    if (column.type !== 'people' || column.boardId !== item.boardId) continue;
    const raw: unknown = item.values[column.key];
    if (isRecord(raw) && Array.isArray(raw.ids)) {
      for (const id of raw.ids) if (typeof id === 'string') ids.add(id);
    }
  }
  return [...ids];
}

export function statusLabelId(item: ItemDto, columnKey: string): string {
  const raw: unknown = item.values[columnKey];
  return isRecord(raw) && typeof raw.labelId === 'string' ? raw.labelId : 'default';
}

export function inRange(date: string | null, range: DateRange): boolean {
  if (!range.from && !range.to) return true;
  if (!date) return false;
  if (range.from && date < range.from) return false;
  if (range.to && date > range.to) return false;
  return true;
}

/** Widget-level filters (board groups, status filter) plus dashboard filters (people, search). */
export function filterItems(
  dataset: InsightDataset,
  settings: WidgetSettings,
  filters: Pick<InsightFilters, 'personIds' | 'search'>,
): ItemDto[] {
  const search = filters.search?.trim().toLowerCase();
  const groupIds = settings.groupIds && settings.groupIds.length > 0 ? new Set(settings.groupIds) : null;
  return dataset.items.filter((item) => {
    if (groupIds && !groupIds.has(item.groupId)) return false;
    if (settings.filter) {
      const hit = settings.filter.labelIds.includes(statusLabelId(item, settings.filter.columnKey));
      if (settings.filter.exclude ? hit : !hit) return false;
    }
    if (search && !item.name.toLowerCase().includes(search)) return false;
    if (filters.personIds.length > 0) {
      const people = peopleIds(item, dataset.columns);
      if (!filters.personIds.some((id) => people.includes(id))) return false;
    }
    return true;
  });
}

export function filterByRange(
  dataset: InsightDataset,
  items: readonly ItemDto[],
  settings: WidgetSettings,
  range: DateRange,
): ItemDto[] {
  if (!range.from && !range.to) return [...items];
  return items.filter((item) => inRange(itemDate(item, dateColumnFor(dataset, item.boardId, settings)), range));
}

export function aggregate(values: readonly number[], fn: Aggregate, count: number): number {
  switch (fn) {
    case 'count':
      return count;
    case 'sum':
      return values.reduce((sum, value) => sum + value, 0);
    case 'average':
      return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    case 'median': {
      if (values.length === 0) return 0;
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
    }
    case 'min':
      return values.length ? Math.min(...values) : 0;
    case 'max':
      return values.length ? Math.max(...values) : 0;
  }
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Aggregate `items` by the widget's value column (count when there is none). */
export function aggregateItems(dataset: InsightDataset, items: readonly ItemDto[], settings: WidgetSettings): number {
  const fn: Aggregate = settings.valueColumnKey ? settings.aggregate : 'count';
  const values: number[] = [];
  for (const item of items) {
    const value = numericValue(item, columnFor(dataset, item.boardId, settings.valueColumnKey));
    if (value !== null) values.push(value);
  }
  return round2(aggregate(values, fn, items.length));
}

// ------------------------------------------------------------------------------------------------
// Dates
// ------------------------------------------------------------------------------------------------

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseIsoDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

export function addDays(value: string, days: number): string {
  return toIsoDate(new Date(parseIsoDate(value).getTime() + days * DAY_MS));
}

/** The period of equal length immediately before `range` (null for open-ended ranges). */
export function previousRange(range: DateRange): Required<DateRange> | null {
  if (!range.from || !range.to) return null;
  const days = Math.round((parseIsoDate(range.to).getTime() - parseIsoDate(range.from).getTime()) / DAY_MS) + 1;
  return { from: addDays(range.from, -days), to: addDays(range.from, -1) };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function bucketKey(date: string, bucket: DateBucket): string {
  if (bucket === 'month') return date.slice(0, 7);
  if (bucket === 'quarter') return `${date.slice(0, 4)}-Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;
  const day = parseIsoDate(date);
  const offset = (day.getUTCDay() + 6) % 7;
  return toIsoDate(new Date(day.getTime() - offset * DAY_MS));
}

export function bucketLabel(key: string, bucket: DateBucket): string {
  if (bucket === 'quarter') return `${key.slice(5)} ${key.slice(0, 4)}`;
  const month = MONTHS[Number(key.slice(5, 7)) - 1] ?? key;
  if (bucket === 'month') return `${month} ${key.slice(2, 4)}`;
  return `${month} ${Number(key.slice(8, 10))}`;
}

/** Consecutive bucket keys starting at `start` (an ISO date). */
export function bucketSequence(start: string, count: number, bucket: DateBucket): string[] {
  const keys: string[] = [];
  let cursor = parseIsoDate(start);
  for (let index = 0; index < count; index += 1) {
    const iso = toIsoDate(cursor);
    keys.push(bucketKey(iso, bucket));
    if (bucket === 'week') cursor = new Date(cursor.getTime() + 7 * DAY_MS);
    else {
      const step = bucket === 'month' ? 1 : 3;
      cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + step, 1));
    }
  }
  return keys;
}

export function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function addMonths(date: string, months: number): string {
  const parsed = parseIsoDate(date);
  return toIsoDate(new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + months, 1)));
}

// ------------------------------------------------------------------------------------------------
// Grouping
// ------------------------------------------------------------------------------------------------

export interface BucketRef {
  readonly key: string;
  readonly label: string;
  readonly order: number;
  readonly color?: string;
  readonly isDone?: boolean;
}

/** Buckets an item falls into for a group-by key (multi-value columns yield several). */
export function bucketsFor(
  dataset: InsightDataset,
  item: ItemDto,
  groupByKey: string | undefined,
  settings: WidgetSettings,
): BucketRef[] {
  if (!groupByKey) return [{ key: 'all', label: 'All items', order: 0 }];
  if (groupByKey === GROUP_BY_GROUP) {
    const group = dataset.groups.find((entry) => entry.id === item.groupId);
    return [{ key: item.groupId, label: group?.title ?? 'Group', order: 0, color: group?.color }];
  }
  if (groupByKey === GROUP_BY_BOARD) {
    const board = dataset.boards.find((entry) => entry.id === item.boardId);
    return [{ key: item.boardId, label: board?.name ?? 'Board', order: 0 }];
  }
  if (groupByKey === GROUP_BY_DATE) {
    const date = itemDate(item, dateColumnFor(dataset, item.boardId, settings));
    if (!date) return [{ key: 'none', label: 'No date', order: Number.MAX_SAFE_INTEGER }];
    const key = bucketKey(date, settings.dateBucket);
    return [{ key, label: bucketLabel(key, settings.dateBucket), order: 0 }];
  }
  return columnBuckets(dataset, item, columnFor(dataset, item.boardId, groupByKey));
}

function columnBuckets(dataset: InsightDataset, item: ItemDto, column: ColumnDto | undefined): BucketRef[] {
  if (!column) return [];
  const raw: unknown = item.values[column.key];
  if (column.type === 'status' || column.type === 'dropdown') {
    const labels = labelsOf(column);
    const ids =
      column.type === 'status'
        ? [isRecord(raw) && typeof raw.labelId === 'string' ? raw.labelId : 'default']
        : isRecord(raw) && Array.isArray(raw.labelIds)
          ? raw.labelIds.filter((id): id is string => typeof id === 'string')
          : [];
    return ids.map((id) => {
      const label = labels.find((entry) => entry.id === id);
      return {
        key: id,
        label: label?.name || 'Blank',
        order: label?.position ?? 999,
        color: label?.color ?? 'gray',
        isDone: Boolean((label as { isDone?: boolean } | undefined)?.isDone),
      };
    });
  }
  if (column.type === 'people') {
    const ids = isRecord(raw) && Array.isArray(raw.ids) ? raw.ids.filter((id): id is string => typeof id === 'string') : [];
    if (ids.length === 0) return [{ key: 'unassigned', label: 'Unassigned', order: Number.MAX_SAFE_INTEGER }];
    return ids.map((id) => ({
      key: id,
      label: dataset.users.find((person) => person.id === id)?.name ?? 'Former member',
      order: 0,
    }));
  }
  const scalar = cellToScalar(column, raw);
  const label = scalar === null || scalar === '' ? 'Blank' : String(scalar);
  return [{ key: label, label, order: label === 'Blank' ? Number.MAX_SAFE_INTEGER : 0 }];
}

/** Ordered columns of `dataset` that exist on every connected board, deduped by key. */
export function distinctColumns(dataset: InsightDataset, keys: readonly string[]): ColumnDto[] {
  const out: ColumnDto[] = [];
  for (const key of keys) {
    const column = dataset.columns.find((entry) => entry.key === key);
    if (column) out.push(column);
  }
  return out;
}
