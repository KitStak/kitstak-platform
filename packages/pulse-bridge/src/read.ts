/**
 * Reads of Pulse profit data for sibling apps. Every function:
 *  - takes the host app's Drizzle executor and the reader `{ orgId, userId }`,
 *  - never throws (any error reads as "not installed"),
 *  - returns `{ available: false, reason }` when Pulse is absent or the person has no Pulse role,
 *  - hides money on the server: without `seesMoney` every cents and margin field is `null`
 *    and the result carries `moneyHidden: true`.
 *
 * Numbers are never worked out here from raw entries. Job figures come from `pulse.job_stats`
 * (the rollup Pulse keeps for its own job pages) and period figures from `pulse.fact_days` (the
 * rollup behind the Profit page), summed with the same kinds Pulse sums. A margin is profit over
 * revenue in basis points, rounded half away from zero in SQL, the one rounding rule of Pulse.
 */
import { sql, type SQL } from 'drizzle-orm';
import { NO_ACCESS, resolvePulseAccess } from './access';
import { isUuid, list, pulseAvailability, query, queryOne, toCount, toInt, type BridgeExecutor } from './executor';
import {
  PULSE_JOB_STATUS_LABELS,
  PULSE_STATUS_LABELS,
  isPulseStatus,
  type PulseAccess,
  type PulseClientProfitResult,
  type PulseClientRef,
  type PulseJobSummary,
  type PulseJobTotals,
  type PulseJobsResult,
  type PulseMonthPoint,
  type PulseOrgSummaryResult,
  type PulsePeriodProfit,
  type PulseReader,
  type PulseRecordType,
  type PulseUnavailable,
} from './types';

const NOT_INSTALLED: PulseUnavailable = { available: false, reason: 'not_installed' };
const NO_ACCESS_RESULT: PulseUnavailable = { available: false, reason: 'no_access' };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Gate shared by every read: Pulse installed, ids well formed, the person has a Pulse role. */
async function gate(db: BridgeExecutor, who: PulseReader): Promise<{ access: PulseAccess } | PulseUnavailable> {
  if (!isUuid(who.orgId) || !isUuid(who.userId)) return NO_ACCESS_RESULT;
  const availability = await pulseAvailability(db);
  if (!availability.installed) return NOT_INSTALLED;
  const access = await resolvePulseAccess(db, who);
  if (access.role === 'none') return NO_ACCESS_RESULT;
  return { access };
}

/** Margin in basis points from two bigint expressions; null when revenue is zero or less. */
const marginSql = (profit: SQL, revenue: SQL): SQL =>
  sql`case when ${revenue} > 0 and abs(round((${profit})::numeric * 10000 / (${revenue})::numeric)) <= 1000000
           then round((${profit})::numeric * 10000 / (${revenue})::numeric)::int end`;

interface JobRow {
  id: string;
  number: string;
  name: string;
  client_id: string | null;
  client_name: string | null;
  status: string;
  unit_label: string | null;
  planned_units: string | null;
  due_date: string | null;
  units_good: string | null;
  hours: string | null;
  pct_complete_bp: number | null;
  last_entry_date: string | null;
  risk_status: string | null;
  revenue_cents: unknown;
  cost_cents: unknown;
  labor_cents: unknown;
  material_cents: unknown;
  profit_cents: unknown;
  margin_bp: number | null;
  target_margin_bp: number | null;
  projected_profit_cents: unknown;
  projected_margin_bp: number | null;
  quote_revenue_cents: unknown;
  plan_labor_cents: unknown;
  plan_material_cents: unknown;
}

const JOB_SELECT = sql`
  select j.id::text as id, j.number, j.name, j.client_id::text as client_id, c.name as client_name, j.status,
         j.unit_label, j.planned_units::text as planned_units, j.due_date::text as due_date,
         st.units_good::text as units_good, st.hours::text as hours, st.pct_complete_bp, st.last_entry_date::text as last_entry_date,
         st.risk_status, st.revenue_cents, st.cost_cents, st.labor_cents, st.material_cents, st.profit_cents, st.margin_bp,
         coalesce(st.target_margin_bp, j.target_margin_bp) as target_margin_bp, st.projected_profit_cents, st.projected_margin_bp,
         (select q.revenue_cents from pulse.job_plans q where q.job_id = j.id and q.plan = 'quote' limit 1) as quote_revenue_cents,
         coalesce((select b.labor_cents + b.setup_cents from pulse.job_plans b where b.job_id = j.id and b.plan = 'budget' limit 1),
                  (select q.labor_cents + q.setup_cents from pulse.job_plans q where q.job_id = j.id and q.plan = 'quote' limit 1)) as plan_labor_cents,
         coalesce((select b.material_cents from pulse.job_plans b where b.job_id = j.id and b.plan = 'budget' limit 1),
                  (select q.material_cents from pulse.job_plans q where q.job_id = j.id and q.plan = 'quote' limit 1)) as plan_material_cents
    from pulse.jobs j
    left join pulse.clients c on c.id = j.client_id
    left join pulse.job_stats st on st.job_id = j.id`;

