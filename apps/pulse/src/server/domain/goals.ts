/**
 * The goals board (SPEC section 6, `/goals`): every goal next to what really happened, with the
 * pace to the goal for money goals and a six month trend.
 *
 * Actuals come from the same rollups as the Profit page (`getProfit`, `getCompanyBridge`), so a
 * goal can never show a different margin than Profit does. The reading (on pace, close, behind)
 * comes from the pure `readGoal`.
 */
import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { GOAL_METRICS, goalToNatural, readGoal, type GoalStatus } from '@/features/goals/goal-math';
import type { TargetMetric, TargetScope } from '@/lib/constants';
import { canPulse } from '@/lib/permissions';
import { addDays, addMonths, endOfMonth, isWorkDay, startOfMonth, workDaysBetween } from '@/lib/profit';
import type { ProfitRowDTO } from '@/lib/types';
import { invalid } from '@/server/errors';
import { rows, todayInZone, type DomainContext } from './_shared';
import { requirePulse } from './access';
import { getCompanyBridge, getProfit } from './profit';
import { loadSettings } from './settings';
import { listTargets } from './standards';

export interface GoalRowDTO {
  readonly id: string;
  readonly scope: TargetScope;
  readonly scopeId: string | null;
  readonly scopeLabel: string;
  readonly metric: TargetMetric;
  /** True when the goal is the "every month" one, false when it was set for this month only. */
  readonly everyMonth: boolean;
  readonly version: number;
  /** The goal as typed ("28", "95000"), or null when the reader may not see it. */
  readonly value: string | null;
  /** Natural units: cents, basis points or thousandths of a unit per person per hour. */
  readonly goal: number | null;
  readonly actual: number | null;
  readonly expected: number | null;
  readonly projected: number | null;
  readonly gap: number | null;
  readonly progressBp: number | null;
  readonly status: GoalStatus;
  /** The same measure for the six months that end with this one, oldest first. */
  readonly trend: readonly (number | null)[];
  readonly hidden: boolean;
}

export interface GoalsBoardDTO {
  readonly month: string;
  readonly trendMonths: readonly string[];
  readonly today: string;
  readonly isCurrentMonth: boolean;
  readonly isFuture: boolean;
  readonly elapsedWorkDays: number;
  readonly totalWorkDays: number;
  readonly rows: readonly GoalRowDTO[];
  readonly options: {
    readonly sites: readonly { readonly id: string; readonly name: string }[];
    readonly clients: readonly { readonly id: string; readonly name: string }[];
    readonly jobTypes: readonly { readonly id: string; readonly name: string }[];
    readonly services: readonly { readonly id: string; readonly name: string }[];
  };
  readonly canManage: boolean;
  readonly moneyHidden: boolean;
}

function measure(metric: TargetMetric, row: ProfitRowDTO | undefined): number | null {
  if (!row) return null;
  switch (metric) {
    case 'margin_pct':
      return row.marginBp;
    case 'profit':
      return row.profitCents;
    case 'revenue':
      return row.revenueCents;
    case 'units_per_labor_hour':
      return row.uph === null ? null : Math.round(Number(row.uph) * 1000);
    case 'labor_pct_of_revenue':
      return row.laborPctBp;
    case 'cost_per_unit':
      return row.costPerUnitCents;
    default:
      return null;
  }
}

/** Work days in `[from, to]`, both ends included. */
function workDaysIn(from: string, to: string, workingDays: readonly number[]): number {
  if (to < from) return 0;
  return workDaysBetween(from, to, workingDays) + (isWorkDay(from, workingDays) ? 1 : 0);
}

