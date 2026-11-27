/**
 * The program tracker math (docs/programs/PULSE_PROGRAMS_SPEC.md section 3). Pure functions: no
 * database, no clock, money in `bigint` cents, quantities as 3 place decimal strings, hours as 2
 * place decimal strings.
 *
 * - `programMonthFigures` (3.1, 3.2): revenue, cost, profit and margin of one program month, by
 *   variant and by day. Program job cost with no variant is split over the variants of the same
 *   day by their good units, with the engine's `allocate`, so the rows add up to the cent.
 * - `programMonthPlan` (3.3): planned units and the month forecast, computed with the engine's
 *   `forecastMonth` from the same inputs Projects uses (apps/projects/src/server/domain/programs/
 *   stats.ts), so the forecast matches Projects to the cent.
 * - `programCostForecast` (3.4): cost to the end of the month and the forecast margin.
 * - `programTargetMargin` (3.5): the customer's target margin, else the org default.
 *
 * "Good units" are the build output qty (`pm.build_output.qty`, Pulse `units_good`). Scrap is
 * counted on its own (`scrap_qty`, Pulse `units_scrap`) and is never part of good units, the same
 * as in the engine, where revenue is qty times price and scrap is not billed.
 */
import { forecastMonth, type ForecastMethod, type ForecastResult } from '@kitstak/programs-engine/forecast';
import { monthCharges } from '@kitstak/programs-engine/month';
import { resolveOrderCharge, resolveUnitPrice } from '@kitstak/programs-engine/price';
import type { CardVersion, FinishedBuild, IsoMonth, OneTimeCharge, OutputRow, ProgramCalendar, TimeDay } from '@kitstak/programs-engine/types';
import {
  type Cents,
  type CentsLike,
  type Decimal,
  ZERO,
  allocate,
  divRound,
  fromScaled,
  hoursToScaled,
  marginBp,
  quantityToScaled,
  ratioBp,
  toCents,
} from '../money';
import { addDays, eachDay, firstDayOfMonth, isPlannableDay, isRealDate, isRealMonth, lastDayOfMonth, monthOf } from './calendar';
import { targetMarginBp } from './pace';
import type { IsoDate } from './types';

const THOUSAND = BigInt(1000);
const HUNDRED = BigInt(100);

/* 3.1 and 3.2: month figures */

/** One build line of the program (`pmb:` production entry with this `pm_program_id`), on any job. */
export interface ProgramLine {
  readonly date: IsoDate;
  /** `pm_variant_id`. Null for a build with no variant: its money stays in "Not tied to a variant". */
  readonly variantId: string | null;
  /** Good units (`units_good`). Scrap is not in here. */
  readonly units: Decimal;
  /** `units_scrap`. Default 0. */
  readonly scrap?: Decimal;
  /** `base_revenue_cents`. */
  readonly revenueCents: CentsLike;
  /** Build labor on the line. Default 0. */
  readonly laborCents?: CentsLike;
  /** Build hours on the line. Default 0. */
  readonly hours?: Decimal;
  readonly materialCents?: CentsLike;
  readonly otherCents?: CentsLike;
  readonly sharedCents?: CentsLike;
}

/** One fee row of the program (`pmf:` revenue entry with this `pm_program_id`). */
export interface FeeLine {
  readonly date: IsoDate;
  /** `revenue_entries.kind`, for example `fee` or `adjustment`. */
  readonly kind: string;
  /** Signed: credits are negative. */
  readonly amountCents: CentsLike;
}

/** Cost on the program job that is not on a build line: typed hours, `pmt:` prep rows, material and other cost rows, shared cost. */
export interface JobCostLine {
  readonly date: IsoDate;
  readonly hours?: Decimal;
  readonly laborCents?: CentsLike;
  readonly materialCents?: CentsLike;
  readonly otherCents?: CentsLike;
  readonly sharedCents?: CentsLike;
}

