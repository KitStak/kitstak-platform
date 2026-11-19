/**
 * Month close, the parts the close screen needs on top of `periods.ts` (SPEC 4.16): every month
 * with its numbers, the checklist as steps a person can act on, what a close will lock, and the
 * audit trail of who closed and reopened what, and why.
 */
import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { invalid } from '@/server/errors';
import { canPulse } from '@/lib/permissions';
import { endOfMonth, startOfMonth } from '@/lib/profit';
import { marginBp } from '@/lib/money';
import { routes } from '@/lib/routes';
import type { CompanyBridgeDTO, ProfitRowDTO } from '@/lib/types';
import { fullMonthViewWords, monthName, rows, todayInZone, type DomainContext } from './_shared';
import { requirePulse } from './access';
import { listActivity } from './activity';
import { getPeople } from './people';
import { closeFixCounts, getCloseChecklist, listPeriods } from './periods';
import { getCompanyBridge, getProfit } from './profit';
import { loadSettings } from './settings';

export interface CloseMonthDTO {
  readonly periodMonth: string;
  readonly label: string;
  readonly status: 'open' | 'closed';
  /** True when the month has not ended yet, so it cannot be closed. */
  readonly inProgress: boolean;
  /**
   * How many checklist steps say "Fix this first", for an open month that is over. Null for a closed
   * month and for a month in progress. The list and the month card read this one number, so a month
   * never says "Ready to close" beside "needs fixing".
   */
  readonly toFix: number | null;
  readonly closedAt: string | null;
  readonly closedByName: string | null;
  readonly reopenedAt: string | null;
  readonly reopenedByName: string | null;
  readonly reopenReason: string | null;
  readonly revenueCents: number | null;
  /** Job cost: labor, material, other costs and the time not on a job the jobs carried. */
  readonly costCents: number | null;
  /** Profit on jobs, before overhead and paid time not on any job. */
  readonly profitCents: number | null;
  /** Job margin. */
  readonly marginBp: number | null;
  /** What the company kept: profit on jobs after the costs no job carried (SPEC 4.9). */
  readonly companyProfitCents: number | null;
  readonly companyMarginBp: number | null;
  /**
   * For a month that is not over yet, plain words that its company numbers are a full month view:
   * all of the month's company costs against the work so far (round five, decision B). Home and
   * Profit count only the days so far. Null for a month that is over, and for a reader without money.
   */
  readonly fullMonthNote: string | null;
}

/** The walk from job profit to company profit, as the close screen shows it. Every money field is null when hidden. */
export interface CloseBridgeDTO {
  readonly jobProfitCents: number | null;
  readonly sharedGapCents: number | null;
  readonly missingCostCents: number | null;
  /** Null when no company costs were typed in: Pulse then trusts the overhead inside the hourly rates. */
  readonly overheadGapCents: number | null;
  readonly companyCostCents: number | null;
  readonly overheadAbsorbedCents: number | null;
  readonly hasCompanyCosts: boolean;
  readonly companyProfitCents: number | null;
}

type Snapshot = { readonly total?: ProfitRowDTO; readonly bridge?: CompanyBridgeDTO };

/** The saved totals of a closed month. Null for an open month, or when the reader may not see money. */
const snapshotOf = (period: { readonly status: 'open' | 'closed'; readonly snapshot: Readonly<Record<string, unknown>> | null }): Snapshot | null =>
  period.status === 'closed' && period.snapshot && typeof period.snapshot === 'object' ? (period.snapshot as Snapshot) : null;

/** Company profit as a share of revenue. Null when either is hidden or there is no revenue. */
const companyMargin = (companyProfitCents: number | null | undefined, revenueCents: number | null | undefined): number | null =>
  companyProfitCents === null || companyProfitCents === undefined || revenueCents === null || revenueCents === undefined ? null : marginBp(companyProfitCents, revenueCents);

const bridgeOut = (bridge: CompanyBridgeDTO): CloseBridgeDTO => ({
  jobProfitCents: bridge.workProfitCents,
  sharedGapCents: bridge.sharedGapCents,
  missingCostCents: bridge.missingCostCents,
  overheadGapCents: bridge.overheadGapCents,
  companyCostCents: bridge.companyCostCents,
  overheadAbsorbedCents: bridge.overheadAbsorbedCents,
  hasCompanyCosts: bridge.hasCompanyCosts,
  companyProfitCents: bridge.companyProfitCents,
});

export interface CloseBoardDTO {
  readonly months: readonly CloseMonthDTO[];
  readonly today: string;
  readonly canClose: boolean;
  readonly canReopen: boolean;
  readonly moneyHidden: boolean;
}

