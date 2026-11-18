/**
 * Month close, the parts the close screen needs on top of `periods.ts` (SPEC 4.16): every month
 * with its numbers, the checklist as steps a person can act on, what a close will lock, and the
 * audit trail of who closed and reopened what, and why.
 */
import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { invalid } from '@/server/errors';
import { canPulse } from '@/lib/permissions';
import { endOfMonth, startOfMonth } from '@/lib/profit';
import type { ProfitRowDTO } from '@/lib/types';
import { monthName, rows, todayInZone, type DomainContext } from './_shared';
import { requirePulse } from './access';
import { listActivity } from './activity';
import { getPeople } from './people';
import { getCloseChecklist, listPeriods } from './periods';
import { getCompanyBridge, getProfit } from './profit';
import { loadSettings } from './settings';

export interface CloseMonthDTO {
  readonly periodMonth: string;
  readonly label: string;
  readonly status: 'open' | 'closed';
  /** True when the month has not ended yet, so it cannot be closed. */
  readonly inProgress: boolean;
  readonly closedAt: string | null;
  readonly closedByName: string | null;
  readonly reopenedAt: string | null;
  readonly reopenedByName: string | null;
  readonly reopenReason: string | null;
  readonly revenueCents: number | null;
  readonly costCents: number | null;
  readonly profitCents: number | null;
  readonly marginBp: number | null;
}

export interface CloseBoardDTO {
  readonly months: readonly CloseMonthDTO[];
  readonly today: string;
  readonly canClose: boolean;
  readonly canReopen: boolean;
  readonly moneyHidden: boolean;
}

/** Every month with data, newest first, open or closed, with its totals. */
export async function getCloseBoard(ctx: DomainContext): Promise<CloseBoardDTO> {
  const access = await requirePulse(ctx, 'pulse:read');
  const settings = await loadSettings(ctx.orgId);
  const today = todayInZone(settings.timezone);
  const periods = await listPeriods(ctx);
  const first = periods[periods.length - 1]?.periodMonth;
  const live = first ? await getProfit(ctx, 'month', { from: first, to: endOfMonth(periods[0]!.periodMonth) }) : null;
  const liveByMonth = new Map((live?.rows ?? []).map((row) => [row.key, row]));
  const people = await getPeople(periods.flatMap((period) => [period.closedBy, period.reopenedBy]).filter((id): id is string => Boolean(id)));
  return {
    months: periods.map((period) => {
      const snapshot = period.status === 'closed' && period.snapshot && typeof period.snapshot === 'object' ? ((period.snapshot as { total?: ProfitRowDTO }).total ?? null) : null;
      const numbers = snapshot ?? liveByMonth.get(period.periodMonth) ?? null;
      return {
        periodMonth: period.periodMonth,
        label: `${monthName(period.periodMonth)} ${period.periodMonth.slice(0, 4)}`,
        status: period.status,
        inProgress: endOfMonth(period.periodMonth) >= today,
        closedAt: period.status === 'closed' ? period.closedAt : null,
        closedByName: period.status === 'closed' && period.closedBy ? (people.get(period.closedBy)?.name ?? null) : null,
        reopenedAt: period.reopenedAt,
        reopenedByName: period.reopenedBy ? (people.get(period.reopenedBy)?.name ?? null) : null,
        reopenReason: period.reopenReason,
        revenueCents: access.seesMoney ? (numbers?.revenueCents ?? null) : null,
        costCents: access.seesMoney ? (numbers?.costCents ?? null) : null,
        profitCents: access.seesMoney ? (numbers?.profitCents ?? null) : null,
        marginBp: access.seesMoney ? (numbers?.marginBp ?? null) : null,
      };
    }),
    today,
    canClose: canPulse(access.role, 'period:close'),
    canReopen: canPulse(access.role, 'period:reopen'),
    moneyHidden: !access.seesMoney,
  };
}

export interface CloseItemDTO {
  readonly key: 'rates' | 'hours' | 'prices' | 'reviews' | 'payroll' | 'company_costs';
  readonly title: string;
  readonly detail: string;
  /** `ok`: nothing to do. `fix`: should be fixed before closing. `check`: worth a look, does not block. */
  readonly state: 'ok' | 'fix' | 'check';
  readonly count: number;
  readonly href: string | null;
  readonly hrefLabel: string | null;
  /** Money behind the step, in cents (the payroll gap, the company costs). Null when hidden or not money. */
  readonly amountCents: number | null;
}

