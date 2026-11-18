/**
 * Profit rollups (SPEC 4.9, 4.18). Every date range screen reads `pulse.fact_days` with one
 * grouped statement; drill downs read `pulse.v_facts`. Derived numbers (profit, both margins,
 * per unit costs) are computed here from summed cents with `BigInt`, never floats.
 * Readers without `money:read` get units, hours and pace with every money field null.
 */
import 'server-only';
import { sql, type SQL } from 'drizzle-orm';
import { db } from '@/server/db';
import { invalid } from '@/server/errors';
import { PROFIT_GROUPS, type FactKind, type ProfitGroup, type PulseStatus } from '@/lib/constants';
import { marginBp } from '@/lib/money';
import { addDays, companyBridge, daysBetween, payrollGap, profitSummary, sharedGap as sharedGapOf, utilizationBp } from '@/lib/profit';
import type { BadgesDTO, CompanyBridgeDTO, FactRowDTO, LaborSummaryDTO, ProfitFilters, ProfitResponse, ProfitRowDTO, SummaryDTO, TrendPointDTO } from '@/lib/types';
import { centsOut, isUuid, moneyOut, rows, todayInZone, type DomainContext } from './_shared';
import { requirePulse, type PulseAccess } from './access';
import { resolveSite } from './catalog';
import { loadSettings } from './settings';

type Access = Pick<PulseAccess, 'seesMoney'>;
const ZERO = BigInt(0);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface Bucket {
  key: string;
  label: string;
  sublabel: string | null;
  base: bigint;
  vas: bigint;
  otherRev: bigint;
  labor: bigint;
  material: bigint;
  other: bigint;
  shared: bigint;
  billed: bigint;
  units: number;
  /** Good units of the job work only. In the services view `units` also holds service quantities, which never add into a total. */
  baseUnits?: number;
  scrap: number;
  hours: number;
  jobs: number;
  laborMissing: boolean;
  risk: PulseStatus | null;
}

interface RawRow {
  key: string | null;
  label: string | null;
  sublabel: string | null;
  base: string;
  vas: string;
  other_rev: string;
  labor: string;
  material: string;
  other: string;
  shared: string;
  billed: string;
  units: string;
  base_units: string;
  scrap: string;
  hours: string;
  jobs: number;
  labor_missing: boolean | null;
  risk: string | null;
}

function checkRange(filters: ProfitFilters): void {
  if (!DATE_RE.test(filters.from) || !DATE_RE.test(filters.to)) throw invalid('Pick a start day and an end day.');
  if (filters.to < filters.from) throw invalid('The end day is before the start day.');
  for (const id of [filters.siteId, filters.clientId, filters.jobTypeId, filters.jobId, filters.vasServiceId]) {
    if (id && !isUuid(id)) throw invalid('One of the filters is not valid.');
  }
}

function whereOf(orgId: string, filters: ProfitFilters): SQL {
  const parts: SQL[] = [sql`f.org_id = ${orgId}`, sql`f.work_date BETWEEN ${filters.from}::date AND ${filters.to}::date`];
  if (filters.siteId) parts.push(sql`f.site_id = ${filters.siteId}`);
  if (filters.clientId) parts.push(sql`f.client_id = ${filters.clientId}`);
  if (filters.jobTypeId) parts.push(sql`f.job_type_id = ${filters.jobTypeId}`);
  if (filters.jobId) parts.push(sql`f.job_id = ${filters.jobId}`);
  if (filters.vasServiceId) parts.push(sql`f.vas_service_id = ${filters.vasServiceId}`);
  if (filters.status) parts.push(sql`j.status = ${filters.status}`);
  return sql.join(parts, sql` AND `);
}

/** The first day of the week that holds `work_date`, for a week that starts on `weekStart` (0 is Sunday). */
const weekExpr = (weekStart: number): SQL => sql`(f.work_date - ((EXTRACT(DOW FROM f.work_date)::int - ${weekStart}::int + 7) % 7))`;

