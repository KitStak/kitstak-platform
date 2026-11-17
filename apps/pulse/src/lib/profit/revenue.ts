/**
 * Revenue (docs/pulse/SPEC.md 4.8). Earned revenue is the only profit basis: what the work done
 * is worth at the agreed price. Invoices are a second number, billed, and never change profit.
 * Pure functions.
 */
import { type Cents, type CentsLike, type Decimal, ZERO, divRound, mulHoursRate, mulQuantityPrice, quantityToScaled, toCents } from '../money';
import type { IsoDate } from './types';

/** Per unit pricing: `units good x unit price`. 3,000 units at $2.75 is $8,250.00. */
export function perUnitRevenue(unitsGood: Decimal, unitPrice: Decimal | null | undefined): Cents {
  if (unitPrice === null || unitPrice === undefined || unitPrice === '') return ZERO;
  return mulQuantityPrice(unitsGood, unitPrice);
}

/** Hourly pricing: `hours x bill rate`. */
export function hourlyRevenue(hours: Decimal, billRateCents: CentsLike | null | undefined): Cents {
  if (billRateCents === null || billRateCents === undefined) return ZERO;
  return mulHoursRate(hours, billRateCents);
}

/** A dated price row of a job (`pulse.job_prices`). */
export interface DatedRow {
  readonly effectiveFrom: IsoDate;
}

/** The price row in force on a work date: the row with the latest `effectiveFrom` on or before it. */
export function priceFor<T extends DatedRow>(rows: readonly T[], workDate: IsoDate): T | null {
  let best: T | null = null;
  for (const row of rows) {
    if (row.effectiveFrom > workDate) continue;
    if (!best || row.effectiveFrom > best.effectiveFrom) best = row;
  }
  return best;
}

/** A production entry of a fixed price job, in stamp order. */
export interface FixedEntry {
  readonly id: string;
  readonly workDate: IsoDate;
  readonly shift?: string | null;
  readonly laborClassCode?: string | null;
  readonly unitsGood: Decimal;
  /** The stamp of an entry in a closed month. It is kept as it is and counts as earned already. */
  readonly frozenStampCents?: CentsLike | null;
}

export interface FixedStamp {
  readonly id: string;
  /** Earned so far through this entry: fixed price times the share of planned units done, capped at the plan. */
  readonly targetCents: Cents;
  /** Revenue stamped on this entry. Can be negative after planned units were raised. */
  readonly stampCents: Cents;
  readonly frozen: boolean;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Sorts fixed price entries into stamp order: work date, shift, labor class code, id. */
export function sortFixedEntries<T extends FixedEntry>(entries: readonly T[]): T[] {
  return [...entries].sort(
    (a, b) => compareText(a.workDate, b.workDate) || compareText(a.shift ?? '', b.shift ?? '') || compareText(a.laborClassCode ?? '', b.laborClassCode ?? '') || compareText(a.id, b.id),
  );
}

/** Earned revenue of a fixed price job at a running unit count: `FP x min(units, planned) / planned`. 0 with no planned units. */
export function fixedTarget(fixedPriceCents: CentsLike, cumulativeUnits: Decimal, plannedUnits: Decimal): Cents {
  const planned = quantityToScaled(plannedUnits);
  if (planned <= ZERO) return ZERO;
  const done = quantityToScaled(cumulativeUnits);
  const capped = done > planned ? planned : done < ZERO ? ZERO : done;
  return divRound(toCents(fixedPriceCents) * capped, planned);
}

/**
 * Stamps fixed price revenue by progress. Each entry earns its target minus everything stamped
 * before it, so the stamps always add up to the last target. Frozen stamps (closed months) are
 * never rewritten: a later change lands in the next open entry.
 *
 * Example: fixed price $9,400.00, 2,000 planned units, entries of 500, 700 and 900 units give
 * stamps of $2,350.00, $3,290.00 and $3,760.00.
 */
export function fixedRevenueStamps(entries: readonly FixedEntry[], fixedPriceCents: CentsLike | null | undefined, plannedUnits: Decimal | null | undefined): FixedStamp[] {
  const price = fixedPriceCents === null || fixedPriceCents === undefined ? ZERO : toCents(fixedPriceCents);
  const planned = plannedUnits === null || plannedUnits === undefined || plannedUnits === '' ? ZERO : quantityToScaled(plannedUnits);
  const ordered = sortFixedEntries(entries);
  let cumulative = ZERO;
  let stamped = ZERO;
  return ordered.map((entry) => {
    cumulative += quantityToScaled(entry.unitsGood);
    const capped = cumulative > planned ? planned : cumulative < ZERO ? ZERO : cumulative;
    const targetCents = planned > ZERO ? divRound(price * capped, planned) : ZERO;
    const frozen = entry.frozenStampCents !== null && entry.frozenStampCents !== undefined;
    const stampCents = frozen ? toCents(entry.frozenStampCents as CentsLike) : targetCents - stamped;
    stamped += stampCents;
    return { id: entry.id, targetCents, stampCents, frozen };
  });
}

/**
 * True up of a completed fixed price job: the fixed price minus everything stamped. It is one
 * system revenue entry dated the completed date, so stamps plus true up equal the fixed price.
 */
export function fixedTrueUp(fixedPriceCents: CentsLike, stamps: readonly { stampCents: CentsLike }[]): Cents {
  let stamped = ZERO;
  for (const stamp of stamps) stamped += toCents(stamp.stampCents);
  return toCents(fixedPriceCents) - stamped;
}

/**
 * Amount of one service entry: a typed flat amount wins, else `quantity x unit price`.
 * `null` means "No price set yet".
 */
export function serviceAmount(input: { quantity: Decimal; unitPrice?: Decimal | null; flatAmountCents?: CentsLike | null }): Cents | null {
  if (input.flatAmountCents !== null && input.flatAmountCents !== undefined) return toCents(input.flatAmountCents);
  if (input.unitPrice === null || input.unitPrice === undefined || input.unitPrice === '') return null;
  return mulQuantityPrice(input.quantity, input.unitPrice);
}

export interface RevenueTotals {
  /** Earned revenue: base plus services plus other. */
  readonly revenueCents: Cents;
  /** Approved invoices. A memo number, never in profit. */
  readonly billedCents: Cents;
  /** Work done that is not invoiced yet. */
  readonly notBilledYetCents: Cents;
}

/** `revenue = base + service + other`, and `not billed yet = revenue - billed`. */
export function revenueTotals(input: { baseCents: CentsLike; serviceCents?: CentsLike; otherCents?: CentsLike; billedCents?: CentsLike }): RevenueTotals {
  const revenueCents = toCents(input.baseCents) + toCents(input.serviceCents ?? ZERO) + toCents(input.otherCents ?? ZERO);
  const billedCents = toCents(input.billedCents ?? ZERO);
  return { revenueCents, billedCents, notBilledYetCents: revenueCents - billedCents };
}
