/**
 * Rollups of month charges (docs/programs/SPEC.md 3.7): by variant, by day, over a range of
 * months, and the program headline. Pure functions over `MonthResult`; they never round again,
 * so every rollup adds back to the month total to the cent.
 */
import { eachDay, firstDayOfMonth, lastDayOfMonth } from './calendar';
import { type Cents, ZERO, divRound, fromScaled, quantityToScaled } from './money';
import type { MonthResult } from './month';
import type { IsoDate } from './types';

export interface VariantRollup {
  /** Null holds program level hours and any build without a variant. */
  readonly variantId: string | null;
  readonly units: string;
  /** Builds with output or a batch charge in the month. */
  readonly builds: number;
  readonly perUnitCents: Cents;
  readonly perOrderCents: Cents;
  readonly perHourCents: Cents;
  readonly totalCents: Cents;
  /** Per unit revenue over units, 4 decimals. Null with no units. */
  readonly avgUnitPrice: string | null;
}

export interface DayRollup {
  readonly date: IsoDate;
  readonly units: string;
  /** Per unit, per batch and per hour charges dated that day. */
  readonly workCents: Cents;
  /** Monthly fee, setup fees, adjustments and the posted top up dated that day. */
  readonly feeCents: Cents;
  /** Running total of work and fees through that day. */
  readonly cumulativeCents: Cents;
  readonly plannedUnits: string;
}

type MonthBase = Omit<MonthResult, 'byVariant' | 'byDay'>;

/**
 * Average unit price: `fromScaled(divRound(perUnitCents * 100000, units1000), 4)`. Cents times
 * 10^5 over thousandths of a unit is the price scaled by 10^4. 161000 cents over 800 units is
 * `'2.0125'`. Null when units are 0.
 */
export function avgUnitPrice(perUnitCents: Cents, units: string): string | null {
  const scaled = quantityToScaled(units);
  if (scaled === ZERO) return null;
  const negative = scaled < ZERO;
  const price = divRound(perUnitCents * BigInt(100000) * (negative ? -BigInt(1) : BigInt(1)), negative ? -scaled : scaled);
  return fromScaled(price, 4);
}

interface VariantTotals {
  units: bigint;
  builds: Set<string>;
  perUnit: bigint;
  perOrder: bigint;
  perHour: bigint;
}

/**
 * Work charges of the month by variant. Fixed lines, one time charges and the top up are left
 * out (they belong to the program). A null variant row holds program level hours.
 * `sum(totalCents)` equals `work.totalCents`.
 */
export function rollupByVariant(result: MonthBase): VariantRollup[] {
  const totals = new Map<string | null, VariantTotals>();
  const get = (variantId: string | null): VariantTotals => {
    let found = totals.get(variantId);
    if (!found) {
      found = { units: ZERO, builds: new Set(), perUnit: ZERO, perOrder: ZERO, perHour: ZERO };
      totals.set(variantId, found);
    }
    return found;
  };
  for (const charge of result.charges) {
    if (!charge.posted) continue;
    if (charge.kind === 'per_unit') {
      const row = get(charge.variantId);
      row.perUnit += charge.cents;
      row.units += quantityToScaled(charge.quantity ?? '0');
      if (charge.buildId) row.builds.add(charge.buildId);
    } else if (charge.kind === 'per_order') {
      const row = get(charge.variantId);
      row.perOrder += charge.cents;
      if (charge.buildId) row.builds.add(charge.buildId);
    }
  }
  for (const split of result.hourSplits) get(split.variantId).perHour += split.cents;

  const rows: VariantRollup[] = [...totals.entries()].map(([variantId, row]) => {
    const units = fromScaled(row.units, 3);
    return {
      variantId,
      units,
      builds: row.builds.size,
      perUnitCents: row.perUnit,
      perOrderCents: row.perOrder,
      perHourCents: row.perHour,
      totalCents: row.perUnit + row.perOrder + row.perHour,
      avgUnitPrice: avgUnitPrice(row.perUnit, units),
    };
  });
  return rows.sort((a, b) => {
    if (a.variantId === null || b.variantId === null) return a.variantId === b.variantId ? 0 : a.variantId === null ? 1 : -1;
    if (a.totalCents !== b.totalCents) return a.totalCents > b.totalCents ? -1 : 1;
    return a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0;
  });
}

