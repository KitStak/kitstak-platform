/**
 * "How we got this" (SPEC 4.15): the formula in words, the same formula with the real figures,
 * a link to the rows behind it, and a data quality line whenever the number is partial.
 *
 * Every figure comes from the same rollups the screens read (`getProfit`, `getCompanyBridge`),
 * so an explanation can never disagree with the number it explains. The answer carries numbers
 * and units, never money inside a sentence: the reader's screen formats them, and a reader
 * without `money:read` gets the words with every money figure blank.
 */
import 'server-only';
import { sql, type SQL } from 'drizzle-orm';
import { db } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { invalid, notFound } from '@/server/errors';
import { EXPLAIN_METRICS, type ExplainMetric } from '@/lib/constants';
import { perHourCents, subCents } from '@/lib/money';
import { profitSummary } from '@/lib/profit';
import { rangeLabel } from '@/lib/reports';
import { routes } from '@/lib/routes';
import type { ExplainDTO, ExplainLineDTO, ProfitFilters, ProfitRowDTO } from '@/lib/types';
import { centsOut, isUuid, rows, type DomainContext } from './_shared';
import { requirePulse } from './access';
import { getCompanyBridge, getProfit } from './profit';
import { loadSettings } from './settings';

type Line = ExplainLineDTO;
const line = (label: string, value: number | null, unit: Line['unit'], op: Line['op'], text?: string): Line => ({ label, value, unit, op, ...(text ? { text } : {}) });

const TITLES: Readonly<Record<ExplainMetric, string>> = {
  revenue: 'Revenue',
  labor: 'Labor cost',
  material: 'Material cost',
  other: 'Other costs',
  shared: 'Time not on a job',
  cost: 'Cost',
  profit: 'Profit',
  margin: 'Job margin',
  margin_before_shared: 'Job margin before time not on a job',
  labor_pct: 'Labor as % of revenue',
  uph: 'Units per person per hour',
  cost_per_unit: 'Cost per unit',
  units: 'Units',
  hours: 'Labor hours',
  company_profit: 'Company profit',
  not_billed: 'Not billed yet',
};

const FORMULAS: Readonly<Record<ExplainMetric, string>> = {
  revenue: 'Revenue is what the work earned: units done at the job price, plus extra services, plus other fees and credits. It counts work done, not invoices sent.',
  labor: 'Labor cost is every labor hour logged, times the real cost of an hour for the people who did it.',
  material: 'Material cost is the parts you paid for: cost per unit times units on jobs counted that way, or the parts used on jobs that track usage. Scrap is inside it.',
  other: 'Other costs are the costs typed in against a job or a client, like freight, supplies or outside work.',
  shared: 'Time not on a job is paid time for meetings, cleanup and waiting. Pulse spreads it over the jobs that ran in the same period.',
  cost: 'Cost is labor, plus material, plus other costs, plus the time not on a job these jobs carry.',
  profit: 'Profit is revenue less cost.',
  margin: 'Job margin is profit on jobs as a share of revenue. Overhead and paid time on no job are not in it. The company margin takes those out too.',
  margin_before_shared: 'This is the job margin with time not on a job left out. It shows what the work itself made.',
  labor_pct: 'Labor as % of revenue is labor cost as a share of revenue. Lower is better.',
  uph: 'Units per person per hour is good units over all labor hours.',
  cost_per_unit: 'Cost per unit is all cost over good units.',
  units: 'Units are the good units logged on the work log. Scrap is left out.',
  hours: 'Labor hours are people times hours each, added up over every entry.',
  company_profit: 'Company profit starts from profit on jobs and takes away the costs no job carried.',
  not_billed: 'Not billed yet is work you earned that is not on an invoice yet.',
};

export type ExplainScope = ProfitFilters;

