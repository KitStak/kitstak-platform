/**
 * The report library (SPEC section 6, `/reports`), the two way pivot and the named drill down
 * rows of the Profit explorer, and report schedules with their builds.
 *
 * Every report is built once here as a `ReportDTO` (columns, rows, total, summary, chart). The
 * page, the CSV download, the print view and scheduled builds all read that one shape, so they
 * can never disagree. Profit numbers come from the profit rollups and the pure library; the SQL
 * here only sums stamped cents.
 */
import 'server-only';
import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { db } from '@/server/db';
import { reportRuns, reportSchedules } from '@/server/db/schema';
import { forbidden, invalid, notFound } from '@/server/errors';
import { reportCellText, reportToCsv, reportToHtml } from '@/features/reports/report-format';
import { JOB_STATUS_LABELS, PROFIT_GROUPS, type FactKind, type JobStatusValue, type ProfitGroup } from '@/lib/constants';
import { marginBp, perUnitCents, subCents, toCents } from '@/lib/money';
import { canPulse } from '@/lib/permissions';
import {
  VARIANCE_ORDER,
  VARIANCE_LABELS,
  costToServe,
  endOfMonth,
  flexFactor,
  flexPlan,
  planFigures,
  productivityBp,
  scrapRateBp,
  shortDate,
  startOfMonth,
  sumWaterfalls,
  varianceWaterfall,
  type ActualTotals,
  type JobMoney,
  type PlanTotals,
  type Waterfall,
} from '@/lib/profit';
import {
  REPORTS,
  SCHEDULE_CADENCES,
  SCHEDULE_RANGES,
  nextScheduleRun,
  rangeLabel,
  reportInfo,
  resolveScheduleRange,
  type ReportInfo,
  type ScheduleCadence,
  type ScheduleRange,
} from '@/lib/reports';
import { routes } from '@/lib/routes';
import type {
  PivotCellDTO,
  ProfitEntriesDTO,
  ProfitFilters,
  ProfitPivotDTO,
  ProfitRowDTO,
  ReportCell,
  ReportCellKind,
  ReportChartDTO,
  ReportColumnDTO,
  ReportDTO,
  ReportRowDTO,
  ReportRunDTO,
  ReportScheduleDTO,
} from '@/lib/types';
import { centsOut, cleanText, inTx, iso, isoRequired, isUuid, moneyOut, rows, todayInZone, type DomainContext } from './_shared';
import { requirePulse } from './access';
import { listActivity, logActivity } from './activity';
import { resolveSite } from './catalog';
import { listJobs } from './jobs';
import { notify } from './notifications';
import { filterOrgMembers } from './people';
import { getCloseChecklist } from './periods';
import { listProduction } from './production';
import { getCompanyBridge, getLaborSummary, getProfit, toProfitRow } from './profit';
import { resolveAllAccess } from './roles';
import { loadSettings } from './settings';

const ZERO = BigInt(0);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ROW_CAP = 5000;

export interface ReportFilters {
  readonly from: string;
  readonly to: string;
  readonly siteId?: string | null;
  readonly clientId?: string | null;
  readonly jobTypeId?: string | null;
  readonly status?: JobStatusValue | null;
}

function checkFilters(filters: ReportFilters): void {
  if (!DATE_RE.test(filters.from) || !DATE_RE.test(filters.to)) throw invalid('Pick a start day and an end day.');
  if (filters.to < filters.from) throw invalid('The end day is before the start day.');
  for (const id of [filters.siteId, filters.clientId, filters.jobTypeId]) if (id && !isUuid(id)) throw invalid('One of the filters is not valid.');
}

const profitFilters = (filters: ReportFilters): ProfitFilters => ({ from: filters.from, to: filters.to, siteId: filters.siteId ?? null, clientId: filters.clientId ?? null, jobTypeId: filters.jobTypeId ?? null, status: filters.status ?? null });

/* ================================================================== the pivot and the drill down rows */

type Bucket = Parameters<typeof toProfitRow>[0];

const weekExpr = (weekStart: number): SQL => sql`(f.work_date - ((EXTRACT(DOW FROM f.work_date)::int - ${weekStart}::int + 7) % 7))`;

/** Key and label of one grouping, written against `fact_days f` with the lookups joined in `PIVOT_JOINS`. */
function dimension(by: ProfitGroup, weekStart: number): { key: SQL; label: SQL; sublabel: SQL } {
  switch (by) {
    case 'job':
      return { key: sql`f.job_id::text`, label: sql`max(j.number)`, sublabel: sql`max(j.name)` };
    case 'client':
      return { key: sql`f.client_id::text`, label: sql`max(c.name)`, sublabel: sql`max(c.code)` };
    case 'type':
      return { key: sql`f.job_type_id::text`, label: sql`max(jt.name)`, sublabel: sql`max(jt.code)` };
    case 'service':
      return { key: sql`f.vas_service_id::text`, label: sql`max(vs.name)`, sublabel: sql`max(vs.code)` };
    case 'site':
      return { key: sql`f.site_id::text`, label: sql`max(s.name)`, sublabel: sql`max(s.code)` };
    case 'month':
      return { key: sql`to_char(date_trunc('month', f.work_date), 'YYYY-MM-DD')`, label: sql`NULL::text`, sublabel: sql`NULL::text` };
    case 'week':
      return { key: sql`to_char(${weekExpr(weekStart)}, 'YYYY-MM-DD')`, label: sql`NULL::text`, sublabel: sql`NULL::text` };
    case 'day':
      return { key: sql`to_char(f.work_date, 'YYYY-MM-DD')`, label: sql`NULL::text`, sublabel: sql`NULL::text` };
  }
}

const PIVOT_JOINS = sql`
  LEFT JOIN pulse.jobs j ON j.id = f.job_id
  LEFT JOIN pulse.clients c ON c.id = f.client_id
  LEFT JOIN pulse.job_types jt ON jt.id = f.job_type_id
  LEFT JOIN pulse.vas_services vs ON vs.id = f.vas_service_id
  LEFT JOIN pulse.sites s ON s.id = f.site_id`;

const NULL_LABELS: Readonly<Record<ProfitGroup, string>> = { job: 'Client level, no job', client: 'No client', type: 'No job type', service: 'Core job work', site: 'No site', month: '', week: '', day: '' };

function factWhere(orgId: string, filters: ProfitFilters): SQL {
  const parts: SQL[] = [sql`f.org_id = ${orgId}`, sql`f.work_date BETWEEN ${filters.from}::date AND ${filters.to}::date`];
  if (filters.siteId) parts.push(sql`f.site_id = ${filters.siteId}`);
  if (filters.clientId) parts.push(sql`f.client_id = ${filters.clientId}`);
  if (filters.jobTypeId) parts.push(sql`f.job_type_id = ${filters.jobTypeId}`);
  if (filters.jobId) parts.push(sql`f.job_id = ${filters.jobId}`);
  if (filters.vasServiceId) parts.push(sql`f.vas_service_id = ${filters.vasServiceId}`);
  if (filters.status) parts.push(sql`j.status = ${filters.status}`);
  return sql.join(parts, sql` AND `);
}

function checkProfitFilters(filters: ProfitFilters): void {
  if (!DATE_RE.test(filters.from) || !DATE_RE.test(filters.to)) throw invalid('Pick a start day and an end day.');
  if (filters.to < filters.from) throw invalid('The end day is before the start day.');
  for (const id of [filters.siteId, filters.clientId, filters.jobTypeId, filters.jobId, filters.vasServiceId]) if (id && !isUuid(id)) throw invalid('One of the filters is not valid.');
}

function emptyBucket(key: string, label: string): Bucket {
  return { key, label, sublabel: null, base: ZERO, vas: ZERO, otherRev: ZERO, labor: ZERO, material: ZERO, other: ZERO, shared: ZERO, billed: ZERO, units: 0, scrap: 0, hours: 0, jobs: 0, laborMissing: false, risk: null };
}

function addInto(target: Bucket, source: Bucket): void {
  target.base += source.base;
  target.vas += source.vas;
  target.otherRev += source.otherRev;
  target.labor += source.labor;
  target.material += source.material;
  target.other += source.other;
  target.shared += source.shared;
  target.units += source.units;
  target.hours += source.hours;
}

const cellOf = (row: ProfitRowDTO): PivotCellDTO => ({ revenueCents: row.revenueCents, costCents: row.costCents, profitCents: row.profitCents, marginBp: row.marginBp, unitsGood: row.unitsGood, hours: row.hours });

/**
 * Profit grouped by two things at once (clients by month, job types by site). Every cell uses the
 * same `toProfitRow` as the explorer, and the row totals, column totals and grand total are sums
 * of the cells, so the grid always adds up to the Profit page.
 */
export async function getProfitPivot(ctx: DomainContext, rowBy: ProfitGroup, colBy: ProfitGroup, filters: ProfitFilters): Promise<ProfitPivotDTO> {
  const access = await requirePulse(ctx, 'pulse:read');
  for (const by of [rowBy, colBy]) if (!(PROFIT_GROUPS as readonly string[]).includes(by)) throw invalid('Pick how to group the numbers.');
  if (rowBy === colBy) throw invalid('Pick two different things to compare.');
  checkProfitFilters(filters);
  const settings = await loadSettings(ctx.orgId);
  const row = dimension(rowBy, settings.weekStart);
  const col = dimension(colBy, settings.weekStart);
  const found = await rows<{ rk: string | null; rl: string | null; rs: string | null; ck: string | null; cl: string | null; cs: string | null; base: string; vas: string; other_rev: string; labor: string; material: string; other: string; shared: string; units: string; hours: string }>(
    db,
    sql`SELECT ${row.key} AS rk, ${row.label} AS rl, ${row.sublabel} AS rs, ${col.key} AS ck, ${col.label} AS cl, ${col.sublabel} AS cs,
               COALESCE(sum(f.amount_cents) FILTER (WHERE f.kind = 'revenue_base'), 0)::text AS base,
               COALESCE(sum(f.amount_cents) FILTER (WHERE f.kind = 'revenue_vas'), 0)::text AS vas,
               COALESCE(sum(f.amount_cents) FILTER (WHERE f.kind = 'revenue_other'), 0)::text AS other_rev,
               COALESCE(sum(f.amount_cents) FILTER (WHERE f.kind = 'labor'), 0)::text AS labor,
               COALESCE(sum(f.amount_cents) FILTER (WHERE f.kind = 'material'), 0)::text AS material,
               COALESCE(sum(f.amount_cents) FILTER (WHERE f.kind = 'other'), 0)::text AS other,
               COALESCE(sum(f.amount_cents) FILTER (WHERE f.kind = 'shared'), 0)::text AS shared,
               COALESCE(sum(f.units_good) FILTER (WHERE f.kind = 'revenue_base'), 0)::text AS units,
               COALESCE(sum(f.hours), 0)::text AS hours
          FROM pulse.fact_days f ${PIVOT_JOINS}
         WHERE ${factWhere(ctx.orgId, filters)}
         GROUP BY 1, 4
         ORDER BY 1, 4`,
  );
  const rowHeads = new Map<string, { key: string; label: string; sublabel: string | null }>();
  const colHeads = new Map<string, { key: string; label: string; sublabel: string | null }>();
  const rowTotals = new Map<string, Bucket>();
  const colTotals = new Map<string, Bucket>();
  const grand = emptyBucket('total', 'Total');
  const cells: Record<string, Record<string, PivotCellDTO>> = {};
  for (const item of found) {
    const rk = item.rk ?? 'none';
    const ck = item.ck ?? 'none';
    if (!rowHeads.has(rk)) rowHeads.set(rk, { key: rk, label: item.rl ?? (NULL_LABELS[rowBy] || rk), sublabel: item.rs });
    if (!colHeads.has(ck)) colHeads.set(ck, { key: ck, label: item.cl ?? (NULL_LABELS[colBy] || ck), sublabel: item.cs });
    const bucket: Bucket = { ...emptyBucket(`${rk}|${ck}`, ''), base: BigInt(item.base), vas: BigInt(item.vas), otherRev: BigInt(item.other_rev), labor: BigInt(item.labor), material: BigInt(item.material), other: BigInt(item.other), shared: BigInt(item.shared), units: Number(item.units), hours: Number(item.hours) };
    (cells[rk] ??= {})[ck] = cellOf(toProfitRow(bucket, access));
    if (!rowTotals.has(rk)) rowTotals.set(rk, emptyBucket(rk, ''));
    if (!colTotals.has(ck)) colTotals.set(ck, emptyBucket(ck, ''));
    addInto(rowTotals.get(rk)!, bucket);
    addInto(colTotals.get(ck)!, bucket);
    addInto(grand, bucket);
  }
  const isTime = (by: ProfitGroup): boolean => by === 'month' || by === 'week' || by === 'day';
  const sortHeads = (heads: Map<string, { key: string; label: string; sublabel: string | null }>, by: ProfitGroup, totals: Map<string, Bucket>) => {
    const list = [...heads.values()];
    if (isTime(by)) return list.sort((a, b) => a.key.localeCompare(b.key));
    // Biggest revenue first, so the most important rows and columns are on screen.
    const revenue = (key: string): bigint => {
      const bucket = totals.get(key)!;
      return bucket.base + bucket.vas + bucket.otherRev;
    };
    return list.sort((a, b) => (revenue(a.key) === revenue(b.key) ? a.label.localeCompare(b.label) : revenue(a.key) > revenue(b.key) ? -1 : 1));
  };
  const totalsOut = (totals: Map<string, Bucket>): Record<string, PivotCellDTO> => Object.fromEntries([...totals.entries()].map(([key, bucket]) => [key, cellOf(toProfitRow(bucket, access))]));
  return {
    rowBy,
    colBy,
    from: filters.from,
    to: filters.to,
    rows: sortHeads(rowHeads, rowBy, rowTotals),
    cols: sortHeads(colHeads, colBy, colTotals),
    cells,
    rowTotals: totalsOut(rowTotals),
    colTotals: totalsOut(colTotals),
    total: cellOf(toProfitRow(grand, access)),
    moneyHidden: !access.seesMoney,
  };
}