export interface ProgramMonthFiguresInput {
  readonly month: IsoMonth;
  readonly lines: readonly ProgramLine[];
  readonly fees: readonly FeeLine[];
  readonly jobCosts: readonly JobCostLine[];
}

/** One row of the By variant table, or the "Not tied to a variant" row (`variantId` null). */
export interface ProgramVariantFigures {
  readonly variantId: string | null;
  readonly units: string;
  readonly scrap: string;
  readonly hours: string;
  /** Work revenue of the build lines. Fees are never in a variant row. */
  readonly revenueCents: Cents;
  readonly laborCents: Cents;
  readonly materialCents: Cents;
  readonly otherCents: Cents;
  readonly sharedCents: Cents;
  readonly costCents: Cents;
  readonly profitCents: Cents;
  readonly marginBp: number | null;
  readonly profitPerUnitCents: Cents | null;
  /** This row's share of all program revenue (work plus fees), in basis points. */
  readonly revenueShareBp: number | null;
}

export interface ProgramTotals {
  readonly units: string;
  readonly scrap: string;
  readonly hours: string;
  readonly workRevenueCents: Cents;
  readonly feeCents: Cents;
  /** Work plus fees. */
  readonly revenueCents: Cents;
  readonly laborCents: Cents;
  readonly materialCents: Cents;
  readonly otherCents: Cents;
  readonly sharedCents: Cents;
  readonly costCents: Cents;
  readonly profitCents: Cents;
  readonly marginBp: number | null;
  /** Good units per labor hour, 3 places. Null with no hours. */
  readonly unitsPerHour: string | null;
  readonly revenuePerUnitCents: Cents | null;
  readonly costPerUnitCents: Cents | null;
  readonly profitPerUnitCents: Cents | null;
  /** Days of the month with good units above zero. */
  readonly daysWithUnits: number;
}

/** One day of the month that has a line, a fee or a job cost (the Days tab). */
export interface ProgramDayFigures {
  readonly date: IsoDate;
  readonly units: string;
  readonly scrap: string;
  /** Build hours plus program job hours. */
  readonly hours: string;
  readonly workRevenueCents: Cents;
  readonly feeCents: Cents;
  readonly revenueCents: Cents;
  readonly costCents: Cents;
  readonly profitCents: Cents;
  readonly unitsPerHour: string | null;
  /** Good units and no hours that day ("Add hours"). */
  readonly missingHours: boolean;
}

export interface ProgramMonth {
  readonly month: IsoMonth;
  readonly totals: ProgramTotals;
  /** Variant rows, most revenue first. */
  readonly byVariant: readonly ProgramVariantFigures[];
  /** Job cost on days with no units, plus build lines with no variant. */
  readonly notTiedToVariant: ProgramVariantFigures;
  readonly fees: { readonly totalCents: Cents; readonly byKind: readonly { readonly kind: string; readonly cents: Cents }[] };
  /** Days with any activity, oldest first. */
  readonly days: readonly ProgramDayFigures[];
}

interface Bucket {
  units: bigint;
  scrap: bigint;
  hours: bigint;
  revenue: bigint;
  labor: bigint;
  material: bigint;
  other: bigint;
  shared: bigint;
}

const emptyBucket = (): Bucket => ({ units: ZERO, scrap: ZERO, hours: ZERO, revenue: ZERO, labor: ZERO, material: ZERO, other: ZERO, shared: ZERO });

const cents = (value: CentsLike | null | undefined): Cents => (value === null || value === undefined ? ZERO : toCents(value));
const qty = (value: Decimal | null | undefined): bigint => (value === null || value === undefined || value === '' ? ZERO : quantityToScaled(value));
const hrs = (value: Decimal | null | undefined): bigint => (value === null || value === undefined || value === '' ? ZERO : hoursToScaled(value));
const costOf = (bucket: Bucket): Cents => bucket.labor + bucket.material + bucket.other + bucket.shared;

