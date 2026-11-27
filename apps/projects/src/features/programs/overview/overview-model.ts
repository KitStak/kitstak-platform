/**
 * Pure helpers for the program Overview (docs/programs/SPEC.md 5.6). Every money number comes
 * from the summary DTO (engine cents); these helpers only compare, pick and word them. Money math
 * is bigint, never float (M7). Chart values are numbers only for drawing.
 */
import { addDays, changeBp, dayNumber, formatCents, formatQty, lastDayOfMonth, monthOf, shortDate, unitLabel } from '@kitstak/programs-engine';
import type { DayRollupDTO, IsoDate, IsoMonth, MonthResultDTO, ForecastResultDTO, ProgramAlertDTO, UnitLabel } from '@/lib/program-types';
import { LABEL_COLORS } from '@/lib/constants';

/* ---------------------------------------------------------------------------------------------- */
/* Alerts                                                                                         */
/* ---------------------------------------------------------------------------------------------- */

export type AlertTone = 'danger' | 'warning' | 'info';
export type AlertAction =
  | { readonly kind: 'log'; readonly date: IsoDate }
  | { readonly kind: 'forecast' }
  | { readonly kind: 'price-card' }
  | { readonly kind: 'new-card' }
  | { readonly kind: 'variants' }
  | { readonly kind: 'build'; readonly buildKey: string }
  | { readonly kind: 'linked' };

export interface AlertView {
  readonly id: string;
  readonly kind: ProgramAlertDTO['kind'];
  readonly tone: AlertTone;
  readonly text: string;
  readonly actionLabel: string;
  readonly action: AlertAction;
  /** Lower sorts first. */
  readonly rank: number;
}

export interface AlertContext {
  readonly unit: UnitLabel;
  readonly programKey: string;
  /** Today in the program time zone. */
  readonly today: IsoDate;
  /** Program owner or org admin: sees sync gaps. */
  readonly seesSync: boolean;
  readonly variantName: (id: string) => string | null;
  readonly pulseJobNumber?: string | null;
  /** Minutes the Pulse gap has lasted (for everyone else's "catching up"). */
  readonly gapMinutes?: number | null;
}

/** The sentence, tone and one action for an alert, or null when this person should not see it. */
export function alertView(alert: ProgramAlertDTO, context: AlertContext): AlertView | null {
  const { unit } = context;
  switch (alert.kind) {
    case 'no_output_yesterday':
      return { id: `${alert.kind}:${alert.date}`, kind: alert.kind, tone: 'warning', rank: 2, text: `No output logged ${alert.date === addDays(context.today, -1) ? 'yesterday' : `on ${shortDate(alert.date)}`} for ${alert.builds} ${alert.builds === 1 ? 'build' : 'builds'}`, actionLabel: 'Log output', action: { kind: 'log', date: alert.date } };
    case 'behind_today':
      return { id: alert.kind, kind: alert.kind, tone: 'warning', rank: 3, text: `Behind today: ${formatQty(alert.builtUnits)} of ${unitLabel(alert.plannedUnits, unit)}`, actionLabel: 'Log output', action: { kind: 'log', date: context.today } };
    case 'minimum_at_risk':
      return { id: alert.kind, kind: alert.kind, tone: 'danger', rank: 1, text: `May miss the minimum by ${formatCents(alert.projectedGapCents, { cents: true })}`, actionLabel: 'View forecast', action: { kind: 'forecast' } };
    case 'unpriced_units':
      return { id: alert.kind, kind: alert.kind, tone: 'danger', rank: 1, text: `${unitLabel(alert.units, unit)} ${scaledIsOne(alert.units) ? 'has' : 'have'} no price`, actionLabel: 'Open price card', action: { kind: 'price-card' } };
    case 'no_price_card':
      return { id: alert.kind, kind: alert.kind, tone: 'warning', rank: 2, text: 'No price card yet', actionLabel: 'Add a price card', action: { kind: 'new-card' } };
    case 'kit_shortage': {
      const variant = context.variantName(alert.variantId);
      return { id: `${alert.kind}:${alert.variantId}:${alert.date}`, kind: alert.kind, tone: 'danger', rank: 1, text: `Short ${formatQty(alert.shortQty)} of ${alert.component} for ${shortDate(alert.date)}${variant ? ` · ${variant}` : ''}`, actionLabel: 'View kit', action: { kind: 'variants' } };
    }
    case 'version_starts_soon':
      return { id: `${alert.kind}:${alert.versionNumber}`, kind: alert.kind, tone: 'info', rank: 4, text: `Price card v${alert.versionNumber} starts ${shortDate(alert.effectiveFrom)}`, actionLabel: 'View', action: { kind: 'price-card' } };
    case 'pulse_out_of_sync': {
      if (context.seesSync) {
        const text = alert.reason === 'job_deleted' ? `Pulse job ${context.pulseJobNumber ?? ''} was deleted`.replace('  ', ' ') : alert.deltaCents ? `Pulse is ${formatCents(absText(alert.deltaCents), { cents: true })} off from Projects` : 'Pulse is catching up';
        return { id: alert.kind, kind: alert.kind, tone: alert.reason === 'job_deleted' ? 'danger' : 'warning', rank: 2, text, actionLabel: alert.reason === 'job_deleted' ? 'Open Linked' : 'View', action: { kind: 'linked' } };
      }
      if ((context.gapMinutes ?? 0) < 10) return null;
      return { id: alert.kind, kind: alert.kind, tone: 'info', rank: 5, text: 'Pulse is catching up', actionLabel: 'View', action: { kind: 'linked' } };
    }
    case 'over_plan':
      return { id: `${alert.kind}:${alert.buildId}`, kind: alert.kind, tone: 'warning', rank: 3, text: `${alert.buildKey} is ${unitLabel(alert.overQty, unit)} over plan`, actionLabel: 'Open', action: { kind: 'build', buildKey: alert.buildKey } };
  }
}