const SOURCE_LABELS: Readonly<Record<string, string>> = {
  production_entries: 'Work log',
  vas_entries: 'Extra service',
  cost_entries: 'Cost',
  revenue_entries: 'Revenue',
  material_usage: 'Material used',
};

/**
 * The stamped rows behind a profit number, with job, client and service names and the note that
 * was typed with the row. This is the last stop of every drill down. Reads `v_facts`.
 */
export async function listProfitEntries(ctx: DomainContext, filters: ProfitFilters & { kinds?: readonly FactKind[]; limit?: number }): Promise<ProfitEntriesDTO> {
  const access = await requirePulse(ctx, 'pulse:read');
  checkProfitFilters(filters);
  const limit = Math.min(Math.max(filters.limit ?? 500, 1), 2000);
  const kinds = filters.kinds && filters.kinds.length > 0 ? sql`AND f.kind = ANY(ARRAY[${sql.join(filters.kinds.map((kind) => sql`${kind}`), sql`, `)}]::text[])` : sql`AND f.kind <> 'billed_memo'`;
  const found = await rows<{ work_date: string; kind: FactKind; amount_cents: string; units_good: string; hours: string; job_id: string | null; job_number: string | null; job_name: string | null; client_id: string; client_name: string | null; service_name: string | null; source_table: string; source_id: string; note: string | null }>(
    db,
    sql`SELECT to_char(f.work_date, 'YYYY-MM-DD') AS work_date, f.kind, f.amount_cents::text, f.units_good::text, f.hours::text, f.job_id, j.number AS job_number, j.name AS job_name,
               f.client_id, c.name AS client_name, vs.name AS service_name, f.source_table, f.source_id,
               CASE f.source_table
                 WHEN 'production_entries' THEN (SELECT p.note FROM pulse.production_entries p WHERE p.id = f.source_id)
                 WHEN 'vas_entries' THEN (SELECT v.note FROM pulse.vas_entries v WHERE v.id = f.source_id)
                 WHEN 'cost_entries' THEN (SELECT COALESCE(NULLIF(x.note, ''), x.vendor, x.category) FROM pulse.cost_entries x WHERE x.id = f.source_id)
                 WHEN 'revenue_entries' THEN (SELECT COALESCE(NULLIF(r.description, ''), r.note, r.invoice_number) FROM pulse.revenue_entries r WHERE r.id = f.source_id)
                 WHEN 'material_usage' THEN (SELECT COALESCE(NULLIF(m.item_name, ''), m.item_sku) FROM pulse.material_usage m WHERE m.id = f.source_id)
               END AS note
          FROM pulse.v_facts f
          LEFT JOIN pulse.jobs j ON j.id = f.job_id
          LEFT JOIN pulse.clients c ON c.id = f.client_id
          LEFT JOIN pulse.vas_services vs ON vs.id = f.vas_service_id
         WHERE ${factWhere(ctx.orgId, filters)} ${kinds}
         ORDER BY f.work_date DESC, j.number NULLS LAST, f.source_table, f.source_id, f.kind
         LIMIT ${limit + 1}`,
  );
  return {
    rows: found.slice(0, limit).map((row) => ({
      workDate: row.work_date,
      kind: row.kind,
      amountCents: moneyOut(access.seesMoney, row.amount_cents),
      unitsGood: row.units_good,
      hours: row.hours,
      jobId: row.job_id,
      jobNumber: row.job_number,
      jobName: row.job_name,
      clientId: row.client_id,
      clientName: row.client_name,
      serviceName: row.service_name,
      sourceTable: row.source_table,
      sourceId: row.source_id,
      sourceLabel: SOURCE_LABELS[row.source_table] ?? 'Entry',
      note: row.note,
    })),
    truncated: found.length > limit,
    moneyHidden: !access.seesMoney,
  };
}

/* ================================================================== report building blocks */

type Cells = Record<string, ReportCell>;

const col = (key: string, label: string, kind: ReportCellKind, extra: Partial<ReportColumnDTO> = {}): ReportColumnDTO => ({ key, label, kind, ...(kind === 'money' ? { money: true } : {}), ...extra });

const num = (value: string | number | null | undefined): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const PROFIT_COLUMNS: readonly ReportColumnDTO[] = [
  col('revenue', 'Revenue', 'money'),
  col('labor', 'Labor', 'money'),
  col('material', 'Material', 'money'),
  col('other', 'Other costs', 'money'),
  col('shared', 'Time not on a job', 'money'),
  col('cost', 'Cost', 'money'),
  col('profit', 'Profit', 'money'),
  col('margin', 'Margin after all costs', 'percent', { money: true }),
  col('margin_before', 'Margin before shared costs', 'percent', { money: true }),
  col('units', 'Units', 'number'),
  col('hours', 'Labor hours', 'hours'),
  col('uph', 'Units per person per hour', 'pace'),
];

function profitCells(row: ProfitRowDTO): Cells {
  return {
    revenue: row.revenueCents,
    labor: row.laborCents,
    material: row.materialCents,
    other: row.otherCents,
    shared: row.sharedCents,
    cost: row.costCents,
    profit: row.profitCents,
    margin: row.marginBp,
    margin_before: row.marginBeforeSharedBp,
    units: num(row.unitsGood),
    hours: num(row.hours),
    uph: num(row.uph),
  };
}

interface Built {
  readonly columns: readonly ReportColumnDTO[];
  readonly rows: ReportRowDTO[];
  readonly total?: Cells | null;
  readonly summary?: ReportDTO['summary'];
  readonly chart?: ReportChartDTO | null;
  readonly notes?: string[];
  /** False for reports about right now, which ignore the date range. */
  readonly usesDates?: boolean;
  /** A report that picks its own days (the month close pack) says which. */
  readonly range?: { from: string; to: string };
}

const headline = (total: ProfitRowDTO): ReportDTO['summary'] => [
  { label: 'Revenue', value: total.revenueCents, kind: 'money' },
  { label: 'Cost', value: total.costCents, kind: 'money' },
  { label: 'Profit', value: total.profitCents, kind: 'money' },
  { label: 'Margin after all costs', value: total.marginBp, kind: 'percent' },
];

/** Best and worst by profit, at most `limit` bars, for a ranking chart. */
function rankingChart(title: string, items: readonly { label: string; profit: number | null }[], limit = 12): ReportChartDTO | null {
  const withMoney = items.filter((item): item is { label: string; profit: number } => item.profit !== null);
  if (withMoney.length === 0) return null;
  const sorted = [...withMoney].sort((a, b) => b.profit - a.profit);
  const shown = sorted.length <= limit ? sorted : [...sorted.slice(0, limit / 2), ...sorted.slice(-limit / 2)];
  return {
    type: 'hbar',
    title,
    description: sorted.length <= limit ? 'Most profit at the top. Bars to the left lost money.' : `The ${limit / 2} best and the ${limit / 2} worst by profit. Bars to the left lost money.`,
    labels: shown.map((item) => item.label),
    series: [{ id: 'profit', label: 'Profit', values: shown.map((item) => item.profit) }],
    format: 'money',
    signColors: true,
  };
}

interface JobMeta {
  id: string;
  number: string;
  name: string;
  client: string;
  type: string;
  status: JobStatusValue;
  risk: string | null;
  standard_uph: string | null;
  unit_label: string;
}

async function jobMeta(orgId: string, ids: readonly string[]): Promise<Map<string, JobMeta>> {
  const clean = ids.filter(isUuid);
  if (clean.length === 0) return new Map();
  const found = await rows<JobMeta>(
    db,
    sql`SELECT j.id, j.number, j.name, c.name AS client, jt.name AS type, j.status, st.risk_status AS risk, COALESCE(st.standard_uph, j.standard_uph)::text AS standard_uph, j.unit_label
          FROM pulse.jobs j JOIN pulse.clients c ON c.id = j.client_id JOIN pulse.job_types jt ON jt.id = j.job_type_id LEFT JOIN pulse.job_stats st ON st.job_id = j.id
         WHERE j.org_id = ${orgId} AND j.id = ANY(ARRAY[${sql.join(clean.map((id) => sql`${id}`), sql`, `)}]::uuid[])`,
  );
  return new Map(found.map((row) => [row.id, row]));
}

function jobScope(filters: ReportFilters): SQL {
  const parts: SQL[] = [];
  if (filters.siteId) parts.push(sql`AND j.site_id = ${filters.siteId}`);
  if (filters.clientId) parts.push(sql`AND j.client_id = ${filters.clientId}`);
  if (filters.jobTypeId) parts.push(sql`AND j.job_type_id = ${filters.jobTypeId}`);
  if (filters.status) parts.push(sql`AND j.status = ${filters.status}`);
  return sql.join(parts, sql` `);
}

/* ================================================================== the reports */

async function jobProfit(ctx: DomainContext, filters: ReportFilters): Promise<Built> {
  const profit = await getProfit(ctx, 'job', profitFilters(filters));
  const meta = await jobMeta(ctx.orgId, profit.rows.map((row) => row.key));
  const sorted = [...profit.rows].sort((a, b) => (b.profitCents ?? 0) - (a.profitCents ?? 0));
  return {
    columns: [col('job', 'Job', 'text'), col('name', 'Name', 'text'), col('client', 'Client', 'text'), col('type', 'Job type', 'text'), col('status', 'Job status', 'job_status'), col('risk', 'Health', 'status'), ...PROFIT_COLUMNS],
    rows: sorted.map((row) => {
      const job = meta.get(row.key);
      return { id: row.key, href: job ? routes.job(job.number) : null, cells: { job: job?.number ?? row.label, name: job?.name ?? row.sublabel, client: job?.client ?? null, type: job?.type ?? null, status: job?.status ?? null, risk: job?.risk ?? null, ...profitCells(row) } };
    }),
    total: { job: 'Total', ...profitCells(profit.total) },
    summary: headline(profit.total),
    chart: rankingChart('Profit by job', sorted.map((row) => ({ label: meta.get(row.key)?.number ?? row.label, profit: row.profitCents }))),
    notes: ['Each job counts only the work and costs dated inside these days.'],
  };
}