function groupSql(by: ProfitGroup, weekStart: number): { key: SQL; label: SQL; sublabel: SQL; joins: SQL } {
  switch (by) {
    case 'job':
      return { key: sql`f.job_id::text`, label: sql`max(j.number)`, sublabel: sql`max(j.name)`, joins: sql`` };
    case 'client':
      return { key: sql`f.client_id::text`, label: sql`max(c.name)`, sublabel: sql`max(c.code)`, joins: sql`LEFT JOIN pulse.clients c ON c.id = f.client_id` };
    case 'type':
      return { key: sql`f.job_type_id::text`, label: sql`max(jt.name)`, sublabel: sql`max(jt.code)`, joins: sql`LEFT JOIN pulse.job_types jt ON jt.id = f.job_type_id` };
    case 'service':
      return { key: sql`f.vas_service_id::text`, label: sql`max(vs.name)`, sublabel: sql`max(vs.code)`, joins: sql`LEFT JOIN pulse.vas_services vs ON vs.id = f.vas_service_id` };
    case 'site':
      return { key: sql`f.site_id::text`, label: sql`max(s.name)`, sublabel: sql`max(s.code)`, joins: sql`LEFT JOIN pulse.sites s ON s.id = f.site_id` };
    case 'month':
      return { key: sql`to_char(date_trunc('month', f.work_date), 'YYYY-MM-DD')`, label: sql`NULL::text`, sublabel: sql`NULL::text`, joins: sql`` };
    case 'week':
      return { key: sql`to_char(${weekExpr(weekStart)}, 'YYYY-MM-DD')`, label: sql`NULL::text`, sublabel: sql`NULL::text`, joins: sql`` };
    case 'day':
      return { key: sql`to_char(f.work_date, 'YYYY-MM-DD')`, label: sql`NULL::text`, sublabel: sql`NULL::text`, joins: sql`` };
  }
}

const NULL_LABELS: Readonly<Record<ProfitGroup, string>> = {
  job: 'Client level, no job',
  client: 'No client',
  type: 'No job type',
  service: 'Core job work',
  site: 'No site',
  month: '',
  week: '',
  day: '',
};

const sums = (unitKinds: SQL): SQL => sql`
  COALESCE(sum(f.amount_cents) FILTER (WHERE f.kind = 'revenue_base'), 0)::text AS base,
  COALESCE(sum(f.amount_cents) FILTER (WHERE f.kind = 'revenue_vas'), 0)::text AS vas,
  COALESCE(sum(f.amount_cents) FILTER (WHERE f.kind = 'revenue_other'), 0)::text AS other_rev,
  COALESCE(sum(f.amount_cents) FILTER (WHERE f.kind = 'labor'), 0)::text AS labor,
  COALESCE(sum(f.amount_cents) FILTER (WHERE f.kind = 'material'), 0)::text AS material,
  COALESCE(sum(f.amount_cents) FILTER (WHERE f.kind = 'other'), 0)::text AS other,
  COALESCE(sum(f.amount_cents) FILTER (WHERE f.kind = 'shared'), 0)::text AS shared,
  COALESCE(sum(f.amount_cents) FILTER (WHERE f.kind = 'billed_memo'), 0)::text AS billed,
  COALESCE(sum(f.units_good) FILTER (WHERE ${unitKinds}), 0)::text AS units,
  COALESCE(sum(f.units_good) FILTER (WHERE f.kind = 'revenue_base'), 0)::text AS base_units,
  COALESCE(sum(f.units_scrap), 0)::text AS scrap,
  COALESCE(sum(f.hours), 0)::text AS hours,
  count(DISTINCT f.job_id)::int AS jobs`;

async function grouped(orgId: string, by: ProfitGroup, filters: ProfitFilters, weekStart: number): Promise<Bucket[]> {
  const group = groupSql(by, weekStart);
  // Service quantities ride on revenue_vas rows; they only count as units in the services view.
  const unitKinds = by === 'service' ? sql`f.kind IN ('revenue_base', 'revenue_vas')` : sql`f.kind = 'revenue_base'`;
  const found = await rows<RawRow>(
    db,
    sql`SELECT ${group.key} AS key, ${group.label} AS label, ${group.sublabel} AS sublabel, ${sums(unitKinds)},
               bool_or(COALESCE((st.needs ->> 'laborMissing')::boolean, false)) AS labor_missing,
               ${by === 'job' ? sql`max(st.risk_status)` : sql`NULL::text`} AS risk
          FROM pulse.fact_days f
          LEFT JOIN pulse.jobs j ON j.id = f.job_id
          LEFT JOIN pulse.job_stats st ON st.job_id = f.job_id
          ${group.joins}
         WHERE ${whereOf(orgId, filters)}
         GROUP BY 1
         ORDER BY 1`,
  );
  return found.map((row) => ({
    key: row.key ?? 'none',
    // Time buckets are labeled by their first day; the client formats it.
    label: row.label ?? (NULL_LABELS[by] || row.key || ''),
    sublabel: row.sublabel,
    base: BigInt(row.base),
    vas: BigInt(row.vas),
    otherRev: BigInt(row.other_rev),
    labor: BigInt(row.labor),
    material: BigInt(row.material),
    other: BigInt(row.other),
    shared: BigInt(row.shared),
    billed: BigInt(row.billed),
    units: Number(row.units),
    baseUnits: Number(row.base_units),
    scrap: Number(row.scrap),
    hours: Number(row.hours),
    jobs: row.jobs,
    laborMissing: Boolean(row.labor_missing),
    risk: (row.risk as PulseStatus | null) ?? null,
  }));
}