/** Every month with data, newest first, open or closed, with its totals. */
export const getCloseBoard = scoped(async function getCloseBoard(ctx: DomainContext): Promise<CloseBoardDTO> {
  const access = await requirePulse(ctx, 'pulse:read');
  const settings = await loadSettings(ctx.orgId);
  const today = todayInZone(settings.timezone);
  const periods = await listPeriods(ctx);
  const first = periods[periods.length - 1]?.periodMonth;
  const live = first ? await getProfit(ctx, 'month', { from: first, to: endOfMonth(periods[0]!.periodMonth) }) : null;
  const liveByMonth = new Map((live?.rows ?? []).map((row) => [row.key, row]));
  // An open month shows live company profit. A closed one shows what was saved with the close.
  const openMonths = access.seesMoney ? periods.filter((period) => !snapshotOf(period)?.bridge).map((period) => period.periodMonth) : [];
  const liveBridges = new Map(await Promise.all(openMonths.map(async (month) => [month, await getCompanyBridge(ctx, { from: month, to: endOfMonth(month) })] as const)));
  const waiting = periods.filter((period) => period.status === 'open' && endOfMonth(period.periodMonth) < today).map((period) => period.periodMonth);
  const fixes = new Map(await Promise.all(waiting.map(async (month) => [month, (await closeFixCounts(ctx, month)).toFix] as const)));
  const people = await getPeople(periods.flatMap((period) => [period.closedBy, period.reopenedBy]).filter((id): id is string => Boolean(id)));
  return {
    months: periods.map((period) => {
      const saved = snapshotOf(period);
      const numbers = saved?.total ?? liveByMonth.get(period.periodMonth) ?? null;
      const companyProfit = (saved?.bridge ?? liveBridges.get(period.periodMonth))?.companyProfitCents ?? null;
      return {
        periodMonth: period.periodMonth,
        label: `${monthName(period.periodMonth)} ${period.periodMonth.slice(0, 4)}`,
        status: period.status,
        inProgress: endOfMonth(period.periodMonth) >= today,
        toFix: fixes.get(period.periodMonth) ?? null,
        closedAt: period.status === 'closed' ? period.closedAt : null,
        closedByName: period.status === 'closed' && period.closedBy ? (people.get(period.closedBy)?.name ?? null) : null,
        reopenedAt: period.reopenedAt,
        reopenedByName: period.reopenedBy ? (people.get(period.reopenedBy)?.name ?? null) : null,
        reopenReason: period.reopenReason,
        revenueCents: access.seesMoney ? (numbers?.revenueCents ?? null) : null,
        costCents: access.seesMoney ? (numbers?.costCents ?? null) : null,
        profitCents: access.seesMoney ? (numbers?.profitCents ?? null) : null,
        marginBp: access.seesMoney ? (numbers?.marginBp ?? null) : null,
        companyProfitCents: access.seesMoney && numbers ? companyProfit : null,
        companyMarginBp: access.seesMoney ? companyMargin(companyProfit, numbers?.revenueCents) : null,
        fullMonthNote: access.seesMoney && period.status === 'open' && endOfMonth(period.periodMonth) >= today ? fullMonthViewWords(period.periodMonth, liveBridges.get(period.periodMonth)?.hasCompanyCosts ?? false) : null,
      };
    }),
    today,
    canClose: canPulse(access.role, 'period:close'),
    canReopen: canPulse(access.role, 'period:reopen'),
    moneyHidden: !access.seesMoney,
  };
});

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
  /** Job margin. */
  readonly marginBp: number | null;
  readonly companyProfitCents: number | null;
  readonly companyMarginBp: number | null;
  /** The steps from job profit to company profit. */
  readonly bridge: CloseBridgeDTO;
  /** True when these are the numbers saved at the close, not live ones. */
  readonly saved: boolean;
  readonly moneyHidden: boolean;
}

const plural = (count: number, one: string, many: string): string => `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;

/** The close checklist of one month as steps, with where to go to fix each, and what the close will lock. */
export const getCloseDetail = scoped(async function getCloseDetail(ctx: DomainContext, month: string): Promise<CloseDetailDTO> {
  const access = await requirePulse(ctx, 'pulse:read');
  if (!/^\d{4}-\d{2}(-\d{2})?$/.test(month)) throw invalid('Pick a month.');
  const start = startOfMonth(`${month.slice(0, 7)}-01`);
  const end = endOfMonth(start);
  const name = `${monthName(start)} ${start.slice(0, 4)}`;
  const [periods, checklist, profit, liveBridge, counts] = await Promise.all([
    listPeriods(ctx),
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
      href: checklist.servicesNoPrice === 0 ? null : routes.servicesNoPrice(start),
      hrefLabel: checklist.servicesNoPrice === 1 ? 'Price the entry' : 'Price the entries',
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
              ? 'Payroll paid more than the pay Pulse worked out from the hours logged on jobs and reasons. Some paid time is not logged. This check compares pay totals, so it can differ a little from the cost of paid time not on any job in the numbers above.'
              : 'The pay Pulse worked out from logged hours is more than payroll paid. Check the paid hours for the month.',
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
      href: `/settings/close?month=${start.slice(0, 7)}#company-costs`,
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
  // A closed month keeps the numbers it was closed with, the company figures included.
  const period = periods.find((item) => item.periodMonth === start);
  const saved = period ? snapshotOf(period) : null;
  const total = saved?.total ?? profit.rows.find((row) => row.key === start) ?? profit.total;
  const bridge = saved?.total && saved.bridge ? saved.bridge : liveBridge;
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
    companyMarginBp: companyMargin(bridge.companyProfitCents, total.revenueCents),
    bridge: bridgeOut(bridge),
    saved: Boolean(saved?.total),
    moneyHidden: !access.seesMoney,
  };
});

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
export const listCloseEvents = scoped(async function listCloseEvents(ctx: DomainContext, limit = 100): Promise<CloseEventDTO[]> {
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
});