async function profitBy(ctx: DomainContext, filters: ReportFilters, by: 'client' | 'type' | 'service', first: string): Promise<Built> {
  const profit = await getProfit(ctx, by, profitFilters(filters));
  const sorted = [...profit.rows].sort((a, b) => (b.profitCents ?? 0) - (a.profitCents ?? 0));
  const href = (row: ProfitRowDTO): string | null => (row.key === 'none' ? null : by === 'client' ? routes.client(row.key) : by === 'service' ? routes.service(row.key) : null);
  return {
    columns: [col('name', first, 'text'), col('code', 'Code', 'text'), col('jobs', 'Jobs', 'number'), ...PROFIT_COLUMNS, col('labor_pct', 'Labor as % of revenue', 'percent', { money: true }), col('cost_per_unit', 'Cost per unit', 'money')],
    rows: sorted.map((row) => ({ id: row.key, href: href(row), cells: { name: row.label, code: row.sublabel, jobs: row.jobCount, ...profitCells(row), labor_pct: row.laborPctBp, cost_per_unit: row.costPerUnitCents } })),
    total: { name: 'Total', jobs: profit.total.jobCount, ...profitCells(profit.total), labor_pct: profit.total.laborPctBp, cost_per_unit: profit.total.costPerUnitCents },
    summary: headline(profit.total),
    chart: rankingChart(`Profit by ${first.toLowerCase()}`, sorted.map((row) => ({ label: row.label, profit: row.profitCents }))),
    notes: by === 'service' ? ['Core job work is everything that is not an extra service, so the total matches the Profit page.'] : [],
  };
}

async function profitBySite(ctx: DomainContext, filters: ReportFilters): Promise<Built> {
  const profit = await getProfit(ctx, 'site', profitFilters(filters));
  const bridges = new Map(await Promise.all(profit.rows.filter((row) => isUuid(row.key)).map(async (row) => [row.key, await getCompanyBridge(ctx, { from: filters.from, to: filters.to, siteId: row.key })] as const)));
  return {
    columns: [col('name', 'Site', 'text'), col('jobs', 'Jobs', 'number'), ...PROFIT_COLUMNS, col('off_job_hours', 'Hours not on a job', 'hours'), col('on_jobs', 'Share of paid time spent on jobs', 'percent')],
    rows: profit.rows.map((row) => {
      const bridge = bridges.get(row.key);
      return { id: row.key, cells: { name: row.label, jobs: row.jobCount, ...profitCells(row), off_job_hours: num(bridge?.indirectHours), on_jobs: bridge?.utilizationBp ?? null } };
    }),
    total: { name: 'Total', jobs: profit.total.jobCount, ...profitCells(profit.total) },
    summary: headline(profit.total),
    chart: profit.rows.length > 0 ? { type: 'bar', title: 'Margin by site', description: 'Margin after all costs for each site.', labels: profit.rows.map((row) => row.label), series: [{ id: 'margin', label: 'Margin after all costs', values: profit.rows.map((row) => row.marginBp) }], format: 'percent', signColors: true } : null,
  };
}

async function monthlyProfitAndLoss(ctx: DomainContext, filters: ReportFilters): Promise<Built> {
  const profit = await getProfit(ctx, 'month', profitFilters(filters));
  const months = await Promise.all(
    profit.rows.map(async (row) => {
      const from = row.key < filters.from ? filters.from : row.key;
      const monthEnd = endOfMonth(row.key);
      const to = monthEnd > filters.to ? filters.to : monthEnd;
      return { row, bridge: await getCompanyBridge(ctx, { from, to, siteId: filters.siteId ?? null }) };
    }),
  );
  const whole = await getCompanyBridge(ctx, { from: filters.from, to: filters.to, siteId: filters.siteId ?? null });
  const monthWords = (key: string): string => `${shortDate(key).split(' ')[0]} ${key.slice(0, 4)}`;
  const bridgeCells = (bridge: typeof whole): Cells => ({ shared_gap: bridge.sharedGapCents, missing: bridge.missingCostCents, overhead_gap: bridge.overheadGapCents, company_profit: bridge.companyProfitCents });
  const narrowed = Boolean(filters.clientId || filters.jobTypeId || filters.status);
  return {
    columns: [
      col('month', 'Month', 'text'),
      col('revenue', 'Revenue', 'money'),
      col('labor', 'Labor', 'money'),
      col('material', 'Material', 'money'),
      col('other', 'Other costs', 'money'),
      col('shared', 'Time not on a job', 'money'),
      col('profit', 'Profit on jobs', 'money'),
      col('margin', 'Margin after all costs', 'percent', { money: true }),
      ...(narrowed ? [] : [col('shared_gap', 'Time not on a job that no job carried', 'money'), col('missing', 'Paid time not on any job', 'money'), col('overhead_gap', 'Overhead your hourly rate did not cover', 'money'), col('company_profit', 'Company profit', 'money')]),
    ],
    rows: months.map(({ row, bridge }) => ({ id: row.key, cells: { month: monthWords(row.key), ...profitCells(row), ...(narrowed ? {} : bridgeCells(bridge)) } })),
    total: { month: 'Total', ...profitCells(profit.total), ...(narrowed ? {} : bridgeCells(whole)) },
    summary: [...headline(profit.total).filter((item) => item.label !== 'Cost'), ...(narrowed ? [] : [{ label: 'Company profit', value: whole.companyProfitCents, kind: 'money' as const }])],
    chart:
      months.length > 0
        ? {
            type: 'bar',
            title: 'Profit by month',
            description: narrowed ? 'Profit on jobs for each month.' : 'Profit on jobs next to company profit for each month.',
            labels: months.map(({ row }) => monthWords(row.key)),
            series: [{ id: 'jobs', label: 'Profit on jobs', values: months.map(({ row }) => row.profitCents) }, ...(narrowed ? [] : [{ id: 'company', label: 'Company profit', values: months.map(({ bridge }) => bridge.companyProfitCents) }])],
            format: 'money',
          }
        : null,
    notes: narrowed
      ? ['Company profit is left out because a client, job type or status filter is on. It only makes sense for the whole company or a whole site.']
      : ['Company profit is profit on jobs, less time not on a job that no job carried, less paid time not on any job, less overhead your hourly rate did not cover.'],
  };
}

async function costToServeReport(ctx: DomainContext, filters: ReportFilters): Promise<Built> {
  const access = await requirePulse(ctx, 'pulse:read');
  const found = await rows<{ client_id: string; client: string | null; job_id: string | null; revenue: string; labor: string; material: string; other: string; shared: string; units: string }>(
    db,
    sql`SELECT f.client_id, max(c.name) AS client, f.job_id,
               COALESCE(sum(f.amount_cents) FILTER (WHERE f.kind IN ('revenue_base', 'revenue_vas', 'revenue_other')), 0)::text AS revenue,
               COALESCE(sum(f.amount_cents) FILTER (WHERE f.kind = 'labor'), 0)::text AS labor,
               COALESCE(sum(f.amount_cents) FILTER (WHERE f.kind = 'material'), 0)::text AS material,
               COALESCE(sum(f.amount_cents) FILTER (WHERE f.kind = 'other'), 0)::text AS other,
               COALESCE(sum(f.amount_cents) FILTER (WHERE f.kind = 'shared'), 0)::text AS shared,
               COALESCE(sum(f.units_good) FILTER (WHERE f.kind = 'revenue_base'), 0)::text AS units
          FROM pulse.fact_days f ${PIVOT_JOINS}
         WHERE ${factWhere(ctx.orgId, profitFilters(filters))}
         GROUP BY f.client_id, f.job_id`,
  );
  const byClient = new Map<string, { name: string; jobs: JobMoney[]; clientCost: bigint; clientRevenue: bigint }>();
  for (const row of found) {
    let entry = byClient.get(row.client_id);
    if (!entry) byClient.set(row.client_id, (entry = { name: row.client ?? 'No client', jobs: [], clientCost: ZERO, clientRevenue: ZERO }));
    if (row.job_id) entry.jobs.push({ revenueCents: BigInt(row.revenue), laborCents: BigInt(row.labor), materialCents: BigInt(row.material), otherCents: BigInt(row.other), sharedCents: BigInt(row.shared), unitsGood: row.units });
    else {
      entry.clientCost += BigInt(row.labor) + BigInt(row.material) + BigInt(row.other) + BigInt(row.shared);
      entry.clientRevenue += BigInt(row.revenue);
    }
  }
  const money = access.seesMoney;
  const list = [...byClient.entries()].map(([id, entry]) => ({ id, name: entry.name, serve: costToServe({ jobs: entry.jobs, clientCostCents: entry.clientCost, clientRevenueCents: entry.clientRevenue }) })).sort((a, b) => (a.serve.costToServeCents === b.serve.costToServeCents ? 0 : a.serve.costToServeCents > b.serve.costToServeCents ? -1 : 1));
  const cells = (serve: ReturnType<typeof costToServe>): Cells => ({
    jobs: serve.jobCount,
    units: serve.unitsGood,
    revenue: moneyOut(money, serve.revenueCents),
    labor: moneyOut(money, serve.laborCents),
    material: moneyOut(money, serve.materialCents),
    other: moneyOut(money, serve.otherCents),
    shared: moneyOut(money, serve.sharedCents),
    client_cost: moneyOut(money, serve.clientCostCents),
    cost: moneyOut(money, serve.costToServeCents),
    per_unit: money ? centsOut(serve.costPerUnitCents) : null,
    per_job: money ? centsOut(serve.costPerJobCents) : null,
    pct: money ? serve.costPctOfRevenueBp : null,
    profit: moneyOut(money, serve.profitCents),
    margin: money ? serve.marginBp : null,
  });
  const all = costToServe({ jobs: [...byClient.values()].flatMap((entry) => entry.jobs), clientCostCents: [...byClient.values()].reduce((sum, entry) => sum + entry.clientCost, ZERO), clientRevenueCents: [...byClient.values()].reduce((sum, entry) => sum + entry.clientRevenue, ZERO) });
  const top = list.slice(0, 10);
  return {
    columns: [
      col('client', 'Client', 'text'),
      col('jobs', 'Jobs', 'number'),
      col('units', 'Units', 'number'),
      col('revenue', 'Revenue', 'money'),
      col('labor', 'Labor', 'money'),
      col('material', 'Material', 'money'),
      col('other', 'Other job costs', 'money'),
      col('shared', 'Time not on a job', 'money'),
      col('client_cost', 'Costs on the client, no job', 'money'),
      col('cost', 'Cost to serve', 'money'),
      col('per_unit', 'Cost to serve per unit', 'money'),
      col('per_job', 'Cost to serve per job', 'money'),
      col('pct', 'Cost to serve as % of revenue', 'percent', { money: true }),
      col('profit', 'Profit', 'money'),
      col('margin', 'Margin after all costs', 'percent', { money: true }),
    ],
    rows: list.map((item) => ({ id: item.id, href: routes.client(item.id), cells: { client: item.name, ...cells(item.serve) } })),
    total: { client: 'Total', ...cells(all) },
    summary: [
      { label: 'Cost to serve', value: moneyOut(money, all.costToServeCents), kind: 'money' },
      { label: 'Per unit', value: money ? centsOut(all.costPerUnitCents) : null, kind: 'money' },
      { label: 'Per job', value: money ? centsOut(all.costPerJobCents) : null, kind: 'money' },
      { label: 'As % of revenue', value: money ? all.costPctOfRevenueBp : null, kind: 'percent' },
    ],
    chart:
      money && top.length > 0
        ? {
            type: 'stacked',
            title: 'What it costs to serve each client',
            description: 'The ten clients that cost the most to serve, split by where the cost comes from.',
            labels: top.map((item) => item.name),
            series: [
              { id: 'labor', label: 'Labor', values: top.map((item) => centsOut(item.serve.laborCents)) },
              { id: 'material', label: 'Material', values: top.map((item) => centsOut(item.serve.materialCents)) },
              { id: 'other', label: 'Other job costs', values: top.map((item) => centsOut(item.serve.otherCents)) },
              { id: 'shared', label: 'Time not on a job', values: top.map((item) => centsOut(item.serve.sharedCents)) },
              { id: 'client', label: 'Costs on the client', values: top.map((item) => centsOut(item.serve.clientCostCents)) },
            ],
            format: 'money',
          }
        : null,
    notes: ['Cost to serve is every cost of the client’s jobs plus costs put on the client with no job.'],
  };
}