function totalOf(buckets: readonly Bucket[], label: string): Bucket {
  const total: Bucket = { key: 'total', label, sublabel: null, base: ZERO, vas: ZERO, otherRev: ZERO, labor: ZERO, material: ZERO, other: ZERO, shared: ZERO, billed: ZERO, units: 0, scrap: 0, hours: 0, jobs: 0, laborMissing: false, risk: null };
  for (const bucket of buckets) {
    total.base += bucket.base;
    total.vas += bucket.vas;
    total.otherRev += bucket.otherRev;
    total.labor += bucket.labor;
    total.material += bucket.material;
    total.other += bucket.other;
    total.shared += bucket.shared;
    total.billed += bucket.billed;
    total.units += bucket.baseUnits ?? bucket.units;
    total.scrap += bucket.scrap;
    total.hours += bucket.hours;
    total.laborMissing ||= bucket.laborMissing;
  }
  return total;
}

const revenueOf = (bucket: Bucket): bigint => bucket.base + bucket.vas + bucket.otherRev;
const costOf = (bucket: Bucket): bigint => bucket.labor + bucket.material + bucket.other + bucket.shared;

export function toProfitRow(bucket: Bucket, access: Access, extra: { prior?: Bucket | null; trend?: number[] | null } = {}): ProfitRowDTO {
  const money = access.seesMoney;
  const revenue = revenueOf(bucket);
  // One formula for every headline number: the same pure function the job page and the tests use.
  const summary = profitSummary(
    { revenueCents: revenue, laborCents: bucket.labor, materialCents: bucket.material, otherCents: bucket.other, sharedCents: bucket.shared },
    bucket.units > 0 ? bucket.units.toFixed(3) : 0,
  );
  const cost = summary.costCents;
  const profit = summary.profitCents;
  const prior = extra.prior;
  return {
    key: bucket.key,
    label: bucket.label,
    sublabel: bucket.sublabel,
    revenueCents: moneyOut(money, revenue),
    baseRevenueCents: moneyOut(money, bucket.base),
    vasRevenueCents: moneyOut(money, bucket.vas),
    otherRevenueCents: moneyOut(money, bucket.otherRev),
    laborCents: moneyOut(money, bucket.labor),
    materialCents: moneyOut(money, bucket.material),
    otherCents: moneyOut(money, bucket.other),
    sharedCents: moneyOut(money, bucket.shared),
    costCents: moneyOut(money, cost),
    profitCents: moneyOut(money, profit),
    marginBp: money ? summary.marginBp : null,
    marginBeforeSharedBp: money ? summary.marginBeforeSharedBp : null,
    laborPctBp: money ? summary.laborPctOfRevenueBp : null,
    billedCents: moneyOut(money, bucket.billed),
    unitsGood: bucket.units.toFixed(3),
    unitsScrap: bucket.scrap.toFixed(3),
    hours: bucket.hours.toFixed(2),
    uph: bucket.hours > 0 && bucket.units > 0 ? (bucket.units / bucket.hours).toFixed(3) : null,
    costPerUnitCents: money ? centsOut(summary.costPerUnitCents) : null,
    profitPerUnitCents: money ? centsOut(summary.profitPerUnitCents) : null,
    jobCount: bucket.jobs,
    prior:
      prior === undefined
        ? null
        : {
            revenueCents: moneyOut(money, prior ? revenueOf(prior) : ZERO),
            profitCents: moneyOut(money, prior ? revenueOf(prior) - costOf(prior) : ZERO),
            marginBp: money && prior ? marginBp(revenueOf(prior) - costOf(prior), revenueOf(prior)) : null,
            unitsGood: (prior?.units ?? 0).toFixed(3),
          },
    trend: extra.trend ?? null,
    laborMissing: bucket.laborMissing,
    riskStatus: bucket.risk,
  };
}

/** The period of the same length right before `from` to `to`. */
export function priorRange(from: string, to: string): { from: string; to: string } {
  const length = daysBetween(from, to) + 1;
  return { from: addDays(from, -length), to: addDays(from, -1) };
}

/** Day buckets up to 31 days, week buckets up to 26 weeks, else months. */
export function autoBucket(from: string, to: string): 'day' | 'week' | 'month' {
  const length = daysBetween(from, to) + 1;
  return length <= 31 ? 'day' : length <= 182 ? 'week' : 'month';
}