function absText(cents: string): string {
  return cents.startsWith('-') ? cents.slice(1) : cents;
}

function scaledIsOne(qty: string): boolean {
  return Number(qty) === 1;
}

/** Alerts for this person, worst first. */
export function alertViews(alerts: readonly ProgramAlertDTO[], context: AlertContext): AlertView[] {
  return alerts
    .map((alert) => alertView(alert, context))
    .filter((alert): alert is AlertView => alert !== null)
    .sort((a, b) => a.rank - b.rank);
}

/* ---------------------------------------------------------------------------------------------- */
/* KPI row                                                                                        */
/* ---------------------------------------------------------------------------------------------- */

/** Cumulative cents through the same day of the month (clamped to the shorter month). */
export function cumulativeThrough(byDay: readonly DayRollupDTO[], dayOfMonth: number): bigint | null {
  let last: bigint | null = null;
  for (const day of byDay) {
    const dom = Number(day.date.slice(8, 10));
    if (dom > dayOfMonth) break;
    if (day.cumulativeCents !== null) last = BigInt(day.cumulativeCents);
  }
  return last;
}

export interface Comparison {
  readonly text: string;
  readonly tone: 'success' | 'danger' | 'neutral';
}

/** "up 27% vs last month at this point", "down 4% ...", or "same as last month at this point". */
export function compareWithLastMonth(thisMonth: readonly DayRollupDTO[], lastMonth: readonly DayRollupDTO[] | null | undefined, asOf: IsoDate): Comparison | null {
  if (!lastMonth || lastMonth.length === 0) return null;
  const dom = Number(asOf.slice(8, 10));
  const now = cumulativeThrough(thisMonth, dom);
  const then = cumulativeThrough(lastMonth, dom);
  if (now === null || then === null || then <= BigInt(0)) return null;
  const bp = changeBp(now, then);
  if (bp === null) return null;
  // SPEC 7.4 rounds the change to the nearest whole percent (26.5% reads "up 27%").
  const pct = Math.round(Math.abs(bp) / 100);
  if (pct === 0) return { text: SAME_AS_LAST_MONTH, tone: 'neutral' };
  return bp > 0 ? { text: `up ${pct}% vs last month at this point`, tone: 'success' } : { text: `down ${pct}% vs last month at this point`, tone: 'danger' };
}

export const SAME_AS_LAST_MONTH = 'Same as last month at this point';

/** Days with output, through `asOf`. */
export function workDaysSoFar(byDay: readonly DayRollupDTO[], asOf: IsoDate): number {
  return byDay.filter((day) => day.date <= asOf && Number(day.units) > 0).length;
}