/** Money divided by thousandths of a unit, as whole cents a unit. Null with no units. */
function perUnit(value: Cents, units1000: bigint): Cents | null {
  return units1000 > ZERO ? divRound(value * THOUSAND, units1000) : null;
}

/** Good units per hour, 3 places. Null with no hours. */
export function unitsPerHourText(units1000: bigint, hours100: bigint): string | null {
  return hours100 > ZERO ? fromScaled(divRound(units1000 * HUNDRED, hours100), 3) : null;
}

function inMonth(month: IsoMonth, date: IsoDate, what: string): void {
  if (!isRealDate(date) || monthOf(date) !== month) throw new RangeError(`${what} dated ${String(date)} is not in ${month}.`);
}

function variantRow(variantId: string | null, bucket: Bucket, totalRevenue: Cents): ProgramVariantFigures {
  const costCents = costOf(bucket);
  const profitCents = bucket.revenue - costCents;
  return {
    variantId,
    units: fromScaled(bucket.units, 3),
    scrap: fromScaled(bucket.scrap, 3),
    hours: fromScaled(bucket.hours, 2),
    revenueCents: bucket.revenue,
    laborCents: bucket.labor,
    materialCents: bucket.material,
    otherCents: bucket.other,
    sharedCents: bucket.shared,
    costCents,
    profitCents,
    marginBp: marginBp(profitCents, bucket.revenue),
    profitPerUnitCents: perUnit(profitCents, bucket.units),
    revenueShareBp: ratioBp(bucket.revenue, totalRevenue),
  };
}

