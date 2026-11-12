/**
 * Pure per-widget-kind insight builders. `computeInsight()` is the single entry point used by
 * the service and by unit tests (it never touches the database).
 */
import type { ItemDto } from './contracts/dto';
import {
  GROUP_BY_DATE,
  type InsightDto,
  type InsightFilters,
  type InsightForecastBucket,
  type InsightPoint,
  type InsightStack,
  type WidgetKind,
  type WidgetSettings,
} from './contracts/dashboard-insights';
import {
  addDays,
  addMonths,
  aggregate,
  aggregateItems,
  bucketKey,
  bucketLabel,
  bucketSequence,
  bucketsFor,
  columnFor,
  dateColumnFor,
  distinctColumns,
  filterByRange,
  filterItems,
  itemDate,
  itemSpan,
  labelsOf,
  numericValue,
  previousRange,
  round2,
  startOfMonth,
  statusLabelId,
  type BucketRef,
  type DateRange,
  type InsightDataset,
} from './dashboards-insights-core';

type Built = Partial<Omit<InsightDto, 'kind' | 'generatedAt'>>;

const MAX_ROWS = 200;
const SPARK_MONTHS = 6;

function emptyInsight(kind: WidgetKind, now: Date): InsightDto {
  return {
    kind,
    total: 0,
    itemCount: 0,
    comparison: null,
    sparkline: [],
    series: [],
    stacks: [],
    boards: [],
    valueColumn: null,
    doneRatio: null,
    forecast: [],
    workload: null,
    rows: [],
    rowsTruncated: false,
    columns: [],
    tableKeys: [],
    groups: [],
    users: [],
    unconfigured: false,
    generatedAt: now.toISOString(),
  };
}

export interface ComputeInsightInput {
  readonly kind: WidgetKind;
  readonly settings: WidgetSettings;
  readonly filters: InsightFilters;
  readonly dataset: InsightDataset;
  readonly now: Date;
}

export function computeInsight({ kind, settings, filters, dataset, now }: ComputeInsightInput): InsightDto {
  const base = emptyInsight(kind, now);
  if (kind === 'text' || kind === 'countdown' || kind === 'section') return base;
  if (dataset.boards.length === 0) return { ...base, unconfigured: true };
  const range: DateRange = { from: filters.from, to: filters.to };
  const scoped = filterItems(dataset, settings, filters);
  const inRangeItems = filterByRange(dataset, scoped, settings, range);
  const today = now.toISOString().slice(0, 10);
  const built = buildFor(kind, { dataset, settings, scoped, items: inRangeItems, range, today });
  const valueColumn = columnFor(dataset, dataset.boards[0]?.id ?? '', settings.valueColumnKey)
    ?? dataset.columns.find((column) => column.key === settings.valueColumnKey);
  const currency = (valueColumn?.settings as { currency?: string } | undefined)?.currency;
  const unit = (valueColumn?.settings as { unit?: string } | undefined)?.unit;
  return {
    ...base,
    total: aggregateItems(dataset, inRangeItems, settings),
    itemCount: inRangeItems.length,
    boards: dataset.boards,
    valueColumn: valueColumn
      ? { key: valueColumn.key, title: valueColumn.title, type: valueColumn.type, ...(currency ? { currency } : {}), ...(unit ? { unit } : {}) }
      : null,
    ...slimPayload(kind, dataset, built),
  };
}

const ROW_KINDS: ReadonlySet<WidgetKind> = new Set(['table', 'calendar', 'timeline']);
const TIME_COLUMN_TYPES = new Set(['date', 'timeline', 'status']);

/**
 * Only row widgets need columns, groups and users on the client, and only the cell values they
 * render. Trimming keeps a 17-widget batch response small (calendar/timeline rows used to carry
 * every value of every item).
 */
function slimPayload(kind: WidgetKind, dataset: InsightDataset, built: Built): Built & Pick<InsightDto, 'groups' | 'users' | 'columns'> {
  if (!ROW_KINDS.has(kind)) return { ...built, groups: [], users: [], columns: [] };
  const tableKeys = new Set(built.tableKeys ?? []);
  const columns =
    kind === 'table'
      ? dataset.columns.filter((column) => tableKeys.has(column.key))
      : dataset.columns.filter((column) => TIME_COLUMN_TYPES.has(column.type));
  const keep = new Set(columns.map((column) => column.key));
  const rows = (built.rows ?? []).map((item) => ({
    ...item,
    values: Object.fromEntries(Object.entries(item.values).filter(([key]) => keep.has(key))) as typeof item.values,
    computed: Object.fromEntries(Object.entries(item.computed ?? {}).filter(([key]) => keep.has(key))) as typeof item.computed,
  }));
  const groupIds = new Set(rows.map((item) => item.groupId));
  return {
    ...built,
    rows,
    columns,
    groups: dataset.groups.filter((group) => groupIds.has(group.id)),
    users: kind === 'table' ? dataset.users : [],
  };
}