/** Worst health first, then the newest job. */
const JOB_ORDER = sql`order by case st.risk_status when 'losing' then 0 when 'at_risk' then 1 when 'heads_up' then 2 when 'on_track' then 3 else 4 end,
                               j.created_at desc`;

function toJob(row: JobRow, money: boolean): PulseJobSummary {
  const risk = isPulseStatus(row.risk_status) ? row.risk_status : null;
  const cents = (value: unknown): number | null => (money ? toInt(value) : null);
  return {
    id: row.id,
    number: row.number,
    name: row.name,
    clientId: row.client_id,
    clientName: row.client_name,
    status: row.status,
    statusLabel: PULSE_JOB_STATUS_LABELS[row.status] ?? row.status,
    risk,
    riskLabel: risk ? PULSE_STATUS_LABELS[risk] : null,
    unitLabel: row.unit_label || 'units',
    plannedUnits: row.planned_units ?? '0',
    unitsGood: row.units_good ?? '0',
    pctCompleteBp: row.pct_complete_bp,
    hours: row.hours ?? '0',
    lastEntryDate: row.last_entry_date,
    dueDate: row.due_date,
    revenueCents: cents(row.revenue_cents),
    costCents: cents(row.cost_cents),
    laborCents: cents(row.labor_cents),
    materialCents: cents(row.material_cents),
    profitCents: cents(row.profit_cents),
    marginBp: money ? row.margin_bp : null,
    targetMarginBp: money ? row.target_margin_bp : null,
    projectedProfitCents: cents(row.projected_profit_cents),
    projectedMarginBp: money ? row.projected_margin_bp : null,
    quoteRevenueCents: cents(row.quote_revenue_cents),
    planLaborCents: cents(row.plan_labor_cents),
    planMaterialCents: cents(row.plan_material_cents),
    path: `/jobs/${encodeURIComponent(row.number)}`,
  };
}

/** Totals over a set of job ids, summed and divided in SQL. */
async function totalsFor(db: BridgeExecutor, orgId: string, ids: readonly string[], money: boolean): Promise<PulseJobTotals> {
  const empty: PulseJobTotals = { jobs: 0, atRisk: 0, losing: 0, revenueCents: money ? 0 : null, costCents: money ? 0 : null, profitCents: money ? 0 : null, marginBp: null };
  if (ids.length === 0) return empty;
  const row = await queryOne<{ jobs: unknown; at_risk: unknown; losing: unknown; revenue: unknown; cost: unknown; profit: unknown; margin_bp: number | null }>(
    db,
    sql`with t as (
          select count(*) as jobs,
                 count(*) filter (where st.risk_status = 'at_risk') as at_risk,
                 count(*) filter (where st.risk_status = 'losing') as losing,
                 coalesce(sum(st.revenue_cents), 0)::bigint as revenue,
                 coalesce(sum(st.cost_cents), 0)::bigint as cost,
                 coalesce(sum(st.profit_cents), 0)::bigint as profit
            from pulse.jobs j left join pulse.job_stats st on st.job_id = j.id
           where j.org_id = ${orgId}::uuid and j.id::text in ${list(ids)})
        select t.*, ${marginSql(sql`t.profit`, sql`t.revenue`)} as margin_bp from t`,
  );
  if (!row) return empty;
  return {
    jobs: toCount(row.jobs),
    atRisk: toCount(row.at_risk),
    losing: toCount(row.losing),
    revenueCents: money ? toInt(row.revenue) : null,
    costCents: money ? toInt(row.cost) : null,
    profitCents: money ? toInt(row.profit) : null,
    marginBp: money ? row.margin_bp : null,
  };
}

