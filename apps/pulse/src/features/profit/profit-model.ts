/**
 * The Profit explorer's rules, with no React in them: which columns exist, how a row is named,
 * sorted, compared with another period and drilled into, and how a view becomes CSV rows. The
 * table, the charts and the export all read these, so what is on screen is what gets exported.
 * Money math stays in `@/lib/money` and `@/lib/profit`.
 */
import { formatDateLong } from '@/components/charts/scale';
import type { ExplainMetric, ProfitGroup } from '@/lib/constants';
import { rawCell, type CsvCell } from '@/lib/csv/write';
import { formatHours, formatMoney, formatMoneyPlain, formatNumber, formatPace, formatPercentBp } from '@/lib/format';
import type { ProfitParams } from '@/lib/hooks/use-data';
import { addCents, centsToNumber, ratioBp } from '@/lib/money';
import { addDays, endOfMonth } from '@/lib/profit/calendar';
import { rankByProfit, rowsToReachProfitShare, type RankedRow } from '@/lib/profit/clients';
import { profitSummary } from '@/lib/profit/summary';
import { compareMoney, compareNumber } from '@/lib/profit/trends';
import type { PivotCellDTO, ProfitPivotDTO, ProfitRowDTO } from '@/lib/types';

export const VIEW_LABELS: Readonly<Record<ProfitGroup, string>> = {
  job: 'Jobs',
  client: 'Clients',
  type: 'Job types',
  service: 'Extra services',
  site: 'Sites',
  month: 'Months',
  week: 'Weeks',
  day: 'Days',
};

/** "a job", "an extra service": the view noun with the right article for a sentence. */
export const withArticle = (noun: string): string => `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`;

/** One of something, for sentences and headers: "job", "client". */
export const VIEW_NOUN: Readonly<Record<ProfitGroup, string>> = {
  job: 'job',
  client: 'client',
  type: 'job type',
  service: 'extra service',
  site: 'site',
  month: 'month',
  week: 'week',
  day: 'day',
};

export const TIME_GROUPS: readonly ProfitGroup[] = ['month', 'week', 'day'];
export const isTimeGroup = (by: ProfitGroup): boolean => TIME_GROUPS.includes(by);

export const EXPLORER_MODES = ['table', 'chart', 'contribution', 'pareto', 'pivot', 'serve'] as const;
export type ExplorerMode = (typeof EXPLORER_MODES)[number];

export const MODE_LABELS: Readonly<Record<ExplorerMode, string>> = {
  table: 'Table',
  chart: 'Chart',
  contribution: 'Contribution',
  pareto: 'Pareto',
  pivot: 'Pivot',
  serve: 'Cost to serve',
};

/** Views that make sense for a grouping. Pareto ranks things, so it skips time. Cost to serve is about clients. */
export function modesFor(by: ProfitGroup): ExplorerMode[] {
  const modes: ExplorerMode[] = ['table', 'chart', 'contribution'];
  if (!isTimeGroup(by)) modes.push('pareto');
  modes.push('pivot');
  if (by === 'client') modes.push('serve');
  return modes;
}

export type ColumnKind = 'money' | 'percent' | 'number' | 'hours' | 'pace';

export interface ProfitColumn {
  readonly id: string;
  readonly label: string;
  /** One plain sentence for the header tooltip. */
  readonly help: string;
  readonly kind: ColumnKind;
  readonly get: (row: ProfitRowDTO) => number | null;
  readonly metric?: ExplainMetric;
  /** Which way is good, for tones. Left out for neutral numbers. */
  readonly goodWhen?: 'up' | 'down';
  /** Shown before the person picks columns. */
  readonly byDefault: boolean;
  readonly money: boolean;
}

const dec = (value: string | null): number | null => (value === null || value === '' ? null : Number(value));

