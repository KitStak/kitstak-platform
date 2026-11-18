/**
 * Real cost of an hour (docs/pulse/SPEC.md 4.3): the wage, plus payroll taxes and benefits, plus
 * overhead per hour. Pure functions over whole cents and basis points.
 */
import { type Cents, type CentsLike, type Decimal, ZERO, divRound, hoursToScaled, pow10, toCents, toScaled } from '../money';
import type { IsoDate } from './types';

const BP = BigInt(10000);
const HUNDRED = BigInt(100);

/** One dated rate row of a labor class, as typed by a person. */
export interface LaborRateInput {
  /** Hourly wage in cents. For a temp agency class this is the agency bill rate. */
  readonly wageCents: CentsLike;
  /** Payroll taxes and workers comp, in basis points of the wage. */
  readonly payrollTaxBp: number;
  /** Benefits and paid time off, in basis points of the wage. */
  readonly benefitsBp: number;
  /** Any other burden, in basis points of the wage. */
  readonly otherBurdenBp: number;
  /** Overhead per labor hour, in cents. */
  readonly overheadPerHourCents: CentsLike;
  /** Overtime multiplier, for example 1.5. */
  readonly overtimeMultiplier: Decimal;
}

/** The stamped answer for one rate row. */
export interface LoadedRate {
  /** Where the rate came from: a labor class row, or the org default rate. */
  readonly kind: 'class' | 'default';
  readonly wageCents: Cents;
  /** Taxes plus benefits plus other, in basis points. */
  readonly burdenBp: number;
  /** Real cost of a regular hour. */
  readonly loadedRateCents: Cents;
  /** Real cost of an overtime hour. */
  readonly overtimeRateCents: Cents;
  /** Wage plus burden with no overhead: the cost of paid time that is not on any job. */
  readonly payRateCents: Cents;
  readonly overheadPerHourCents: Cents;
  /** Overtime multiplier x 100. */
  readonly mult100: bigint;
}

function assertBp(name: string, value: number): bigint {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`${name} must be a whole number of basis points, 0 or more`);
  return BigInt(value);
}

/**
 * Builds the loaded, overtime and pay rates for one rate row.
 * Payroll taxes grow with overtime pay. Benefits and overhead do not.
 *
 * Packer example: wage $16.00, taxes 9%, benefits 12%, overhead $2.40, overtime 1.50 gives
 * loaded $21.76, overtime $30.48 and pay rate $19.36.
 */
export function loadedRate(input: LaborRateInput): LoadedRate {
  const wage = toCents(input.wageCents);
  const overhead = toCents(input.overheadPerHourCents);
  if (wage < ZERO) throw new RangeError('The wage cannot be below zero');
  if (overhead < ZERO) throw new RangeError('Overhead per hour cannot be below zero');
  const tax = assertBp('payrollTaxBp', input.payrollTaxBp);
  const benefits = assertBp('benefitsBp', input.benefitsBp);
  const other = assertBp('otherBurdenBp', input.otherBurdenBp);
  const mult100 = toScaled(input.overtimeMultiplier, 2);
  if (mult100 < HUNDRED) throw new RangeError('The overtime multiplier must be 1 or more');
  const burden = tax + benefits + other;
  const payRate = divRound(wage * (BP + burden), BP);
  const overtime = divRound(wage * mult100 * (BP + tax), BP * HUNDRED) + divRound(wage * (benefits + other), BP) + overhead;
  return {
    kind: 'class',
    wageCents: wage,
    burdenBp: Number(burden),
    loadedRateCents: payRate + overhead,
    overtimeRateCents: overtime,
    payRateCents: payRate,
    overheadPerHourCents: overhead,
    mult100,
  };
}

/**
 * The org default rate, used when an entry has no rate row at all. The overtime rate is the
 * default rate times the default multiplier, the overhead part is 0 and gross pay equals cost.
 */
export function defaultRate(defaultLoadedRateCents: CentsLike, overtimeMultiplier: Decimal = 1.5): LoadedRate {
  const rate = toCents(defaultLoadedRateCents);
  if (rate < ZERO) throw new RangeError('The default rate cannot be below zero');
  const mult100 = toScaled(overtimeMultiplier, 2);
  if (mult100 < HUNDRED) throw new RangeError('The overtime multiplier must be 1 or more');
  return {
    kind: 'default',
    wageCents: rate,
    burdenBp: 0,
    loadedRateCents: rate,
    overtimeRateCents: divRound(rate * mult100, HUNDRED),
    payRateCents: rate,
    overheadPerHourCents: ZERO,
    mult100,
  };
}

/** A stored rate row, with what is needed to choose between rows. */
export interface RateRow {
  readonly laborClassId: string;
  /** `null` means the row is for all sites. */
  readonly siteId: string | null;
  readonly effectiveFrom: IsoDate;
}