function scopeWhere(orgId: string, filters: ProfitFilters, alias: string, dateColumn: string): SQL {
  const a = sql.raw(alias);
  const parts: SQL[] = [sql`${a}.org_id = ${orgId}`, sql`${a}.deleted_at IS NULL`, sql`${a}.${sql.raw(dateColumn)} BETWEEN ${filters.from}::date AND ${filters.to}::date`];
  if (filters.siteId) parts.push(sql`${a}.site_id = ${filters.siteId}`);
  if (filters.jobId) parts.push(sql`${a}.job_id = ${filters.jobId}`);
  if (filters.clientId) parts.push(sql`j.client_id = ${filters.clientId}`);
  if (filters.jobTypeId) parts.push(sql`j.job_type_id = ${filters.jobTypeId}`);
  if (filters.status) parts.push(sql`j.status = ${filters.status}`);
  return sql.join(parts, sql` AND `);
}

/** Where the number comes from, in a few words: the job, client, type, service or site, then the days. */
async function scopeWords(ctx: DomainContext, filters: ProfitFilters): Promise<string> {
  const [found] = await rows<{ job: string | null; client: string | null; type: string | null; service: string | null; site: string | null }>(
    db,
    sql`SELECT (SELECT number || ' ' || name FROM pulse.jobs WHERE org_id = ${ctx.orgId} AND id = ${filters.jobId ?? null}::uuid) AS job,
               (SELECT name FROM pulse.clients WHERE org_id = ${ctx.orgId} AND id = ${filters.clientId ?? null}::uuid) AS client,
               (SELECT name FROM pulse.job_types WHERE org_id = ${ctx.orgId} AND id = ${filters.jobTypeId ?? null}::uuid) AS type,
               (SELECT name FROM pulse.vas_services WHERE org_id = ${ctx.orgId} AND id = ${filters.vasServiceId ?? null}::uuid) AS service,
               (SELECT name FROM pulse.sites WHERE org_id = ${ctx.orgId} AND id = ${filters.siteId ?? null}::uuid) AS site`,
  );
  const who = [found?.job, found?.job ? null : found?.client, found?.type, found?.service, found?.site].filter(Boolean) as string[];
  const range = rangeLabel(filters);
  return `${who.length > 0 ? who.join(', ') : 'All jobs'}, ${range}`;
}

/** Data quality lines for the jobs behind a number. A number with no line is complete. */
async function qualityLines(ctx: DomainContext, filters: ProfitFilters): Promise<string[]> {
  const scope: SQL[] = [];
  if (filters.siteId) scope.push(sql`AND f.site_id = ${filters.siteId}`);
  if (filters.clientId) scope.push(sql`AND f.client_id = ${filters.clientId}`);
  if (filters.jobTypeId) scope.push(sql`AND f.job_type_id = ${filters.jobTypeId}`);
  if (filters.jobId) scope.push(sql`AND f.job_id = ${filters.jobId}`);
  if (filters.vasServiceId) scope.push(sql`AND f.vas_service_id = ${filters.vasServiceId}`);
  const [needs] = await rows<{ no_rate: number; no_hours: number; no_price: number; service_no_price: number; early: number }>(
    db,
    sql`WITH scoped AS (SELECT DISTINCT f.job_id FROM pulse.fact_days f WHERE f.org_id = ${ctx.orgId} AND f.job_id IS NOT NULL AND f.work_date BETWEEN ${filters.from}::date AND ${filters.to}::date ${sql.join(scope, sql` `)})
        SELECT COALESCE(sum((st.needs ->> 'needsRate')::int), 0)::int AS no_rate,
               COALESCE(sum((st.needs ->> 'daysMissingHours')::int), 0)::int AS no_hours,
               count(*) FILTER (WHERE (st.needs ->> 'noPrice')::boolean)::int AS no_price,
               COALESCE(sum((st.needs ->> 'serviceNoPrice')::int), 0)::int AS service_no_price,
               count(*) FILTER (WHERE st.confidence = 'early')::int AS early
          FROM scoped JOIN pulse.job_stats st ON st.job_id = scoped.job_id`,
  );
  const [fallback] = await rows<{ n: number }>(
    db,
    sql`SELECT count(*)::int AS n FROM pulse.production_entries p JOIN pulse.jobs j ON j.id = p.job_id
         WHERE ${scopeWhere(ctx.orgId, filters, 'p', 'work_date')} AND p.labor_class_id IS NULL AND p.hours > 0`,
  );
  const out: string[] = [];
  const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;
  if ((needs?.no_hours ?? 0) > 0) out.push(`${plural(needs!.no_hours, 'day has', 'days have')} units and no hours, so labor cost is too low.`);
  if ((needs?.no_rate ?? 0) > 0) out.push(`${plural(needs!.no_rate, 'entry has', 'entries have')} no labor rate, so those hours cost nothing here.`);
  if ((needs?.no_price ?? 0) > 0) out.push(`${plural(needs!.no_price, 'job has', 'jobs have')} no price, so revenue is too low.`);
  if ((needs?.service_no_price ?? 0) > 0) out.push(`${plural(needs!.service_no_price, 'extra service entry has', 'extra service entries have')} no price.`);
  if ((fallback?.n ?? 0) > 0) out.push(`${plural(fallback!.n, 'entry uses', 'entries use')} the default rate because no labor class was picked.`);
  return out;
}

