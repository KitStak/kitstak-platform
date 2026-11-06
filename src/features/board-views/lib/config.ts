/**
 * Per-view-type settings. Each type keeps its settings under its own key of `view.config`
 * (`kanban`, `calendar`, `timeline`, `chartView`, `files`; forms use `form`, see
 * board-views-form-model) so they never collide with the toolbar's shared keys (filters, sort,
 * search…). Parsing is lenient: unknown / stale values fall back to smart defaults derived from
 * the board's columns, and the legacy flat keys written by the seed (`kanbanColumnKey`,
 * `dateColumnKey`, `chart`) are honoured.
 */
import { z } from 'zod';
import { LABEL_COLORS } from '@/server/db/schema/column-types';
import type { ColumnDto } from '@/server/services/contracts/dto';
import { DATE_COLUMN_TYPES, GROUP_KEY, LABEL_COLUMN_TYPES, NUMERIC_COLUMN_TYPES } from './values';

const key = z.string().max(64);
const ids = z.array(z.string().max(80)).max(1000);

export const kanbanSettingsSchema = z.object({
  groupBy: key.nullish(),
  cardFields: z.array(key).max(20).optional(),
  hideEmptyLanes: z.boolean().optional(),
  collapsedLanes: z.array(key).max(200).optional(),
  laneOrder: z.array(key).max(200).optional(),
  cardOrder: z.record(key, ids).optional(),
  wipLimits: z.record(key, z.number().int().min(1).max(999)).optional(),
  sumColumnKey: key.nullish(),
  weightColumnKey: key.nullish(),
  showEmptyFields: z.boolean().optional(),
});
export type KanbanSettingsInput = z.infer<typeof kanbanSettingsSchema>;

export const calendarSettingsSchema = z.object({
  dateColumnKey: key.nullish(),
  mode: z.enum(['month', 'week', 'day']).optional(),
  weekStartsOn: z.union([z.literal(0), z.literal(1)]).optional(),
  hideWeekends: z.boolean().optional(),
  colorBy: key.nullish(),
  showUnscheduled: z.boolean().optional(),
  eventDuration: z.number().int().min(15).max(480).optional(),
});

export const TIMELINE_ZOOMS = ['day', 'week', 'month', 'quarter'] as const;
export type TimelineZoom = (typeof TIMELINE_ZOOMS)[number];

export const timelineSettingsSchema = z.object({
  columnKey: key.nullish(),
  zoom: z.enum(TIMELINE_ZOOMS).optional(),
  groupBy: key.nullish(),
  colorBy: key.nullish(),
  showToday: z.boolean().optional(),
  showWeekends: z.boolean().optional(),
  showSummary: z.boolean().optional(),
  collapsedGroups: z.array(key).max(200).optional(),
});

export const CHART_TYPES = [
  'column',
  'bar',
  'stacked_column',
  'stacked_bar',
  'stacked_column_percent',
  'line',
  'smooth_line',
  'area',
  'stacked_area',
  'pie',
  'donut',
] as const;
export type ChartType = (typeof CHART_TYPES)[number];
export const CHART_AGGREGATES = ['count', 'sum', 'average', 'min', 'max'] as const;
export type ChartAggregate = (typeof CHART_AGGREGATES)[number];
export const DATE_BUCKETS = ['day', 'week', 'month', 'quarter', 'year'] as const;
export type DateBucket = (typeof DATE_BUCKETS)[number];
export const CHART_SORTS = ['label', 'value_desc', 'value_asc', 'name_asc', 'name_desc'] as const;
export type ChartSort = (typeof CHART_SORTS)[number];

export const chartSettingsSchema = z.object({
  type: z.enum(CHART_TYPES).optional(),
  xColumnKey: key.nullish(),
  dateBucket: z.enum(DATE_BUCKETS).optional(),
  yColumnKey: key.nullish(),
  aggregate: z.enum(CHART_AGGREGATES).optional(),
  stackColumnKey: key.nullish(),
  sort: z.enum(CHART_SORTS).optional(),
  showValues: z.boolean().optional(),
  showLegend: z.boolean().optional(),
  hideEmpty: z.boolean().optional(),
  cumulative: z.boolean().optional(),
  goal: z.number().finite().nullish(),
  title: z.string().max(120).nullish(),
  colors: z.record(z.string().max(80), z.enum(LABEL_COLORS)).optional(),
});

export const filesSettingsSchema = z.object({
  layout: z.enum(['grid', 'list']).optional(),
  sort: z.enum(['newest', 'oldest', 'name', 'size']).optional(),
  kind: z.enum(['all', 'image', 'pdf', 'doc', 'sheet', 'other']).optional(),
});