export interface CloseDetailDTO {
  readonly periodMonth: string;
  readonly label: string;
  readonly items: readonly CloseItemDTO[];
  /** True when no step is in the `fix` state. */
  readonly ready: boolean;
  readonly toFix: number;
  /** How many rows a close locks, per kind of entry. */
  readonly locks: readonly { readonly label: string; readonly count: number }[];
  readonly totalRows: number;
  readonly revenueCents: number | null;
  readonly costCents: number | null;
  readonly profitCents: number | null;
  readonly marginBp: number | null;
  readonly companyProfitCents: number | null;
  readonly moneyHidden: boolean;
}

const plural = (count: number, one: string, many: string): string => `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;

/** The close checklist of one month as steps, with where to go to fix each, and what the close will lock. */
export async function getCloseDetail(ctx: DomainContext, month: string): Promise<CloseDetailDTO> {
  const access = await requirePulse(ctx, 'pulse:read');
  if (!/^\d{4}-\d{2}(-\d{2})?$/.test(month)) throw invalid('Pick a month.');
  const start = startOfMonth(`${month.slice(0, 7)}-01`);
  const end = endOfMonth(start);
  const name = `${monthName(start)} ${start.slice(0, 4)}`;
  const [checklist, profit, bridge, counts] = await Promise.all([
    getCloseChecklist(ctx, start),
    getProfit(ctx, 'month', { from: start, to: end }),
    getCompanyBridge(ctx, { from: start, to: end }),
    rows<{ production: number; indirect: number; paid: number; usage: number; costs: number; revenue: number; services: number; company_costs: number; company_cents: string }>(
      db,
      sql`SELECT
            (SELECT count(*) FROM pulse.production_entries WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL AND work_date BETWEEN ${start}::date AND ${end}::date)::int AS production,
            (SELECT count(*) FROM pulse.indirect_entries WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL AND work_date BETWEEN ${start}::date AND ${end}::date)::int AS indirect,
            (SELECT count(*) FROM pulse.paid_hours WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL AND work_date BETWEEN ${start}::date AND ${end}::date)::int AS paid,
            (SELECT count(*) FROM pulse.material_usage WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL AND usage_date BETWEEN ${start}::date AND ${end}::date)::int AS usage,
            (SELECT count(*) FROM pulse.cost_entries WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL AND cost_date BETWEEN ${start}::date AND ${end}::date)::int AS costs,
            (SELECT count(*) FROM pulse.revenue_entries WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL AND revenue_date BETWEEN ${start}::date AND ${end}::date)::int AS revenue,
            (SELECT count(*) FROM pulse.vas_entries WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL AND work_date BETWEEN ${start}::date AND ${end}::date)::int AS services,
            (SELECT count(*) FROM pulse.cost_entries WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL AND scope = 'company' AND cost_date BETWEEN ${start}::date AND ${end}::date)::int AS company_costs,
            (SELECT COALESCE(sum(amount_cents), 0) FROM pulse.cost_entries WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL AND scope = 'company' AND cost_date BETWEEN ${start}::date AND ${end}::date)::text AS company_cents`,
    ),
  ]);
  const count = counts[0] ?? { production: 0, indirect: 0, paid: 0, usage: 0, costs: 0, revenue: 0, services: 0, company_costs: 0, company_cents: '0' };
  const gap = checklist.payrollGapCents;
  const gapBig = gap !== null && Math.abs(gap) >= 10_000;
  const items: CloseItemDTO[] = [
    {
      key: 'rates',
      title: 'Every hour has a labor rate',
      detail: checklist.entriesNeedingRate === 0 ? 'All logged hours have a real cost of an hour.' : `${plural(checklist.entriesNeedingRate, 'entry has', 'entries have')} hours with no labor rate, so their labor cost is missing.`,
      state: checklist.entriesNeedingRate === 0 ? 'ok' : 'fix',
      count: checklist.entriesNeedingRate,
      href: checklist.entriesNeedingRate === 0 ? null : '/labor?tab=rates',
      hrefLabel: 'Set labor rates',
      amountCents: null,
    },
    {
      key: 'hours',
      title: 'Every day with units has hours',
      detail: checklist.daysWithUnitsNoHours === 0 ? 'No day has units without hours.' : `${plural(checklist.daysWithUnitsNoHours, 'job day has', 'job days have')} units logged and no hours, so those jobs look cheaper than they were.`,
      state: checklist.daysWithUnitsNoHours === 0 ? 'ok' : 'fix',
      count: checklist.daysWithUnitsNoHours,
      href: checklist.daysWithUnitsNoHours === 0 ? null : '/log/entries',
      hrefLabel: 'Open the entries',
      amountCents: null,
    },
    {
      key: 'prices',
      title: 'Every extra service has a price',
      detail: checklist.servicesNoPrice === 0 ? 'Every extra service entry has a price.' : `${plural(checklist.servicesNoPrice, 'extra service entry has', 'extra service entries have')} no price, so that work earned nothing on paper.`,
      state: checklist.servicesNoPrice === 0 ? 'ok' : 'fix',
      count: checklist.servicesNoPrice,
      href: checklist.servicesNoPrice === 0 ? null : '/services',
      hrefLabel: 'Open extra services',
      amountCents: null,
    },
    {
      key: 'reviews',
      title: 'Days are reviewed',
      detail: checklist.daysNotReviewed === 0 ? 'A manager approved every logged day.' : `${plural(checklist.daysNotReviewed, 'logged day was', 'logged days were')} not approved by a manager. You can still close.`,
      state: checklist.daysNotReviewed === 0 ? 'ok' : 'check',
      count: checklist.daysNotReviewed,
      href: checklist.daysNotReviewed === 0 ? null : '/log/review',
      hrefLabel: 'Review days',
      amountCents: null,
    },
    {
      key: 'payroll',
      title: 'Payroll check',
      detail:
        gap === null
          ? 'Compares the pay Pulse worked out from logged hours with the pay you typed for paid hours.'
          : !gapBig
            ? 'Pay worked out from logged hours matches the pay for paid hours.'
            : gap > 0
              ? 'Paid hours cost more than the hours logged on jobs and reasons. Some paid time is not logged.'
              : 'Logged hours cost more than the paid hours you typed. Check the paid hours for the month.',
      state: gap === null || !gapBig ? 'ok' : 'check',
      count: gapBig ? 1 : 0,
      href: gapBig ? '/labor?tab=time' : null,
      hrefLabel: 'Open paid time',
      amountCents: gap,
    },
    {
      key: 'company_costs',
      title: 'Company costs are in',
      detail: count.company_costs === 0 ? `No rent, utilities or other company costs are typed for ${name}. Without them the company profit trusts your overhead per hour.` : `${plural(count.company_costs, 'company cost is', 'company costs are')} in for ${name}.`,
      state: count.company_costs === 0 ? 'check' : 'ok',
      count: count.company_costs,
      href: `/costs?scope=company&month=${start.slice(0, 7)}`,
      hrefLabel: count.company_costs === 0 ? 'Add company costs' : 'Open company costs',
      amountCents: access.seesMoney ? Number(count.company_cents) : null,
    },
  ];
  const toFix = items.filter((item) => item.state === 'fix').length;
  const locks = [
    { label: 'Work log entries', count: count.production },
    { label: 'Time not on a job', count: count.indirect },
    { label: 'Paid hours', count: count.paid },
    { label: 'Material usage', count: count.usage },
    { label: 'Other costs', count: count.costs },
    { label: 'Invoices and fees', count: count.revenue },
    { label: 'Extra service entries', count: count.services },
  ];
  const total = profit.rows.find((row) => row.key === start) ?? profit.total;
  return {
    periodMonth: start,
    label: name,
    items,
    ready: toFix === 0,
    toFix,
    locks,
    totalRows: locks.reduce((sum, item) => sum + item.count, 0),
    revenueCents: total.revenueCents,
    costCents: total.costCents,
    profitCents: total.profitCents,
    marginBp: total.marginBp,
    companyProfitCents: bridge.companyProfitCents,
    moneyHidden: !access.seesMoney,
  };
}

export interface CloseEventDTO {
  readonly id: string;
  readonly at: string;
  readonly actorName: string | null;
  readonly action: 'closed' | 'reopened';
  readonly periodMonth: string | null;
  readonly monthLabel: string;
  readonly reason: string | null;
}

/** Who closed and reopened which month, newest first. The log cannot be edited. */
export async function listCloseEvents(ctx: DomainContext, limit = 100): Promise<CloseEventDTO[]> {
  const page = await listActivity(ctx, { entityType: 'period', limit: Math.min(Math.max(limit, 1), 200) });
  return page.items
    .filter((item) => item.verb === 'period.closed' || item.verb === 'period.reopened')
    .map((item) => {
      const month = typeof item.meta.periodMonth === 'string' ? item.meta.periodMonth : null;
      const after = (item.after && typeof item.after === 'object' ? item.after : {}) as { reopenReason?: unknown };
      return {
        id: item.id,
        at: item.createdAt,
        actorName: item.actor?.name ?? null,
        action: item.verb === 'period.closed' ? ('closed' as const) : ('reopened' as const),
        periodMonth: month,
        monthLabel: month ? `${monthName(month)} ${month.slice(0, 4)}` : 'A month',
        reason: typeof after.reopenReason === 'string' ? after.reopenReason : null,
      };
    });
}