interface BuildContext {
  readonly dataset: InsightDataset;
  readonly settings: WidgetSettings;
  /** Items after widget + people/search filters, before the date range. */
  readonly scoped: readonly ItemDto[];
  /** Items after every filter including the date range. */
  readonly items: readonly ItemDto[];
  readonly range: DateRange;
  readonly today: string;
}

function buildFor(kind: WidgetKind, ctx: BuildContext): Built {
  switch (kind) {
    case 'numbers':
      return buildNumbers(ctx);
    case 'chart':
      return buildChart(ctx);
    case 'battery':
      return buildBattery(ctx);
    case 'leaderboard':
      return buildLeaderboard(ctx);
    case 'funnel':
      return buildFunnel(ctx);
    case 'forecast':
      return buildForecast(ctx);
    case 'workload':
      return buildWorkload(ctx);
    case 'table':
    case 'calendar':
    case 'timeline':
      return buildRows(kind, ctx);
    default:
      return {};
  }
}

// ------------------------------------------------------------------------------------------------
// Numbers
// ------------------------------------------------------------------------------------------------

function buildNumbers(ctx: BuildContext): Built {
  const { range, today } = ctx;
  const comparison = ctx.settings.compare ? compareTotals(ctx) : null;
  const end = range.to ?? today;
  const trailing = sparkSeries(ctx, startOfMonth(addMonths(end, -(SPARK_MONTHS - 1))));
  // Forward-looking metrics (e.g. open pipeline by close date) have no history: show the next
  // six months instead of an empty trailing window.
  const sparkline =
    !range.to && trailing.every((point) => point.value === 0) ? sparkSeries(ctx, startOfMonth(today)) : trailing;
  return { comparison, sparkline };
}

function sparkSeries(ctx: BuildContext, start: string) {
  const { dataset, settings, scoped } = ctx;
  return bucketSequence(start, SPARK_MONTHS, 'month').map((key) => {
    const monthItems = scoped.filter((item) => {
      const date = itemDate(item, dateColumnFor(dataset, item.boardId, settings));
      return date !== null && date.startsWith(key);
    });
    return { key, label: bucketLabel(key, 'month'), value: aggregateItems(dataset, monthItems, settings) };
  });
}

function compareTotals(ctx: BuildContext): InsightDto['comparison'] {
  const { dataset, settings, scoped, range, today } = ctx;
  const explicit = previousRange(range);
  const current: DateRange = explicit ? range : { from: addDays(today, -29), to: today };
  const previous = explicit ?? { from: addDays(today, -59), to: addDays(today, -30) };
  const label = explicit ? 'vs previous period' : 'Last 30 days vs prior 30';
  const currentTotal = aggregateItems(dataset, filterByRange(dataset, scoped, settings, current), settings);
  const previousTotal = aggregateItems(dataset, filterByRange(dataset, scoped, settings, previous), settings);
  if (currentTotal === 0 && previousTotal === 0) return null;
  return { current: currentTotal, previous: previousTotal, label };
}

// ------------------------------------------------------------------------------------------------
// Grouped series (chart, battery, leaderboard)
// ------------------------------------------------------------------------------------------------

interface Accumulator {
  ref: BucketRef;
  values: number[];
  count: number;
  stack: Map<string, { values: number[]; count: number }>;
}