/** Goals against actuals for one month (default: this month). */
export async function getGoalsBoard(ctx: DomainContext, options: { month?: string | null } = {}): Promise<GoalsBoardDTO> {
  const access = await requirePulse(ctx, 'pulse:read');
  const settings = await loadSettings(ctx.orgId);
  const today = todayInZone(settings.timezone);
  if (options.month && !/^\d{4}-\d{2}(-\d{2})?$/.test(options.month)) throw invalid('Pick a month.');
  const month = options.month ? `${options.month.slice(0, 7)}-01` : startOfMonth(today);
  const monthEnd = endOfMonth(month);
  const isCurrentMonth = month === startOfMonth(today);
  const isFuture = month > today;
  const through = isCurrentMonth ? today : monthEnd;
  const totalWorkDays = workDaysIn(month, monthEnd, settings.workingDays);
  const elapsedWorkDays = isFuture ? 0 : workDaysIn(month, through, settings.workingDays);
  const trendMonths = Array.from({ length: 6 }, (_, index) => addMonths(month, index - 5));

  const [targets, sites, clients, jobTypes, services] = await Promise.all([
    listTargets(ctx, { month }),
    rows<{ id: string; name: string }>(db, sql`SELECT id, name FROM pulse.sites WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL ORDER BY lower(name)`),
    rows<{ id: string; name: string }>(db, sql`SELECT id, name FROM pulse.clients WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL ORDER BY lower(name)`),
    rows<{ id: string; name: string }>(db, sql`SELECT id, name FROM pulse.job_types WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL AND archived_at IS NULL ORDER BY position, lower(name)`),
    rows<{ id: string; name: string }>(db, sql`SELECT id, name FROM pulse.vas_services WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL ORDER BY lower(name)`),
  ]);
  // A goal set for this month wins over the "every month" goal of the same thing.
  const chosen = new Map<string, (typeof targets)[number]>();
  for (const target of targets) {
    const key = `${target.scope}:${target.scopeId ?? ''}:${target.metric}`;
    const current = chosen.get(key);
    if (!current || (current.periodMonth === null && target.periodMonth !== null)) chosen.set(key, target);
  }
  const names = new Map<string, string>([...sites, ...clients, ...jobTypes, ...services].map((row) => [row.id, row.name]));
  const scopeKeys = new Map<string, { scope: TargetScope; scopeId: string | null }>();
  for (const target of chosen.values()) scopeKeys.set(`${target.scope}:${target.scopeId ?? ''}`, { scope: target.scope, scopeId: target.scopeId });

  const filterFor = (scope: TargetScope, scopeId: string | null) =>
    scope === 'site' ? { siteId: scopeId } : scope === 'client' ? { clientId: scopeId } : scope === 'job_type' ? { jobTypeId: scopeId } : scope === 'vas_service' ? { vasServiceId: scopeId } : {};
  const byScope = new Map<string, Map<string, ProfitRowDTO>>();
  const utilization = new Map<string, number | null>();
  await Promise.all(
    [...scopeKeys.entries()].map(async ([key, { scope, scopeId }]) => {
      const profit = await getProfit(ctx, 'month', { from: trendMonths[0]!, to: addDays(addMonths(month, 1), -1), ...filterFor(scope, scopeId) });
      byScope.set(key, new Map(profit.rows.map((row) => [row.key, row])));
      const wantsUtilization = [...chosen.values()].some((target) => target.metric === 'utilization_pct' && target.scope === scope && target.scopeId === scopeId);
      if (wantsUtilization && !isFuture) {
        const bridge = await getCompanyBridge(ctx, { from: month, to: through, siteId: scope === 'site' ? scopeId : null });
        utilization.set(key, bridge.utilizationBp);
      }
    }),
  );

  const order: readonly TargetScope[] = ['org', 'site', 'client', 'job_type', 'vas_service'];
  const out: GoalRowDTO[] = [...chosen.values()]
    .map((target): GoalRowDTO => {
      const key = `${target.scope}:${target.scopeId ?? ''}`;
      const months = byScope.get(key) ?? new Map<string, ProfitRowDTO>();
      const info = GOAL_METRICS[target.metric];
      const hidden = info.needsMoney && !access.seesMoney;
      const actual = hidden ? null : target.metric === 'utilization_pct' ? (utilization.get(key) ?? null) : measure(target.metric, months.get(month));
      const goal = hidden ? null : goalToNatural(target.metric, target.value);
      const reading = readGoal({ metric: target.metric, goal, actual, elapsedWorkDays, totalWorkDays });
      return {
        id: target.id,
        scope: target.scope,
        scopeId: target.scopeId,
        scopeLabel: target.scope === 'org' ? 'Whole company' : (names.get(target.scopeId ?? '') ?? 'Removed'),
        metric: target.metric,
        everyMonth: target.periodMonth === null,
        version: target.version,
        value: hidden ? null : target.value,
        goal,
        actual,
        expected: reading.expected,
        projected: reading.projected,
        gap: reading.gap,
        progressBp: reading.progressBp,
        status: reading.status,
        trend: hidden || target.metric === 'utilization_pct' ? [] : trendMonths.map((item) => measure(target.metric, months.get(item))),
        hidden,
      };
    })
    .sort((a, b) => order.indexOf(a.scope) - order.indexOf(b.scope) || a.scopeLabel.localeCompare(b.scopeLabel) || a.metric.localeCompare(b.metric));

  return {
    month,
    trendMonths,
    today,
    isCurrentMonth,
    isFuture,
    elapsedWorkDays,
    totalWorkDays,
    rows: out,
    options: { sites, clients, jobTypes, services },
    canManage: canPulse(access.role, 'target:manage'),
    moneyHidden: !access.seesMoney,
  };
}