export const PROFIT_COLUMNS: readonly ProfitColumn[] = [
  { id: 'revenue', label: 'Revenue', help: 'What the work earned. It counts work done, not invoices sent.', kind: 'money', get: (row) => row.revenueCents, metric: 'revenue', goodWhen: 'up', byDefault: true, money: true },
  { id: 'labor', label: 'Labor', help: 'Labor hours times the real cost of an hour.', kind: 'money', get: (row) => row.laborCents, metric: 'labor', goodWhen: 'down', byDefault: true, money: true },
  { id: 'material', label: 'Material', help: 'Parts you paid for, scrap included.', kind: 'money', get: (row) => row.materialCents, metric: 'material', goodWhen: 'down', byDefault: true, money: true },
  { id: 'other', label: 'Other', help: 'Other costs typed in against a job or a client.', kind: 'money', get: (row) => row.otherCents, metric: 'other', goodWhen: 'down', byDefault: true, money: true },
  { id: 'shared', label: 'Time not on a job', help: 'Paid time for meetings, cleanup and waiting, spread over the jobs.', kind: 'money', get: (row) => row.sharedCents, metric: 'shared', goodWhen: 'down', byDefault: true, money: true },
  { id: 'cost', label: 'Cost', help: 'Labor, material, other costs and time not on a job, added up.', kind: 'money', get: (row) => row.costCents, metric: 'cost', goodWhen: 'down', byDefault: false, money: true },
  { id: 'profit', label: 'Profit', help: 'Revenue less cost.', kind: 'money', get: (row) => row.profitCents, metric: 'profit', goodWhen: 'up', byDefault: true, money: true },
  { id: 'margin', label: 'Job margin', help: 'Profit as a share of revenue, after labor, material, other costs and time not on a job.', kind: 'percent', get: (row) => row.marginBp, metric: 'margin', goodWhen: 'up', byDefault: true, money: true },
  { id: 'margin_before', label: 'Contribution %', help: 'What the work itself made as a share of revenue, with time not on a job left out.', kind: 'percent', get: (row) => row.marginBeforeSharedBp, metric: 'margin_before_shared', goodWhen: 'up', byDefault: false, money: true },
  { id: 'labor_pct', label: 'Labor % of revenue', help: 'Labor cost as a share of revenue. Lower is better.', kind: 'percent', get: (row) => row.laborPctBp, metric: 'labor_pct', goodWhen: 'down', byDefault: false, money: true },
  { id: 'units', label: 'Units', help: 'Good units logged. Scrap is left out.', kind: 'number', get: (row) => dec(row.unitsGood), metric: 'units', byDefault: true, money: false },
  { id: 'hours', label: 'Labor hours', help: 'Labor hours: people times hours each.', kind: 'hours', get: (row) => dec(row.hours), metric: 'hours', byDefault: true, money: false },
  { id: 'uph', label: 'Units per hour', help: 'Units per person per hour: good units over all labor hours.', kind: 'pace', get: (row) => dec(row.uph), metric: 'uph', goodWhen: 'up', byDefault: true, money: false },
  { id: 'cost_per_unit', label: 'Cost per unit', help: 'All cost over good units.', kind: 'money', get: (row) => row.costPerUnitCents, metric: 'cost_per_unit', goodWhen: 'down', byDefault: false, money: true },
];

const COLUMN_BY_ID: ReadonlyMap<string, ProfitColumn> = new Map(PROFIT_COLUMNS.map((column) => [column.id, column]));
export const profitColumn = (id: string): ProfitColumn | undefined => COLUMN_BY_ID.get(id);

/** The columns to show: the chosen ids in catalog order, or the defaults. Money columns go when money is hidden. */
export function visibleColumns(chosen: readonly string[] | null, seesMoney: boolean): ProfitColumn[] {
  const wanted = chosen && chosen.length > 0 ? new Set(chosen) : null;
  return PROFIT_COLUMNS.filter((column) => (wanted ? wanted.has(column.id) : column.byDefault) && (seesMoney || !column.money));
}