function groupItems(ctx: BuildContext, groupByKey: string | undefined, stackKey?: string) {
  const { dataset, settings, items } = ctx;
  const buckets = new Map<string, Accumulator>();
  const stacks = new Map<string, InsightStack & { order: number }>();
  for (const item of items) {
    const refs = bucketsFor(dataset, item, groupByKey, settings).filter((ref) => keepBucket(settings, ref.key));
    if (refs.length === 0) continue;
    const value = numericValue(item, columnFor(dataset, item.boardId, settings.valueColumnKey));
    const stackRefs = stackKey ? bucketsFor(dataset, item, stackKey, settings) : [];
    for (const ref of stackRefs) {
      if (!stacks.has(ref.key)) stacks.set(ref.key, { key: ref.key, label: ref.label, color: ref.color, order: ref.order });
    }
    for (const ref of refs) {
      const entry: Accumulator = buckets.get(ref.key) ?? { ref, values: [], count: 0, stack: new Map() };
      entry.count += 1;
      if (value !== null) entry.values.push(value);
      for (const stackRef of stackRefs) {
        const slot = entry.stack.get(stackRef.key) ?? { values: [] as number[], count: 0 };
        slot.count += 1;
        if (value !== null) slot.values.push(value);
        entry.stack.set(stackRef.key, slot);
      }
      buckets.set(ref.key, entry);
    }
  }
  return { buckets, stacks: [...stacks.values()].sort((a, b) => a.order - b.order) };
}

function keepBucket(settings: WidgetSettings, key: string): boolean {
  if (settings.includeLabelIds && settings.includeLabelIds.length > 0 && !settings.includeLabelIds.includes(key)) return false;
  if (settings.excludeLabelIds?.includes(key)) return false;
  return true;
}

function toPoints(ctx: BuildContext, buckets: Map<string, Accumulator>, withStack: boolean): InsightPoint[] {
  const fn = ctx.settings.valueColumnKey ? ctx.settings.aggregate : 'count';
  const image = (key: string) => ctx.dataset.users.find((person) => person.id === key)?.image;
  return [...buckets.entries()].map(([key, entry]) => {
    const userImage = image(key);
    return {
      key,
      label: entry.ref.label,
      value: round2(aggregate(entry.values, fn, entry.count)),
      count: entry.count,
      ...(entry.ref.color ? { color: entry.ref.color } : {}),
      ...(userImage !== undefined ? { image: userImage } : {}),
      ...(entry.ref.isDone ? { isDone: true } : {}),
      ...(withStack
        ? {
            stack: Object.fromEntries(
              [...entry.stack.entries()].map(([stackKey, slot]) => [stackKey, round2(aggregate(slot.values, fn, slot.count))]),
            ),
          }
        : {}),
    };
  });
}

export function sortPoints(
  points: readonly InsightPoint[],
  sortBy: WidgetSettings['sortBy'],
  orderOf: (key: string) => number,
  chronological = false,
): InsightPoint[] {
  const list = [...points];
  if (sortBy === 'value_desc') return list.sort((a, b) => b.value - a.value);
  if (sortBy === 'value_asc') return list.sort((a, b) => a.value - b.value);
  if (sortBy === 'label') return list.sort((a, b) => a.label.localeCompare(b.label));
  if (chronological) return list.sort((a, b) => (a.key === 'none' ? 1 : b.key === 'none' ? -1 : a.key.localeCompare(b.key)));
  return list.sort((a, b) => orderOf(a.key) - orderOf(b.key) || b.value - a.value);
}

function buildChart(ctx: BuildContext): Built {
  const groupBy = ctx.settings.groupByColumnKey;
  const stacked = ctx.settings.chartType === 'stacked_bar' && Boolean(ctx.settings.stackByColumnKey);
  const { buckets, stacks } = groupItems(ctx, groupBy, stacked ? ctx.settings.stackByColumnKey : undefined);
  const points = sortPoints(
    toPoints(ctx, buckets, stacked),
    ctx.settings.sortBy,
    (key) => buckets.get(key)?.ref.order ?? 0,
    groupBy === GROUP_BY_DATE,
  );
  const limited = ctx.settings.limit ? points.slice(0, ctx.settings.limit) : points;
  return { series: limited, stacks: stacked ? stacks.map(({ key, label, color }) => ({ key, label, color })) : [] };
}

function buildBattery(ctx: BuildContext): Built {
  const { buckets } = groupItems(ctx, ctx.settings.groupByColumnKey);
  const points = sortPoints(toPoints(ctx, buckets, false), 'default', (key) => buckets.get(key)?.ref.order ?? 0);
  const total = points.reduce((sum, point) => sum + point.count, 0);
  const done = points.filter((point) => point.isDone).reduce((sum, point) => sum + point.count, 0);
  return { series: points, doneRatio: total > 0 ? done / total : null };
}

function buildLeaderboard(ctx: BuildContext): Built {
  const { buckets } = groupItems(ctx, ctx.settings.groupByColumnKey);
  const points = toPoints(ctx, buckets, false)
    .filter((point) => point.key !== 'unassigned')
    .sort((a, b) => b.value - a.value || b.count - a.count);
  return { series: points.slice(0, ctx.settings.limit ?? 10) };
}