async function trends(orgId: string, by: ProfitGroup, filters: ProfitFilters, weekStart: number, money: boolean): Promise<Map<string, number[]>> {
  const bucket = autoBucket(filters.from, filters.to);
  const group = groupSql(by, weekStart);
  const bucketExpr = bucket === 'day' ? sql`f.work_date` : bucket === 'week' ? weekExpr(weekStart) : sql`date_trunc('month', f.work_date)::date`;
  const found = await rows<{ key: string | null; b: string; profit: string; units: string }>(
    db,
    sql`SELECT ${group.key} AS key, to_char(${bucketExpr}, 'YYYY-MM-DD') AS b,
               COALESCE(sum(CASE WHEN f.kind IN ('revenue_base', 'revenue_vas', 'revenue_other') THEN f.amount_cents WHEN f.kind = 'billed_memo' THEN 0 ELSE -f.amount_cents END), 0)::text AS profit,
               COALESCE(sum(f.units_good) FILTER (WHERE f.kind = 'revenue_base'), 0)::text AS units
          FROM pulse.fact_days f LEFT JOIN pulse.jobs j ON j.id = f.job_id
         WHERE ${whereOf(orgId, filters)}
         GROUP BY 1, 2 ORDER BY 2`,
  );
  const labels = [...new Set(found.map((row) => row.b))].sort();
  const index = new Map(labels.map((label, i) => [label, i]));
  const out = new Map<string, number[]>();
  for (const row of found) {
    const key = row.key ?? 'none';
    let series = out.get(key);
    if (!series) out.set(key, (series = new Array<number>(labels.length).fill(0)));
    series[index.get(row.b)!] = money ? Number(row.profit) : Number(row.units);
  }
  return out;
}

export interface ProfitOptions {
  /** Add the same numbers for the period right before. */
  readonly comparePrior?: boolean;
  /** Add a sparkline per row (profit, or units when money is hidden). */
  readonly trend?: boolean;
}

/**
 * The Profit explorer: revenue, the four cost buckets, profit, both margins, units and pace,
 * grouped by job, client, job type, service, site, month, week or day. The total always equals
 * the sum of the rows, and the sum of the level below.
 */
export async function getProfit(ctx: DomainContext, by: ProfitGroup, filters: ProfitFilters, options: ProfitOptions = {}): Promise<ProfitResponse> {
  const access = await requirePulse(ctx, 'pulse:read');
  if (!(PROFIT_GROUPS as readonly string[]).includes(by)) throw invalid('Pick how to group the numbers.');
  checkRange(filters);
  const settings = await loadSettings(ctx.orgId);
  const buckets = await grouped(ctx.orgId, by, filters, settings.weekStart);
  const prior = options.comparePrior ? await grouped(ctx.orgId, by, { ...filters, ...priorRange(filters.from, filters.to) }, settings.weekStart) : null;
  const priorByKey = prior ? new Map(prior.map((bucket) => [bucket.key, bucket])) : null;
  const trend = options.trend ? await trends(ctx.orgId, by, filters, settings.weekStart, access.seesMoney) : null;
  const total = totalOf(buckets, 'Total');
  const [jobCount] = await rows<{ n: number }>(db, sql`SELECT count(DISTINCT f.job_id)::int AS n FROM pulse.fact_days f LEFT JOIN pulse.jobs j ON j.id = f.job_id WHERE ${whereOf(ctx.orgId, filters)}`);
  total.jobs = jobCount?.n ?? 0;
  return {
    by,
    from: filters.from,
    to: filters.to,
    rows: buckets.map((bucket) => toProfitRow(bucket, access, { prior: priorByKey ? (priorByKey.get(bucket.key) ?? null) : undefined, trend: trend?.get(bucket.key) ?? null })),
    total: toProfitRow(total, access, { prior: prior ? totalOf(prior, 'Total') : undefined }),
    moneyHidden: !access.seesMoney,
  };
}

/** Profit summary of one job over all time (the totals row of its fact days). */
export async function getJobProfit(ctx: DomainContext, jobId: string): Promise<ProfitRowDTO> {
  const result = await getProfit(ctx, 'job', { from: '0001-01-01', to: '9999-12-31', jobId });
  return result.rows[0] ?? result.total;
}

/** Revenue, cost, profit, units and hours per day, week or month (trend charts). */
export async function getProfitTrend(ctx: DomainContext, filters: ProfitFilters, bucket?: 'day' | 'week' | 'month'): Promise<TrendPointDTO[]> {
  const result = await getProfit(ctx, bucket ?? autoBucket(filters.from, filters.to), filters);
  return result.rows.map((row) => ({ bucket: row.key, revenueCents: row.revenueCents, costCents: row.costCents, profitCents: row.profitCents, marginBp: row.marginBp, unitsGood: row.unitsGood, hours: row.hours }));
}