/** A value as it reads in a cell. Missing reads as a blank. */
export function formatValue(value: number | null | undefined, kind: ColumnKind): string {
  if (value === null || value === undefined) return '';
  switch (kind) {
    case 'money':
      return formatMoney(value);
    case 'percent':
      return formatPercentBp(value, { fixed: true });
    case 'hours':
      return formatHours(value, { maxDigits: 1 });
    case 'pace':
      return formatPace(value);
    default:
      return formatNumber(value, { maxDigits: 0 });
  }
}

/** A value as a spreadsheet wants it: plain numbers, percent as a number. */
export function csvValue(value: number | null | undefined, kind: ColumnKind): CsvCell {
  if (value === null || value === undefined) return '';
  // Marked as numbers, so a negative amount is not mistaken for a formula.
  if (kind === 'money') return rawCell(formatMoneyPlain(value));
  if (kind === 'percent') return rawCell((value / 100).toFixed(2));
  return value;
}

export const csvHeader = (column: Pick<ProfitColumn, 'label' | 'kind'>): string => (column.kind === 'percent' ? `${column.label} (%)` : column.label);

/** The name of a row. Time buckets are named by their first day. */
export function rowLabel(by: ProfitGroup, row: Pick<ProfitRowDTO, 'key' | 'label'>): string {
  if (isTimeGroup(by) && /^\d{4}-\d{2}-\d{2}$/.test(row.key)) return formatDateLong(row.key, by as 'day' | 'week' | 'month');
  return row.label;
}

export interface SortState {
  readonly column: string;
  readonly direction: 'asc' | 'desc';
}

export function defaultSort(by: ProfitGroup, seesMoney: boolean): SortState {
  if (isTimeGroup(by)) return { column: 'name', direction: 'asc' };
  return { column: seesMoney ? 'profit' : 'units', direction: 'desc' };
}

/** `?sort=-profit` is profit, biggest first. */
export function parseSort(raw: string | null | undefined, fallback: SortState): SortState {
  if (!raw) return fallback;
  const descending = raw.startsWith('-');
  const column = descending ? raw.slice(1) : raw;
  if (column !== 'name' && column !== 'profit_change' && column !== 'margin_change' && !COLUMN_BY_ID.has(column)) return fallback;
  return { column, direction: descending ? 'desc' : 'asc' };
}

export const sortParam = (sort: SortState): string => `${sort.direction === 'desc' ? '-' : ''}${sort.column}`;

export interface Compared {
  /** Profit now less profit then, in cents. Null when either side is missing. */
  readonly profitDelta: number | null;
  /** Margin now less margin then, in basis points (points x 100). */
  readonly marginDelta: number | null;
  readonly previous: ProfitRowDTO | null;
}

/**
 * Lines the comparison period up with the rows on screen. Things (jobs, clients) match by key.
 * Time buckets match by position: the first week against the first week of the other period.
 */
export function compareRows(by: ProfitGroup, rows: readonly ProfitRowDTO[], previous: readonly ProfitRowDTO[] | null | undefined): Map<string, Compared> {
  const out = new Map<string, Compared>();
  if (!previous) return out;
  const time = isTimeGroup(by);
  const byKey = new Map(previous.map((row) => [row.key, row]));
  const currentOrder = time ? [...rows].sort((a, b) => a.key.localeCompare(b.key)) : rows;
  const previousOrder = time ? [...previous].sort((a, b) => a.key.localeCompare(b.key)) : previous;
  currentOrder.forEach((row, index) => {
    const before = (time ? previousOrder[index] : byKey.get(row.key)) ?? null;
    out.set(row.key, compareOne(row, before));
  });
  return out;
}

export function compareOne(row: ProfitRowDTO, before: ProfitRowDTO | null): Compared {
  if (!before || row.profitCents === null || before.profitCents === null) return { profitDelta: null, marginDelta: null, previous: before };
  const profit = compareMoney(BigInt(row.profitCents), BigInt(before.profitCents), 'up');
  const margin = compareNumber(row.marginBp, before.marginBp, 'up');
  return { profitDelta: profit.deltaCents === null ? null : centsToNumber(profit.deltaCents), marginDelta: margin.delta, previous: before };
}