/** WHERE fragment (alias `j`) for the live jobs tied to a sibling record. `null` means no job can match. */
function recordFilter(orgId: string, type: PulseRecordType, id: string): SQL | null {
  const targetId = id.trim();
  if (!targetId || targetId.length > 64) return null;
  const viaLink = (linkType: string): SQL =>
    sql`exists (select 1 from pulse.job_links l where l.org_id = ${orgId}::uuid and l.job_id = j.id and l.target_type = ${linkType} and l.target_id = ${targetId})`;
  const viaClient = (column: 'core_customer_id' | 'crm_account_item_id'): SQL | null =>
    isUuid(targetId)
      ? sql`exists (select 1 from pulse.clients pc where pc.org_id = ${orgId}::uuid and pc.id = j.client_id and pc.${sql.identifier(column)} = ${targetId}::uuid)`
      : null;
  switch (type) {
    case 'core_customer':
      return viaClient('core_customer_id');
    case 'wms_client': {
      const client = viaClient('core_customer_id');
      return client ? sql`(${viaLink('wms_client')} or ${client})` : viaLink('wms_client');
    }
    case 'crm_account': {
      const client = viaClient('crm_account_item_id');
      return client ? sql`(${viaLink('crm_account')} or ${client})` : viaLink('crm_account');
    }
    default:
      return viaLink(type);
  }
}

/**
 * The Pulse jobs tied to one sibling record: a CRM deal or account, a warehouse work order,
 * shipment order or client, a shared customer, or a project. Worst health first.
 */
export async function getJobsForRecord(
  db: BridgeExecutor,
  who: PulseReader,
  record: { readonly type: PulseRecordType; readonly id: string },
  options: { readonly limit?: number } = {},
): Promise<PulseJobsResult> {
  try {
    const gated = await gate(db, who);
    if ('available' in gated) return gated;
    const { access } = gated;
    const filter = recordFilter(who.orgId, record.type, record.id);
    const empty = { available: true as const, moneyHidden: !access.seesMoney, access, jobs: [], totals: await totalsFor(db, who.orgId, [], access.seesMoney) };
    if (!filter) return empty;
    const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
    const rows = await query<JobRow>(
      db,
      sql`${JOB_SELECT} where j.org_id = ${who.orgId}::uuid and j.deleted_at is null and ${filter} ${JOB_ORDER} limit ${limit}`,
    );
    const allIds = await query<{ id: string }>(db, sql`select j.id::text as id from pulse.jobs j where j.org_id = ${who.orgId}::uuid and j.deleted_at is null and ${filter} limit 2000`);
    return {
      available: true,
      moneyHidden: !access.seesMoney,
      access,
      jobs: rows.map((row) => toJob(row, access.seesMoney)),
      totals: await totalsFor(db, who.orgId, allIds.map((row) => row.id), access.seesMoney),
    };
  } catch {
    return NOT_INSTALLED;
  }
}

/**
 * Batched form for list columns: the worst job of each record, keyed by record id.
 * Records with no job are left out of the map.
 */
export async function getJobSummaries(
  db: BridgeExecutor,
  who: PulseReader,
  records: { readonly type: Exclude<PulseRecordType, 'core_customer' | 'crm_account' | 'wms_client'>; readonly ids: readonly string[] },
): Promise<{ available: true; moneyHidden: boolean; byRecord: Readonly<Record<string, PulseJobSummary>> } | PulseUnavailable> {
  try {
    const gated = await gate(db, who);
    if ('available' in gated) return gated;
    const { access } = gated;
    const ids = [...new Set(records.ids.map((id) => id.trim()).filter((id) => id.length > 0 && id.length <= 64))].slice(0, 500);
    if (ids.length === 0) return { available: true, moneyHidden: !access.seesMoney, byRecord: {} };
    const rows = await query<JobRow & { target_id: string }>(
      db,
      sql`select x.*, l.target_id from (${JOB_SELECT} where j.org_id = ${who.orgId}::uuid and j.deleted_at is null) x
            join pulse.job_links l on l.job_id = x.id::uuid and l.org_id = ${who.orgId}::uuid and l.target_type = ${records.type} and l.target_id in ${list(ids)}
           order by case x.risk_status when 'losing' then 0 when 'at_risk' then 1 when 'heads_up' then 2 when 'on_track' then 3 else 4 end`,
    );
    const byRecord: Record<string, PulseJobSummary> = {};
    for (const row of rows) {
      if (!(row.target_id in byRecord)) byRecord[row.target_id] = toJob(row, access.seesMoney);
    }
    return { available: true, moneyHidden: !access.seesMoney, byRecord };
  } catch {
    return NOT_INSTALLED;
  }
}