interface PlanRow {
  id: string;
  number: string;
  name: string;
  client: string;
  status: JobStatusValue;
  risk: string | null;
  plan: string | null;
  p_units: string | null;
  p_revenue: string | null;
  p_labor_hours: string | null;
  p_labor: string | null;
  p_setup_hours: string | null;
  p_setup: string | null;
  p_material: string | null;
  p_other: string | null;
  p_shared: string | null;
  units_good: string;
  hours: string;
  setup_hours: string;
  revenue: string;
  labor: string;
  material: string;
  scrap: string;
  other: string;
  shared: string;
  uph: string | null;
  projected_profit: string | null;
  projected_margin_bp: number | null;
}

/** Jobs that had work inside the range, with the plan in use (budget, else quote) or the quote only. */
async function planRows(ctx: DomainContext, filters: ReportFilters, which: 'in_use' | 'quote'): Promise<PlanRow[]> {
  const pick = which === 'quote' ? sql`AND p.plan = 'quote'` : sql``;
  return rows<PlanRow>(
    db,
    sql`SELECT j.id, j.number, j.name, c.name AS client, j.status, st.risk_status AS risk, p.plan,
               p.units::text AS p_units, p.revenue_cents::text AS p_revenue, p.labor_hours::text AS p_labor_hours, p.labor_cents::text AS p_labor, p.setup_hours::text AS p_setup_hours,
               p.setup_cents::text AS p_setup, p.material_cents::text AS p_material, p.other_cents::text AS p_other, p.shared_cents::text AS p_shared,
               st.units_good::text, st.hours::text, st.setup_hours::text, st.revenue_cents::text AS revenue, st.labor_cents::text AS labor, st.material_cents::text AS material,
               st.scrap_cents::text AS scrap, st.other_cents::text AS other, st.shared_cents::text AS shared, st.uph::text, st.projected_profit_cents::text AS projected_profit, st.projected_margin_bp
          FROM pulse.jobs j
          JOIN pulse.clients c ON c.id = j.client_id
          JOIN pulse.job_stats st ON st.job_id = j.id
          LEFT JOIN LATERAL (SELECT * FROM pulse.job_plans p WHERE p.job_id = j.id ${pick} ORDER BY (p.plan = 'budget') DESC LIMIT 1) p ON true
         WHERE j.org_id = ${ctx.orgId} AND j.deleted_at IS NULL AND st.entry_count > 0
           AND st.first_entry_date <= ${filters.to}::date AND st.last_entry_date >= ${filters.from}::date ${jobScope(filters)}
         ORDER BY j.number
         LIMIT ${ROW_CAP}`,
  );
}

const planOf = (row: PlanRow): PlanTotals | null =>
  row.plan === null
    ? null
    : { units: row.p_units, revenueCents: toCents(row.p_revenue ?? 0), laborHours: row.p_labor_hours, laborCents: toCents(row.p_labor ?? 0), setupHours: row.p_setup_hours, setupCents: toCents(row.p_setup ?? 0), materialCents: toCents(row.p_material ?? 0), otherCents: toCents(row.p_other ?? 0), sharedCents: toCents(row.p_shared ?? 0) };

const actualOf = (row: PlanRow): ActualTotals => ({ unitsGood: row.units_good, hours: row.hours, revenueCents: toCents(row.revenue), laborCents: toCents(row.labor), materialCents: toCents(row.material), scrapCents: toCents(row.scrap), otherCents: toCents(row.other), sharedCents: toCents(row.shared), setupHours: row.setup_hours, uph: row.uph === null ? null : Number(row.uph) });

const actualProfit = (actual: ActualTotals): bigint => actual.revenueCents - actual.laborCents - actual.materialCents - actual.otherCents - actual.sharedCents;
const actualCost = (actual: ActualTotals): bigint => actual.laborCents + actual.materialCents + actual.otherCents + actual.sharedCents;

async function planVsActualReport(ctx: DomainContext, filters: ReportFilters, which: 'in_use' | 'quote'): Promise<Built> {
  const access = await requirePulse(ctx, 'pulse:read');
  const money = access.seesMoney;
  const found = await planRows(ctx, filters, which);
  let planProfit = ZERO;
  let realProfit = ZERO;
  let withPlan = 0;
  const out: ReportRowDTO[] = found.map((row) => {
    const plan = planOf(row);
    const actual = actualOf(row);
    const profit = actualProfit(actual);
    const base: Cells = { job: row.number, name: row.name, client: row.client, status: row.status, risk: row.risk, units: num(row.units_good), revenue: moneyOut(money, actual.revenueCents), cost: moneyOut(money, actualCost(actual)), profit: moneyOut(money, profit), margin: money ? marginBp(profit, actual.revenueCents) : null };
    if (!plan) return { id: row.id, href: routes.jobTab(row.number, 'plan'), cells: { ...base, plan: which === 'quote' ? 'No quote' : 'No plan' } };
    // Compare against the plan for the work done so far, so a half done job is not judged against its whole plan.
    const flexed = flexPlan(plan, flexFactor(plan, actual));
    planProfit += flexed.profitCents;
    realProfit += profit;
    withPlan += 1;
    const quoted: Cells = which === 'quote' ? { quoted_price: money ? centsOut(perUnitCents(planFigures(plan).revenueCents, planFigures(plan).units)) : null, actual_price: money ? centsOut(perUnitCents(actual.revenueCents, actual.unitsGood)) : null, projected_profit: moneyOut(money, row.projected_profit), projected_margin: money ? row.projected_margin_bp : null } : {};
    return {
      id: row.id,
      href: routes.jobTab(row.number, 'plan'),
      cells: {
        ...base,
        plan: row.plan === 'budget' ? 'Budget' : 'Quote',
        plan_revenue: moneyOut(money, flexed.revenueCents),
        plan_cost: moneyOut(money, flexed.costCents),
        plan_profit: moneyOut(money, flexed.profitCents),
        plan_margin: money ? flexed.marginBp : null,
        difference: moneyOut(money, subCents(profit, flexed.profitCents)),
        ...quoted,
      },
    };
  });
  const word = which === 'quote' ? 'Quote' : 'Plan';
  const charted = out.filter((row) => typeof row.cells.difference === 'number').sort((a, b) => (a.cells.difference as number) - (b.cells.difference as number));
  const shown = charted.length <= 12 ? charted : [...charted.slice(0, 6), ...charted.slice(-6)];
  return {
    columns: [
      col('job', 'Job', 'text'),
      col('name', 'Name', 'text'),
      col('client', 'Client', 'text'),
      col('status', 'Job status', 'job_status'),
      col('plan', which === 'quote' ? 'Quote' : 'Compared with', 'text'),
      col('units', 'Units done', 'number'),
      ...(which === 'quote' ? [col('quoted_price', 'Quoted price per unit', 'money'), col('actual_price', 'Revenue per unit so far', 'money')] : []),
      col('plan_revenue', `${word} revenue for the work done`, 'money'),
      col('revenue', 'Actual revenue', 'money'),
      col('plan_cost', `${word} cost for the work done`, 'money'),
      col('cost', 'Actual cost', 'money'),
      col('plan_profit', `${word} profit for the work done`, 'money'),
      col('profit', 'Actual profit', 'money'),
      col('difference', 'Difference', 'money', { signed: 'up_good' }),
      col('plan_margin', `${word} margin`, 'percent', { money: true }),
      col('margin', 'Actual margin', 'percent', { money: true }),
      ...(which === 'quote' ? [col('projected_profit', 'Projected profit at finish', 'money'), col('projected_margin', 'Projected margin at finish', 'percent', { money: true })] : []),
    ],
    rows: out,
    total: withPlan > 0 ? { job: 'Total, jobs with a plan', plan_profit: moneyOut(money, planProfit), profit: moneyOut(money, realProfit), difference: moneyOut(money, realProfit - planProfit) } : null,
    summary: [
      { label: `${word} profit for the work done`, value: moneyOut(money, planProfit), kind: 'money' },
      { label: 'Actual profit', value: moneyOut(money, realProfit), kind: 'money' },
      { label: 'Difference', value: moneyOut(money, realProfit - planProfit), kind: 'money' },
      { label: `Jobs with a ${word.toLowerCase()}`, value: withPlan, kind: 'number' },
    ],
    chart:
      shown.length > 0
        ? { type: 'hbar', title: `Actual profit against the ${word.toLowerCase()}`, description: `How far each job is from its ${word.toLowerCase()}. Bars to the left are behind.`, labels: shown.map((row) => String(row.cells.job)), series: [{ id: 'difference', label: 'Difference', values: shown.map((row) => row.cells.difference as number) }], format: 'money', signColors: true }
        : null,
    notes: [`Jobs with work logged inside these days. Each job shows its whole life so far, against the ${word.toLowerCase()} for the work done so far.`],
  };
}

async function whyProfitChanged(ctx: DomainContext, filters: ReportFilters): Promise<Built> {
  const access = await requirePulse(ctx, 'pulse:read');
  const money = access.seesMoney;
  const found = await planRows(ctx, filters, 'in_use');
  const falls: { row: PlanRow; fall: Waterfall }[] = [];
  for (const row of found) {
    const plan = planOf(row);
    if (!plan) continue;
    falls.push({ row, fall: varianceWaterfall({ plan, actual: actualOf(row), mode: row.status === 'completed' ? 'whole_job' : 'so_far' }) });
  }
  const sum = sumWaterfalls(falls.map((item) => item.fall));
  const barCells = (bars: readonly { key: string; amountCents: bigint }[]): Cells => Object.fromEntries(VARIANCE_ORDER.map((key) => [key, moneyOut(money, bars.find((bar) => bar.key === key)?.amountCents ?? ZERO)]));
  const sorted = [...falls].sort((a, b) => (a.fall.totalCents === b.fall.totalCents ? 0 : a.fall.totalCents < b.fall.totalCents ? -1 : 1));
  return {
    columns: [col('job', 'Job', 'text'), col('name', 'Name', 'text'), col('client', 'Client', 'text'), col('status', 'Job status', 'job_status'), col('start', 'Planned profit', 'money'), ...VARIANCE_ORDER.map((key) => col(key, VARIANCE_LABELS[key], 'money', { signed: 'up_good' })), col('end', 'Actual profit', 'money'), col('total', 'Change', 'money', { signed: 'up_good' })],
    rows: sorted.map(({ row, fall }) => ({ id: row.id, href: routes.jobTab(row.number, 'plan'), cells: { job: row.number, name: row.name, client: row.client, status: row.status, start: moneyOut(money, fall.startCents), ...barCells(fall.bars), end: moneyOut(money, fall.endCents), total: moneyOut(money, fall.totalCents) } })),
    total: falls.length > 0 ? { job: 'Total', start: moneyOut(money, sum.startCents), ...barCells(sum.bars), end: moneyOut(money, sum.endCents), total: moneyOut(money, sum.totalCents) } : null,
    summary: [
      { label: 'Planned profit', value: moneyOut(money, sum.startCents), kind: 'money' },
      { label: 'Actual profit', value: moneyOut(money, sum.endCents), kind: 'money' },
      { label: 'Change', value: moneyOut(money, sum.totalCents), kind: 'money' },
      { label: 'Jobs counted', value: sum.jobCount, kind: 'number' },
    ],
    chart:
      money && falls.length > 0
        ? { type: 'waterfall', title: 'Why profit changed', description: 'Start at planned profit. Each bar adds or takes away. The last bar is actual profit.', labels: sum.bars.map((bar) => bar.label), series: [{ id: 'change', label: 'Effect on profit', values: sum.bars.map((bar) => centsOut(bar.amountCents)) }], format: 'money', start: { label: 'Planned profit', value: centsOut(sum.startCents) ?? 0 }, endLabel: 'Actual profit' }
        : null,
    notes: ['Jobs with work logged inside these days. Each job shows its whole life so far, not only these days, so the totals can be larger than the profit of the period.', 'Open jobs start from the plan for the work done so far. Finished jobs start from the whole plan. Jobs with no plan are left out.', 'The bars are worked out job by job and then added, so they always sum to the change.'],
  };
}