/** Sort key order for a day's split: variant ids in order, the no variant lines last, so ties land the same way every time. */
function byKey(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

/**
 * One program month (3.1). Revenue is the build lines plus the fees. Cost is the build lines' own
 * cost plus every program job cost. Job cost is split per day over that day's variants by their
 * good units (3.2), with `allocate` per bucket (hours, labor, material, other, shared), so every
 * column of `byVariant` plus `notTiedToVariant` adds up to the totals to the cent. A day with job
 * cost and no units keeps that cost in `notTiedToVariant`.
 *
 * Throws a RangeError when `month` is not a real month or a row is dated outside it.
 */
export function programMonthFigures(input: ProgramMonthFiguresInput): ProgramMonth {
  const { month } = input;
  if (!isRealMonth(month)) throw new RangeError(`Not a YYYY-MM month: "${String(month)}"`);

  const rows = new Map<string | null, Bucket>();
  const row = (variantId: string | null): Bucket => {
    let found = rows.get(variantId);
    if (!found) {
      found = emptyBucket();
      rows.set(variantId, found);
    }
    return found;
  };
  const days = new Map<IsoDate, Bucket & { fees: bigint }>();
  const day = (date: IsoDate): Bucket & { fees: bigint } => {
    let found = days.get(date);
    if (!found) {
      found = { ...emptyBucket(), fees: ZERO };
      days.set(date, found);
    }
    return found;
  };
  /** Good units per day per variant: the split weights. */
  const weights = new Map<IsoDate, Map<string | null, bigint>>();

  for (const line of input.lines) {
    inMonth(month, line.date, 'A build line');
    const units = qty(line.units);
    const add = (bucket: Bucket): void => {
      bucket.units += units;
      bucket.scrap += qty(line.scrap);
      bucket.hours += hrs(line.hours);
      bucket.revenue += cents(line.revenueCents);
      bucket.labor += cents(line.laborCents);
      bucket.material += cents(line.materialCents);
      bucket.other += cents(line.otherCents);
      bucket.shared += cents(line.sharedCents);
    };
    add(row(line.variantId));
    add(day(line.date));
    const dayWeights = weights.get(line.date) ?? new Map<string | null, bigint>();
    dayWeights.set(line.variantId, (dayWeights.get(line.variantId) ?? ZERO) + units);
    weights.set(line.date, dayWeights);
  }

  // Job cost, summed per day first so each day is split once.
  const jobDays = new Map<IsoDate, Bucket>();
  for (const cost of input.jobCosts) {
    inMonth(month, cost.date, 'A job cost');
    const bucket = jobDays.get(cost.date) ?? emptyBucket();
    bucket.hours += hrs(cost.hours);
    bucket.labor += cents(cost.laborCents);
    bucket.material += cents(cost.materialCents);
    bucket.other += cents(cost.otherCents);
    bucket.shared += cents(cost.sharedCents);
    jobDays.set(cost.date, bucket);
  }
  for (const [date, cost] of [...jobDays.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const target = day(date);
    target.hours += cost.hours;
    target.labor += cost.labor;
    target.material += cost.material;
    target.other += cost.other;
    target.shared += cost.shared;
    const split = [...(weights.get(date)?.entries() ?? [])].filter(([, units]) => units > ZERO).sort(([a], [b]) => byKey(a, b));
    if (split.length === 0) {
      const notTied = row(null);
      notTied.hours += cost.hours;
      notTied.labor += cost.labor;
      notTied.material += cost.material;
      notTied.other += cost.other;
      notTied.shared += cost.shared;
      continue;
    }
    const w = split.map(([, units]) => units);
    const parts = {
      hours: allocate(cost.hours, w),
      labor: allocate(cost.labor, w),
      material: allocate(cost.material, w),
      other: allocate(cost.other, w),
      shared: allocate(cost.shared, w),
    };
    split.forEach(([variantId], index) => {
      const bucket = row(variantId);
      bucket.hours += parts.hours[index] as bigint;
      bucket.labor += parts.labor[index] as bigint;
      bucket.material += parts.material[index] as bigint;
      bucket.other += parts.other[index] as bigint;
      bucket.shared += parts.shared[index] as bigint;
    });
  }

  let feeTotal = ZERO;
  const feeKinds = new Map<string, bigint>();
  for (const fee of input.fees) {
    inMonth(month, fee.date, 'A fee');
    const amount = cents(fee.amountCents);
    feeTotal += amount;
    feeKinds.set(fee.kind, (feeKinds.get(fee.kind) ?? ZERO) + amount);
    day(fee.date).fees += amount;
  }

  const total = emptyBucket();
  for (const bucket of rows.values()) {
    total.units += bucket.units;
    total.scrap += bucket.scrap;
    total.hours += bucket.hours;
    total.revenue += bucket.revenue;
    total.labor += bucket.labor;
    total.material += bucket.material;
    total.other += bucket.other;
    total.shared += bucket.shared;
  }
  const revenueCents = total.revenue + feeTotal;
  const costCents = costOf(total);
  const profitCents = revenueCents - costCents;

  const byVariant = [...rows.entries()]
    .filter(([variantId]) => variantId !== null)
    .map(([variantId, bucket]) => variantRow(variantId, bucket, revenueCents))
    .sort((a, b) => (a.revenueCents === b.revenueCents ? byKey(a.variantId, b.variantId) : a.revenueCents > b.revenueCents ? -1 : 1));

  const dayRows: ProgramDayFigures[] = [...days.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, bucket]) => {
      const dayRevenue = bucket.revenue + bucket.fees;
      const dayCost = costOf(bucket);
      return {
        date,
        units: fromScaled(bucket.units, 3),
        scrap: fromScaled(bucket.scrap, 3),
        hours: fromScaled(bucket.hours, 2),
        workRevenueCents: bucket.revenue,
        feeCents: bucket.fees,
        revenueCents: dayRevenue,
        costCents: dayCost,
        profitCents: dayRevenue - dayCost,
        unitsPerHour: unitsPerHourText(bucket.units, bucket.hours),
        missingHours: bucket.units > ZERO && bucket.hours <= ZERO,
      };
    });

  return {
    month,
    totals: {
      units: fromScaled(total.units, 3),
      scrap: fromScaled(total.scrap, 3),
      hours: fromScaled(total.hours, 2),
      workRevenueCents: total.revenue,
      feeCents: feeTotal,
      revenueCents,
      laborCents: total.labor,
      materialCents: total.material,
      otherCents: total.other,
      sharedCents: total.shared,
      costCents,
      profitCents,
      marginBp: marginBp(profitCents, revenueCents),
      unitsPerHour: unitsPerHourText(total.units, total.hours),
      revenuePerUnitCents: perUnit(revenueCents, total.units),
      costPerUnitCents: perUnit(costCents, total.units),
      profitPerUnitCents: perUnit(profitCents, total.units),
      daysWithUnits: dayRows.filter((row) => quantityToScaled(row.units) > ZERO).length,
    },
    byVariant,
    notTiedToVariant: variantRow(null, rows.get(null) ?? emptyBucket(), revenueCents),
    fees: { totalCents: feeTotal, byKind: [...feeKinds.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([kind, value]) => ({ kind, cents: value })) },
    days: dayRows,
  };
}