function parse<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> | Record<string, never> {
  const result = schema.safeParse(raw ?? {});
  return result.success ? result.data : {};
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

const find = (columns: readonly ColumnDto[], key: string | null | undefined) =>
  key ? columns.find((column) => column.key === key) : undefined;

// Kanban ---------------------------------------------------------------------------------------

export interface KanbanSettings {
  /** A status/dropdown column key or `__group`. */
  readonly groupBy: string;
  readonly cardFields: readonly string[];
  readonly hideEmptyLanes: boolean;
  readonly collapsedLanes: readonly string[];
  readonly laneOrder: readonly string[];
  readonly cardOrder: Readonly<Record<string, readonly string[]>>;
  readonly wipLimits: Readonly<Record<string, number>>;
  readonly sumColumnKey: string | null;
  readonly weightColumnKey: string | null;
  readonly showEmptyFields: boolean;
}

/** Best "probability" column: a % number column, preferring keys/titles that say so. */
export function guessWeightColumn(columns: readonly ColumnDto[]): ColumnDto | undefined {
  const numbers = columns.filter((column) => column.type === 'number');
  return (
    numbers.find((column) => /prob|likel|confidence|win/i.test(`${column.key} ${column.title}`)) ??
    numbers.find((column) => (column.settings as { unit?: unknown }).unit === '%')
  );
}

export function kanbanSettings(config: Record<string, unknown>, columns: readonly ColumnDto[]): KanbanSettings {
  const raw = parse(kanbanSettingsSchema, config.kanban);
  const legacyGroup = str(config.kanbanColumnKey);
  const requested = raw.groupBy ?? legacyGroup;
  const statusColumns = columns.filter((column) => column.type === 'status');
  const groupBy =
    requested === GROUP_KEY || (requested && LABEL_COLUMN_TYPES.has(find(columns, requested)?.type ?? ''))
      ? (requested as string)
      : (statusColumns[0]?.key ?? GROUP_KEY);
  const legacyFields = Array.isArray(config.kanbanCardColumnKeys) ? (config.kanbanCardColumnKeys as unknown[]).map(String) : null;
  const known = new Set(columns.map((column) => column.key));
  const defaultFields = columns
    .filter((column) => column.key !== groupBy && column.type !== 'name' && !column.hidden)
    .slice(0, 3)
    .map((column) => column.key);
  const cardFields = (raw.cardFields ?? legacyFields ?? defaultFields).filter((field) => known.has(field) && field !== 'name');
  const sum = find(columns, raw.sumColumnKey) ?? (raw.sumColumnKey === null ? undefined : columns.find((column) => column.type === 'currency'));
  const weight =
    raw.weightColumnKey === null ? undefined : (find(columns, raw.weightColumnKey) ?? (sum ? guessWeightColumn(columns) : undefined));
  return {
    groupBy,
    cardFields,
    hideEmptyLanes: raw.hideEmptyLanes ?? false,
    collapsedLanes: raw.collapsedLanes ?? [],
    laneOrder: raw.laneOrder ?? [],
    cardOrder: raw.cardOrder ?? {},
    wipLimits: raw.wipLimits ?? {},
    sumColumnKey: sum && NUMERIC_COLUMN_TYPES.has(sum.type) ? sum.key : null,
    weightColumnKey: weight?.type === 'number' ? weight.key : null,
    showEmptyFields: raw.showEmptyFields ?? true,
  };
}

// Calendar -------------------------------------------------------------------------------------

export interface CalendarSettings {
  readonly dateColumnKey: string | null;
  readonly mode: 'month' | 'week' | 'day';
  readonly weekStartsOn: 0 | 1;
  readonly hideWeekends: boolean;
  readonly colorBy: string;
  readonly showUnscheduled: boolean;
  readonly eventDuration: number;
}

export function calendarSettings(config: Record<string, unknown>, columns: readonly ColumnDto[]): CalendarSettings {
  const raw = parse(calendarSettingsSchema, config.calendar);
  const requested = find(columns, raw.dateColumnKey ?? str(config.dateColumnKey));
  const dateColumn =
    requested && DATE_COLUMN_TYPES.has(requested.type)
      ? requested
      : (columns.find((column) => column.type === 'date') ?? columns.find((column) => column.type === 'timeline'));
  const status = columns.find((column) => column.type === 'status');
  return {
    dateColumnKey: dateColumn?.key ?? null,
    mode: raw.mode ?? 'month',
    weekStartsOn: raw.weekStartsOn ?? 0,
    hideWeekends: raw.hideWeekends ?? false,
    colorBy: raw.colorBy ?? status?.key ?? 'group',
    showUnscheduled: raw.showUnscheduled ?? false,
    eventDuration: raw.eventDuration ?? 30,
  };
}

// Timeline -------------------------------------------------------------------------------------

export interface TimelineSettings {
  readonly columnKey: string | null;
  readonly zoom: TimelineZoom;
  readonly groupBy: string;
  readonly colorBy: string;
  readonly showToday: boolean;
  readonly showWeekends: boolean;
  readonly showSummary: boolean;
  readonly collapsedGroups: readonly string[];
}

export function timelineSettings(config: Record<string, unknown>, columns: readonly ColumnDto[]): TimelineSettings {
  const raw = parse(timelineSettingsSchema, config.timeline);
  const requested = find(columns, raw.columnKey ?? str(config.dateColumnKey));
  const column =
    requested && (requested.type === 'timeline' || requested.type === 'date')
      ? requested
      : (columns.find((entry) => entry.type === 'timeline') ?? columns.find((entry) => entry.type === 'date'));
  const groupColumn = find(columns, raw.groupBy);
  const status = columns.find((entry) => entry.type === 'status');
  return {
    columnKey: column?.key ?? null,
    zoom: raw.zoom ?? 'week',
    groupBy: groupColumn && LABEL_COLUMN_TYPES.has(groupColumn.type) ? groupColumn.key : raw.groupBy === 'none' ? 'none' : GROUP_KEY,
    colorBy: raw.colorBy ?? status?.key ?? GROUP_KEY,
    showToday: raw.showToday ?? true,
    showWeekends: raw.showWeekends ?? true,
    showSummary: raw.showSummary ?? true,
    collapsedGroups: raw.collapsedGroups ?? [],
  };
}

// Chart ----------------------------------------------------------------------------------------

export interface ChartSettings {
  readonly type: ChartType;
  readonly xColumnKey: string;
  readonly dateBucket: DateBucket;
  readonly yColumnKey: string | null;
  readonly aggregate: ChartAggregate;
  readonly stackColumnKey: string | null;
  readonly sort: ChartSort;
  readonly showValues: boolean;
  readonly showLegend: boolean;
  readonly hideEmpty: boolean;
  readonly cumulative: boolean;
  readonly goal: number | null;
  readonly title: string | null;
  readonly colors: Readonly<Record<string, (typeof LABEL_COLORS)[number]>>;
}

export const STACKED_TYPES: ReadonlySet<ChartType> = new Set([
  'stacked_column',
  'stacked_bar',
  'stacked_column_percent',
  'stacked_area',
]);

const LEGACY_CHART_TYPES: Record<string, ChartType> = {
  bar: 'column',
  stacked_bar: 'stacked_column',
  line: 'line',
  area: 'area',
  pie: 'pie',
  donut: 'donut',
};

export function chartSettings(config: Record<string, unknown>, columns: readonly ColumnDto[]): ChartSettings {
  const raw = parse(chartSettingsSchema, config.chartView);
  const legacy = (typeof config.chart === 'object' && config.chart !== null ? config.chart : {}) as Record<string, unknown>;
  const xRequested = raw.xColumnKey ?? str(legacy.xColumnKey);
  const xColumn = find(columns, xRequested);
  const xColumnKey =
    xRequested === GROUP_KEY || (xColumn && (LABEL_COLUMN_TYPES.has(xColumn.type) || xColumn.type === 'people' || DATE_COLUMN_TYPES.has(xColumn.type)))
      ? (xRequested as string)
      : (columns.find((column) => column.type === 'status')?.key ?? GROUP_KEY);
  const yRequested = raw.yColumnKey === undefined ? str(legacy.yColumnKey) : raw.yColumnKey;
  const yColumn = find(columns, yRequested);
  const yColumnKey = yColumn && NUMERIC_COLUMN_TYPES.has(yColumn.type) ? yColumn.key : null;
  const legacyAggregate = CHART_AGGREGATES.find((entry) => entry === legacy.aggregate);
  const aggregate = yColumnKey ? (raw.aggregate ?? legacyAggregate ?? 'sum') : 'count';
  const stack = find(columns, raw.stackColumnKey);
  return {
    type: raw.type ?? LEGACY_CHART_TYPES[String(legacy.type)] ?? 'column',
    xColumnKey,
    dateBucket: raw.dateBucket ?? 'month',
    yColumnKey,
    aggregate: aggregate === 'count' && yColumnKey ? 'sum' : aggregate,
    stackColumnKey:
      raw.stackColumnKey === GROUP_KEY || (stack && (LABEL_COLUMN_TYPES.has(stack.type) || stack.type === 'people'))
        ? (raw.stackColumnKey as string)
        : null,
    sort: raw.sort ?? 'label',
    showValues: raw.showValues ?? true,
    showLegend: raw.showLegend ?? true,
    hideEmpty: raw.hideEmpty ?? false,
    cumulative: raw.cumulative ?? false,
    goal: raw.goal ?? null,
    title: raw.title ?? null,
    colors: raw.colors ?? {},
  };
}

// Files ----------------------------------------------------------------------------------------

export interface FilesSettings {
  readonly layout: 'grid' | 'list';
  readonly sort: 'newest' | 'oldest' | 'name' | 'size';
  readonly kind: 'all' | 'image' | 'pdf' | 'doc' | 'sheet' | 'other';
}

export function filesSettings(config: Record<string, unknown>): FilesSettings {
  const raw = parse(filesSettingsSchema, config.files);
  return { layout: raw.layout ?? 'grid', sort: raw.sort ?? 'newest', kind: raw.kind ?? 'all' };
}