export function sortRows(by: ProfitGroup, rows: readonly ProfitRowDTO[], sort: SortState, compared: ReadonlyMap<string, Compared>): ProfitRowDTO[] {
  const sign = sort.direction === 'asc' ? 1 : -1;
  const value = (row: ProfitRowDTO): number | string | null => {
    if (sort.column === 'name') return isTimeGroup(by) ? row.key : row.label.toLowerCase();
    if (sort.column === 'profit_change') return compared.get(row.key)?.profitDelta ?? null;
    if (sort.column === 'margin_change') return compared.get(row.key)?.marginDelta ?? null;
    return COLUMN_BY_ID.get(sort.column)?.get(row) ?? null;
  };
  return [...rows].sort((a, b) => {
    const left = value(a);
    const right = value(b);
    // Rows with nothing to sort on always sink to the bottom.
    if (left === null && right === null) return a.label.localeCompare(b.label);
    if (left === null) return 1;
    if (right === null) return -1;
    if (typeof left === 'string' || typeof right === 'string') return String(left).localeCompare(String(right)) * sign;
    return left === right ? a.label.localeCompare(b.label) : (left - right) * sign;
  });
}

/** The filters a row adds on top of the page filters: the scope of its "How we got this" and of the level below. */
export function rowScope(by: ProfitGroup, key: string, range: { from: string; to: string }): Partial<ProfitParams> | null {
  if (key === 'none' || key === 'total') return null;
  switch (by) {
    case 'job':
      return { jobId: key };
    case 'client':
      return { clientId: key };
    case 'type':
      return { jobTypeId: key };
    case 'service':
      return { serviceId: key };
    case 'site':
      return { siteId: key };
    case 'month':
    case 'week':
    case 'day': {
      const end = by === 'month' ? endOfMonth(key) : by === 'week' ? addDays(key, 6) : key;
      return { from: key < range.from ? range.from : key, to: end > range.to ? range.to : end };
    }
  }
}

export interface DrillTarget {
  /** Query keys to set. `entries` opens the rows behind the number. */
  readonly patch: Readonly<Record<string, string | null>>;
  /** What the click does, for the row's label: "See the jobs of Acme". */
  readonly words: string;
}

/**
 * Where a click on a row leads: one level down, and at the bottom, the entries.
 * client and job type open their jobs; a site opens its clients; an extra service opens the
 * clients using it; a job opens its days; a month opens its weeks; a week opens its days; a day
 * opens the entries behind it.
 */
export function drillTarget(by: ProfitGroup, row: Pick<ProfitRowDTO, 'key' | 'label'>, range: { from: string; to: string }): DrillTarget | null {
  if (row.key === 'none' || row.key === 'total') return null;
  const name = rowLabel(by, row);
  const sortReset = { sort: null, view: null, cols: null };
  switch (by) {
    case 'client':
      return { patch: { by: 'job', client: row.key, ...sortReset }, words: `See the jobs of ${name}` };
    case 'type':
      return { patch: { by: 'job', jobType: row.key, ...sortReset }, words: `See the ${name} jobs` };
    case 'site':
      return { patch: { by: 'client', site: row.key, ...sortReset }, words: `See the clients at ${name}` };
    case 'service':
      return { patch: { by: 'client', service: row.key, ...sortReset }, words: `See the clients using ${name}` };
    case 'job':
      return { patch: { by: 'day', job: row.key, ...sortReset }, words: `See ${name} day by day` };
    case 'month':
    case 'week': {
      const scope = rowScope(by, row.key, range) as { from: string; to: string };
      return { patch: { by: by === 'month' ? 'week' : 'day', range: 'custom', from: scope.from, to: scope.to, ...sortReset }, words: by === 'month' ? `See the weeks of ${name}` : `See the days of the ${name.toLowerCase()}` };
    }
    case 'day':
      return { patch: { entries: 'all', day: row.key }, words: `See the entries of ${name}` };
  }
}