async function openJobsAtRisk(ctx: DomainContext, filters: ReportFilters): Promise<Built> {
  const jobs = await listJobs(ctx, { tab: 'open', risk: ['losing', 'at_risk'], siteId: filters.siteId ?? null, clientId: filters.clientId ?? null, jobTypeId: filters.jobTypeId ?? null, limit: 1000 });
  const losing = jobs.filter((job) => job.stats.riskStatus === 'losing').length;
  const impact = jobs.reduce<number | null>((sum, job) => (job.stats.projectedProfitCents === null ? sum : (sum ?? 0) + job.stats.projectedProfitCents), null);
  return {
    usesDates: false,
    columns: [col('job', 'Job', 'text'), col('name', 'Name', 'text'), col('client', 'Client', 'text'), col('risk', 'Health', 'status'), col('reason', 'Why', 'text'), col('margin', 'Margin so far', 'percent', { money: true }), col('projected_margin', 'Projected margin', 'percent', { money: true }), col('projected_profit', 'Projected profit', 'money'), col('due', 'Due', 'date'), col('last_entry', 'Last entry', 'date')],
    rows: jobs.map((job) => ({ id: job.id, href: routes.job(job.number), cells: { job: job.number, name: job.name, client: job.clientName, risk: job.stats.riskStatus, reason: job.stats.headline || null, margin: job.stats.marginBp, projected_margin: job.stats.projectedMarginBp, projected_profit: job.stats.projectedProfitCents, due: job.dueDate, last_entry: job.stats.lastEntryDate } })),
    summary: [
      { label: 'Losing money', value: losing, kind: 'number' },
      { label: 'At risk', value: jobs.length - losing, kind: 'number' },
      { label: 'Projected profit of these jobs', value: impact, kind: 'money' },
    ],
    chart: rankingChart('Projected profit of jobs at risk', jobs.map((job) => ({ label: job.number, profit: job.stats.projectedProfitCents }))),
    notes: ['This report is about right now, so the dates above do not change it. Worst jobs first.'],
  };
}

async function paceVsTarget(ctx: DomainContext, filters: ReportFilters): Promise<Built> {
  const profit = await getProfit(ctx, 'job', profitFilters(filters));
  const meta = await jobMeta(ctx.orgId, profit.rows.map((row) => row.key));
  const list = profit.rows
    .filter((row) => meta.has(row.key) && Number(row.hours) > 0)
    .map((row) => {
      const job = meta.get(row.key)!;
      return { row, job, pct: productivityBp(row.uph, job.standard_uph) };
    })
    .sort((a, b) => (a.pct ?? Number.MAX_SAFE_INTEGER) - (b.pct ?? Number.MAX_SAFE_INTEGER));
  const withTarget = list.filter((item) => item.pct !== null);
  const under = withTarget.filter((item) => (item.pct ?? 0) < 10000).length;
  const shown = withTarget.length <= 14 ? withTarget : [...withTarget.slice(0, 7), ...withTarget.slice(-7)];
  return {
    columns: [col('job', 'Job', 'text'), col('name', 'Name', 'text'), col('client', 'Client', 'text'), col('type', 'Job type', 'text'), col('units', 'Units', 'number'), col('hours', 'Labor hours', 'hours'), col('uph', 'Units per person per hour', 'pace'), col('target', 'Target pace', 'pace'), col('pct', 'Pace as % of target', 'percent')],
    rows: list.map(({ row, job, pct }) => ({ id: row.key, href: routes.jobTab(job.number, 'work'), cells: { job: job.number, name: job.name, client: job.client, type: job.type, units: num(row.unitsGood), hours: num(row.hours), uph: num(row.uph), target: num(job.standard_uph), pct } })),
    total: { job: 'Total', units: num(profit.total.unitsGood), hours: num(profit.total.hours) },
    summary: [
      { label: 'Jobs under target pace', value: under, kind: 'number' },
      { label: 'Jobs at or over target', value: withTarget.length - under, kind: 'number' },
      { label: 'Jobs with no target pace', value: list.length - withTarget.length, kind: 'number' },
      { label: 'Labor hours', value: num(profit.total.hours), kind: 'hours' },
    ],
    chart: shown.length > 0 ? { type: 'hbar', title: 'Pace as a share of target', description: '100% means the crew hit the target pace. Slowest jobs at the top.', labels: shown.map((item) => item.job.number), series: [{ id: 'pct', label: 'Pace as % of target', values: shown.map((item) => item.pct) }], format: 'percent' } : null,
    notes: ['Pace here is units over all labor hours inside these days, setup time included.'],
  };
}

async function laborSummaryReport(ctx: DomainContext, filters: ReportFilters): Promise<Built> {
  const labor = await getLaborSummary(ctx, { from: filters.from, to: filters.to, siteId: filters.siteId ?? null });
  const sumOf = (pick: (row: (typeof labor.byClass)[number]) => number | null): number | null => labor.byClass.reduce<number | null>((sum, row) => (pick(row) === null ? sum : (sum ?? 0) + (pick(row) as number)), null);
  const total: Cells = { name: 'Total', on_jobs: sumOf((row) => num(row.directHours)), off_jobs: sumOf((row) => num(row.indirectHours)), overtime: sumOf((row) => num(row.overtimeHours)), setup: sumOf((row) => num(row.setupHours)), labor: sumOf((row) => row.laborCents), off_cost: sumOf((row) => row.indirectCents), units: sumOf((row) => num(row.unitsGood)), entries: sumOf((row) => row.entries) };
  return {
    columns: [col('name', 'Labor class', 'text'), col('on_jobs', 'Hours on jobs', 'hours'), col('off_jobs', 'Hours not on a job', 'hours'), col('overtime', 'Overtime hours', 'hours'), col('setup', 'Setup hours', 'hours'), col('labor', 'Labor cost on jobs', 'money'), col('off_cost', 'Cost of time not on a job', 'money'), col('units', 'Units', 'number'), col('entries', 'Entries', 'number'), col('needs_rate', 'Entries with no rate', 'number')],
    rows: labor.byClass.map((row) => ({ id: row.laborClassId ?? 'none', cells: { name: row.name, on_jobs: num(row.directHours), off_jobs: num(row.indirectHours), overtime: num(row.overtimeHours), setup: num(row.setupHours), labor: row.laborCents, off_cost: row.indirectCents, units: num(row.unitsGood), entries: row.entries, needs_rate: row.needsRate } })),
    total,
    summary: [
      { label: 'Hours on jobs', value: num(labor.bridge.directHours), kind: 'hours' },
      { label: 'Hours not on a job', value: num(labor.bridge.indirectHours), kind: 'hours' },
      { label: 'Share of paid time spent on jobs', value: labor.bridge.utilizationBp, kind: 'percent' },
      { label: 'Labor cost on jobs', value: total.labor ?? null, kind: 'money' },
    ],
    chart: labor.byClass.length > 0 ? { type: 'stacked', title: 'Hours by labor class', description: 'Hours on jobs and hours not on a job for each labor class.', labels: labor.byClass.map((row) => row.name), series: [{ id: 'on', label: 'On jobs', values: labor.byClass.map((row) => num(row.directHours)) }, { id: 'off', label: 'Not on a job', values: labor.byClass.map((row) => num(row.indirectHours)) }], format: 'hours' } : null,
    notes: filters.clientId || filters.jobTypeId || filters.status ? ['This report covers the whole site. The client, job type and status filters do not change it.'] : [],
  };
}

async function paidTimeNotOnAnyJob(ctx: DomainContext, filters: ReportFilters): Promise<Built> {
  const labor = await getLaborSummary(ctx, { from: filters.from, to: filters.to, siteId: filters.siteId ?? null });
  const days = labor.byDay;
  const add = (pick: (row: (typeof days)[number]) => number | null): number | null => days.reduce<number | null>((sum, row) => (pick(row) === null ? sum : (sum ?? 0) + (pick(row) as number)), null);
  return {
    columns: [col('date', 'Day', 'date'), col('paid', 'Paid hours', 'hours'), col('on_jobs', 'On jobs', 'hours'), col('off_jobs', 'Not on a job', 'hours'), col('missing', 'Paid but not logged anywhere', 'hours'), col('missing_cost', 'Cost of the missing hours', 'money'), col('flag', 'Check', 'text')],
    rows: days.map((row) => ({ id: row.date, href: routes.log({ date: row.date }), cells: { date: row.date, paid: num(row.paidHours), on_jobs: num(row.directHours), off_jobs: num(row.indirectHours), missing: num(row.missingHours), missing_cost: row.missingCents, flag: row.overLogged ? 'More hours logged than paid' : null } })),
    total: { date: 'Total', paid: add((row) => num(row.paidHours)), on_jobs: add((row) => num(row.directHours)), off_jobs: add((row) => num(row.indirectHours)), missing: add((row) => num(row.missingHours)), missing_cost: add((row) => row.missingCents) },
    summary: [
      { label: 'Paid but not logged anywhere', value: num(labor.bridge.missingHours), kind: 'hours' },
      { label: 'Cost of the missing hours', value: labor.bridge.missingCostCents, kind: 'money' },
      { label: 'Share of paid time spent on jobs', value: labor.bridge.utilizationBp, kind: 'percent' },
      { label: 'Days with more logged than paid', value: labor.bridge.overLoggedDays, kind: 'number' },
    ],
    chart: days.length > 0 ? { type: 'stacked', title: 'Where paid time went', description: 'Each day split into time on jobs, time not on a job and paid time nobody logged.', labels: days.map((row) => shortDate(row.date)), series: [{ id: 'on', label: 'On jobs', values: days.map((row) => num(row.directHours)) }, { id: 'off', label: 'Not on a job', values: days.map((row) => num(row.indirectHours)) }, { id: 'missing', label: 'Not logged anywhere', values: days.map((row) => num(row.missingHours)) }], format: 'hours' } : null,
    notes: ['Missing hours only show on days where paid hours were typed in. Enter paid hours on the Labor page to fill the gaps.'],
  };
}

