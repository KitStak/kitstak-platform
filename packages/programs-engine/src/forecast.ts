/**
 * Month forecast and program health (docs/programs/SPEC.md 3.8). Two estimates of the month:
 * "Based on recent days" (the average work day of the last 10 work days) and "Based on planned
 * builds" (the open builds still to make). The planned one is used when planned builds cover
 * most of the days left. Pure functions; `asOf` is passed in.
 */
import { accrueDay } from './accrual';
import { eachDay, firstDayOfMonth, isPlannableDay, lastDayOfMonth, monthOf } from './calendar';
import { type Cents, ZERO, divRound, quantityToScaled, ratioBp, toCents } from './money';
import { type MonthResult, assertMonthClock, fixedLineForMonth } from './month';
import type { CardVersion, IsoDate, IsoMonth, OneTimeCharge, ProgramCalendar } from './types';

export interface ForecastInput {
  readonly month: IsoMonth;
  readonly asOf: IsoDate;
  readonly calendar: ProgramCalendar;
  readonly versions: readonly CardVersion[];
  /** Actuals through `asOf`. */
  readonly result: MonthResult;
  /** The last 20 work days before `asOf` (may cross months). `workCents` is every work charge of the day (per unit, per batch and per hour). */
  readonly trailingDaily: readonly { readonly date: IsoDate; readonly workCents: Cents; readonly units: string }[];
  /**
   * Open builds dated `asOf` to month end (3.8). Builds dated before `asOf` (past due) or in
   * another month are left out, so every app forecasts from the same builds.
   */
  readonly planned: readonly { readonly buildId: string; readonly date: IsoDate; readonly remainingQty: string; readonly unitPrice: string; readonly orderCents: Cents | null }[];
  /**
   * Every live setup fee and adjustment dated in the month, including the ones dated after
   * `asOf` that `result` does not hold yet, so the forecast counts the whole month's one time
   * charges (3.8). Optional: when left out, the setup fees and adjustments already in `result`
   * are used.
   */
  readonly oneTime?: readonly OneTimeCharge[];
  readonly targetCents: Cents | null;
}

export type ForecastMethod = 'planned' | 'recent';

export interface ForecastResult {
  readonly actualCents: Cents;
  /** "Based on recent days". */
  readonly recentCents: Cents;
  /** "Based on planned builds". */
  readonly plannedCents: Cents;
  /** The chosen one. */
  readonly forecastCents: Cents;
  readonly method: ForecastMethod;
  readonly remainingWorkDays: number;
  readonly avgDailyWorkCents: Cents;
  /** `max(0, minimum - projected work charges for the minimum)`. */
  readonly projectedGapCents: Cents;
  /** `max(0, target - forecast)`, null with no target. */
  readonly targetGapCents: Cents | null;
  /** Forecast over target in basis points ("105% of target"). */
  readonly targetBp: number | null;
}

/** Days of recent work the average uses. */
export const RECENT_DAYS = 10;
/** Share of the days left that planned builds must cover, in percent, to use the planned forecast. */
export const PLANNED_COVERAGE_PERCENT = 80;

function positive(value: Cents): Cents {
  return value > ZERO ? value : ZERO;
}

/**
 * The month estimate (3.8). Throws a RangeError when `asOf` is not a real date, `month` is not
 * a real month, or `result` is a different month.
 */