/** Losing and at risk jobs that are still running, worst first. */
export async function listJobsNeedingAttention(db: BridgeExecutor, who: PulseReader, options: { readonly limit?: number } = {}): Promise<PulseJobsResult> {
  try {
    const gated = await gate(db, who);
    if ('available' in gated) return gated;
    const { access } = gated;
    const limit = Math.min(Math.max(options.limit ?? 5, 1), 50);
    const where = sql`j.org_id = ${who.orgId}::uuid and j.deleted_at is null and j.archived_at is null and j.status = 'active' and st.risk_status in ('losing', 'at_risk')`;
    const rows = await query<JobRow>(db, sql`${JOB_SELECT} where ${where} ${JOB_ORDER} limit ${limit}`);
    const ids = await query<{ id: string }>(db, sql`select j.id::text as id from pulse.jobs j join pulse.job_stats st on st.job_id = j.id where ${where} limit 2000`);
    return {
      available: true,
      moneyHidden: !access.seesMoney,
      access,
      jobs: rows.map((row) => toJob(row, access.seesMoney)),
      totals: await totalsFor(db, who.orgId, ids.map((row) => row.id), access.seesMoney),
    };
  } catch {
    return NOT_INSTALLED;
  }
}

/** Sums `pulse.fact_days` for a filter and a date range with the kinds Pulse itself sums. */
async function periodProfit(db: BridgeExecutor, orgId: string, extra: SQL, from: string, to: string, money: boolean): Promise<PulsePeriodProfit> {
  const row = await queryOne<{ revenue: unknown; cost: unknown; profit: unknown; margin_bp: number | null; units: string | null; hours: string | null }>(
    db,
    sql`with t as (
          select coalesce(sum(f.amount_cents) filter (where f.kind in ('revenue_base', 'revenue_vas', 'revenue_other')), 0)::bigint as revenue,
                 coalesce(sum(f.amount_cents) filter (where f.kind in ('labor', 'material', 'other', 'shared')), 0)::bigint as cost,
                 coalesce(sum(f.units_good), 0)::text as units,
                 coalesce(sum(f.hours), 0)::text as hours
            from pulse.fact_days f
           where f.org_id = ${orgId}::uuid and f.work_date between ${from}::date and ${to}::date ${extra})
        select t.revenue, t.cost, (t.revenue - t.cost) as profit, t.units, t.hours,
               ${marginSql(sql`t.revenue - t.cost`, sql`t.revenue`)} as margin_bp
          from t`,
  );
  return {
    from,
    to,
    revenueCents: money ? toInt(row?.revenue ?? 0) : null,
    costCents: money ? toInt(row?.cost ?? 0) : null,
    profitCents: money ? toInt(row?.profit ?? 0) : null,
    marginBp: money ? (row?.margin_bp ?? null) : null,
    unitsGood: row?.units ?? '0',
    hours: row?.hours ?? '0',
  };
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** `days` back from today (UTC), inclusive of today. */
export function lastDays(days: number, now: Date = new Date()): { from: string; to: string } {
  const to = isoDay(now);
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1)));
  return { from: isoDay(start), to };
}

/** The current calendar month through today (UTC). */
export function thisMonth(now: Date = new Date()): { from: string; to: string } {
  return { from: isoDay(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))), to: isoDay(now) };
}

function cleanRange(range: { readonly from: string; readonly to: string } | undefined, fallback: { from: string; to: string }): { from: string; to: string } {
  if (range && ISO_DATE.test(range.from) && ISO_DATE.test(range.to) && range.from <= range.to) return { from: range.from, to: range.to };
  return fallback;
}

/**
 * Profit for one client over a date range (default: the last 30 days), found by any of its
 * three ids. Also: open jobs with their health, a count at risk, and an optional longer window
 * and month by month trend for context.
 */