/** The entries behind a number: how many, and how labor splits into pay and overhead. */
async function laborDetail(ctx: DomainContext, filters: ProfitFilters): Promise<{ entries: number; gross: bigint; overhead: bigint }> {
  if (filters.vasServiceId) {
    const [row] = await rows<{ n: number; gross: string; overhead: string }>(db, sql`SELECT count(*)::int AS n, COALESCE(sum(v.gross_pay_cents), 0)::text AS gross, COALESCE(sum(v.overhead_cents), 0)::text AS overhead FROM pulse.vas_entries v LEFT JOIN pulse.jobs j ON j.id = v.job_id WHERE ${scopeWhere(ctx.orgId, filters, 'v', 'work_date')} AND v.vas_service_id = ${filters.vasServiceId}`);
    return { entries: row?.n ?? 0, gross: BigInt(row?.gross ?? 0), overhead: BigInt(row?.overhead ?? 0) };
  }
  const clientOnVas = filters.clientId ? sql`AND v.client_id = ${filters.clientId}` : sql``;
  const vasFilters = { ...filters, clientId: null };
  const [row] = await rows<{ n: number; gross: string; overhead: string }>(
    db,
    sql`SELECT (a.n + b.n)::int AS n, (a.gross + b.gross)::text AS gross, (a.overhead + b.overhead)::text AS overhead FROM
          (SELECT count(*) AS n, COALESCE(sum(p.gross_pay_cents), 0) AS gross, COALESCE(sum(p.overhead_cents), 0) AS overhead FROM pulse.production_entries p JOIN pulse.jobs j ON j.id = p.job_id WHERE ${scopeWhere(ctx.orgId, filters, 'p', 'work_date')}) a,
          (SELECT count(*) AS n, COALESCE(sum(v.gross_pay_cents), 0) AS gross, COALESCE(sum(v.overhead_cents), 0) AS overhead FROM pulse.vas_entries v LEFT JOIN pulse.jobs j ON j.id = v.job_id WHERE ${scopeWhere(ctx.orgId, vasFilters, 'v', 'work_date')} ${clientOnVas}) b`,
  );
  return { entries: row?.n ?? 0, gross: BigInt(row?.gross ?? 0), overhead: BigInt(row?.overhead ?? 0) };
}

const SHARED_RULE_WORDS: Readonly<Record<string, string>> = {
  by_labor_hours: 'Each job takes a share in step with its labor hours.',
  full: 'Each job takes a share in step with its labor hours, and paid time nobody logged is spread too.',
  percent_of_labor: 'Each job is charged a set percent of its labor cost.',
  none: 'Your workspace does not spread it over jobs, so it only shows in company profit.',
};

