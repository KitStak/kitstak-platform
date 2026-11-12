/**
 * Chart aggregation: X categories (labels / people / groups / date buckets), optional stack
 * series, Y = count or sum/avg/min/max of a numeric column. Each point keeps its item ids so the
 * chart can drill down into the matching items.
 */
import { colorForString, toLabelColor, type LabelColor } from '@/components/ui/label-color';
import type { ColumnDto, GroupDto, ItemDto, UserSummaryDto } from '@/server/services/contracts/dto';
import type { ChartAggregate, ChartSettings, ChartSort, DateBucket } from './config';
import { dateBucket } from './dates';
import { cellOf, columnLabels, dateRangeOf, dropdownLabelIds, GROUP_KEY, numericValue, peopleIds, statusLabelId } from './values';

export const NONE_KEY = '__none';

export interface Category {
  readonly key: string;
  readonly label: string;
  readonly color: LabelColor;
  /** Board order of the category (label position, group position, chronological bucket). */
  readonly order: number;
}

interface CategorizeContext {
  readonly columns: readonly ColumnDto[];
  readonly groups: readonly GroupDto[];
  readonly users: ReadonlyMap<string, UserSummaryDto>;
  readonly dateBucket: DateBucket;
}

/** Categories an item belongs to on a dimension (people / dropdown can yield several). */
export function categorize(item: ItemDto, dimension: string, ctx: CategorizeContext): Category[] {
  if (dimension === GROUP_KEY) {
    const index = ctx.groups.findIndex((group) => group.id === item.groupId);
    const group = ctx.groups[index];
    return [{ key: item.groupId, label: group?.title ?? 'Group', color: toLabelColor(group?.color, 'blue'), order: index }];
  }
  const column = ctx.columns.find((entry) => entry.key === dimension);
  const none: Category = { key: NONE_KEY, label: column ? `No ${column.title.toLowerCase()}` : 'None', color: 'gray', order: 9999 };
  if (!column) return [none];
  const raw = cellOf(item, column.key);
  if (column.type === 'status' || column.type === 'dropdown') {
    const labels = columnLabels(column);
    const ids = column.type === 'status' ? [statusLabelId(raw)].filter((id): id is string => Boolean(id)) : dropdownLabelIds(raw);
    const hits = ids
      .map((id) => labels.find((label) => label.id === id && !label.isDefault))
      .filter((label): label is NonNullable<typeof label> => Boolean(label))
      .map((label) => ({ key: label.id, label: label.name || 'Untitled', color: label.color, order: label.position }));
    return hits.length ? hits : [none];
  }
  if (column.type === 'people') {
    const ids = peopleIds(raw);
    if (ids.length === 0) return [{ ...none, label: 'Unassigned' }];
    return ids.map((id) => {
      const user = ctx.users.get(id);
      const name = user?.name ?? 'Unknown user';
      return { key: id, label: name, color: colorForString(id), order: 0 };
    });
  }
  const range = dateRangeOf(raw);
  if (range) {
    const bucket = dateBucket(range.start, ctx.dateBucket);
    return [{ key: bucket.key, label: bucket.label, color: 'blue', order: 0 }];
  }
  return [none];
}

export interface ChartPoint {
  readonly key: string;
  readonly label: string;
  readonly color: LabelColor;
  readonly value: number;
  readonly count: number;
  /** Stack key → aggregated value. */
  readonly stacks: Readonly<Record<string, number>>;
  readonly itemIds: readonly string[];
  readonly stackItemIds: Readonly<Record<string, readonly string[]>>;
}

export interface ChartSeries {
  readonly key: string;
  readonly label: string;
  readonly color: LabelColor;
}

export interface ChartData {
  readonly points: readonly ChartPoint[];
  readonly stacks: readonly ChartSeries[];
  readonly total: number;
  readonly itemCount: number;
}

function aggregate(values: readonly number[], fn: ChartAggregate, count: number): number {
  if (fn === 'count') return count;
  if (values.length === 0) return 0;
  switch (fn) {
    case 'sum':
      return values.reduce((sum, value) => sum + value, 0);
    case 'average':
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    case 'min':
      return Math.min(...values);
    case 'max':
      return Math.max(...values);
  }
}

interface Bucket {
  category: Category;
  itemIds: Set<string>;
  values: number[];
  stacks: Map<string, { series: Category; values: number[]; itemIds: Set<string> }>;
}

function sortPoints(points: ChartPoint[], categories: Map<string, Category>, sort: ChartSort, isDate: boolean): ChartPoint[] {
  const order = (point: ChartPoint) => categories.get(point.key)?.order ?? 0;
  const copy = [...points];
  switch (sort) {
    case 'value_desc':
      return copy.sort((a, b) => b.value - a.value);
    case 'value_asc':
      return copy.sort((a, b) => a.value - b.value);
    case 'name_asc':
      return copy.sort((a, b) => a.label.localeCompare(b.label));
    case 'name_desc':
      return copy.sort((a, b) => b.label.localeCompare(a.label));
    default:
      return copy.sort((a, b) => {
        if (a.key === NONE_KEY) return 1;
        if (b.key === NONE_KEY) return -1;
        if (isDate) return a.key < b.key ? -1 : 1;
        return order(a) - order(b) || a.label.localeCompare(b.label);
      });
  }
}

