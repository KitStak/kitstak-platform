/**
 * Time not on a job, paid hours and the payroll check (docs/pulse/SPEC.md 4.5). Pure functions.
 * The spread uses the largest remainder method, so the shares always add up to the pool.
 */
import { type Cents, type CentsLike, type Decimal, ZERO, allocate, divRound, hoursToScaled, maxCents, mulBp, scaledToNumber, sumBy, toCents } from '../money';
import type { IsoDate, SharedCostRule } from './types';

/** A row that takes a share: a production or service entry with hours above zero. */
export interface SharedTaker {
  readonly id: string;
  readonly workDate: IsoDate;
  readonly hours: Decimal;
  /** Needed only for the `percent_of_labor` rule. */
  readonly laborCostCents?: CentsLike;
}

export interface SharedShare {
  readonly id: string;
  readonly sharedCents: Cents;
}

export interface SharedSpreadResult {
  /** One share per taker, in the order the takers were given. */
  readonly shares: SharedShare[];
  /** The pool that was spread (0 for the rules with no pool). */
  readonly poolCents: Cents;
  /** Pool cost that no row carried, for example a pool with cost and no takers. */
  readonly unallocatedCents: Cents;
}

/**
 * Spreads one pool over its takers by labor hours (weight is hours x 100). Left over cents go to
 * the largest remainders; ties go to the earlier work date, then the smaller id.
 *
 * Example: $100.00 over 96.00, 40.00 and 24.50 hours gives $59.81, $24.92 and $15.27.
 */
export function allocateShared(poolCents: CentsLike, takers: readonly SharedTaker[]): SharedSpreadResult {
  const pool = toCents(poolCents);
  const ordered = takers
    .map((taker, index) => ({ taker, index, weight: hoursToScaled(taker.hours) }))
    .filter((entry) => entry.weight > ZERO)
    .sort((a, b) => (a.taker.workDate === b.taker.workDate ? (a.taker.id < b.taker.id ? -1 : a.taker.id > b.taker.id ? 1 : 0) : a.taker.workDate < b.taker.workDate ? -1 : 1));
  const parts = allocate(pool, ordered.map((entry) => entry.weight));
  const byIndex = new Map<number, Cents>();
  ordered.forEach((entry, position) => byIndex.set(entry.index, parts[position] as Cents));
  const shares = takers.map((taker, index) => ({ id: taker.id, sharedCents: byIndex.get(index) ?? ZERO }));
  const handed = sumBy(shares, (share) => share.sharedCents);
  return { shares, poolCents: pool, unallocatedCents: pool - handed };
}

export interface SharedPoolInput {
  readonly rule: SharedCostRule;
  /** Cost of the pool's indirect entries. */
  readonly indirectCents: CentsLike;
  /** Cost of paid time that nobody logged, for the pool. Only the `full` rule spreads it. */
  readonly missingCents?: CentsLike;
  /** `settings.shared_pct_bp`, for the `percent_of_labor` rule. */
  readonly sharedPctBp?: number;
  readonly takers: readonly SharedTaker[];
}

/**
 * Applies the org's shared cost rule to one pool (one site and one day, week or month):
 * `by_labor_hours` spreads indirect cost, `full` also spreads missing time, `percent_of_labor`
 * adds a set percent of each row's labor cost, and `none` adds nothing.
 */
export function spreadSharedCost(input: SharedPoolInput): SharedSpreadResult {
  const indirect = toCents(input.indirectCents);
  const missing = toCents(input.missingCents ?? ZERO);
  if (input.rule === 'none') {
    return { shares: input.takers.map((taker) => ({ id: taker.id, sharedCents: ZERO })), poolCents: ZERO, unallocatedCents: ZERO };
  }
  if (input.rule === 'percent_of_labor') {
    const bp = input.sharedPctBp ?? 0;
    const shares = input.takers.map((taker) => ({ id: taker.id, sharedCents: hoursToScaled(taker.hours) > ZERO ? mulBp(taker.laborCostCents ?? ZERO, bp) : ZERO }));
    return { shares, poolCents: ZERO, unallocatedCents: ZERO };
  }
  return allocateShared(input.rule === 'full' ? indirect + missing : indirect, input.takers);
}