/** The stamped rows behind a number (drill down and "See 14 entries"). Reads `v_facts`. */
export async function listFacts(ctx: DomainContext, filters: ProfitFilters & { kinds?: readonly FactKind[]; limit?: number }): Promise<FactRowDTO[]> {
  const access = await requirePulse(ctx, 'pulse:read');
  checkRange(filters);
  const kinds = filters.kinds && filters.kinds.length > 0 ? sql`AND f.kind = ANY(${sql`ARRAY[${sql.join(filters.kinds.map((kind) => sql`${kind}`), sql`, `)}]::text[]`})` : sql``;
  const found = await rows<{ work_date: string; kind: FactKind; amount_cents: string; units_good: string; hours: string; job_id: string | null; client_id: string; vas_service_id: string | null; source_table: string; source_id: string }>(
    db,
    sql`SELECT to_char(f.work_date, 'YYYY-MM-DD') AS work_date, f.kind, f.amount_cents::text, f.units_good::text, f.hours::text, f.job_id, f.client_id, f.vas_service_id, f.source_table, f.source_id
          FROM pulse.v_facts f LEFT JOIN pulse.jobs j ON j.id = f.job_id
         WHERE ${whereOf(ctx.orgId, filters)} ${kinds}
         ORDER BY f.work_date DESC, f.source_table, f.source_id
         LIMIT ${Math.min(filters.limit ?? 500, 5000)}`,
  );
  return found.map((row) => ({
    workDate: row.work_date,
    kind: row.kind,
    amountCents: moneyOut(access.seesMoney, row.amount_cents),
    unitsGood: row.units_good,
    hours: row.hours,
    jobId: row.job_id,
    clientId: row.client_id,
    vasServiceId: row.vas_service_id,
    sourceTable: row.source_table,
    sourceId: row.source_id,
  }));
}

/**
 * The walk from profit on jobs to company profit (SPEC 4.9):
 * company profit = profit on jobs, less time not on a job that no job carried, less paid time
 * not on any job, less the overhead the hourly rate did not cover.
 */
export async function getCompanyBridge(ctx: DomainContext, filters: { from: string; to: string; siteId?: string | null }): Promise<CompanyBridgeDTO> {
  const access = await requirePulse(ctx, 'pulse:read');
  checkRange(filters);
  const settings = await loadSettings(ctx.orgId);
  const site = filters.siteId ? sql`AND site_id = ${filters.siteId}` : sql``;
  const [work] = await rows<{ profit: string }>(
    db,
    sql`SELECT COALESCE(sum(CASE WHEN kind IN ('revenue_base', 'revenue_vas', 'revenue_other') THEN amount_cents WHEN kind = 'billed_memo' THEN 0 ELSE -amount_cents END), 0)::text AS profit
          FROM pulse.fact_days WHERE org_id = ${ctx.orgId} AND work_date BETWEEN ${filters.from}::date AND ${filters.to}::date ${site}`,
  );
  const [day] = await rows<{
    direct_hours: string;
    indirect_hours: string;
    paid_hours: string;
    missing_hours: string;
    indirect: string;
    applied: string;
    missing: string;
    paid: string | null;
    gross_paid_days: string;
    company: string;
    overhead: string;
    over_logged: number;
    base_hours: string;
  }>(
    db,
    sql`SELECT COALESCE(sum(direct_hours), 0)::text AS direct_hours, COALESCE(sum(indirect_hours), 0)::text AS indirect_hours, COALESCE(sum(paid_hours), 0)::text AS paid_hours,
               COALESCE(sum(missing_hours), 0)::text AS missing_hours, COALESCE(sum(indirect_cents), 0)::text AS indirect, COALESCE(sum(shared_applied_cents), 0)::text AS applied,
               COALESCE(sum(missing_cents), 0)::text AS missing, sum(paid_cents)::text AS paid,
               COALESCE(sum(gross_pay_cents) FILTER (WHERE paid_cents IS NOT NULL), 0)::text AS gross_paid_days,
               COALESCE(sum(company_cost_cents), 0)::text AS company, COALESCE(sum(overhead_absorbed_cents), 0)::text AS overhead,
               count(*) FILTER (WHERE over_logged)::int AS over_logged,
               COALESCE(sum(CASE WHEN paid_hours > 0 THEN paid_hours ELSE direct_hours + indirect_hours END), 0)::text AS base_hours
          FROM pulse.company_days WHERE org_id = ${ctx.orgId} AND work_date BETWEEN ${filters.from}::date AND ${filters.to}::date ${site}`,
  );
  const workProfit = BigInt(work?.profit ?? 0);
  const indirect = BigInt(day?.indirect ?? 0);
  const applied = BigInt(day?.applied ?? 0);
  const missing = BigInt(day?.missing ?? 0);
  const company = BigInt(day?.company ?? 0);
  const overhead = BigInt(day?.overhead ?? 0);
  // The walk itself is the pure `companyBridge` of src/lib/profit, so the page, the report and the tests agree.
  const rule = settings.sharedCostRule as 'by_labor_hours' | 'full' | 'percent_of_labor' | 'none';
  const sharedGap = sharedGapOf({ rule, indirectCents: indirect, missingCents: missing, sharedAppliedCents: applied });
  const bridge = companyBridge({ workProfitCents: workProfit, sharedGapCents: sharedGap, missingCents: missing, companyCostCents: company, overheadAbsorbedCents: overhead, rule });
  const missingCost = bridge.missingCents;
  const hasCompanyCosts = bridge.showsOverheadGap;
  const overheadGap = bridge.overheadGapCents;
  const companyProfit = bridge.companyProfitCents;
  const directHours = Number(day?.direct_hours ?? 0);
  const indirectHours = Number(day?.indirect_hours ?? 0);
  const paidHours = Number(day?.paid_hours ?? 0);
  // Share of paid time spent on jobs: per day, paid hours when entered, else the hours logged that day.
  const base = Number(day?.base_hours ?? 0);
  const money = access.seesMoney;
  const paid = day?.paid === null || day?.paid === undefined ? null : BigInt(day.paid);
  return {
    from: filters.from,
    to: filters.to,
    workProfitCents: moneyOut(money, workProfit),
    sharedGapCents: moneyOut(money, sharedGap),
    missingCostCents: moneyOut(money, missingCost),
    companyCostCents: moneyOut(money, company),
    overheadAbsorbedCents: moneyOut(money, overhead),
    overheadGapCents: hasCompanyCosts ? moneyOut(money, overheadGap) : null,
    companyProfitCents: moneyOut(money, companyProfit),
    indirectCents: moneyOut(money, indirect),
    sharedAppliedCents: moneyOut(money, applied),
    directHours: directHours.toFixed(2),
    indirectHours: indirectHours.toFixed(2),
    paidHours: paidHours.toFixed(2),
    missingHours: Number(day?.missing_hours ?? 0).toFixed(2),
    utilizationBp: base > 0 ? Math.min(utilizationBp({ directHours: day?.direct_hours ?? '0', paidHours: day?.base_hours ?? '0' }) ?? 0, 10000) : null,
    paidCents: moneyOut(money, paid),
    grossPayCents: moneyOut(money, day?.gross_paid_days ?? 0),
    payrollGapCents: paid === null ? null : moneyOut(money, payrollGap(paid, day?.gross_paid_days ?? 0)),
    overLoggedDays: day?.over_logged ?? 0,
    hasCompanyCosts,
    moneyHidden: !money,
  };
}