async function materialAndScrap(ctx: DomainContext, filters: ReportFilters): Promise<Built> {
  const access = await requirePulse(ctx, 'pulse:read');
  const money = access.seesMoney;
  const range = sql`BETWEEN ${filters.from}::date AND ${filters.to}::date`;
  const found = await rows<{ id: string; number: string; name: string; client: string; method: string; units: string; scrap_units: string; material: string; scrap: string; used: string | null; scrapped: string | null }>(
    db,
    sql`SELECT j.id, j.number, j.name, c.name AS client, j.material_method AS method,
               COALESCE(pe.units, 0)::text AS units, COALESCE(pe.scrap_units, 0)::text AS scrap_units,
               (CASE WHEN j.material_method = 'actual' THEN COALESCE(mu.cost, 0) ELSE COALESCE(pe.std_material, 0) END)::text AS material,
               (CASE WHEN j.material_method = 'actual' THEN COALESCE(mu.scrap, 0) ELSE COALESCE(pe.std_scrap, 0) END)::text AS scrap,
               mu.used::text, mu.scrapped::text
          FROM pulse.jobs j
          JOIN pulse.clients c ON c.id = j.client_id
          LEFT JOIN (SELECT job_id, sum(units_good) AS units, sum(units_scrap) AS scrap_units, sum(std_material_cents) AS std_material, sum(std_scrap_cents) AS std_scrap
                       FROM pulse.production_entries WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL AND work_date ${range} GROUP BY job_id) pe ON pe.job_id = j.id
          LEFT JOIN (SELECT job_id, sum(cost_cents) AS cost, sum(scrap_cents) AS scrap, sum(quantity_used) AS used, sum(quantity_scrapped) AS scrapped
                       FROM pulse.material_usage WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL AND usage_date ${range} GROUP BY job_id) mu ON mu.job_id = j.id
         WHERE j.org_id = ${ctx.orgId} AND j.deleted_at IS NULL AND (pe.job_id IS NOT NULL OR mu.job_id IS NOT NULL) ${jobScope(filters)}
         ORDER BY (CASE WHEN j.material_method = 'actual' THEN COALESCE(mu.scrap, 0) ELSE COALESCE(pe.std_scrap, 0) END) DESC, j.number
         LIMIT ${ROW_CAP}`,
  );
  let material = ZERO;
  let scrap = ZERO;
  let scrapUnits = 0;
  for (const row of found) {
    material += BigInt(row.material);
    scrap += BigInt(row.scrap);
    scrapUnits += Number(row.scrap_units);
  }
  const top = found.filter((row) => BigInt(row.scrap) > ZERO).slice(0, 10);
  return {
    columns: [col('job', 'Job', 'text'), col('name', 'Name', 'text'), col('client', 'Client', 'text'), col('method', 'Material counted by', 'text'), col('units', 'Units good', 'number'), col('scrap_units', 'Units scrapped', 'number'), col('used', 'Parts used', 'number'), col('scrapped', 'Parts scrapped', 'number'), col('material', 'Material cost', 'money'), col('scrap', 'Scrap cost', 'money'), col('scrap_rate', 'Scrap as % of material', 'percent', { money: true })],
    rows: found.map((row) => ({ id: row.id, href: routes.jobTab(row.number, 'materials'), cells: { job: row.number, name: row.name, client: row.client, method: row.method === 'actual' ? 'Parts used' : 'Cost per unit', units: num(row.units), scrap_units: num(row.scrap_units), used: num(row.used), scrapped: num(row.scrapped), material: moneyOut(money, row.material), scrap: moneyOut(money, row.scrap), scrap_rate: money ? scrapRateBp(BigInt(row.scrap), BigInt(row.material)) : null } })),
    total: { job: 'Total', scrap_units: scrapUnits, material: moneyOut(money, material), scrap: moneyOut(money, scrap), scrap_rate: money ? scrapRateBp(scrap, material) : null },
    summary: [
      { label: 'Material cost', value: moneyOut(money, material), kind: 'money' },
      { label: 'Scrap cost', value: moneyOut(money, scrap), kind: 'money' },
      { label: 'Scrap as % of material', value: money ? scrapRateBp(scrap, material) : null, kind: 'percent' },
      { label: 'Units scrapped', value: scrapUnits, kind: 'number' },
    ],
    chart: money && top.length > 0 ? { type: 'hbar', title: 'Scrap cost by job', description: 'The jobs that lost the most money to scrap.', labels: top.map((row) => row.number), series: [{ id: 'scrap', label: 'Scrap cost', values: top.map((row) => centsOut(row.scrap)) }], format: 'money' } : null,
    notes: ['Scrap cost is part of material cost. Parts the client supplied cost you nothing, so they show as scrapped parts with no scrap cost.'],
  };
}

async function dailyProductionLog(ctx: DomainContext, filters: ReportFilters): Promise<Built> {
  const entries = await listProduction(ctx, { from: filters.from, to: filters.to, siteId: filters.siteId ?? null, clientId: filters.clientId ?? null, limit: ROW_CAP });
  const names = new Map((await rows<{ id: string; name: string }>(db, sql`SELECT u.id, u.name FROM core."user" u JOIN core.member m ON m.user_id = u.id WHERE m.organization_id = ${ctx.orgId}`)).map((row) => [row.id, row.name]));
  const byDay = new Map<string, number>();
  let units = 0;
  let hours = 0;
  for (const entry of entries) {
    byDay.set(entry.workDate, (byDay.get(entry.workDate) ?? 0) + Number(entry.unitsGood));
    units += Number(entry.unitsGood);
    hours += Number(entry.hours);
  }
  const days = [...byDay.keys()].sort();
  return {
    columns: [col('date', 'Day', 'date'), col('job', 'Job', 'text'), col('name', 'Name', 'text'), col('shift', 'Shift', 'text'), col('units', 'Units good', 'number'), col('scrap', 'Scrap', 'number'), col('rework', 'Rework', 'number'), col('people', 'People', 'number'), col('hours', 'Labor hours', 'hours'), col('overtime', 'Overtime hours', 'hours'), col('uph', 'Units per person per hour', 'pace'), col('note', 'Note', 'text'), col('by', 'Logged by', 'text')],
    rows: entries.map((entry) => ({
      id: entry.id,
      href: routes.log({ date: entry.workDate, job: entry.jobId }),
      cells: { date: entry.workDate, job: entry.jobNumber, name: entry.jobName, shift: entry.shift, units: num(entry.unitsGood), scrap: num(entry.unitsScrap), rework: num(entry.unitsRework), people: num(entry.headcount), hours: num(entry.hours), overtime: num(entry.overtimeHours), uph: Number(entry.hours) > 0 ? Math.round((Number(entry.unitsGood) / Number(entry.hours)) * 1000) / 1000 : null, note: entry.note, by: names.get(entry.enteredBy ?? entry.createdBy ?? '') ?? null },
    })),
    total: { date: 'Total', units, hours: Math.round(hours * 100) / 100 },
    summary: [
      { label: 'Entries', value: entries.length, kind: 'number' },
      { label: 'Units good', value: units, kind: 'number' },
      { label: 'Labor hours', value: Math.round(hours * 100) / 100, kind: 'hours' },
      { label: 'Days with work', value: days.length, kind: 'number' },
    ],
    chart: days.length > 0 ? { type: 'bar', title: 'Units finished by day', description: 'Good units logged on each day.', labels: days.map((day) => shortDate(day)), series: [{ id: 'units', label: 'Units good', values: days.map((day) => byDay.get(day) ?? 0) }], format: 'number' } : null,
    notes: filters.jobTypeId || filters.status ? ['The job type and status filters do not change this report.'] : [],
  };
}

async function readyToBill(ctx: DomainContext, filters: ReportFilters): Promise<Built> {
  const jobs = (await listJobs(ctx, { tab: 'all', siteId: filters.siteId ?? null, clientId: filters.clientId ?? null, jobTypeId: filters.jobTypeId ?? null, status: filters.status ? [filters.status] : undefined, limit: 2000 })).filter((job) => (job.stats.notBilledYetCents ?? 0) > 0 && job.status !== 'cancelled').sort((a, b) => (b.stats.notBilledYetCents ?? 0) - (a.stats.notBilledYetCents ?? 0));
  const add = (pick: (job: (typeof jobs)[number]) => number | null): number | null => jobs.reduce<number | null>((sum, job) => (pick(job) === null ? sum : (sum ?? 0) + (pick(job) as number)), null);
  const done = jobs.filter((job) => job.status === 'completed');
  const top = jobs.slice(0, 12);
  return {
    usesDates: false,
    columns: [col('job', 'Job', 'text'), col('name', 'Name', 'text'), col('client', 'Client', 'text'), col('status', 'Job status', 'job_status'), col('completed', 'Finished on', 'date'), col('po', 'PO number', 'text'), col('earned', 'Earned', 'money'), col('billed', 'Billed', 'money'), col('not_billed', 'Not billed yet', 'money')],
    rows: jobs.map((job) => ({ id: job.id, href: routes.jobTab(job.number, 'money-in'), cells: { job: job.number, name: job.name, client: job.clientName, status: job.status, completed: job.completedDate, po: job.poNumber, earned: job.stats.revenueCents, billed: job.stats.billedCents, not_billed: job.stats.notBilledYetCents } })),
    total: { job: 'Total', earned: add((job) => job.stats.revenueCents), billed: add((job) => job.stats.billedCents), not_billed: add((job) => job.stats.notBilledYetCents) },
    summary: [
      { label: 'Not billed yet', value: add((job) => job.stats.notBilledYetCents), kind: 'money' },
      { label: 'Of that, on finished jobs', value: done.reduce<number | null>((sum, job) => (job.stats.notBilledYetCents === null ? sum : (sum ?? 0) + job.stats.notBilledYetCents), jobs.length > 0 ? 0 : null), kind: 'money' },
      { label: 'Jobs waiting for an invoice', value: jobs.length, kind: 'number' },
    ],
    chart: top.length > 0 ? { type: 'hbar', title: 'Not billed yet by job', description: 'Earned work that is not on an invoice, biggest first.', labels: top.map((job) => job.number), series: [{ id: 'not_billed', label: 'Not billed yet', values: top.map((job) => job.stats.notBilledYetCents) }], format: 'money' } : null,
    notes: ['This report is about right now, so the dates above do not change it. Earned is work done at the job price. Billed is what you put on invoices.'],
  };
}

async function monthClosePack(ctx: DomainContext, filters: ReportFilters): Promise<Built> {
  const from = startOfMonth(filters.to);
  const to = endOfMonth(from);
  const scope = { from, to, siteId: filters.siteId ?? null };
  const [profit, bridge, checklist] = await Promise.all([getProfit(ctx, 'month', scope, { comparePrior: false }), getCompanyBridge(ctx, scope), getCloseChecklist(ctx, from.slice(0, 7))]);
  const total = profit.total;
  const line = (section: string, name: string, amount: number | null, note: string | null = null): ReportRowDTO => ({ id: `${section}:${name}`, cells: { section, line: name, amount, count: null, note } });
  const count = (section: string, name: string, value: number, note: string): ReportRowDTO => ({ id: `${section}:${name}`, cells: { section, line: name, amount: null, count: value, note } });
  const list: ReportRowDTO[] = [
    line('Profit on jobs', 'Revenue', total.revenueCents),
    line('Profit on jobs', 'Labor', total.laborCents),
    line('Profit on jobs', 'Material', total.materialCents),
    line('Profit on jobs', 'Other costs', total.otherCents),
    line('Profit on jobs', 'Time not on a job', total.sharedCents),
    line('Profit on jobs', 'Profit on jobs', total.profitCents, 'Revenue less the four costs above.'),
    line('Company profit', 'Profit on jobs', bridge.workProfitCents),
    line('Company profit', 'Time not on a job that no job carried', bridge.sharedGapCents, 'Taken away.'),
    line('Company profit', 'Paid time not on any job', bridge.missingCostCents, 'Taken away.'),
    ...(bridge.hasCompanyCosts ? [line('Company profit', 'Overhead your hourly rate did not cover', bridge.overheadGapCents, 'Taken away. Below zero means the rate covered more than you spent.')] : []),
    line('Company profit', 'Company profit', bridge.companyProfitCents),
    line('Payroll check', 'Pay from the hours logged', bridge.grossPayCents),
    line('Payroll check', 'Pay you typed in', bridge.paidCents, bridge.paidCents === null && !bridge.moneyHidden ? 'No payroll total was typed in for this month.' : null),
    line('Payroll check', 'Gap', bridge.payrollGapCents ?? checklist.payrollGapCents),
    line('Billing', 'Earned this month', total.revenueCents),
    line('Billing', 'Billed this month', total.billedCents),
    count('Things to fix before you close', 'Entries with no labor rate', checklist.entriesNeedingRate, 'Set a rate on the Labor page.'),
    count('Things to fix before you close', 'Days with units and no hours', checklist.daysWithUnitsNoHours, 'Add the hours on Log work.'),
    count('Things to fix before you close', 'Extra service entries with no price', checklist.servicesNoPrice, 'Add a price on the service.'),
    count('Things to fix before you close', 'Days not reviewed', checklist.daysNotReviewed, 'Review them on Log work.'),
  ];
  const monthWords = `${shortDate(from).split(' ')[0]} ${from.slice(0, 4)}`;
  return {
    range: { from, to },
    columns: [col('section', 'Section', 'text'), col('line', 'Line', 'text'), col('amount', 'Amount', 'money'), col('count', 'Count', 'number'), col('note', 'Note', 'text')],
    rows: list,
    summary: [
      { label: 'Revenue', value: total.revenueCents, kind: 'money' },
      { label: 'Profit on jobs', value: total.profitCents, kind: 'money' },
      { label: 'Company profit', value: bridge.companyProfitCents, kind: 'money' },
      { label: 'Ready to close', value: checklist.ready ? 'Yes' : 'Not yet', kind: 'text' },
    ],
    chart:
      bridge.workProfitCents !== null
        ? {
            type: 'waterfall',
            title: `From profit on jobs to company profit, ${monthWords}`,
            description: 'Start at profit on jobs. Each bar takes away a cost no job carried. The last bar is company profit.',
            labels: ['Time not on a job that no job carried', 'Paid time not on any job', ...(bridge.hasCompanyCosts ? ['Overhead not covered'] : [])],
            series: [{ id: 'bridge', label: 'Effect on profit', values: [-(bridge.sharedGapCents ?? 0), -(bridge.missingCostCents ?? 0), ...(bridge.hasCompanyCosts ? [-(bridge.overheadGapCents ?? 0)] : [])] }],
            format: 'money',
            start: { label: 'Profit on jobs', value: bridge.workProfitCents },
            endLabel: 'Company profit',
          }
        : null,
    notes: [`This pack always covers one whole month: ${monthWords}, the month of the end day you picked.`, ...(filters.clientId || filters.jobTypeId || filters.status ? ['It is a company report, so the client, job type and status filters do not change it.'] : [])],
  };
}