/**
 * Every calendar day of the month through month end, with units, work charges, fees, a running
 * total and planned units. Only posted charges count, so once the month is over
 * `sum(workCents + feeCents)` equals `totalCents`.
 */
export function rollupByDay(result: MonthBase, planned: readonly { readonly date: IsoDate; readonly qty: string }[]): DayRollup[] {
  const units = new Map<IsoDate, bigint>();
  const work = new Map<IsoDate, bigint>();
  const fees = new Map<IsoDate, bigint>();
  const plannedUnits = new Map<IsoDate, bigint>();
  const add = (map: Map<IsoDate, bigint>, date: IsoDate, value: bigint): void => {
    map.set(date, (map.get(date) ?? ZERO) + value);
  };
  for (const charge of result.charges) {
    if (!charge.posted) continue;
    if (charge.kind === 'per_unit') {
      add(units, charge.date, quantityToScaled(charge.quantity ?? '0'));
      add(work, charge.date, charge.cents);
    } else if (charge.kind === 'per_order' || charge.kind === 'per_hour') add(work, charge.date, charge.cents);
    else add(fees, charge.date, charge.cents);
  }
  for (const row of planned) add(plannedUnits, row.date, quantityToScaled(row.qty));
  let running = ZERO;
  return eachDay(firstDayOfMonth(result.month), lastDayOfMonth(result.month)).map((date) => {
    const workCents = work.get(date) ?? ZERO;
    const feeCents = fees.get(date) ?? ZERO;
    running += workCents + feeCents;
    return {
      date,
      units: fromScaled(units.get(date) ?? ZERO, 3),
      workCents,
      feeCents,
      cumulativeCents: running,
      plannedUnits: fromScaled(plannedUnits.get(date) ?? ZERO, 3),
    };
  });
}

export interface RangeRollup {
  readonly units: string;
  readonly totalCents: Cents;
  readonly workCents: Cents;
  readonly fixedCents: Cents;
  readonly adjustmentCents: Cents;
  readonly topUpCents: Cents;
}

/**
 * Sums of several months (a quarter, a year, a custom range of whole months). A range is keyed by
 * month, so the same month passed twice is a RangeError ("Duplicate month 2026-11"), never revenue
 * counted twice (M2).
 */
export function rangeRollup(months: readonly MonthResult[]): RangeRollup {
  const seen = new Set<string>();
  for (const month of months) {
    if (seen.has(month.month)) throw new RangeError(`Duplicate month ${month.month}`);
    seen.add(month.month);
  }
  let units = ZERO;
  let totalCents = ZERO;
  let workCents = ZERO;
  let fixedCents = ZERO;
  let adjustmentCents = ZERO;
  let topUpCents = ZERO;
  for (const month of months) {
    units += quantityToScaled(month.units);
    totalCents += month.totalCents;
    workCents += month.work.totalCents;
    fixedCents += month.fixed.totalCents;
    adjustmentCents += month.adjustments.totalCents;
    topUpCents += month.minimum.topUpCents;
  }
  return { units: fromScaled(units, 3), totalCents, workCents, fixedCents, adjustmentCents, topUpCents };
}

/** The program headline: revenue and units of the given months, every build day counted once (M2). A month passed twice is a RangeError (`rangeRollup`). */
export function programHeadline(input: { readonly months: readonly MonthResult[] }): { revenueCents: Cents; units: string } {
  const range = rangeRollup(input.months);
  return { revenueCents: range.totalCents, units: range.units };
}