/* 3.3: plan for the month, read from Projects */

/** What the plan reads of `loadProgramFacts` (`@kitstak/db/programs`). */
export interface ProgramPlanFacts {
  readonly calendar: ProgramCalendar;
}

/** What the plan reads of `loadProgramMonthInputs` (`@kitstak/db/programs`): the month inputs of `monthCharges` without `asOf`. */
export interface ProgramPlanMonthInputs {
  readonly programId: string;
  readonly month: IsoMonth;
  readonly output: readonly OutputRow[];
  readonly finished: readonly FinishedBuild[];
  readonly time: readonly TimeDay[];
  readonly oneTime: readonly OneTimeCharge[];
}

/**
 * One `pm.builds` row of the month, as Projects reads it (`stats.ts` planned rows): a live build
 * whose status is not cancelled, with `build_date` in the month.
 */
export interface ProgramPlanBuild {
  /** `task_id`. */
  readonly id: string;
  /** `build_date`. */
  readonly date: IsoDate;
  /** `planned_qty`, 3 places. */
  readonly planned: string;
  /** `built_qty`, 3 places. */
  readonly built: string;
  readonly variantId: string | null;
  /** `rate_override`, or null. */
  readonly rate: string | null;
}

/**
 * One day of the trailing read Projects makes (`stats.ts` trailing rows): output of live builds
 * plus `per_order` and `per_hour` ledger rows, summed per day, from 45 days before `asOf` up to
 * the day before `asOf`.
 */
export interface ProgramTrailingDay {
  readonly date: IsoDate;
  readonly units: string;
  readonly cents: CentsLike;
}

export interface ProgramMonthPlanInput {
  readonly facts: ProgramPlanFacts;
  /** `loadPublishedVersions`. */
  readonly versions: readonly CardVersion[];
  readonly monthInputs: ProgramPlanMonthInputs;
  /** Today in the program time zone. A month that has not started yet is read as of its first day, as Projects does. */
  readonly asOf: IsoDate;
  readonly builds: readonly ProgramPlanBuild[];
  readonly trailing: readonly ProgramTrailingDay[];
  /** `pm.program_settings.monthly_target_cents`. */
  readonly monthlyTargetCents: CentsLike | null;
}

export interface ProgramMonthPlan {
  readonly month: IsoMonth;
  /** The day the forecast is read as of (today, or the first day of a month still ahead). */
  readonly asOf: IsoDate;
  /** Output so far in the month. */
  readonly builtUnits: string;
  /** Built so far plus what open builds dated `asOf` to month end still have to make. */
  readonly plannedUnits: string;
  /** The same per variant. A null `variantId` holds builds with no variant. */
  readonly plannedByVariant: readonly { readonly variantId: string | null; readonly units: string; readonly builtUnits: string }[];
  /** Planned qty of every build dated that day, for each day of the month (the Days tab). */
  readonly plannedByDay: readonly { readonly date: IsoDate; readonly units: string }[];
  readonly forecastCents: Cents;
  readonly forecastMethod: ForecastMethod;
  readonly targetCents: Cents | null;
  /** The monthly minimum in force, or null when the card has none. */
  readonly minimumCents: Cents | null;
  readonly projectedGapCents: Cents;
  /** Engine revenue of the month so far (work, fixed, adjustments and a posted top up). */
  readonly actualCents: Cents;
  /** The whole engine forecast, with `targetBp` counted the way Projects counts it (without the top up). */
  readonly forecast: ForecastResult;
}