function entriesHref(filters: ProfitFilters, kinds?: string): string {
  const query = new URLSearchParams();
  query.set('by', filters.jobId ? 'day' : 'job');
  query.set('range', 'custom');
  query.set('from', filters.from);
  query.set('to', filters.to);
  if (filters.siteId) query.set('site', filters.siteId);
  if (filters.clientId) query.set('client', filters.clientId);
  if (filters.jobTypeId) query.set('jobType', filters.jobTypeId);
  if (filters.jobId) query.set('job', filters.jobId);
  if (filters.vasServiceId) query.set('service', filters.vasServiceId);
  query.set('entries', kinds ?? 'all');
  return `${routes.profit()}?${query.toString()}`;
}

function moneyLines(metric: ExplainMetric, total: ProfitRowDTO): Line[] {
  const t = total;
  const units = Number(t.unitsGood);
  const hours = Number(t.hours);
  switch (metric) {
    case 'revenue':
      return [line('Units done at the job price', t.baseRevenueCents, 'money', 'start'), line('Extra services', t.vasRevenueCents, 'money', 'plus'), line('Other fees and credits', t.otherRevenueCents, 'money', 'plus'), line('Revenue', t.revenueCents, 'money', 'total')];
    case 'cost':
      return [line('Labor', t.laborCents, 'money', 'start'), line('Material', t.materialCents, 'money', 'plus'), line('Other costs', t.otherCents, 'money', 'plus'), line('Time not on a job', t.sharedCents, 'money', 'plus'), line('Cost', t.costCents, 'money', 'total')];
    case 'profit':
      return [line('Revenue', t.revenueCents, 'money', 'start'), line('Labor', t.laborCents, 'money', 'minus'), line('Material', t.materialCents, 'money', 'minus'), line('Other costs', t.otherCents, 'money', 'minus'), line('Time not on a job', t.sharedCents, 'money', 'minus'), line('Profit', t.profitCents, 'money', 'total')];
    case 'margin':
      return [line('Profit', t.profitCents, 'money', 'start'), line('Revenue', t.revenueCents, 'money', 'divide'), line('Job margin', t.marginBp, 'percent', 'total'), line('Before time not on a job', t.marginBeforeSharedBp, 'percent', 'note')];
    case 'margin_before_shared': {
      // The same pure summary the profit rows use, so "before shared costs" is one rule everywhere.
      const before = t.revenueCents === null ? null : centsOut(profitSummary({ revenueCents: BigInt(t.revenueCents), laborCents: BigInt(t.laborCents ?? 0), materialCents: BigInt(t.materialCents ?? 0), otherCents: BigInt(t.otherCents ?? 0), sharedCents: BigInt(t.sharedCents ?? 0) }).profitBeforeSharedCents);
      return [line('Revenue', t.revenueCents, 'money', 'start'), line('Labor', t.laborCents, 'money', 'minus'), line('Material', t.materialCents, 'money', 'minus'), line('Other costs', t.otherCents, 'money', 'minus'), line('Profit before time not on a job', before, 'money', 'total'), line('Revenue', t.revenueCents, 'money', 'divide'), line('Job margin before time not on a job', t.marginBeforeSharedBp, 'percent', 'total')];
    }
    case 'labor_pct':
      return [line('Labor', t.laborCents, 'money', 'start'), line('Revenue', t.revenueCents, 'money', 'divide'), line('Labor as % of revenue', t.laborPctBp, 'percent', 'total')];
    case 'cost_per_unit':
      return [line('Cost', t.costCents, 'money', 'start'), line('Good units', units, 'number', 'divide'), line('Cost per unit', t.costPerUnitCents, 'money', 'total')];
    case 'uph':
      return [line('Good units', units, 'number', 'start'), line('Labor hours', hours, 'hours', 'divide'), line('Units per person per hour', t.uph === null ? null : Number(t.uph), 'pace', 'total')];
    case 'units':
      return [line('Good units', units, 'number', 'total'), line('Scrapped units, left out', Number(t.unitsScrap), 'number', 'note')];
    case 'hours':
      return [line('Labor hours', hours, 'hours', 'total')];
    case 'material':
      return [line('Material cost', t.materialCents, 'money', 'total')];
    case 'other':
      return [line('Other costs', t.otherCents, 'money', 'total')];
    case 'not_billed':
      return [line('Earned', t.revenueCents, 'money', 'start'), line('Billed', t.billedCents, 'money', 'minus'), line('Not billed yet', t.revenueCents === null || t.billedCents === null ? null : centsOut(subCents(t.revenueCents, t.billedCents)), 'money', 'total')];
    default:
      return [];
  }
}