export async function getClientProfit(
  db: BridgeExecutor,
  who: PulseReader,
  ref: PulseClientRef,
  options: { readonly from?: string; readonly to?: string; readonly longDays?: number; readonly trendMonths?: number; readonly jobLimit?: number } = {},
): Promise<PulseClientProfitResult> {
  try {
    const gated = await gate(db, who);
    if ('available' in gated) return gated;
    const { access } = gated;
    const money = access.seesMoney;
    const range = cleanRange(options.from && options.to ? { from: options.from, to: options.to } : undefined, lastDays(30));
    const conditions: SQL[] = [];
    if (isUuid(ref.pulseClientId)) conditions.push(sql`c.id = ${ref.pulseClientId}::uuid`);
    if (isUuid(ref.coreCustomerId)) conditions.push(sql`c.core_customer_id = ${ref.coreCustomerId}::uuid`);
    if (isUuid(ref.crmAccountItemId)) conditions.push(sql`c.crm_account_item_id = ${ref.crmAccountItemId}::uuid`);
    const zero: PulsePeriodProfit = { ...range, revenueCents: money ? 0 : null, costCents: money ? 0 : null, profitCents: money ? 0 : null, marginBp: null, unitsGood: '0', hours: '0' };
    const none = { available: true as const, moneyHidden: !money, access, client: null, period: zero, longPeriod: null, trend: [], openJobs: 0, atRisk: 0, losing: 0, jobs: [] };
    if (conditions.length === 0) return none;
    const client = await queryOne<{ id: string; name: string; target_margin_bp: number | null }>(
      db,
      sql`select c.id::text as id, c.name, c.target_margin_bp from pulse.clients c
           where c.org_id = ${who.orgId}::uuid and c.deleted_at is null and (${sql.join(conditions, sql` or `)})
           order by c.created_at limit 1`,
    );
    if (!client) return none;
    const clientFilter = sql`and f.client_id = ${client.id}::uuid`;
    const period = await periodProfit(db, who.orgId, clientFilter, range.from, range.to, money);
    const longRange = options.longDays ? lastDays(options.longDays) : null;
    const longPeriod = longRange ? await periodProfit(db, who.orgId, clientFilter, longRange.from, longRange.to, money) : null;
    let trend: PulseMonthPoint[] = [];
    if (options.trendMonths && money) {
      const months = Math.min(Math.max(options.trendMonths, 1), 24);
      const rows = await query<{ month: string; revenue: unknown; profit: unknown; margin_bp: number | null }>(
        db,
        sql`with m as (
              select generate_series(date_trunc('month', current_date) - (${months - 1} * interval '1 month'), date_trunc('month', current_date), interval '1 month')::date as month),
            t as (
              select m.month,
                     coalesce(sum(f.amount_cents) filter (where f.kind in ('revenue_base', 'revenue_vas', 'revenue_other')), 0)::bigint as revenue,
                     coalesce(sum(f.amount_cents) filter (where f.kind in ('labor', 'material', 'other', 'shared')), 0)::bigint as cost
                from m left join pulse.fact_days f
                  on f.org_id = ${who.orgId}::uuid and f.client_id = ${client.id}::uuid and date_trunc('month', f.work_date)::date = m.month
               group by m.month)
            select t.month::text as month, t.revenue, (t.revenue - t.cost) as profit, ${marginSql(sql`t.revenue - t.cost`, sql`t.revenue`)} as margin_bp
              from t order by t.month`,
      );
      trend = rows.map((row) => ({ month: row.month, revenueCents: toInt(row.revenue), profitCents: toInt(row.profit), marginBp: row.margin_bp }));
    }
    const open = sql`j.org_id = ${who.orgId}::uuid and j.client_id = ${client.id}::uuid and j.deleted_at is null and j.archived_at is null and j.status in ('active', 'on_hold', 'planned')`;
    const counts = await queryOne<{ open_jobs: unknown; at_risk: unknown; losing: unknown }>(
      db,
      sql`select count(*) as open_jobs,
                 count(*) filter (where st.risk_status = 'at_risk') as at_risk,
                 count(*) filter (where st.risk_status = 'losing') as losing
            from pulse.jobs j left join pulse.job_stats st on st.job_id = j.id where ${open}`,
    );
    const limit = Math.min(Math.max(options.jobLimit ?? 5, 0), 50);
    const jobs = limit > 0 ? await query<JobRow>(db, sql`${JOB_SELECT} where ${open} ${JOB_ORDER} limit ${limit}`) : [];
    return {
      available: true,
      moneyHidden: !money,
      access,
      client: { id: client.id, name: client.name, targetMarginBp: money ? client.target_margin_bp : null, path: `/clients/${client.id}` },
      period,
      longPeriod,
      trend,
      openJobs: toCount(counts?.open_jobs),
      atRisk: toCount(counts?.at_risk),
      losing: toCount(counts?.losing),
      jobs: jobs.map((row) => toJob(row, money)),
    };
  } catch {
    return NOT_INSTALLED;
  }
}

