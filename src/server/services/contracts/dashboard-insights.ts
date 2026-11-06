/**
 * Dashboard insight contracts (Zod + types). CLIENT-SAFE: no server imports.
 *
 * A widget row stores a database `type` (the `widget_type` enum) plus a free-form `config`.
 * KitStak exposes more widget kinds than the enum has, so the client-facing `kind` lives in
 * `config.kind` (countdown and section are stored as `text`, forecast as `chart`).
 */
import { z } from 'zod';
import type { ColumnDto, ItemDto, UserSummaryDto, WidgetType } from './dto';

export const DB_WIDGET_TYPES = [
  'number',
  'chart',
  'battery',
  'table',
  'calendar',
  'timeline',
  'workload',
  'leaderboard',
  'funnel',
  'text',
] as const satisfies readonly WidgetType[];

export const WIDGET_KINDS = [
  'numbers',
  'chart',
  'battery',
  'table',
  'workload',
  'calendar',
  'timeline',
  'leaderboard',
  'funnel',
  'forecast',
  'text',
  'countdown',
  'section',
] as const;
export type WidgetKind = (typeof WIDGET_KINDS)[number];

const KIND_TO_TYPE: Readonly<Record<WidgetKind, WidgetType>> = {
  numbers: 'number',
  chart: 'chart',
  battery: 'battery',
  table: 'table',
  workload: 'workload',
  calendar: 'calendar',
  timeline: 'timeline',
  leaderboard: 'leaderboard',
  funnel: 'funnel',
  forecast: 'chart',
  text: 'text',
  countdown: 'text',
  section: 'text',
};

const TYPE_TO_KIND: Readonly<Record<WidgetType, WidgetKind>> = {
  number: 'numbers',
  chart: 'chart',
  battery: 'battery',
  table: 'table',
  calendar: 'calendar',
  timeline: 'timeline',
  workload: 'workload',
  leaderboard: 'leaderboard',
  funnel: 'funnel',
  text: 'text',
};

/** Database widget type used to persist a kind. */
export function widgetTypeForKind(kind: WidgetKind): WidgetType {
  return KIND_TO_TYPE[kind];
}

/** Resolve the client kind of a stored widget (config.kind wins when it is compatible). */
export function widgetKindOf(type: WidgetType, config: Record<string, unknown> | undefined): WidgetKind {
  const declared = config?.kind;
  if (typeof declared === 'string' && (WIDGET_KINDS as readonly string[]).includes(declared)) {
    const kind = declared as WidgetKind;
    if (KIND_TO_TYPE[kind] === type) return kind;
  }
  return TYPE_TO_KIND[type];
}

export const AGGREGATES = ['count', 'sum', 'average', 'median', 'min', 'max'] as const;
export type Aggregate = (typeof AGGREGATES)[number];

export const CHART_TYPES = ['bar', 'horizontal_bar', 'stacked_bar', 'line', 'area', 'pie', 'donut'] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export const DATE_BUCKETS = ['week', 'month', 'quarter'] as const;
export type DateBucket = (typeof DATE_BUCKETS)[number];

export const NUMBER_FORMATS = ['number', 'currency', 'percent'] as const;
export type NumberFormat = (typeof NUMBER_FORMATS)[number];