export function buildChartData(
  items: readonly ItemDto[],
  settings: Pick<ChartSettings, 'xColumnKey' | 'yColumnKey' | 'aggregate' | 'stackColumnKey' | 'sort' | 'dateBucket' | 'hideEmpty' | 'cumulative' | 'colors'>,
  context: { columns: readonly ColumnDto[]; groups: readonly GroupDto[]; users: readonly UserSummaryDto[] },
): ChartData {
  const ctx: CategorizeContext = {
    columns: context.columns,
    groups: context.groups,
    users: new Map(context.users.map((user) => [user.id, user])),
    dateBucket: settings.dateBucket,
  };
  const fn: ChartAggregate = settings.yColumnKey ? settings.aggregate : 'count';
  const buckets = new Map<string, Bucket>();
  const stackSeries = new Map<string, Category>();
  for (const item of items) {
    const value = settings.yColumnKey ? numericValue(cellOf(item, settings.yColumnKey)) : null;
    const stackCats = settings.stackColumnKey ? categorize(item, settings.stackColumnKey, ctx) : [];
    for (const category of categorize(item, settings.xColumnKey, ctx)) {
      const bucket: Bucket = buckets.get(category.key) ?? { category, itemIds: new Set(), values: [], stacks: new Map() };
      bucket.itemIds.add(item.id);
      if (value !== null) bucket.values.push(value);
      for (const series of stackCats) {
        stackSeries.set(series.key, series);
        const stack = bucket.stacks.get(series.key) ?? { series, values: [] as number[], itemIds: new Set<string>() };
        stack.itemIds.add(item.id);
        if (value !== null) stack.values.push(value);
        bucket.stacks.set(series.key, stack);
      }
      buckets.set(category.key, bucket);
    }
  }
  // Show every label of a label column even when empty (board parity), unless hidden.
  const xColumn = context.columns.find((column) => column.key === settings.xColumnKey);
  if (!settings.hideEmpty && xColumn && (xColumn.type === 'status' || xColumn.type === 'dropdown')) {
    for (const label of columnLabels(xColumn).filter((entry) => !entry.isDefault)) {
      if (!buckets.has(label.id)) {
        buckets.set(label.id, {
          category: { key: label.id, label: label.name || 'Untitled', color: label.color, order: label.position },
          itemIds: new Set(),
          values: [],
          stacks: new Map(),
        });
      }
    }
  }
  const categories = new Map([...buckets.values()].map((bucket) => [bucket.category.key, bucket.category]));
  let points: ChartPoint[] = [...buckets.values()].map((bucket) => {
    const stacks: Record<string, number> = {};
    const stackItemIds: Record<string, string[]> = {};
    for (const [key, stack] of bucket.stacks) {
      stacks[key] = aggregate(stack.values, fn, stack.itemIds.size);
      stackItemIds[key] = [...stack.itemIds];
    }
    return {
      key: bucket.category.key,
      label: bucket.category.label,
      color: settings.colors[bucket.category.key] ?? bucket.category.color,
      value: aggregate(bucket.values, fn, bucket.itemIds.size),
      count: bucket.itemIds.size,
      stacks,
      itemIds: [...bucket.itemIds],
      stackItemIds,
    };
  });
  if (settings.hideEmpty) points = points.filter((point) => point.count > 0);
  points = sortPoints(points, categories, settings.sort, Boolean(xColumn && (xColumn.type === 'date' || xColumn.type === 'timeline' || xColumn.type === 'last_updated' || xColumn.type === 'creation_log')));
  if (settings.cumulative) {
    let running = 0;
    points = points.map((point) => {
      running += point.value;
      return { ...point, value: running };
    });
  }
  const stacks = [...stackSeries.values()]
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
    .map((series) => ({ key: series.key, label: series.label, color: settings.colors[series.key] ?? series.color }));
  const total = settings.cumulative ? (points.at(-1)?.value ?? 0) : points.reduce((sum, point) => sum + point.value, 0);
  return { points, stacks, total: fn === 'average' ? (items.length ? total / Math.max(1, points.length) : 0) : total, itemCount: items.length };
}

/** Normalise stack values of each point to 100%. */
export function toPercent(points: readonly ChartPoint[]): ChartPoint[] {
  return points.map((point) => {
    const sum = Object.values(point.stacks).reduce((acc, value) => acc + value, 0);
    if (sum === 0) return point;
    const stacks: Record<string, number> = {};
    for (const [key, value] of Object.entries(point.stacks)) stacks[key] = (value / sum) * 100;
    return { ...point, stacks };
  });
}