async function auditLog(ctx: DomainContext, filters: ReportFilters): Promise<Built> {
  const out: ReportRowDTO[] = [];
  let cursor: string | null = null;
  const show = (value: unknown): string | null => {
    if (value === null || value === undefined || value === '') return null;
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return text.length > 240 ? `${text.slice(0, 237)}...` : text;
  };
  for (let page = 0; page < 10; page += 1) {
    const result = await listActivity(ctx, { from: filters.from, to: filters.to, clientId: filters.clientId ?? null, cursor, limit: 200 });
    for (const item of result.items) {
      out.push({ id: item.id, cells: { at: item.createdAt, who: item.actor?.name ?? (item.actorKind === 'system' ? 'KitStak' : null), what: item.verb.replace(/[._]/g, ' '), record: item.entityType.replace(/_/g, ' '), field: item.field, before: show(item.before), after: show(item.after), note: item.body } });
    }
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  const people = new Set(out.map((row) => row.cells.who).filter(Boolean));
  const byDay = new Map<string, number>();
  for (const row of out) {
    const day = String(row.cells.at).slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  const days = [...byDay.keys()].sort();
  return {
    columns: [col('at', 'When', 'datetime'), col('who', 'Who', 'text'), col('what', 'What happened', 'text'), col('record', 'Record', 'text'), col('field', 'Field', 'text'), col('before', 'Before', 'text', { money: true }), col('after', 'After', 'text', { money: true }), col('note', 'Note', 'text')],
    rows: out,
    summary: [
      { label: 'Changes', value: out.length, kind: 'number' },
      { label: 'People', value: people.size, kind: 'number' },
    ],
    chart: days.length > 1 ? { type: 'bar', title: 'Changes by day', description: 'How many changes were saved on each day.', labels: days.map((day) => shortDate(day)), series: [{ id: 'changes', label: 'Changes', values: days.map((day) => byDay.get(day) ?? 0) }], format: 'number' } : null,
    notes: [...(cursor ? ['Only the newest 2,000 changes are shown. Narrow the dates to see older ones.'] : []), 'The log cannot be edited. Newest first.'],
  };
}

const BUILDERS: Readonly<Record<string, (ctx: DomainContext, filters: ReportFilters) => Promise<Built>>> = {
  'job-profit': jobProfit,
  'profit-by-client': (ctx, filters) => profitBy(ctx, filters, 'client', 'Client'),
  'profit-by-job-type': (ctx, filters) => profitBy(ctx, filters, 'type', 'Job type'),
  'profit-by-service': (ctx, filters) => profitBy(ctx, filters, 'service', 'Service'),
  'profit-by-site': profitBySite,
  'monthly-profit-and-loss': monthlyProfitAndLoss,
  'cost-to-serve': costToServeReport,
  'plan-vs-actual': (ctx, filters) => planVsActualReport(ctx, filters, 'in_use'),
  'quote-vs-actual': (ctx, filters) => planVsActualReport(ctx, filters, 'quote'),
  'open-jobs-at-risk': openJobsAtRisk,
  'why-profit-changed': whyProfitChanged,
  'pace-vs-target': paceVsTarget,
  'labor-summary': laborSummaryReport,
  'paid-time-not-on-any-job': paidTimeNotOnAnyJob,
  'material-and-scrap': materialAndScrap,
  'daily-production-log': dailyProductionLog,
  'ready-to-bill': readyToBill,
  'month-close-pack': monthClosePack,
  'audit-log': auditLog,
};

async function filtersLabel(ctx: DomainContext, filters: ReportFilters, usesDates: boolean): Promise<string> {
  const parts: string[] = [usesDates ? rangeLabel(filters) : 'As of today'];
  const lookups = await rows<{ site: string | null; client: string | null; type: string | null }>(
    db,
    sql`SELECT (SELECT name FROM pulse.sites WHERE org_id = ${ctx.orgId} AND id = ${filters.siteId ?? null}::uuid) AS site,
               (SELECT name FROM pulse.clients WHERE org_id = ${ctx.orgId} AND id = ${filters.clientId ?? null}::uuid) AS client,
               (SELECT name FROM pulse.job_types WHERE org_id = ${ctx.orgId} AND id = ${filters.jobTypeId ?? null}::uuid) AS type`,
  );
  const found = lookups[0];
  parts.push(found?.site ?? 'All sites');
  if (found?.client) parts.push(found.client);
  if (found?.type) parts.push(found.type);
  if (filters.status) parts.push(`${JOB_STATUS_LABELS[filters.status]} jobs`);
  return parts.join(', ');
}

export interface BuildReportOptions {
  /** Blank every money column even when the reader could see it (scheduled builds made without money). */
  readonly hideMoney?: boolean;
}

/**
 * Builds one report of the library. Reports that show money answer FORBIDDEN to a reader without
 * `money:read`; reports open to everyone come back with their money columns blank for them.
 */
export async function buildReport(ctx: DomainContext, slug: string, filters: ReportFilters, options: BuildReportOptions = {}): Promise<ReportDTO> {
  const access = await requirePulse(ctx, 'pulse:read');
  const info = reportInfo(slug);
  const builder = BUILDERS[slug];
  if (!info || !builder) throw notFound('That report');
  if (info.needsMoney && !access.seesMoney) throw forbidden('This report shows money. Ask an admin if you need it.');
  checkFilters(filters);
  const built = await builder(ctx, filters);
  const hide = options.hideMoney || !access.seesMoney;
  const hidden = new Set(hide ? built.columns.filter((column) => column.money).map((column) => column.key) : []);
  // Only cells that have a column leave the server, and hidden money columns leave blank.
  const known = new Set(built.columns.map((column) => column.key));
  const strip = (cells: Readonly<Record<string, ReportCell>>): Record<string, ReportCell> => Object.fromEntries(Object.entries(cells).filter(([key]) => known.has(key)).map(([key, value]) => [key, hidden.has(key) ? null : value]));
  const usesDates = built.usesDates ?? true;
  const range = built.range ?? { from: filters.from, to: filters.to };
  return {
    slug,
    name: info.name,
    description: info.description,
    from: range.from,
    to: range.to,
    usesDates,
    filtersLabel: await filtersLabel(ctx, { ...filters, ...range }, usesDates),
    generatedAt: new Date().toISOString(),
    columns: built.columns,
    rows: built.rows.slice(0, ROW_CAP).map((row) => ({ ...row, cells: strip(row.cells) })),
    total: built.total ? strip(built.total) : null,
    summary: (built.summary ?? []).map((item) => (hide && item.kind === 'money' ? { ...item, value: null } : item)),
    chart: hide && built.chart?.format === 'money' ? null : (built.chart ?? null),
    notes: built.notes ?? [],
    truncated: built.rows.length >= ROW_CAP,
    moneyHidden: hide,
  };
}

/** The reports this reader may open. */
export async function listReportsFor(ctx: DomainContext): Promise<ReportInfo[]> {
  const access = await requirePulse(ctx, 'pulse:read');
  return REPORTS.filter((report) => access.seesMoney || !report.needsMoney);
}

/* ================================================================== schedules and builds */

type ScheduleRow = typeof reportSchedules.$inferSelect;
type RunRow = typeof reportRuns.$inferSelect;

export interface ReportScheduleInput {
  id?: string | null;
  name: string;
  report: string;
  cadence: ScheduleCadence;
  weekday?: number | null;
  dayOfMonth?: number | null;
  hour: number;
  range: ScheduleRange;
  siteId?: string | null;
  clientId?: string | null;
  jobTypeId?: string | null;
  recipientUserIds?: readonly string[];
  includeMoney?: boolean;
  enabled?: boolean;
}

function toScheduleDTO(row: ScheduleRow, ctx: DomainContext, canManageAll: boolean): ReportScheduleDTO {
  return {
    id: row.id,
    name: row.name,
    report: row.report,
    reportName: reportInfo(row.report)?.name ?? row.report,
    cadence: row.cadence as ScheduleCadence,
    weekday: row.weekday,
    dayOfMonth: row.dayOfMonth,
    hour: row.hour,
    config: row.config ?? {},
    recipientUserIds: row.recipientUserIds ?? [],
    includeMoney: row.includeMoney,
    enabled: row.enabled,
    lastRunAt: iso(row.lastRunAt),
    nextRunAt: iso(row.nextRunAt),
    createdBy: row.createdBy,
    mine: row.createdBy === ctx.userId,
    canEdit: canManageAll || row.createdBy === ctx.userId,
  };
}

/** Schedules of the workspace. People without money rights do not see schedules that build money. */
export async function listReportSchedules(ctx: DomainContext): Promise<ReportScheduleDTO[]> {
  const access = await requirePulse(ctx, 'pulse:read');
  const found = await db.select().from(reportSchedules).where(and(eq(reportSchedules.orgId, ctx.orgId), isNull(reportSchedules.deletedAt))).orderBy(reportSchedules.name);
  const manage = canPulse(access.role, 'job:manage');
  return found.filter((row) => access.seesMoney || !row.includeMoney).map((row) => toScheduleDTO(row, ctx, manage));
}

async function siteZone(ctx: DomainContext, siteId: string | null | undefined): Promise<string> {
  try {
    return (await resolveSite(ctx, siteId && isUuid(siteId) ? siteId : null)).timezone;
  } catch {
    return 'UTC';
  }
}

/** Creates or edits a schedule. A report that shows money can only be scheduled by someone who sees money. */
export async function saveReportSchedule(ctx: DomainContext, input: ReportScheduleInput): Promise<ReportScheduleDTO> {
  const access = await requirePulse(ctx, 'pulse:read');
  const name = cleanText(input.name);
  const fields: Record<string, string> = {};
  if (!name) fields.name = 'Give the schedule a name.';
  const info = reportInfo(input.report);
  if (!info) fields.report = 'Pick a report.';
  if (!(SCHEDULE_CADENCES as readonly string[]).includes(input.cadence)) fields.cadence = 'Pick how often to build it.';
  if (!(SCHEDULE_RANGES as readonly string[]).includes(input.range)) fields.range = 'Pick which days each build covers.';
  if (!Number.isInteger(input.hour) || input.hour < 0 || input.hour > 23) fields.hour = 'Pick an hour of the day.';
  if (input.cadence === 'weekly' && (!Number.isInteger(input.weekday) || (input.weekday as number) < 0 || (input.weekday as number) > 6)) fields.weekday = 'Pick a day of the week.';
  if (input.cadence === 'monthly' && (!Number.isInteger(input.dayOfMonth) || (input.dayOfMonth as number) < 1 || (input.dayOfMonth as number) > 31)) fields.dayOfMonth = 'Pick a day from 1 to 31.';
  for (const id of [input.siteId, input.clientId, input.jobTypeId]) if (id && !isUuid(id)) fields.filters = 'One of the filters is not valid.';
  if (Object.keys(fields).length > 0) throw invalid(Object.values(fields)[0]!, fields);
  const includeMoney = Boolean(input.includeMoney) || Boolean(info!.needsMoney);
  if (includeMoney && !access.seesMoney) throw forbidden('This report shows money. Only someone who can see money can schedule it.');
  const recipients = await filterOrgMembers(ctx, [...new Set((input.recipientUserIds ?? []).filter(isUuid))].slice(0, 50));
  const finalRecipients = recipients.length > 0 ? recipients : [ctx.userId];
  const manage = canPulse(access.role, 'job:manage');
  const zone = await siteZone(ctx, input.siteId);
  const enabled = input.enabled ?? true;
  const values = {
    name: name!,
    report: info!.slug,
    cadence: input.cadence,
    weekday: input.cadence === 'weekly' ? (input.weekday as number) : null,
    dayOfMonth: input.cadence === 'monthly' ? (input.dayOfMonth as number) : null,
    hour: input.hour,
    config: { range: input.range, siteId: input.siteId ?? null, clientId: input.clientId ?? null, jobTypeId: input.jobTypeId ?? null },
    recipientUserIds: finalRecipients,
    includeMoney,
    enabled,
    nextRunAt: enabled ? nextScheduleRun({ cadence: input.cadence, weekday: input.weekday, dayOfMonth: input.dayOfMonth, hour: input.hour }, zone) : null,
    updatedAt: new Date(),
  };
  return inTx(async (tx) => {
    if (input.id) {
      const [before] = isUuid(input.id) ? await tx.select().from(reportSchedules).where(and(eq(reportSchedules.orgId, ctx.orgId), eq(reportSchedules.id, input.id), isNull(reportSchedules.deletedAt))) : [];
      if (!before) throw notFound('That schedule');
      if (before.createdBy !== ctx.userId && !manage) throw forbidden('You can only change your own schedules.');
      const [row] = await tx.update(reportSchedules).set(values).where(eq(reportSchedules.id, before.id)).returning();
      await logActivity(tx, ctx, { verb: 'schedule.updated', entityType: 'report_schedule', entityId: before.id, after: { name: values.name, report: values.report, cadence: values.cadence, enabled: values.enabled } });
      return toScheduleDTO(row!, ctx, manage);
    }
    const [row] = await tx.insert(reportSchedules).values({ orgId: ctx.orgId, createdBy: ctx.userId, format: 'csv', ...values }).returning();
    await logActivity(tx, ctx, { verb: 'schedule.created', entityType: 'report_schedule', entityId: row!.id, after: { name: values.name, report: values.report, cadence: values.cadence } });
    return toScheduleDTO(row!, ctx, manage);
  });
}

async function ownScheduleRow(ctx: DomainContext, scheduleId: string, deleted: boolean): Promise<{ row: ScheduleRow; manage: boolean }> {
  const access = await requirePulse(ctx, 'pulse:read');
  const manage = canPulse(access.role, 'job:manage');
  const [row] = isUuid(scheduleId) ? await db.select().from(reportSchedules).where(and(eq(reportSchedules.orgId, ctx.orgId), eq(reportSchedules.id, scheduleId))) : [];
  if (!row || Boolean(row.deletedAt) !== deleted) throw notFound('That schedule');
  if (row.createdBy !== ctx.userId && !manage) throw forbidden('You can only change your own schedules.');
  if (row.includeMoney && !access.seesMoney) throw forbidden('This schedule builds a report with money.');
  return { row, manage };
}

export async function deleteReportSchedule(ctx: DomainContext, scheduleId: string): Promise<void> {
  const { row } = await ownScheduleRow(ctx, scheduleId, false);
  await inTx(async (tx) => {
    await tx.update(reportSchedules).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(reportSchedules.id, row.id));
    await logActivity(tx, ctx, { verb: 'schedule.deleted', entityType: 'report_schedule', entityId: row.id, before: { name: row.name, report: row.report } });
  });
}

/** Undo of a delete. */
export async function restoreReportSchedule(ctx: DomainContext, scheduleId: string): Promise<ReportScheduleDTO> {
  const { row, manage } = await ownScheduleRow(ctx, scheduleId, true);
  return inTx(async (tx) => {
    const [restored] = await tx.update(reportSchedules).set({ deletedAt: null, updatedAt: new Date() }).where(eq(reportSchedules.id, row.id)).returning();
    await logActivity(tx, ctx, { verb: 'schedule.restored', entityType: 'report_schedule', entityId: row.id });
    return toScheduleDTO(restored!, ctx, manage);
  });
}

/** Turns a schedule on or off without opening the editor. */
export async function setReportScheduleEnabled(ctx: DomainContext, scheduleId: string, enabled: boolean): Promise<ReportScheduleDTO> {
  const { row, manage } = await ownScheduleRow(ctx, scheduleId, false);
  const config = (row.config ?? {}) as { siteId?: string | null };
  const zone = await siteZone(ctx, config.siteId);
  return inTx(async (tx) => {
    const [updated] = await tx
      .update(reportSchedules)
      .set({ enabled, nextRunAt: enabled ? nextScheduleRun({ cadence: row.cadence as ScheduleCadence, weekday: row.weekday, dayOfMonth: row.dayOfMonth, hour: row.hour }, zone) : null, updatedAt: new Date() })
      .where(eq(reportSchedules.id, row.id))
      .returning();
    await logActivity(tx, ctx, { verb: enabled ? 'schedule.turned_on' : 'schedule.turned_off', entityType: 'report_schedule', entityId: row.id });
    return toScheduleDTO(updated!, ctx, manage);
  });
}

function toRunDTO(row: RunRow & { scheduleName?: string | null }, seesMoney: boolean): ReportRunDTO {
  return {
    id: row.id,
    scheduleId: row.scheduleId,
    scheduleName: row.scheduleName ?? null,
    report: row.report,
    reportName: reportInfo(row.report)?.name ?? row.report,
    periodLabel: row.periodLabel,
    rowCount: row.rowCount,
    includeMoney: row.includeMoney,
    status: row.status === 'failed' ? 'failed' : 'ready',
    error: row.error,
    createdAt: isoRequired(row.createdAt),
    canOpen: row.status !== 'failed' && (seesMoney || !row.includeMoney),
  };
}

/** Builds a schedule's report, stores the CSV and the HTML page, and tells the recipients. */
async function buildForSchedule(ctx: DomainContext, row: ScheduleRow): Promise<RunRow> {
  const settings = await loadSettings(ctx.orgId);
  const config = (row.config ?? {}) as { range?: string; siteId?: string | null; clientId?: string | null; jobTypeId?: string | null };
  const zone = await siteZone(ctx, config.siteId);
  const range = resolveScheduleRange((SCHEDULE_RANGES as readonly string[]).includes(config.range ?? '') ? (config.range as ScheduleRange) : 'last_week', todayInZone(zone), settings.weekStart);
  let csv: string | null = null;
  let html: string | null = null;
  let rowCount = 0;
  let period: string | null = rangeLabel(range);
  let failure: string | null = null;
  try {
    const report = await buildReport(ctx, row.report, { ...range, siteId: config.siteId ?? null, clientId: config.clientId ?? null, jobTypeId: config.jobTypeId ?? null }, { hideMoney: !row.includeMoney });
    const [org] = await rows<{ name: string }>(db, sql`SELECT name FROM core.organization WHERE id = ${ctx.orgId}`);
    csv = reportToCsv(report);
    html = reportToHtml(report, { orgName: org?.name ?? '' });
    rowCount = report.rows.length;
    period = report.filtersLabel;
  } catch (error) {
    failure = error instanceof Error && error.name === 'DomainError' ? error.message : 'The report could not be built. Try it again from the report page.';
    if (!(error instanceof Error && error.name === 'DomainError')) console.error('[pulse] report build failed', { schedule: row.id, error });
  }
  return inTx(async (tx) => {
    const [run] = await tx.insert(reportRuns).values({ orgId: ctx.orgId, scheduleId: row.id, report: row.report, periodLabel: period, csv, html, rowCount, includeMoney: row.includeMoney, status: failure ? 'failed' : 'ready', error: failure }).returning();
    await tx
      .update(reportSchedules)
      .set({ lastRunAt: new Date(), nextRunAt: row.enabled ? nextScheduleRun({ cadence: row.cadence as ScheduleCadence, weekday: row.weekday, dayOfMonth: row.dayOfMonth, hour: row.hour }, zone) : null, updatedAt: new Date() })
      .where(eq(reportSchedules.id, row.id));
    if (!failure) {
      // A build with money only goes to people who may see money.
      let recipients = row.recipientUserIds ?? [];
      if (row.includeMoney && recipients.length > 0) {
        const seesMoney = new Set((await resolveAllAccess(ctx, tx)).filter((member) => member.access.seesMoney).map((member) => member.person.id));
        recipients = recipients.filter((userId) => seesMoney.has(userId));
      }
      await notify(tx, ctx, recipients, { kind: 'report_ready', params: { reportName: row.name }, url: `${routes.reports()}?tab=scheduled&run=${run!.id}` });
    }
    await logActivity(tx, ctx, { verb: failure ? 'report.build_failed' : 'report.built', entityType: 'report_schedule', entityId: row.id, after: { report: row.report, rows: rowCount } });
    return run!;
  });
}

/** "Build now": runs a schedule right away, whatever its clock says. */
export async function runReportSchedule(ctx: DomainContext, scheduleId: string): Promise<ReportRunDTO> {
  const access = await requirePulse(ctx, 'pulse:read');
  const { row } = await ownScheduleRow(ctx, scheduleId, false);
  const run = await buildForSchedule(ctx, row);
  return toRunDTO({ ...run, scheduleName: row.name }, access.seesMoney);
}

/** Past builds, newest first. Kept 90 days. */
export async function listReportRuns(ctx: DomainContext, options: { limit?: number } = {}): Promise<ReportRunDTO[]> {
  const access = await requirePulse(ctx, 'pulse:read');
  const found = await db
    .select({ run: reportRuns, scheduleName: reportSchedules.name })
    .from(reportRuns)
    .leftJoin(reportSchedules, eq(reportSchedules.id, reportRuns.scheduleId))
    .where(eq(reportRuns.orgId, ctx.orgId))
    .orderBy(desc(reportRuns.createdAt))
    .limit(Math.min(options.limit ?? 50, 200));
  return found.filter((item) => access.seesMoney || !item.run.includeMoney).map((item) => toRunDTO({ ...item.run, scheduleName: item.scheduleName }, access.seesMoney));
}

/** One build's file. A build that holds money needs `money:read`. */
export async function getReportRunFile(ctx: DomainContext, runId: string, format: 'csv' | 'html'): Promise<{ fileName: string; body: string }> {
  const access = await requirePulse(ctx, 'pulse:read');
  const [row] = isUuid(runId) ? await db.select().from(reportRuns).where(and(eq(reportRuns.orgId, ctx.orgId), eq(reportRuns.id, runId))) : [];
  if (!row) throw notFound('That build');
  if (row.includeMoney && !access.seesMoney) throw forbidden('This build shows money. Ask an admin if you need it.');
  const body = format === 'csv' ? row.csv : row.html;
  if (row.status === 'failed' || !body) throw notFound('That file');
  await logActivity(db, ctx, { verb: 'report.downloaded', entityType: 'report_run', entityId: row.id, meta: { report: row.report, format } });
  return { fileName: `${row.report}-${isoRequired(row.createdAt).slice(0, 10)}.${format}`, body };
}

/**
 * Builds every schedule of an org whose time has come. Called by the scheduler; each schedule
 * runs in its own try and catch so one bad report never blocks the rest.
 */
export async function runDueReportSchedules(ctx: DomainContext, now: Date = new Date()): Promise<{ built: number; failed: number }> {
  const due = await db.select().from(reportSchedules).where(and(eq(reportSchedules.orgId, ctx.orgId), isNull(reportSchedules.deletedAt), eq(reportSchedules.enabled, true), sql`${reportSchedules.nextRunAt} IS NOT NULL AND ${reportSchedules.nextRunAt} <= ${now.toISOString()}::timestamptz`));
  let built = 0;
  let failed = 0;
  for (const row of due) {
    try {
      const run = await buildForSchedule(ctx, row);
      if (run.status === 'failed') failed += 1;
      else built += 1;
    } catch (error) {
      failed += 1;
      console.error('[pulse] scheduled report failed', { schedule: row.id, error });
    }
  }
  return { built, failed };
}

/** Text of one summary value, for sentences built on the server (search hits, notifications). */
export function reportSummaryText(report: ReportDTO): string {
  return report.summary.map((item) => `${item.label}: ${reportCellText(item.value, item.kind, 'Hidden')}`).join('. ');
}