/** Workspace totals for a date range (default: this month so far) and the count of jobs by health. */
export async function getOrgSummary(db: BridgeExecutor, who: PulseReader, range?: { readonly from: string; readonly to: string }): Promise<PulseOrgSummaryResult> {
  try {
    const gated = await gate(db, who);
    if ('available' in gated) return gated;
    const { access } = gated;
    const clean = cleanRange(range, thisMonth());
    const counts = await queryOne<{ total: unknown; open_jobs: unknown; at_risk: unknown; losing: unknown }>(
      db,
      sql`select count(*) as total,
                 count(*) filter (where j.status in ('active', 'on_hold') and j.archived_at is null) as open_jobs,
                 count(*) filter (where j.status = 'active' and j.archived_at is null and st.risk_status = 'at_risk') as at_risk,
                 count(*) filter (where j.status = 'active' and j.archived_at is null and st.risk_status = 'losing') as losing
            from pulse.jobs j left join pulse.job_stats st on st.job_id = j.id
           where j.org_id = ${who.orgId}::uuid and j.deleted_at is null`,
    );
    const period = await periodProfit(db, who.orgId, sql``, clean.from, clean.to, access.seesMoney);
    return {
      available: true,
      moneyHidden: !access.seesMoney,
      access,
      from: clean.from,
      to: clean.to,
      totalJobs: toCount(counts?.total),
      openJobs: toCount(counts?.open_jobs),
      atRisk: toCount(counts?.at_risk),
      losing: toCount(counts?.losing),
      revenueCents: period.revenueCents,
      costCents: period.costCents,
      profitCents: period.profitCents,
      marginBp: period.marginBp,
    };
  } catch {
    return NOT_INSTALLED;
  }
}

/** Open alerts in the workspace, for a badge. Zero when Pulse is absent or the person has no role. */
export async function getAttentionCount(db: BridgeExecutor, who: PulseReader): Promise<number> {
  try {
    const gated = await gate(db, who);
    if ('available' in gated) return 0;
    const row = await queryOne<{ n: unknown }>(db, sql`select count(*) as n from pulse.alerts a where a.org_id = ${who.orgId}::uuid and a.status = 'open'`);
    return toCount(row?.n);
  } catch {
    return 0;
  }
}

/**
 * Counts with no person behind them, for server jobs that already checked the caller's rights
 * (the Portal setup guide). No money. `null` when Pulse is not installed.
 */
export async function getSetupSignals(
  db: BridgeExecutor,
  orgId: string,
): Promise<{ readonly laborRates: number; readonly jobs: number; readonly entries: number; readonly links: number } | null> {
  try {
    if (!isUuid(orgId)) return null;
    const availability = await pulseAvailability(db);
    if (!availability.installed) return null;
    const row = await queryOne<{ rates: unknown; jobs: unknown; entries: unknown; links: unknown }>(
      db,
      sql`select
            (select count(*) from pulse.labor_rates r where r.org_id = ${orgId}::uuid and r.deleted_at is null)
              + (select count(*) from pulse.settings s where s.org_id = ${orgId}::uuid and coalesce(s.default_loaded_rate_cents, 0) > 0) as rates,
            (select count(*) from pulse.jobs j where j.org_id = ${orgId}::uuid and j.deleted_at is null and j.is_sample = false) as jobs,
            (select count(*) from pulse.production_entries e where e.org_id = ${orgId}::uuid and e.deleted_at is null and e.is_sample = false) as entries,
            (select count(*) from pulse.job_links l where l.org_id = ${orgId}::uuid) as links`,
    );
    return { laborRates: toCount(row?.rates), jobs: toCount(row?.jobs), entries: toCount(row?.entries), links: toCount(row?.links) };
  } catch {
    return null;
  }
}

export { NO_ACCESS };