/**
 * "Avg 801 a work day": units over the finished work days with output, through yesterday. Today is
 * still running, so it is left out of both sides (SPEC 7.4: 13,612 kits over 17 days is 801).
 * Null before the first finished work day.
 */
export function finishedDaysAverage(byDay: readonly DayRollupDTO[], asOf: IsoDate): string | null {
  const days = byDay.filter((day) => day.date < asOf && Number(day.units) > 0);
  const units = days.reduce((sum, day) => sum + Number(day.units), 0);
  return avgPerDayText(units.toFixed(3), days.length);
}

/** "Avg 801 a work day" (whole units, rounded half up on the 3 decimal string). */
export function avgPerDayText(units: string, days: number): string | null {
  if (days <= 0) return null;
  const scaled = BigInt(Math.round(Number(units) * 1000));
  const avg = (scaled + BigInt(days * 500)) / BigInt(days * 1000);
  return `Avg ${formatQty(String(avg))} a work day`;
}

export interface MinimumKpi {
  readonly value: string;
  readonly line: string | null;
  readonly tone: 'success' | 'warning' | 'neutral' | 'muted';
  /** Why the month's minimum is not the card's, e.g. "$3,000.00 on the card, cut for the Nov 2 start". */
  readonly reason: string | null;
}

/**
 * Why this month's minimum differs from the card's monthly minimum: the program started (or ends)
 * inside the month, so the engine counts only the days it runs. Null when they match or the card has none.
 */
export function minimumReason(monthCents: string, cardCents: string | null | undefined, month: IsoMonth, startDate: IsoDate | null, endDate: IsoDate | null = null): string | null {
  if (!cardCents || BigInt(cardCents) === BigInt(monthCents)) return null;
  const card = formatCents(cardCents, { cents: true });
  const first = `${month}-01`;
  if (startDate && startDate > first && startDate.slice(0, 7) === month) return `${card} on the card, cut for the ${shortDate(startDate)} start`;
  if (endDate && endDate.slice(0, 7) === month) return `${card} on the card, cut for the ${shortDate(endDate)} end`;
  return `${card} on the card, sized to the days in this month`;
}

/** The Minimum KPI: Met, Met so far (month open), Below minimum by X so far (on track), May miss it by X, or Not set. */
export function minimumKpi(result: MonthResultDTO, forecast: ForecastResultDTO, context: { readonly cardMinimumCents?: string | null; readonly month?: IsoMonth; readonly startDate?: IsoDate | null; readonly endDate?: IsoDate | null } = {}): MinimumKpi {
  const minimum = result.minimum;
  if (!minimum || minimum.status === 'none') return { value: 'Not set', line: 'No monthly minimum on the card', tone: 'muted', reason: null };
  const reason = context.month ? minimumReason(minimum.minimumCents, context.cardMinimumCents, context.month, context.startDate ?? null, context.endDate ?? null) : null;
  const gap = BigInt(minimum.gapSoFarCents);
  const projected = forecast.projectedGapCents ? BigInt(forecast.projectedGapCents) : BigInt(0);
  const of = `of ${formatCents(minimum.minimumCents, { cents: true })}`;
  // "Met" is final only once the month is over (or no day can charge, B.1.5). While it is open the
  // statement says "Month still open", so the KPI says "Met so far" and the same thing.
  const over = `Work charges are over the ${formatCents(minimum.minimumCents, { cents: true })} minimum.`;
  if (minimum.status === 'met') return { value: 'Met', line: over, tone: 'success', reason: reason ? `${reason}.` : null };
  if (gap <= BigInt(0)) return { value: 'Met so far', line: `${over} The month is still open.`, tone: 'success', reason: reason ? `${reason}.` : null };
  if (projected > BigInt(0)) return { value: `May miss it by ${formatCents(projected, { cents: true })}`, line: `Below minimum by ${formatCents(gap, { cents: true })} so far ${of}.`, tone: 'warning', reason: reason ? `${reason}.` : null };
  return { value: `Below minimum by ${formatCents(gap, { cents: true })} so far`, line: 'On track to meet it.', tone: 'neutral', reason: reason ? `${reason}.` : null };
}