export interface MissingTimeInput {
  /** Hours payroll paid for, for one site and day. */
  readonly paidHours: Decimal;
  /** Hours logged on jobs and services. */
  readonly directHours: Decimal;
  /** Hours logged as time not on a job. */
  readonly indirectHours: Decimal;
  /** Real gross pay of the day, when every paid row has it. */
  readonly paidCents?: CentsLike | null;
  /** Paid hours weighted average pay rate, used when `paidCents` is not known. */
  readonly avgPayRateCents?: CentsLike | null;
}

export interface MissingTime {
  readonly missingHours: number;
  readonly missingCents: Cents;
  /** True when more hours were logged than paid. The day goes to Things to fix. */
  readonly overLogged: boolean;
}

/** Paid time that is on no job and no reason, for one site and day. */
export function missingTime(input: MissingTimeInput): MissingTime {
  const paid = hoursToScaled(input.paidHours);
  const logged = hoursToScaled(input.directHours) + hoursToScaled(input.indirectHours);
  const overLogged = logged > paid;
  const missing = overLogged ? ZERO : paid - logged;
  let missingCents = ZERO;
  if (missing > ZERO) {
    if (input.paidCents !== null && input.paidCents !== undefined && paid > ZERO) missingCents = divRound(toCents(input.paidCents) * missing, paid);
    else if (input.avgPayRateCents !== null && input.avgPayRateCents !== undefined) missingCents = divRound(missing * toCents(input.avgPayRateCents), BigInt(100));
  }
  return { missingHours: scaledToNumber(missing, 2), missingCents, overLogged };
}

/** Paid hours weighted average of the pay rate over a day's paid rows. `null` with no paid hours. */
export function averagePayRate(rows: readonly { paidHours: Decimal; payRateCents: CentsLike }[]): Cents | null {
  let hours = ZERO;
  let weighted = ZERO;
  for (const row of rows) {
    const h = hoursToScaled(row.paidHours);
    if (h <= ZERO) continue;
    hours += h;
    weighted += h * toCents(row.payRateCents);
  }
  return hours > ZERO ? divRound(weighted, hours) : null;
}

/**
 * Shared gap (4.5): time not on a job that no job carried.
 * `indirect cost (+ missing cost under the full rule) - sum of shared cents`.
 */
export function sharedGap(input: { rule: SharedCostRule; indirectCents: CentsLike; missingCents?: CentsLike; sharedAppliedCents: CentsLike }): Cents {
  const pool = toCents(input.indirectCents) + (input.rule === 'full' ? toCents(input.missingCents ?? ZERO) : ZERO);
  return pool - toCents(input.sharedAppliedCents);
}

/** Payroll check: what payroll paid minus the gross pay of the hours in Pulse. */
export function payrollGap(paidCents: CentsLike, grossPayCents: CentsLike): Cents {
  return toCents(paidCents) - toCents(grossPayCents);
}

/**
 * Share of paid time spent on jobs, in basis points: direct hours over paid hours, or over
 * direct plus indirect hours when paid hours are not entered. `null` when there is nothing to divide by.
 */
export function utilizationBp(input: { directHours: Decimal; indirectHours?: Decimal | null; paidHours?: Decimal | null }): number | null {
  const direct = hoursToScaled(input.directHours);
  const paid = input.paidHours === null || input.paidHours === undefined || input.paidHours === '' ? ZERO : hoursToScaled(input.paidHours);
  const base = paid > ZERO ? paid : direct + hoursToScaled(input.indirectHours ?? 0);
  if (base <= ZERO) return null;
  return Number(divRound(direct * BigInt(10000), base));
}

/** The overhead and the dollars a percent rule would have needed: used to tune `shared_pct_bp`. */
export function sharedPercentNeeded(indirectCents: CentsLike, laborCostCents: CentsLike): number | null {
  const labor = toCents(laborCostCents);
  if (labor <= ZERO) return null;
  return Number(divRound(maxCents(toCents(indirectCents), ZERO) * BigInt(10000), labor));
}