/** Counts for the sidebar and the bell. Cheap: three index reads. */
export async function getBadges(ctx: DomainContext): Promise<BadgesDTO> {
  const access = await requirePulse(ctx, 'pulse:read').catch(() => null);
  if (!access) return { jobsAtRisk: 0, openAlerts: 0, unreadNotifications: 0 };
  const [row] = await rows<{ risk: number; alerts: number; unread: number }>(
    db,
    sql`SELECT
          (SELECT count(*) FROM pulse.job_stats st JOIN pulse.jobs j ON j.id = st.job_id
            WHERE st.org_id = ${ctx.orgId} AND st.risk_status IN ('losing', 'at_risk') AND j.deleted_at IS NULL AND j.archived_at IS NULL AND j.status = 'active')::int AS risk,
          (SELECT count(*) FROM pulse.alerts a WHERE a.org_id = ${ctx.orgId} AND a.status = 'open')::int AS alerts,
          (SELECT count(*) FROM pulse.notifications n WHERE n.org_id = ${ctx.orgId} AND n.user_id = ${ctx.userId} AND n.read_at IS NULL AND n.archived_at IS NULL)::int AS unread`,
  );
  return { jobsAtRisk: row?.risk ?? 0, openAlerts: row?.alerts ?? 0, unreadNotifications: row?.unread ?? 0 };
}