/* ---------------------------------------------------------------------------------------------- */
/* Month chart                                                                                    */
/* ---------------------------------------------------------------------------------------------- */

export type ChartMetric = 'revenue' | 'units';

export interface MonthChartData {
  readonly labels: readonly IsoDate[];
  readonly actual: readonly (number | null)[];
  readonly forecast: readonly (number | null)[];
  readonly target: readonly (number | null)[] | null;
  readonly minimum: readonly (number | null)[] | null;
  readonly todayIndex: number | null;
  readonly daily: readonly { readonly date: IsoDate; readonly units: number; readonly planned: number; readonly future: boolean; readonly today: boolean; readonly revenueCents: string | null }[];
}

const toDollars = (cents: bigint): number => Number(cents) / 100;

/**
 * Series for the "This month" chart: cumulative actual through today, ONE forecast line from today
 * to the month end in the chosen basis, the target as a straight line from 0 to the target at
 * month end, and the minimum line when one is set.
 */
export function monthChart(input: {
  readonly month: IsoMonth;
  readonly asOf: IsoDate;
  readonly byDay: readonly DayRollupDTO[];
  readonly metric: ChartMetric;
  readonly forecastCents: string | null;
  readonly targetCents: string | null;
  readonly minimumCents: string | null;
  readonly dailyTargetUnits: string | null;
  readonly workDays: number;
}): MonthChartData {
  const { byDay, metric } = input;
  const labels = byDay.map((day) => day.date);
  const isCurrent = monthOf(input.asOf) === input.month;
  const todayIndex = isCurrent ? labels.indexOf(input.asOf) : null;
  const lastActual = isCurrent ? todayIndex ?? -1 : input.asOf >= lastDayOfMonth(input.month) ? labels.length - 1 : -1;
  let units = 0;
  const actual: (number | null)[] = [];
  const cumUnits: number[] = [];
  for (const [index, day] of byDay.entries()) {
    units += Number(day.units);
    cumUnits.push(units);
    if (index <= lastActual) actual.push(metric === 'revenue' ? toDollars(BigInt(day.cumulativeCents ?? '0')) : units);
    else actual.push(null);
  }
  const forecast: (number | null)[] = labels.map(() => null);
  if (isCurrent && todayIndex !== null && todayIndex < labels.length - 1) {
    const start = actual[todayIndex] ?? 0;
    if (metric === 'revenue') {
      const end = input.forecastCents ? toDollars(BigInt(input.forecastCents)) : start;
      const span = labels.length - 1 - todayIndex;
      for (let index = todayIndex; index < labels.length; index += 1) forecast[index] = start + ((end - start) * (index - todayIndex)) / span;
    } else {
      let running = start;
      forecast[todayIndex] = start;
      for (let index = todayIndex + 1; index < labels.length; index += 1) {
        running += Number(byDay[index]?.plannedUnits ?? 0);
        forecast[index] = running;
      }
    }
  }
  let target: (number | null)[] | null = null;
  const last = labels.length - 1;
  if (metric === 'revenue' && input.targetCents) {
    const goal = toDollars(BigInt(input.targetCents));
    target = labels.map((_, index) => (goal * (index + 1)) / (last + 1));
  } else if (metric === 'units' && input.dailyTargetUnits && input.workDays > 0) {
    const goal = Number(input.dailyTargetUnits) * input.workDays;
    target = labels.map((_, index) => (goal * (index + 1)) / (last + 1));
  }
  const minimum = metric === 'revenue' && input.minimumCents && BigInt(input.minimumCents) > BigInt(0) ? labels.map(() => toDollars(BigInt(input.minimumCents as string))) : null;
  const daily = byDay.map((day, index) => ({
    date: day.date,
    units: Number(day.units),
    planned: Number(day.plannedUnits),
    future: index > lastActual,
    today: index === todayIndex,
    revenueCents: day.workCents === null ? null : String(BigInt(day.workCents) + BigInt(day.feeCents ?? '0')),
  }));
  return { labels, actual, forecast, target, minimum, todayIndex, daily };
}

/** Day number in month (1 to 31). */
export function dayOfMonth(date: IsoDate): number {
  return Number(date.slice(8, 10));
}