/**
 * The month's plan (3.3), the same way Projects computes it in
 * `apps/projects/src/server/domain/programs/stats.ts` (`programMonthStats`): `monthCharges` as of
 * today, open builds from today to month end at today's price, the last 20 plannable trailing
 * days, the month's one time charges, and the program's monthly target. Keep the two in lockstep.
 */
export function programMonthPlan(input: ProgramMonthPlanInput): ProgramMonthPlan {
  const { monthInputs, versions } = input;
  const calendar = input.facts.calendar;
  const month = monthInputs.month;
  if (!isRealMonth(month)) throw new RangeError(`Not a YYYY-MM month: "${String(month)}"`);
  if (!isRealDate(input.asOf)) throw new RangeError(`Not a YYYY-MM-DD date: "${String(input.asOf)}"`);
  const from = firstDayOfMonth(month);
  const to = lastDayOfMonth(month);
  const asOf = input.asOf < from ? from : input.asOf;
  const result = monthCharges({
    programId: monthInputs.programId,
    month,
    asOf,
    calendar,
    versions,
    output: monthInputs.output,
    finished: monthInputs.finished,
    time: monthInputs.time,
    oneTime: monthInputs.oneTime,
  });

  // Projects reads builds with build_date in the month; rows outside it are left out the same way.
  const builds = input.builds.filter((build) => build.date >= from && build.date <= to);
  // Open builds from today to month end, at today's price (3.8).
  const planned = builds
    .filter((build) => build.date >= asOf)
    .map((build) => {
      const remainingScaled = quantityToScaled(build.planned) - quantityToScaled(build.built);
      const remaining = remainingScaled > ZERO ? remainingScaled : ZERO;
      let unitPrice = '0.0000';
      try {
        unitPrice = resolveUnitPrice({ workDate: build.date, variantId: build.variantId, buildOverride: build.rate, versions }).unitPrice;
      } catch {
        unitPrice = '0.0000';
      }
      const order = remaining > ZERO ? resolveOrderCharge(versions, build.variantId, build.date) : null;
      return { buildId: build.id, variantId: build.variantId, date: build.date, remainingQty: fromScaled(remaining, 3), unitPrice, orderCents: order ? order.amountCents : null };
    })
    .filter((build) => quantityToScaled(build.remainingQty) > ZERO);
  const trailingFrom = addDays(asOf, -45);
  const trailingDaily = input.trailing
    .filter((day) => day.date >= trailingFrom && day.date < asOf)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .filter((day) => isPlannableDay(calendar, day.date))
    .slice(-20)
    .map((day) => ({ date: day.date, workCents: toCents(day.cents), units: day.units }));
  const targetCents = input.monthlyTargetCents === null || input.monthlyTargetCents === undefined ? null : toCents(input.monthlyTargetCents);
  const raw = forecastMonth({
    month,
    asOf,
    calendar,
    versions,
    result,
    trailingDaily,
    planned: planned.map(({ buildId, date, remainingQty, unitPrice, orderCents }) => ({ buildId, date, remainingQty, unitPrice, orderCents })),
    oneTime: monthInputs.oneTime,
    targetCents,
  });
  // Percent of target counts work and fixed charges only, never the minimum top up (as Projects does).
  const forecast: ForecastResult =
    raw.targetBp !== null && targetCents !== null && targetCents > ZERO && raw.projectedGapCents > ZERO ? { ...raw, targetBp: ratioBp(raw.forecastCents - raw.projectedGapCents, targetCents) } : raw;

  const built = new Map<string | null, bigint>();
  for (const row of monthInputs.output) {
    if (monthOf(row.workDate) !== month) continue;
    built.set(row.variantId, (built.get(row.variantId) ?? ZERO) + quantityToScaled(row.qty));
  }
  const open = new Map<string | null, bigint>();
  for (const build of planned) open.set(build.variantId, (open.get(build.variantId) ?? ZERO) + quantityToScaled(build.remainingQty));
  const variantIds = [...new Set([...built.keys(), ...open.keys()])].sort(byKey);
  const plannedByVariant = variantIds.map((variantId) => ({
    variantId,
    units: fromScaled((built.get(variantId) ?? ZERO) + (open.get(variantId) ?? ZERO), 3),
    builtUnits: fromScaled(built.get(variantId) ?? ZERO, 3),
  }));
  let builtTotal = ZERO;
  for (const value of built.values()) builtTotal += value;
  let openTotal = ZERO;
  for (const value of open.values()) openTotal += value;

  const byDay = new Map<IsoDate, bigint>();
  for (const build of builds) byDay.set(build.date, (byDay.get(build.date) ?? ZERO) + quantityToScaled(build.planned));

  return {
    month,
    asOf,
    builtUnits: fromScaled(builtTotal, 3),
    plannedUnits: fromScaled(builtTotal + openTotal, 3),
    plannedByVariant,
    plannedByDay: eachDay(from, to).map((date) => ({ date, units: fromScaled(byDay.get(date) ?? ZERO, 3) })),
    forecastCents: forecast.forecastCents,
    forecastMethod: forecast.method,
    targetCents,
    minimumCents: result.minimum.status === 'none' ? null : result.minimum.minimumCents,
    projectedGapCents: forecast.projectedGapCents,
    actualCents: forecast.actualCents,
    forecast,
  };
}