export const SORT_ORDERS = ['default', 'value_desc', 'value_asc', 'label'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

/** Special group-by keys. */
export const GROUP_BY_GROUP = '$group';
export const GROUP_BY_BOARD = '$board';
export const GROUP_BY_DATE = '$date';

const key = z.string().trim().min(1).max(64);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/**
 * Typed view of `widget.config`. Every field `.catch()`es so a malformed or legacy config
 * degrades to defaults instead of failing the widget.
 */
export const widgetSettingsSchema = z
  .object({
    kind: z.enum(WIDGET_KINDS).optional().catch(undefined),
    boardIds: z.array(z.uuid()).max(20).optional().catch(undefined),
    groupIds: z.array(z.uuid()).max(100).optional().catch(undefined),
    groupByColumnKey: key.optional().catch(undefined),
    dateBucket: z.enum(DATE_BUCKETS).default('month').catch('month'),
    valueColumnKey: key.optional().catch(undefined),
    aggregate: z.enum(AGGREGATES).default('count').catch('count'),
    chartType: z.enum(CHART_TYPES).default('bar').catch('bar'),
    stackByColumnKey: key.optional().catch(undefined),
    dateColumnKey: key.optional().catch(undefined),
    probabilityColumnKey: key.optional().catch(undefined),
    colorByColumnKey: key.optional().catch(undefined),
    filter: z
      .object({ columnKey: key, labelIds: z.array(z.string().max(64)).max(100), exclude: z.boolean().default(false) })
      .optional()
      .catch(undefined),
    includeLabelIds: z.array(z.string().max(64)).max(100).optional().catch(undefined),
    excludeLabelIds: z.array(z.string().max(64)).max(100).optional().catch(undefined),
    prefix: z.string().max(10).optional().catch(undefined),
    suffix: z.string().max(10).optional().catch(undefined),
    format: z.enum(NUMBER_FORMATS).default('number').catch('number'),
    compare: z.boolean().default(true).catch(true),
    goal: z.number().finite().positive().optional().catch(undefined),
    showSparkline: z.boolean().default(true).catch(true),
    showLegend: z.boolean().default(true).catch(true),
    showValues: z.boolean().default(false).catch(false),
    sortBy: z.enum(SORT_ORDERS).default('default').catch('default'),
    limit: z.number().int().min(1).max(200).optional().catch(undefined),
    columnKeys: z.array(key).max(20).optional().catch(undefined),
    capacity: z.number().int().min(1).max(500).default(5).catch(5),
    months: z.number().int().min(1).max(24).default(6).catch(6),
    text: z.string().max(10_000).optional().catch(undefined),
    targetDate: isoDate.optional().catch(undefined),
    targetTime: z.string().regex(/^\d{2}:\d{2}$/).optional().catch(undefined),
    color: z.string().max(32).optional().catch(undefined),
    colorOverrides: z.record(z.string().max(64), z.string().max(32)).optional().catch(undefined),
    description: z.string().max(280).optional().catch(undefined),
  })
  .catchall(z.unknown());
export type WidgetSettings = z.output<typeof widgetSettingsSchema>;

export function parseWidgetSettings(config: unknown): WidgetSettings {
  const result = widgetSettingsSchema.safeParse(config && typeof config === 'object' ? config : {});
  return result.success ? result.data : widgetSettingsSchema.parse({});
}

/** Dashboard-wide filters, applied on top of every widget's own filters. */
export const insightFiltersSchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    /** User ids, or `me` for the caller. */
    personIds: z.array(z.union([z.uuid(), z.literal('me')])).max(50).default([]),
    search: z.string().trim().max(200).optional(),
  })
  // Unknown keys (e.g. a malformed `range`) are rejected instead of silently ignored.
  .strict()
  .refine((filters) => !filters.from || !filters.to || filters.from <= filters.to, {
    message: '`from` must be on or before `to`',
    path: ['from'],
  });
export type InsightFilters = z.output<typeof insightFiltersSchema>;

/** Upper bound for a serialized widget config (a text widget allows 10k characters). */
export const MAX_WIDGET_CONFIG_BYTES = 32_000;

/** Widget config record with a serialized-size cap (rejects junk payloads). */
export const boundedConfigSchema = z
  .record(z.string().max(64), z.unknown())
  .refine((config) => JSON.stringify(config).length <= MAX_WIDGET_CONFIG_BYTES, {
    message: `Widget config must be under ${MAX_WIDGET_CONFIG_BYTES / 1000}KB`,
  });

const widgetShapeSchema = z.object({
  type: z.enum(DB_WIDGET_TYPES),
  config: boundedConfigSchema
    .refine((config) => config.kind === undefined || (WIDGET_KINDS as readonly unknown[]).includes(config.kind), {
      message: 'Unknown widget kind',
      path: ['kind'],
    })
    .default({}),
});

export const insightQuerySchema = z.object({
  widget: widgetShapeSchema,
  filters: insightFiltersSchema.default({ personIds: [] }),
});

/** Every widget of a dashboard computed from one dataset load per board set. */
export const insightBatchSchema = z.object({
  widgets: z
    .array(widgetShapeSchema.extend({ key: z.string().min(1).max(64) }))
    .min(1)
    .max(60),
  filters: insightFiltersSchema.default({ personIds: [] }),
  /** Bypass the short-lived server dataset cache (manual refresh). */
  fresh: z.boolean().default(false),
});
export type InsightBatchInput = z.input<typeof insightBatchSchema>;

export type InsightBatchResult =
  | { readonly ok: true; readonly data: InsightDto }
  | { readonly ok: false; readonly error: string };

export interface InsightBatchDto {
  readonly results: Readonly<Record<string, InsightBatchResult>>;
}
export type InsightQueryInput = z.input<typeof insightQuerySchema>;