export function forecastMonth(input: ForecastInput): ForecastResult {
  assertMonthClock(input);
  if (input.result.month !== input.month) throw new RangeError(`The result is for ${String(input.result.month)}, not ${input.month}.`);
  const { month, asOf, calendar, result } = input;
  const monthEnd = lastDayOfMonth(month);
  const days = eachDay(firstDayOfMonth(month), monthEnd);
  const remaining = days.filter((date) => date > asOf && isPlannableDay(calendar, date));
  const asOfInMonth = monthOf(asOf) === month;

  const recentDays = input.trailingDaily
    .filter((day) => day.date < asOf && isPlannableDay(calendar, day.date))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .slice(-RECENT_DAYS);
  const avgDailyWorkCents = recentDays.length === 0 ? ZERO : divRound(recentDays.reduce((sum, day) => sum + day.workCents, ZERO), BigInt(recentDays.length));

  const actualWork = result.work.totalCents;
  const todayWork = asOfInMonth ? (result.byDay.find((day) => day.date === asOf)?.workCents ?? ZERO) : ZERO;
  const todayRemainder = asOfInMonth && isPlannableDay(calendar, asOf) ? positive(avgDailyWorkCents - todayWork) : ZERO;
  const recentWork = actualWork + todayRemainder + avgDailyWorkCents * BigInt(remaining.length);

  // Planned (3.8): actuals plus what each open build dated asOf to month end still has to make.
  // Hours are only in the actuals, so an hourly program (MAHCO) forecasts its work hours through
  // today and shows the minimum gap the rest of the month must close.
  const open = input.planned.filter((build) => build.date >= asOf && build.date <= monthEnd && monthOf(build.date) === month);
  let plannedWork = actualWork;
  for (const build of open) plannedWork += accrueDay(build.remainingQty, build.unitPrice) + (build.orderCents ?? ZERO);
  const coveredDays = new Set(open.map((build) => build.date));
  const covered = remaining.filter((date) => coveredDays.has(date)).length;
  const method: ForecastMethod =
    remaining.length === 0 ? (coveredDays.has(asOf) ? 'planned' : 'recent') : covered * 100 >= PLANNED_COVERAGE_PERCENT * remaining.length ? 'planned' : 'recent';

  // Fixed charges for the whole month: the monthly fee plus every setup fee and adjustment dated
  // in the month, also the ones still ahead of `asOf`. Only adjustments that count toward the
  // minimum close the minimum gap.
  let oneTimeCents = ZERO;
  let toward = ZERO;
  if (input.oneTime) {
    for (const charge of input.oneTime) {
      if (monthOf(charge.chargeOn) !== month) continue;
      const cents = toCents(charge.amountCents);
      oneTimeCents += cents;
      if (charge.kind === 'adjustment' && charge.countsTowardMinimum) toward += cents;
    }
  } else {
    oneTimeCents = result.fixed.setupCents + result.adjustments.totalCents;
    toward = result.adjustments.towardMinimumCents;
  }
  const fixedForMonth = fixedLineForMonth({ month, calendar, versions: input.versions, kind: 'flat_monthly' }).cents + oneTimeCents;
  const minimumCents = result.minimum.minimumCents;
  const project = (work: Cents): { total: Cents; gap: Cents } => {
    const gap = result.minimum.status === 'none' ? ZERO : positive(minimumCents - (work + toward));
    return { total: work + fixedForMonth + gap, gap };
  };
  const recent = project(recentWork);
  const plan = project(plannedWork);
  const chosen = method === 'planned' ? plan : recent;
  const targetCents = input.targetCents;
  return {
    actualCents: result.totalCents,
    recentCents: recent.total,
    plannedCents: plan.total,
    forecastCents: chosen.total,
    method,
    remainingWorkDays: remaining.length,
    avgDailyWorkCents,
    projectedGapCents: chosen.gap,
    targetGapCents: targetCents === null ? null : positive(targetCents - chosen.total),
    targetBp: targetCents === null ? null : ratioBp(chosen.total, targetCents),
  };
}

/** The words for a forecast method (UI copy). */
export const FORECAST_METHOD_LABELS: Readonly<Record<ForecastMethod, string>> = {
  planned: 'Based on planned builds',
  recent: 'Based on recent days',
};

export type Health = 'on_track' | 'at_risk' | 'off_track';
export type HealthBasis = 'money_target' | 'unit_target' | 'plan';

/** The words for a health state (UI copy). */
export const HEALTH_LABELS: Readonly<Record<Health, string>> = {
  on_track: 'On track',
  at_risk: 'At risk',
  off_track: 'Off track',
};

/** The tip that says where a health state came from (UI copy). */
export const HEALTH_BASIS_LABELS: Readonly<Record<HealthBasis, string>> = {
  money_target: 'From the money target',
  unit_target: 'From the daily unit target',
  plan: 'From planned vs built, last 5 work days',
};

function band(bp: number, onTrack: number, atRisk: number): Health {
  if (bp >= onTrack) return 'on_track';
  if (bp >= atRisk) return 'at_risk';
  return 'off_track';
}

/**
 * Program health (3.8). The first basis with data wins: the money target (on track at 100
 * percent or more, at risk from 90, else off track), the daily unit target (same bands), then
 * planned vs built over the last 5 work days that had builds (on track at 95 percent or more, at
 * risk from 85). Null when no basis has data.
 */
export function programHealth(input: {
  readonly targetBp: number | null;
  readonly dailyTargetUnits: string | null;
  readonly recentUnitsPerDay: string | null;
  readonly lastWorkDays: readonly { readonly planned: string; readonly built: string }[];
}): { health: Health; basis: HealthBasis } | null {
  if (input.targetBp !== null && Number.isFinite(input.targetBp)) return { health: band(input.targetBp, 10000, 9000), basis: 'money_target' };
  if (input.dailyTargetUnits !== null && input.recentUnitsPerDay !== null && input.dailyTargetUnits.trim() !== '' && input.recentUnitsPerDay.trim() !== '') {
    const target = quantityToScaled(input.dailyTargetUnits);
    if (target > ZERO) {
      const bp = ratioBp(quantityToScaled(input.recentUnitsPerDay), target);
      if (bp !== null) return { health: band(bp, 10000, 9000), basis: 'unit_target' };
    }
  }
  const days = input.lastWorkDays.slice(-5);
  let planned = ZERO;
  let built = ZERO;
  for (const day of days) {
    planned += quantityToScaled(day.planned);
    built += quantityToScaled(day.built);
  }
  if (planned > ZERO) {
    const bp = ratioBp(built, planned);
    if (bp !== null) return { health: band(bp, 9500, 8500), basis: 'plan' };
  }
  return null;
}