// ------------------------------------------------------------------------------------------------
// Funnel: stages in label order; an item "reached" every stage up to its current one.
// ------------------------------------------------------------------------------------------------

function buildFunnel(ctx: BuildContext): Built {
  const { dataset, settings, items } = ctx;
  const stageKey = settings.groupByColumnKey;
  const stageColumn = dataset.columns.find((column) => column.key === stageKey && column.type === 'status');
  if (!stageColumn || !stageKey) return { series: [] };
  const excluded = new Set(settings.excludeLabelIds ?? []);
  const stages = labelsOf(stageColumn)
    .filter((label) => !label.isDefault && !excluded.has(label.id))
    .sort((a, b) => a.position - b.position);
  const index = new Map(stages.map((stage, position) => [stage.id, position]));
  const current = stages.map(() => ({ count: 0, values: [] as number[] }));
  for (const item of items) {
    const position = index.get(statusLabelId(item, stageKey));
    if (position === undefined) continue;
    const slot = current[position];
    if (!slot) continue;
    slot.count += 1;
    const value = numericValue(item, columnFor(dataset, item.boardId, settings.valueColumnKey));
    if (value !== null) slot.values.push(value);
  }
  const fn = settings.valueColumnKey ? settings.aggregate : 'count';
  let reachedAfter = 0;
  const reached = current.map(() => 0);
  for (let position = stages.length - 1; position >= 0; position -= 1) {
    reachedAfter += current[position]?.count ?? 0;
    reached[position] = reachedAfter;
  }
  const series = stages.map((stage, position): InsightPoint => {
    const slot = current[position] ?? { count: 0, values: [] };
    const previous = position > 0 ? (reached[position - 1] ?? 0) : null;
    return {
      key: stage.id,
      label: stage.name || 'Blank',
      color: stage.color,
      count: reached[position] ?? 0,
      value: round2(aggregate(slot.values, fn, slot.count)),
      stack: { current: slot.count },
      conversion: previous === null ? null : previous > 0 ? (reached[position] ?? 0) / previous : 0,
      ...(stage.isDone ? { isDone: true } : {}),
    };
  });
  return { series };
}

// ------------------------------------------------------------------------------------------------
// Forecast: open pipeline, probability-weighted pipeline and won value per close month.
// ------------------------------------------------------------------------------------------------

function probabilityOf(ctx: BuildContext, item: ItemDto, stagePosition: number, openStages: number): number {
  const column = columnFor(ctx.dataset, item.boardId, ctx.settings.probabilityColumnKey);
  const explicit = numericValue(item, column);
  if (explicit !== null) return Math.min(Math.max(explicit, 0), 100) / 100;
  return openStages > 0 ? (stagePosition + 1) / (openStages + 1) : 0.5;
}

function buildForecast(ctx: BuildContext): Built {
  const { dataset, settings, scoped, range, today } = ctx;
  const stageKey = settings.groupByColumnKey;
  const stageColumn = dataset.columns.find((column) => column.key === stageKey && column.type === 'status');
  const labels = labelsOf(stageColumn);
  const excluded = new Set(settings.excludeLabelIds ?? []);
  const openStages = labels.filter((label) => !label.isDone && !label.isDefault && !excluded.has(label.id));
  const start = startOfMonth(range.from ?? today);
  const keys = bucketSequence(start, settings.months, 'month');
  const buckets = new Map<string, InsightForecastBucket>(
    keys.map((key) => [key, { key, label: bucketLabel(key, 'month'), pipeline: 0, weighted: 0, won: 0, count: 0 }]),
  );
  const overdue = { key: 'overdue', label: 'Overdue', pipeline: 0, weighted: 0, won: 0, count: 0 };
  for (const item of scoped) {
    const labelId = stageKey ? statusLabelId(item, stageKey) : 'default';
    if (excluded.has(labelId)) continue;
    const label = labels.find((entry) => entry.id === labelId);
    const date = itemDate(item, dateColumnFor(dataset, item.boardId, settings));
    if (!date) continue;
    const value = numericValue(item, columnFor(dataset, item.boardId, settings.valueColumnKey)) ?? 0;
    const isWon = Boolean(label?.isDone);
    const key = bucketKey(date, 'month');
    const target = buckets.get(key) ?? (!isWon && date < start && !range.from ? overdue : undefined);
    if (!target) continue;
    const next = { ...target, count: target.count + 1 };
    if (isWon) next.won = target.won + value;
    else {
      const position = Math.max(openStages.findIndex((stage) => stage.id === labelId), 0);
      next.pipeline = target.pipeline + value;
      next.weighted = target.weighted + value * probabilityOf(ctx, item, position, openStages.length);
    }
    if (target === overdue) Object.assign(overdue, next);
    else buckets.set(key, next);
  }
  const list = [...(overdue.count > 0 ? [overdue] : []), ...buckets.values()].map((entry) => ({
    ...entry,
    pipeline: Math.round(entry.pipeline),
    weighted: Math.round(entry.weighted),
    won: Math.round(entry.won),
  }));
  return { forecast: list };
}