export const dashboardSettingsSchema = z.object({
  privacy: z.enum(['main', 'private']).optional(),
  autoRefreshSec: z.union([z.literal(0), z.literal(60), z.literal(300), z.literal(900)]).optional(),
  lockLayout: z.boolean().optional(),
  autoIncludeBoards: z.boolean().optional(),
  defaultRange: z.string().max(32).optional(),
});
export type DashboardSettings = z.output<typeof dashboardSettingsSchema>;

export const layoutUpdateSchema = z.object({
  widgets: z
    .array(
      z.object({
        id: z.uuid(),
        x: z.number().int().min(0).max(11),
        y: z.number().int().min(0).max(1_000),
        w: z.number().int().min(1).max(12),
        h: z.number().int().min(1).max(48),
      })
      .refine((widget) => widget.x + widget.w <= 12, {
        message: 'Widget must fit inside the 12-column grid (x + w <= 12)',
        path: ['w'],
      }),
    )
    .min(1)
    .max(100),
});
export type LayoutUpdateInput = z.infer<typeof layoutUpdateSchema>;

export const createDashboardFlowSchema = z.object({
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(2_000).nullish(),
  workspaceId: z.uuid().nullish(),
  boardIds: z.array(z.uuid()).max(20).default([]),
  privacy: z.enum(['main', 'private']).default('main'),
  starter: z.enum(['blank', 'sales']).default('blank'),
});
export type CreateDashboardFlowInput = z.input<typeof createDashboardFlowSchema>;

export const duplicateDashboardSchema = z.object({ name: z.string().trim().min(1).max(255).optional() });

// ------------------------------------------------------------------------------------------------
// Response shapes
// ------------------------------------------------------------------------------------------------

export interface InsightPoint {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly count: number;
  readonly color?: string;
  readonly image?: string | null;
  /** Stacked charts: value per stack key. */
  readonly stack?: Readonly<Record<string, number>>;
  /** Funnel: share of items that reached this stage from the previous stage (0-1). */
  readonly conversion?: number | null;
  /** Battery: label counts as done. */
  readonly isDone?: boolean;
}

export interface InsightStack {
  readonly key: string;
  readonly label: string;
  readonly color?: string;
}

export interface InsightForecastBucket {
  readonly key: string;
  readonly label: string;
  readonly pipeline: number;
  readonly weighted: number;
  readonly won: number;
  readonly count: number;
}

export interface InsightWorkloadRow {
  readonly id: string;
  readonly name: string;
  readonly image: string | null;
  readonly total: number;
  readonly cells: readonly number[];
}

export interface InsightValueColumn {
  readonly key: string;
  readonly title: string;
  readonly type: string;
  readonly currency?: string;
  readonly unit?: string;
}

export interface InsightDto {
  readonly kind: WidgetKind;
  readonly total: number;
  readonly itemCount: number;
  /** Same aggregate over a current vs previous period (null when not comparable). */
  readonly comparison: { readonly current: number; readonly previous: number; readonly label: string } | null;
  readonly sparkline: readonly { readonly key: string; readonly label: string; readonly value: number }[];
  readonly series: readonly InsightPoint[];
  readonly stacks: readonly InsightStack[];
  readonly boards: readonly { readonly id: string; readonly name: string }[];
  readonly valueColumn: InsightValueColumn | null;
  /** Battery: share of items in a done label (0-1). */
  readonly doneRatio: number | null;
  readonly forecast: readonly InsightForecastBucket[];
  readonly workload: {
    readonly periods: readonly { readonly key: string; readonly label: string }[];
    readonly rows: readonly InsightWorkloadRow[];
    readonly capacity: number;
  } | null;
  readonly rows: readonly ItemDto[];
  readonly rowsTruncated: boolean;
  /** Every column of the connected boards (cells of multi-board rows resolve per board). */
  readonly columns: readonly ColumnDto[];
  /** Table widget: ordered column keys to show. */
  readonly tableKeys: readonly string[];
  readonly groups: readonly { readonly id: string; readonly boardId: string; readonly title: string; readonly color: string }[];
  readonly users: readonly UserSummaryDto[];
  /** True when nothing is configured yet (no boards connected). */
  readonly unconfigured: boolean;
  readonly generatedAt: string;
}

export interface DashboardSourceBoard {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly workspaceId: string;
  readonly itemTerminology: string;
  readonly columns: readonly ColumnDto[];
  readonly groups: readonly { readonly id: string; readonly title: string; readonly color: string }[];
}

export interface DashboardSourcesDto {
  readonly boards: readonly DashboardSourceBoard[];
  readonly users: readonly UserSummaryDto[];
}