/** True when `date` is after `asOf` (a future day). */
export function isFuture(date: IsoDate, asOf: IsoDate): boolean {
  return dayNumber(date) > dayNumber(asOf);
}

/* ---------------------------------------------------------------------------------------------- */
/* Variant colors                                                                                 */
/* ---------------------------------------------------------------------------------------------- */

const CHART_VARS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-6)', 'var(--chart-5)'];

/** The color for a variant in charts: its own label color, else the chart palette by position. */
export function variantChartColor(color: string | null | undefined, index: number): string {
  if (color && (LABEL_COLORS as readonly string[]).includes(color)) return `var(--label-${color})`;
  if (index < CHART_VARS.length) return CHART_VARS[index] as string;
  const label = LABEL_COLORS[(index - CHART_VARS.length) % LABEL_COLORS.length];
  return `var(--label-${label})`;
}

/**
 * One color per variant for every program screen (Overview, Today's run, Variants): its own
 * label color, else the chart palette by its place in the variants list.
 */
export function variantColorMap(variants: readonly { readonly id: string; readonly color: string | null }[]): Map<string, string> {
  return new Map(variants.map((variant, index) => [variant.id, variantChartColor(variant.color, index)]));
}

/* ---------------------------------------------------------------------------------------------- */
/* Statement groups                                                                               */
/* ---------------------------------------------------------------------------------------------- */

export type ChargeGroup = 'per_unit' | 'per_order' | 'per_hour' | 'flat_monthly' | 'setup' | 'adjustment' | 'minimum_top_up';

export const CHARGE_GROUP_LABEL: Readonly<Record<ChargeGroup, string>> = {
  per_unit: 'Per unit',
  per_order: 'Per batch',
  per_hour: 'Per hour',
  flat_monthly: 'Monthly fee',
  setup: 'Setup',
  adjustment: 'Adjustments',
  minimum_top_up: 'Minimum top up',
};

export const CHARGE_GROUP_ORDER: readonly ChargeGroup[] = ['per_unit', 'per_order', 'per_hour', 'flat_monthly', 'setup', 'adjustment', 'minimum_top_up'];

/** "Per kit" for the per unit group. */
export function groupLabel(group: ChargeGroup, unit: UnitLabel): string {
  return group === 'per_unit' ? `Per ${unit.singular}` : CHARGE_GROUP_LABEL[group];
}

/** Map a ledger or line kind to its statement group. */
export function chargeGroupOf(kind: string): ChargeGroup {
  if (kind === 'per_unit' || kind === 'per_order' || kind === 'per_hour' || kind === 'flat_monthly' || kind === 'setup' || kind === 'adjustment') return kind;
  if (kind === 'monthly_minimum' || kind === 'minimum_top_up' || kind === 'top_up') return 'minimum_top_up';
  if (kind === 'monthly_fee') return 'flat_monthly';
  return 'adjustment';
}

export interface GroupTotal {
  readonly group: ChargeGroup;
  readonly cents: bigint;
  readonly count: number;
}

/** Totals per statement group, in statement order, leaving out empty groups. */
export function groupTotals(rows: readonly { readonly kind: string; readonly cents: string }[]): GroupTotal[] {
  const totals = new Map<ChargeGroup, { cents: bigint; count: number }>();
  for (const row of rows) {
    const group = chargeGroupOf(row.kind);
    const current = totals.get(group) ?? { cents: BigInt(0), count: 0 };
    totals.set(group, { cents: current.cents + BigInt(row.cents), count: current.count + 1 });
  }
  return CHARGE_GROUP_ORDER.filter((group) => totals.has(group)).map((group) => ({ group, ...(totals.get(group) as { cents: bigint; count: number }) }));
}

/** "November 2026" for a month. */
export function monthLong(month: IsoMonth): string {
  const [year, number] = month.split('-').map(Number) as [number, number];
  const name = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(year, number - 1, 1)));
  return `${name} ${year}`;
}

/** "November" for a month. */
export function monthShortName(month: IsoMonth): string {
  return monthLong(month).split(' ')[0] as string;
}

/** "Wed Nov 25". */
export function weekdayDate(date: IsoDate): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const value = new Date(Date.UTC(year, month - 1, day));
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(value);
  return `${weekday} ${shortDate(date)}`;
}