/** Direct costs and what is left before shared costs, from the same pure summary the profit rows use. */
export function contribution(row: ProfitRowDTO): { directCents: number; contributionCents: number } | null {
  if (row.revenueCents === null || row.laborCents === null || row.materialCents === null || row.otherCents === null || row.sharedCents === null) return null;
  const summary = profitSummary({ revenueCents: BigInt(row.revenueCents), laborCents: BigInt(row.laborCents), materialCents: BigInt(row.materialCents), otherCents: BigInt(row.otherCents), sharedCents: BigInt(row.sharedCents) });
  return { directCents: centsToNumber(addCents(row.laborCents, row.materialCents, row.otherCents)), contributionCents: centsToNumber(summary.profitBeforeSharedCents) };
}

export interface ParetoView {
  readonly ranked: readonly RankedRow<ProfitRowDTO>[];
  /** How many of the top rows make 80% of the profit made. Null when nothing made a profit. */
  readonly toEighty: number | null;
  readonly losing: number;
  /** Profit from the rows that made money. Every share in this view is a share of this, so the running share never passes 100%. */
  readonly madeCents: bigint;
  /** Money lost by the rows that lost money, as a positive amount. */
  readonly gaveBackCents: bigint;
}

/**
 * The whale curve: rows ranked by profit with each one's share and the running share. The base is
 * profit from the rows that made money (the same base the chart draws), so the headline, the chart
 * and the table agree. The running share climbs to 100% at the last money maker, then the rows that
 * lost money pull it back down.
 */
export function paretoView(rows: readonly ProfitRowDTO[]): ParetoView {
  const withMoney = rows.filter((row) => row.profitCents !== null && row.revenueCents !== null);
  const base = rankByProfit(withMoney, (row) => ({ revenueCents: BigInt(row.revenueCents as number), profitCents: BigInt(row.profitCents as number) }));
  const zero = BigInt(0);
  const madeCents = base.reduce((sum, row) => (row.profitCents > zero ? sum + row.profitCents : sum), zero);
  const lostCents = base.reduce((sum, row) => (row.profitCents < zero ? sum + row.profitCents : sum), zero);
  const ranked = base.map((row) => ({ ...row, profitShareBp: ratioBp(row.profitCents, madeCents), cumulativeProfitShareBp: ratioBp(row.cumulativeProfitCents, madeCents) }));
  return { ranked, toEighty: rowsToReachProfitShare(ranked), losing: ranked.filter((row) => row.profitCents < zero).length, madeCents, gaveBackCents: -lostCents };
}

export const PIVOT_MEASURES = ['profit', 'revenue', 'cost', 'margin', 'units', 'hours'] as const;
export type PivotMeasure = (typeof PIVOT_MEASURES)[number];

export const PIVOT_MEASURE_LABELS: Readonly<Record<PivotMeasure, string>> = { profit: 'Profit', revenue: 'Revenue', cost: 'Cost', margin: 'Margin', units: 'Units', hours: 'Labor hours' };
export const PIVOT_MEASURE_KIND: Readonly<Record<PivotMeasure, ColumnKind>> = { profit: 'money', revenue: 'money', cost: 'money', margin: 'percent', units: 'number', hours: 'hours' };

export function pivotValue(cell: PivotCellDTO | undefined, measure: PivotMeasure): number | null {
  if (!cell) return null;
  switch (measure) {
    case 'profit':
      return cell.profitCents;
    case 'revenue':
      return cell.revenueCents;
    case 'cost':
      return cell.costCents;
    case 'margin':
      return cell.marginBp;
    case 'units':
      return Number(cell.unitsGood);
    case 'hours':
      return Number(cell.hours);
  }
}