/** Home: counts by status, the period totals with the prior period, the bridge, entry progress and things to fix. */
export async function getSummary(ctx: DomainContext, filters: { from: string; to: string; siteId?: string | null }): Promise<SummaryDTO> {
  const access = await requirePulse(ctx, 'pulse:read');
  checkRange(filters);
  const settings = await loadSettings(ctx.orgId);
  const site = await resolveSite(ctx, filters.siteId);
  const today = todayInZone(site.timezone);
  const siteFilter = filters.siteId ? sql`AND j.site_id = ${filters.siteId}` : sql``;
  const [profit, bridge, counts, progress, fix, alerts] = await Promise.all([
    getProfit(ctx, 'month', filters, { comparePrior: true }),
    getCompanyBridge(ctx, filters),
    rows<{ risk: string | null; n: number }>(
      db,
      sql`SELECT st.risk_status AS risk, count(*)::int AS n FROM pulse.jobs j LEFT JOIN pulse.job_stats st ON st.job_id = j.id
           WHERE j.org_id = ${ctx.orgId} AND j.deleted_at IS NULL AND j.archived_at IS NULL AND j.status IN ('active', 'on_hold') ${siteFilter} GROUP BY st.risk_status`,
    ),
    rows<{ active: number; logged: number; reviewed: number; unbilled: string }>(
      db,
      sql`SELECT
            (SELECT count(*) FROM pulse.jobs j WHERE j.org_id = ${ctx.orgId} AND j.deleted_at IS NULL AND j.status = 'active' AND (j.start_date IS NULL OR j.start_date <= ${today}::date) ${siteFilter})::int AS active,
            (SELECT count(DISTINCT p.job_id) FROM pulse.production_entries p JOIN pulse.jobs j ON j.id = p.job_id
              WHERE p.org_id = ${ctx.orgId} AND p.work_date = ${today}::date AND p.deleted_at IS NULL AND j.status = 'active' AND j.deleted_at IS NULL ${siteFilter})::int AS logged,
            (SELECT count(*) FROM pulse.day_reviews r WHERE r.org_id = ${ctx.orgId} AND r.status = 'approved'
              AND r.work_date BETWEEN (${today}::date - ((EXTRACT(DOW FROM ${today}::date)::int - ${settings.weekStart}::int + 7) % 7)) AND ${today}::date
              ${filters.siteId ? sql`AND r.site_id = ${filters.siteId}` : sql``})::int AS reviewed,
            (SELECT COALESCE(sum(st.revenue_cents - st.billed_cents), 0) FROM pulse.job_stats st JOIN pulse.jobs j ON j.id = st.job_id
              WHERE st.org_id = ${ctx.orgId} AND j.deleted_at IS NULL AND j.status <> 'cancelled' ${siteFilter})::text AS unbilled`,
    ),
    rows<{ needs_rate: number; no_price: number; units_no_hours: number; service_no_price: number }>(
      db,
      sql`SELECT
            COALESCE(sum((st.needs ->> 'needsRate')::int), 0)::int AS needs_rate,
            count(*) FILTER (WHERE (st.needs ->> 'noPrice')::boolean)::int AS no_price,
            COALESCE(sum((st.needs ->> 'daysMissingHours')::int), 0)::int AS units_no_hours,
            COALESCE(sum((st.needs ->> 'serviceNoPrice')::int), 0)::int AS service_no_price
          FROM pulse.job_stats st JOIN pulse.jobs j ON j.id = st.job_id
         WHERE st.org_id = ${ctx.orgId} AND j.deleted_at IS NULL AND j.status IN ('active', 'on_hold', 'completed') ${siteFilter}`,
    ),
    rows<{ n: number }>(db, sql`SELECT count(*)::int AS n FROM pulse.alerts WHERE org_id = ${ctx.orgId} AND status = 'open'`),
  ]);
  const byRisk = new Map(counts.map((row) => [row.risk ?? 'none', row.n]));
  const weekStartDay = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() - settings.weekStart + 7) % 7));
  let workDays = 0;
  for (let day = weekStartDay; day < today; day = addDays(day, 1)) if (settings.workingDays.includes(new Date(`${day}T00:00:00Z`).getUTCDay())) workDays += 1;
  const totalPrior = profit.total.prior;
  return {
    from: filters.from,
    to: filters.to,
    openJobs: counts.reduce((sum, row) => sum + row.n, 0),
    atRisk: byRisk.get('at_risk') ?? 0,
    losing: byRisk.get('losing') ?? 0,
    headsUp: byRisk.get('heads_up') ?? 0,
    onTrack: byRisk.get('on_track') ?? 0,
    noData: byRisk.get('no_data') ?? 0,
    total: { ...profit.total, prior: totalPrior },
    prior: null,
    bridge,
    entryProgress: { activeJobs: progress[0]?.active ?? 0, loggedToday: progress[0]?.logged ?? 0, date: today, daysReviewedThisWeek: progress[0]?.reviewed ?? 0, workDaysThisWeek: workDays },
    notBilledYetCents: moneyOut(access.seesMoney, progress[0]?.unbilled ?? 0),
    openAlerts: alerts[0]?.n ?? 0,
    thingsToFix: { needsRate: fix[0]?.needs_rate ?? 0, noPrice: fix[0]?.no_price ?? 0, unitsNoHours: fix[0]?.units_no_hours ?? 0, serviceNoPrice: fix[0]?.service_no_price ?? 0 },
    moneyHidden: !access.seesMoney,
  };
}