/* 3.4: cost forecast and margin forecast */

/** With fewer work days with units than this in the month, cost per unit comes from recent days. */
export const COST_FORECAST_MIN_DAYS = 3;
/** How many recent work days the early month cost per unit uses. */
export const COST_FORECAST_RECENT_DAYS = 20;

/** One work day's units and cost (`ProgramDayFigures` has this shape). */
export interface ProgramCostDay {
  readonly date: IsoDate;
  readonly units: Decimal;
  readonly costCents: CentsLike;
}

export interface ProgramCostForecastInput {
  /** This month so far. */
  readonly figures: { readonly totals: Pick<ProgramTotals, 'units' | 'costCents'>; readonly days: readonly ProgramCostDay[] };
  /** `ProgramMonthPlan.plannedUnits`. */
  readonly plannedUnits: Decimal;
  /** `ProgramMonthPlan.forecastCents`. */
  readonly forecastRevenueCents: CentsLike;
  /**
   * Work days before this month, newest last or in any order: at least the last 20 that had units
   * or cost (`programMonthFigures(...).days` of the months before). Only read when this month has
   * fewer than 3 work days with units.
   */
  readonly priorDays: readonly ProgramCostDay[];
}

export type CostForecastBasis = 'month' | 'recent_days';

export interface ProgramCostForecast {
  /** `month`: this month's cost per unit. `recent_days`: the last 20 work days (fewer than 3 work days this month). */
  readonly basis: CostForecastBasis;
  /** Work days the cost per unit was taken from. */
  readonly daysUsed: number;
  readonly costSoFarCents: Cents;
  readonly unitsSoFar: string;
  /** Cost per good unit of the basis days, rounded to a cent for display. Null with no units. */
  readonly costPerUnitCents: Cents | null;
  /** Planned units still to make, never below 0. */
  readonly remainingUnits: string;
  /** Null when there is no cost yet, or no units to price the units still to make. */
  readonly forecastCostCents: Cents | null;
  readonly forecastRevenueCents: Cents;
  readonly forecastProfitCents: Cents | null;
  /** Null when there is no cost yet: the screen says "Not enough days yet." */
  readonly forecastMarginBp: number | null;
}