/** The second grouping a pivot starts with: time for things, clients for time. */
export function defaultPivotBy(by: ProfitGroup): ProfitGroup {
  return isTimeGroup(by) ? 'client' : 'month';
}

/** The pivot grid as CSV: one row per row group, one column per column group, then the totals. */
export function pivotCsv(pivot: ProfitPivotDTO, measure: PivotMeasure): { headers: string[]; rows: CsvCell[][] } {
  const kind = PIVOT_MEASURE_KIND[measure];
  const headers = [VIEW_LABELS[pivot.rowBy], ...pivot.cols.map((col) => rowLabel(pivot.colBy, col)), 'Total'];
  const rows: CsvCell[][] = pivot.rows.map((row) => [rowLabel(pivot.rowBy, row), ...pivot.cols.map((col) => csvValue(pivotValue(pivot.cells[row.key]?.[col.key], measure), kind)), csvValue(pivotValue(pivot.rowTotals[row.key], measure), kind)]);
  rows.push(['Total', ...pivot.cols.map((col) => csvValue(pivotValue(pivot.colTotals[col.key], measure), kind)), csvValue(pivotValue(pivot.total, measure), kind)]);
  return { headers, rows };
}

export const FACT_KIND_LABELS: Readonly<Record<string, string>> = {
  revenue_base: 'Revenue, units done',
  revenue_vas: 'Revenue, extra service',
  revenue_other: 'Revenue, other',
  labor: 'Labor',
  material: 'Material',
  other: 'Other cost',
  shared: 'Time not on a job',
  billed_memo: 'Billed',
};

/** The entry filters of the drill down drawer (`?entries=`) and the fact kinds each one shows. */
export const ENTRY_FILTERS = ['all', 'revenue', 'labor', 'material', 'other', 'shared'] as const;
export type EntryFilter = (typeof ENTRY_FILTERS)[number];
export const ENTRY_FILTER_LABELS: Readonly<Record<EntryFilter, string>> = { all: 'Everything', revenue: 'Revenue', labor: 'Labor', material: 'Material', other: 'Other costs', shared: 'Time not on a job' };
export const ENTRY_FILTER_KINDS: Readonly<Record<EntryFilter, readonly string[]>> = {
  all: [],
  revenue: ['revenue_base', 'revenue_vas', 'revenue_other'],
  labor: ['labor'],
  material: ['material'],
  other: ['other'],
  shared: ['shared'],
};

const RANGE_ALIASES: Readonly<Record<string, string>> = { last_30_days: 'last_30', last_90_days: 'last_90', this_quarter: 'this_quarter' };

/**
 * Turns a saved view into the query string it stands for. Views saved from the explorer hold the
 * query as it was (`config.query`). Older and seeded views hold plain fields (`by`, `sort`,
 * `direction`, `range`, `compare`), which are mapped here.
 */
export function viewToQuery(config: Readonly<Record<string, unknown>>): Record<string, string> {
  const query = config.query;
  if (query && typeof query === 'object') {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(query as Record<string, unknown>)) if (typeof value === 'string' && value !== '') out[key] = value;
    return out;
  }
  const out: Record<string, string> = {};
  const text = (key: string): string | null => (typeof config[key] === 'string' && config[key] !== '' ? (config[key] as string) : null);
  const by = text('by');
  if (by && by !== 'job') out.by = by;
  const range = text('range');
  if (range) out.range = RANGE_ALIASES[range] ?? range;
  for (const key of ['from', 'to', 'site', 'client', 'jobType', 'status', 'view']) {
    const value = text(key);
    if (value) out[key] = value;
  }
  const sort = text('sort');
  if (sort) out.sort = `${text('direction') === 'asc' ? '' : '-'}${sort}`;
  const compare = config.compare;
  if (compare === true || compare === 'prior') out.compare = 'prior';
  else if (compare === 'last_year') out.compare = 'last_year';
  return out;
}