/**
 * The Labor page: hours and cost by labor class (on jobs and not on a job, overtime, setup),
 * time not on a job by reason, the day by day split of paid time, and the bridge numbers
 * (share of paid time spent on jobs, payroll check).
 */
export async function getLaborSummary(ctx: DomainContext, filters: { from: string; to: string; siteId?: string | null }): Promise<LaborSummaryDTO> {
  const access = await requirePulse(ctx, 'pulse:read');
  checkRange(filters);
  const money = access.seesMoney;
  const range = sql`org_id = ${ctx.orgId} AND deleted_at IS NULL AND work_date BETWEEN ${filters.from}::date AND ${filters.to}::date ${filters.siteId ? sql`AND site_id = ${filters.siteId}` : sql``}`;
  const byClass = await rows<{ id: string | null; name: string | null; direct: string; indirect: string; overtime: string; setup: string; labor: string; indirect_cents: string; units: string; entries: number; needs_rate: number }>(
    db,
    sql`WITH u AS (
          SELECT labor_class_id, hours AS direct, 0::numeric AS indirect, overtime_hours, setup_hours, labor_cost_cents AS labor, 0::bigint AS indirect_cents, units_good, needs_rate FROM pulse.production_entries WHERE ${range}
          UNION ALL SELECT labor_class_id, hours, 0, overtime_hours, 0, labor_cost_cents, 0, 0, needs_rate FROM pulse.vas_entries WHERE ${range}
          UNION ALL SELECT labor_class_id, 0, hours, overtime_hours, 0, 0, cost_cents, 0, needs_rate FROM pulse.indirect_entries WHERE ${range}
        )
        SELECT u.labor_class_id AS id, max(lc.name) AS name, sum(u.direct)::text AS direct, sum(u.indirect)::text AS indirect, sum(u.overtime_hours)::text AS overtime,
               sum(u.setup_hours)::text AS setup, sum(u.labor)::text AS labor, sum(u.indirect_cents)::text AS indirect_cents, sum(u.units_good)::text AS units,
               count(*)::int AS entries, count(*) FILTER (WHERE u.needs_rate)::int AS needs_rate
          FROM u LEFT JOIN pulse.labor_classes lc ON lc.id = u.labor_class_id
         GROUP BY u.labor_class_id ORDER BY sum(u.labor) + sum(u.indirect_cents) DESC`,
  );
  const byReason = await rows<{ reason: string; hours: string; cost: string; entries: number }>(
    db,
    sql`SELECT reason, sum(hours)::text AS hours, sum(cost_cents)::text AS cost, count(*)::int AS entries FROM pulse.indirect_entries WHERE ${range} GROUP BY reason ORDER BY sum(hours) DESC`,
  );
  const byDay = await rows<{ d: string; direct: string; indirect: string; paid: string; missing: string; indirect_cents: string; missing_cents: string; over_logged: boolean }>(
    db,
    sql`SELECT to_char(work_date, 'YYYY-MM-DD') AS d, sum(direct_hours)::text AS direct, sum(indirect_hours)::text AS indirect, sum(paid_hours)::text AS paid, sum(missing_hours)::text AS missing,
               sum(indirect_cents)::text AS indirect_cents, sum(missing_cents)::text AS missing_cents, bool_or(over_logged) AS over_logged
          FROM pulse.company_days
         WHERE org_id = ${ctx.orgId} AND work_date BETWEEN ${filters.from}::date AND ${filters.to}::date ${filters.siteId ? sql`AND site_id = ${filters.siteId}` : sql``}
         GROUP BY work_date ORDER BY work_date`,
  );
  return {
    from: filters.from,
    to: filters.to,
    byClass: byClass.map((row) => ({
      laborClassId: row.id,
      name: row.name ?? 'No labor class',
      directHours: row.direct,
      indirectHours: row.indirect,
      overtimeHours: row.overtime,
      setupHours: row.setup,
      laborCents: moneyOut(money, row.labor),
      indirectCents: moneyOut(money, row.indirect_cents),
      unitsGood: row.units,
      entries: row.entries,
      needsRate: row.needs_rate,
    })),
    byReason: byReason.map((row) => ({ reason: row.reason, hours: row.hours, costCents: moneyOut(money, row.cost), entries: row.entries })),
    byDay: byDay.map((row) => ({ date: row.d, directHours: row.direct, indirectHours: row.indirect, paidHours: row.paid, missingHours: row.missing, indirectCents: moneyOut(money, row.indirect_cents), missingCents: moneyOut(money, row.missing_cents), overLogged: row.over_logged })),
    bridge: await getCompanyBridge(ctx, filters),
    moneyHidden: !money,
  };
}