// ------------------------------------------------------------------------------------------------
// Workload: people × weeks, item count per cell vs capacity.
// ------------------------------------------------------------------------------------------------

const WORKLOAD_WEEKS = 6;

function buildWorkload(ctx: BuildContext): Built {
  const { dataset, settings, items, range, today } = ctx;
  const peopleKey =
    settings.groupByColumnKey ?? dataset.columns.find((column) => column.type === 'people')?.key;
  const start = bucketKey(range.from ?? today, 'week');
  const periods = bucketSequence(start, WORKLOAD_WEEKS, 'week').map((key) => ({ key, label: bucketLabel(key, 'week') }));
  const end = addDays(periods[periods.length - 1]?.key ?? start, 6);
  const rows = new Map<string, { id: string; name: string; image: string | null; cells: number[] }>();
  for (const item of items) {
    const refs = bucketsFor(dataset, item, peopleKey, settings).filter((ref) => ref.key !== 'unassigned');
    const span = itemSpan(item, dateColumnFor(dataset, item.boardId, settings));
    for (const ref of refs) {
      const person = dataset.users.find((user) => user.id === ref.key);
      const row = rows.get(ref.key) ?? { id: ref.key, name: ref.label, image: person?.image ?? null, cells: periods.map(() => 0) };
      if (span && span.to >= start && span.from <= end) {
        periods.forEach((period, position) => {
          const periodEnd = addDays(period.key, 6);
          if (span.from <= periodEnd && span.to >= period.key) row.cells[position] = (row.cells[position] ?? 0) + 1;
        });
      }
      rows.set(ref.key, row);
    }
  }
  const list = [...rows.values()]
    .map((row) => ({ ...row, total: row.cells.reduce((sum, value) => sum + value, 0) }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  return { workload: { periods, rows: list, capacity: settings.capacity } };
}

// ------------------------------------------------------------------------------------------------
// Item rows (table, calendar, timeline)
// ------------------------------------------------------------------------------------------------

function buildRows(kind: WidgetKind, ctx: BuildContext): Built {
  const { dataset, settings, items } = ctx;
  const dateOf = (item: ItemDto) => itemDate(item, dateColumnFor(dataset, item.boardId, settings));
  let list = [...items];
  if (kind !== 'table') list = list.filter((item) => dateOf(item) !== null);
  const valueOf = (item: ItemDto) => numericValue(item, columnFor(dataset, item.boardId, settings.valueColumnKey)) ?? 0;
  if (settings.sortBy === 'value_desc') list.sort((a, b) => valueOf(b) - valueOf(a));
  else if (settings.sortBy === 'value_asc') list.sort((a, b) => valueOf(a) - valueOf(b));
  else if (settings.sortBy === 'label') list.sort((a, b) => a.name.localeCompare(b.name));
  else if (kind !== 'table') list.sort((a, b) => (dateOf(a) ?? '').localeCompare(dateOf(b) ?? ''));
  const limit = Math.min(settings.limit ?? (kind === 'table' ? 50 : MAX_ROWS), MAX_ROWS);
  const keys = settings.columnKeys && settings.columnKeys.length > 0 ? settings.columnKeys : defaultTableKeys(dataset);
  return {
    rows: list.slice(0, limit),
    rowsTruncated: list.length > limit,
    tableKeys: distinctColumns(dataset, keys).map((column) => column.key),
  };
}

function defaultTableKeys(dataset: InsightDataset): string[] {
  const preferred = ['status', 'people', 'currency', 'number', 'date', 'formula'];
  const keys: string[] = [];
  for (const type of preferred) {
    const column = dataset.columns.find((entry) => entry.type === type && !keys.includes(entry.key));
    if (column) keys.push(column.key);
  }
  return keys.slice(0, 5);
}
