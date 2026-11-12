/**
 * Payload contract for the native Labor & Operational Analytics dashboards (M13 §4).
 * Every dashboard is a list of KPIs + chart specs; each chart carries its rows (also
 * rendered as an accessible table and exported to CSV/XLSX) and optional drill links.
 * PURE types: shared by the server builders and the client renderer.
 */

export type AnalyticsChartKind =
  'line' | 'bar' | 'stackedBar' | 'area' | 'scatter' | 'heatmap' | 'donut' | 'scorecards';

export interface AnalyticsSeries {
  readonly key: string;
  readonly label: string;
  readonly color: string;
  /**
   * Line charts: "percent" series are drawn against a right-hand 0–100 % axis so they never
   * share a scale with the count series on the left axis.
   */
  readonly axis?: 'percent';
}

export interface AnalyticsColumn {
  readonly key: string;
  readonly label: string;
  readonly kind?: 'text' | 'number' | 'decimal' | 'percent' | 'money' | 'hours' | 'minutes';
}

export type AnalyticsRow = Readonly<Record<string, string | number | null>>;

export interface AnalyticsChart {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly kind: AnalyticsChartKind;
  readonly xKey: string;
  readonly series: readonly AnalyticsSeries[];
  readonly rows: readonly AnalyticsRow[];
  readonly columns: readonly AnalyticsColumn[];
  /** Line charts: break lines on days without data instead of bridging them (sparse series). */
  readonly breakOnNull?: boolean;
  /** Bar charts: row key holding a per-bar colour (one colour per category). */
  readonly colorKey?: string;
  /** Row key holding a drilldown href. */
  readonly hrefKey?: string;
  /** "Open the underlying grid" link for the whole chart. */
  readonly gridHref?: string;
  readonly gridLabel?: string;
  /** Scatter: reference lines + quadrant labels. */
  readonly medians?: { readonly x: number; readonly y: number };
  readonly yKey?: string;
  readonly quadrants?: readonly [topRight: string, topLeft: string, bottomRight: string, bottomLeft: string];
  /** Heatmap axes. */
  readonly yCategories?: readonly string[];
  readonly xCategories?: readonly string[];
  /** Chart spans the full row. */
  readonly wide?: boolean;
  /**
   * Bar charts: draw bars horizontally (categories on the Y axis) so long category names
   * (order statuses, SKUs) read in full instead of being cut and tilted.
   */
  readonly horizontal?: boolean;
  /**
   * Bar charts: when one bar is an outlier (> 3× the rest), the axis stops at a cap and that bar
   * is drawn to the cap with its real value labelled "off scale", so the other bars stay legible.
   */
  readonly offScale?: boolean;
  /**
   * Bar charts: row key holding a data-quality flag. Rows whose flag differs from `flagNormal`
   * are drawn hatched and the flag text is shown in the tooltip (e.g. low timing confidence,
   * value at the measurement cap).
   */
  readonly flagKey?: string;
  readonly flagNormal?: string;
}

export interface AnalyticsKpi {
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
  readonly href?: string;
}

export interface AnalyticsGate {
  readonly appKey: string;
  readonly appName: string;
  readonly reason: 'inactive';
}

export interface AnalyticsPayload {
  readonly key: string;
  readonly title: string;
  readonly range: { readonly from: string; readonly to: string; readonly timeZone?: string };
  readonly gate: AnalyticsGate | null;
  readonly kpis: readonly AnalyticsKpi[];
  readonly charts: readonly AnalyticsChart[];
  /** Data redacted or narrowed for this viewer's permissions (shown as a note above the KPIs). */
  readonly notice?: AnalyticsNotice | null;
  /** Task-duration evidence behind the page (labor and productivity pages). */
  readonly timing?: TimingShare;
}

/** How many tasks were timed by start → finish scans, inferred from gaps, or had no evidence. */
export interface TimingShare {
  readonly total: number;
  readonly timed: number;
  readonly inferred: number;
  readonly none: number;
}

export interface AnalyticsNotice {
  readonly kind: 'self-only' | 'no-billing';
  readonly title: string;
  readonly message: string;
}

export const LABOR_PAGES = [
  'average-task',
  'associate-task',
  'performance-quadrant',
  'associate',
  'receiving-performance',
] as const;
export const OPERATIONAL_PAGES = ['inbound-inventory', 'fulfillment', 'management', 'productivity'] as const;
export type LaborPage = (typeof LABOR_PAGES)[number];
export type OperationalPage = (typeof OPERATIONAL_PAGES)[number];

export const ANALYTICS_TITLES: Readonly<
  Record<LaborPage | OperationalPage, { title: string; helper: string }>
> = {
  'average-task': {
    title: 'Average Task Analysis',
    helper: 'Average minutes per task by task type and day, with the trend across the period.',
  },
  'associate-task': {
    title: 'Associate Task Analysis',
    helper: 'How many tasks each associate completed, split by task type.',
  },
  'performance-quadrant': {
    title: 'Performance Quadrant Analysis',
    helper:
      'Speed (tasks per hour) against volume (tasks completed) for every associate, split at the team medians.',
  },
  associate: {
    title: 'Associate Analysis',
    helper: 'A scorecard per associate: volume, speed, average task time, daily trend and rank.',
  },
  'receiving-performance': {
    title: 'Receiving Performance Analysis',
    helper: 'Units and lines received per associate, per hour on the dock.',
  },
  'inbound-inventory': {
    title: 'Inbound & Inventory Dashboard',
    helper: 'Receipts trend, dock-to-stock time, inventory value, aging and your top SKUs.',
  },
  fulfillment: {
    title: 'Fulfillment Dashboard',
    helper: 'Orders created against orders shipped, on-time shipping, backlog and shortages.',
  },
  management: {
    title: 'Management Dashboard',
    helper: 'Volume, revenue proxies and billing totals per client.',
  },
  productivity: {
    title: 'Productivity Dashboard',
    helper: 'Units per hour by work area and shift, and when the floor is busiest.',
  },
};

/** Shown by the API (400 VALIDATION) and the client guard when From is after To. */
export const RANGE_ORDER_MESSAGE = 'From must be on or before To';

export const LABOR_APP = {
  key: 'labor-analytics',
  name: 'Labor Analytics',
  permission: 'analytics.labor_analytics.view',
} as const;
export const OPERATIONAL_APP = {
  key: 'operational-analytics',
  name: 'Operational Analytics',
  permission: 'analytics.operational_analytics.view',
} as const;

/**
 * Money on the Management Dashboard (merchandise shipped, 3PL billed) follows the same gate as
 * the billing screens: 3PL Billing or Billing Report view. Without it the money KPIs, series and
 * columns are removed server side (not just hidden).
 */
export const BILLING_VIEW_PERMISSIONS = ['settings.billing.view', 'settings.billing_report.view'] as const;
/**
 * Team-wide labor analytics (every coworker's tasks/h and rank) are for Supervisors and up,
 * i.e. roles that can view Users. Anyone else sees only their own work.
 */
export const LABOR_TEAM_PERMISSION = 'settings.users.view';

export const SELF_ONLY_NOTICE: AnalyticsNotice = {
  kind: 'self-only',
  title: 'Showing your own work only',
  message:
    "Team-wide labor analytics (every associate's speed and rank) are available to supervisors and admins. Team medians are shown for comparison.",
};
export const NO_BILLING_NOTICE: AnalyticsNotice = {
  kind: 'no-billing',
  title: 'Revenue and billing figures are hidden',
  message:
    'Merchandise value and 3PL billing need the 3PL Billing or Billing Report view permission. Volumes are shown instead.',
};