export interface RateQuery {
  /** The entry's labor class, or `null` to use the org's default class. */
  readonly laborClassId: string | null;
  readonly siteId: string | null;
  readonly workDate: IsoDate;
}

/**
 * The rate row that applies to an entry (4.3). Candidates are rows of the class dated on or
 * before the work date, for the entry's site or for all sites. A row for the entry's site wins
 * over an all sites row; within each group the latest `effectiveFrom` wins.
 */
export function pickRateRow<T extends RateRow>(rows: readonly T[], query: { laborClassId: string; siteId: string | null; workDate: IsoDate }): T | null {
  let siteBest: T | null = null;
  let allBest: T | null = null;
  for (const row of rows) {
    if (row.laborClassId !== query.laborClassId || row.effectiveFrom > query.workDate) continue;
    if (row.siteId !== null && row.siteId === query.siteId) {
      if (!siteBest || row.effectiveFrom > siteBest.effectiveFrom) siteBest = row;
    } else if (row.siteId === null) {
      if (!allBest || row.effectiveFrom > allBest.effectiveFrom) allBest = row;
    }
  }
  return siteBest ?? allBest;
}

export interface RateDefaults {
  /** The org's default labor class, used when the entry has none. */
  readonly defaultLaborClassId?: string | null;
  /** `settings.default_loaded_rate_cents`. */
  readonly defaultLoadedRateCents?: CentsLike | null;
  /** `settings.default_overtime_multiplier`. Default 1.5. */
  readonly defaultOvertimeMultiplier?: Decimal | null;
}

export interface RateChoice<T extends RateRow> {
  /** `class`: a row of the entry's class. `default_class`: a row of the org default class. `org_default`: the default rate. `none`: nothing to use. */
  readonly source: 'class' | 'default_class' | 'org_default' | 'none';
  readonly row: T | null;
  /** The rate to stamp, or `null` when there is none. */
  readonly rate: LoadedRate | null;
  /** True when cost is 0 because no rate exists. The entry shows up in Things to fix. */
  readonly needsRate: boolean;
}

/**
 * `rateFor(classId, siteId, workDate)` from 4.3: the class row, else the default class row, else
 * the org default rate, else nothing (cost 0 and `needsRate`).
 */
export function rateFor<T extends RateRow & LaborRateInput>(rows: readonly T[], query: RateQuery, defaults: RateDefaults = {}): RateChoice<T> {
  const classId = query.laborClassId ?? defaults.defaultLaborClassId ?? null;
  if (classId !== null) {
    const row = pickRateRow(rows, { laborClassId: classId, siteId: query.siteId, workDate: query.workDate });
    if (row) return { source: query.laborClassId === null ? 'default_class' : 'class', row, rate: loadedRate(row), needsRate: false };
  }
  if (defaults.defaultLoadedRateCents !== null && defaults.defaultLoadedRateCents !== undefined) {
    return { source: 'org_default', row: null, rate: defaultRate(defaults.defaultLoadedRateCents, defaults.defaultOvertimeMultiplier ?? 1.5), needsRate: false };
  }
  return { source: 'none', row: null, rate: null, needsRate: true };
}

/** The parts of a loaded rate, for "How we got this": wage, taxes and benefits in cents, overhead. */
export interface RateBreakdown {
  readonly wageCents: Cents;
  readonly burdenCents: Cents;
  readonly burdenBp: number;
  readonly overheadPerHourCents: Cents;
  readonly loadedRateCents: Cents;
}

/** Splits a loaded rate into wage, burden and overhead. The three parts add up to the loaded rate. */
export function rateBreakdown(rate: LoadedRate): RateBreakdown {
  return {
    wageCents: rate.wageCents,
    burdenCents: rate.payRateCents - rate.wageCents,
    burdenBp: rate.burdenBp,
    overheadPerHourCents: rate.overheadPerHourCents,
    loadedRateCents: rate.loadedRateCents,
  };
}

/**
 * Overhead helper (4.3): company costs divided by direct labor hours gives a suggested overhead
 * per hour in cents. `null` when there are no direct hours.
 */
export function suggestOverheadPerHour(companyCostCents: CentsLike, directHours: Decimal): Cents | null {
  const hours = hoursToScaled(directHours);
  if (hours <= ZERO) return null;
  const cost = toCents(companyCostCents);
  return cost <= ZERO ? ZERO : divRound(cost * pow10(2), hours);
}

/** How much overhead an hourly overhead rate covers over a number of direct hours. */
export function overheadCovered(overheadPerHourCents: CentsLike, directHours: Decimal): Cents {
  return divRound(hoursToScaled(directHours) * toCents(overheadPerHourCents), pow10(2));
}