/**
 * Explains one number for a scope (a job, a client, a job type, a service, a site, or everything)
 * and a date range. `metric` is one of `EXPLAIN_METRICS`.
 */
export const explain = scoped(async function explain(ctx: DomainContext, metric: string, scope: ExplainScope): Promise<ExplainDTO> {
  const access = await requirePulse(ctx, 'pulse:read');
  if (!(EXPLAIN_METRICS as readonly string[]).includes(metric)) throw invalid('Pick a number to explain: revenue, cost, profit, margin, labor, units or hours.');
  for (const id of [scope.siteId, scope.clientId, scope.jobTypeId, scope.jobId, scope.vasServiceId]) if (id && !isUuid(id)) throw invalid('One of the filters is not valid.');
  // A job that is not in this workspace (or was deleted) is "not found", like every job route,
  // never a silent answer for the whole workspace.
  if (scope.jobId) {
    const [job] = await rows<{ id: string }>(db, sql`SELECT id FROM pulse.jobs WHERE org_id = ${ctx.orgId} AND id = ${scope.jobId}::uuid AND deleted_at IS NULL`);
    if (!job) throw notFound('That job');
  }
  const key = metric as ExplainMetric;
  const money = access.seesMoney;
  const filters: ProfitFilters = { from: scope.from, to: scope.to, siteId: scope.siteId ?? null, clientId: scope.clientId ?? null, jobTypeId: scope.jobTypeId ?? null, jobId: scope.jobId ?? null, vasServiceId: scope.vasServiceId ?? null, status: scope.status ?? null };
  const [profit, words, quality, settings] = await Promise.all([getProfit(ctx, 'month', filters), scopeWords(ctx, filters), qualityLines(ctx, filters), loadSettings(ctx.orgId)]);
  const total = profit.total;
  let lines: Line[] = moneyLines(key, total);
  const links: { label: string; href: string }[] = [];
  let formula = FORMULAS[key];

  if (key === 'labor') {
    const detail = await laborDetail(ctx, filters);
    const hours = Number(total.hours);
    const average = total.laborCents === null ? null : centsOut(perHourCents(total.laborCents, total.hours));
    lines = [line('Labor hours', hours, 'hours', 'start'), line('Average real cost of an hour', average, 'money_per_hour', 'times'), line('Labor cost', total.laborCents, 'money', 'total')];
    // Only readers with wage rights see how the hour splits into pay and overhead.
    if (access.seesWages && money && total.laborCents !== null) {
      const burden = subCents(subCents(total.laborCents, detail.gross), detail.overhead);
      lines.push(line('Of that, wages', centsOut(detail.gross), 'money', 'note'));
      if (burden >= BigInt(0)) lines.push(line('Of that, taxes and benefits', centsOut(burden), 'money', 'note'));
      lines.push(line('Of that, overhead in the hourly rate', centsOut(detail.overhead), 'money', 'note'));
    }
    links.push({ label: `See ${detail.entries} ${detail.entries === 1 ? 'entry' : 'entries'}`, href: entriesHref(filters, 'labor') });
  } else if (key === 'shared') {
    lines = [line('Time not on a job carried by these jobs', total.sharedCents, 'money', 'total')];
    formula = `${FORMULAS.shared} ${SHARED_RULE_WORDS[settings.sharedCostRule] ?? ''}`.trim();
    links.push({ label: 'See the time not on a job', href: routes.labor('time') });
  } else if (key === 'company_profit') {
    const bridge = await getCompanyBridge(ctx, { from: filters.from, to: filters.to, siteId: filters.siteId ?? null });
    // A step below zero adds to profit. It reads "plus" with the amount above zero, never "less" with a minus sign.
    const step = (takes: string, adds: string, cents: number | null): Line => (cents !== null && cents < 0 ? line(adds, -cents, 'money', 'plus') : line(takes, cents, 'money', 'minus'));
    lines = [
      line('Profit on jobs', bridge.workProfitCents, 'money', 'start'),
      step('Time not on a job that no job carried', 'Jobs carried more time not on a job than was logged', bridge.sharedGapCents),
      step('Paid time not on any job', 'Paid time not on any job', bridge.missingCostCents),
      ...(bridge.hasCompanyCosts
        ? [
            step('Overhead your hourly rate did not cover', 'Your hourly rate covered more overhead than you spent', bridge.overheadGapCents),
            line(bridge.companyCostPartial ? 'Company costs counted for these days' : 'Company costs you typed in', bridge.companyCostCents, 'money', 'note'),
            line(bridge.companyCostPartial ? 'Overhead your hourly rates covered on those days' : 'Overhead your hourly rates already covered', bridge.overheadAbsorbedCents, 'money', 'note'),
          ]
        : []),
      line('Company profit', bridge.companyProfitCents, 'money', 'total'),
    ];
    if (!bridge.hasCompanyCosts) formula = `${FORMULAS.company_profit} No company costs were typed in for these days, so Pulse trusts the overhead inside your hourly rates.`;
    else if ((bridge.overheadGapCents ?? 0) < 0) formula = `${FORMULAS.company_profit} Your hourly rate covered more overhead than you spent, which adds to profit.`;
    // Company costs are monthly. A part month counts its share by day, and the popover says so.
    if (bridge.hasCompanyCosts && bridge.companyCostPartial) formula = `${formula} Company costs are monthly, so part of a month counts its share by day.`;
    if (bridge.companyCostNote) quality.push(bridge.companyCostNote);
    if (bridge.overLoggedDays > 0) quality.push(`${bridge.overLoggedDays} ${bridge.overLoggedDays === 1 ? 'day has' : 'days have'} more hours logged than paid.`);
    links.push({ label: 'See where paid time went', href: routes.labor('time') });
  } else if (key === 'material' || key === 'other' || key === 'revenue') {
    links.push({ label: 'See the entries', href: entriesHref(filters, key === 'revenue' ? 'revenue' : key) });
  } else {
    links.push({ label: 'See the entries', href: entriesHref(filters) });
  }

  // An extra service with revenue and no cost of any kind: the margin is not known, so it never reads 100%.
  if (money && total.costMissing) {
    lines = lines.map((item) => (item.unit === 'percent' && item.value === null ? { ...item, unit: 'text' as const, text: 'No cost yet' } : item));
    quality.push('No labor hours or parts are logged for this work, so Pulse does not know what it cost. The margin shows once a cost is logged.');
  }
  if (!money) lines = lines.map((item) => (item.unit === 'money' || item.unit === 'money_per_hour' || item.unit === 'money_per_unit' || item.unit === 'percent' ? { ...item, value: null } : item));
  // Pace, units and hours do not depend on prices, so a missing price is not their problem.
  const neutral = key === 'units' || key === 'hours' || key === 'uph';
  const shownQuality = neutral ? quality.filter((text) => !text.includes('price') && !text.includes('rate')) : quality;
  if (total.laborMissing && !neutral && !shownQuality.some((text) => text.includes('hours') || text.includes('rate'))) shownQuality.push('Some labor is missing on these jobs, so profit is not complete yet.');
  return {
    metric: key,
    title: TITLES[key],
    scope: words,
    formula,
    lines,
    quality: shownQuality,
    links: money || neutral ? links : [],
    from: filters.from,
    to: filters.to,
    moneyHidden: !money && lines.some((item) => item.value === null),
  };
});

/** Money and unit safe label for a metric (tooltips, search). */
export function explainTitle(metric: ExplainMetric): string {
  return TITLES[metric];
}