/**
 * Cost to the end of the month (3.4). Cost per unit is cost over good units of this month, or of
 * the last 20 work days when the month has fewer than 3 work days with units. Forecast cost is
 * cost so far plus that rate times the planned units still to make, rounded once (the exact rate,
 * not the rounded cent, so the forecast does not drift on large months). Forecast margin is
 * forecast revenue less forecast cost over forecast revenue.
 */
export function programCostForecast(input: ProgramCostForecastInput): ProgramCostForecast {
  const costSoFar = toCents(input.figures.totals.costCents);
  const unitsSoFar = qty(input.figures.totals.units);
  const planned = qty(input.plannedUnits);
  const remaining = planned > unitsSoFar ? planned - unitsSoFar : ZERO;
  const revenue = toCents(input.forecastRevenueCents);

  const monthDays = input.figures.days.filter((day) => qty(day.units) > ZERO || cents(day.costCents) !== ZERO);
  const monthWorkDays = monthDays.filter((day) => qty(day.units) > ZERO).length;
  const basis: CostForecastBasis = monthWorkDays < COST_FORECAST_MIN_DAYS ? 'recent_days' : 'month';
  let basisCost = costSoFar;
  let basisUnits = unitsSoFar;
  let daysUsed = monthWorkDays;
  if (basis === 'recent_days') {
    const seen = new Set(monthDays.map((day) => day.date));
    const window = [...monthDays, ...input.priorDays.filter((day) => !seen.has(day.date) && (qty(day.units) > ZERO || cents(day.costCents) !== ZERO))]
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .slice(-COST_FORECAST_RECENT_DAYS);
    basisCost = ZERO;
    basisUnits = ZERO;
    for (const day of window) {
      basisCost += cents(day.costCents);
      basisUnits += qty(day.units);
    }
    daysUsed = window.length;
  }
  const costPerUnitCents = perUnit(basisCost, basisUnits);
  const base = {
    basis,
    daysUsed,
    costSoFarCents: costSoFar,
    unitsSoFar: fromScaled(unitsSoFar, 3),
    costPerUnitCents,
    remainingUnits: fromScaled(remaining, 3),
    forecastRevenueCents: revenue,
  };
  const noForecast = { ...base, forecastCostCents: null, forecastProfitCents: null, forecastMarginBp: null };
  if (costSoFar === ZERO) return noForecast;
  if (remaining > ZERO && basisUnits <= ZERO) return noForecast;
  const forecastCostCents = remaining > ZERO ? costSoFar + divRound(basisCost * remaining, basisUnits) : costSoFar;
  const forecastProfitCents = revenue - forecastCostCents;
  return { ...base, forecastCostCents, forecastProfitCents, forecastMarginBp: marginBp(forecastProfitCents, revenue) };
}

/* 3.5: target margin */

export interface ProgramTargetMargin {
  readonly targetMarginBp: number;
  /** `client`: set on the customer ("Target 30% for this customer"). `org`: the org default. */
  readonly source: 'client' | 'org';
}

/**
 * A program's target margin (3.5): the Pulse client's `target_margin_bp`, else the org default
 * (`settings.default_target_margin_bp`, 30% when unset). A target typed on the program job or its
 * job type is never read, so every program of a customer is judged the same way.
 */
export function programTargetMargin(input: { readonly clientTargetMarginBp?: number | null; readonly orgDefaultBp?: number | null }): ProgramTargetMargin {
  const client = input.clientTargetMarginBp ?? null;
  return { targetMarginBp: targetMarginBp({ client, orgDefault: input.orgDefaultBp ?? null }), source: client === null ? 'org' : 'client' };
}
