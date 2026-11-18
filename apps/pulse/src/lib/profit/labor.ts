/**
 * Labor cost of one entry (docs/pulse/SPEC.md 4.4). `hours` always means total labor hours:
 * people times hours each. Pure functions.
 */
import { type Cents, type Decimal, ZERO, divRound, fromScaled, hoursToScaled, pow10, scaledToNumber, toScaled } from '../money';
import type { LoadedRate } from './rates';

const HUNDRED = BigInt(100);

export interface LaborEntryInput {
  /** Total labor hours of the entry. */
  readonly hours: Decimal;
  /** Overtime hours inside `hours`. Blank means none. */
  readonly overtimeHours?: Decimal | null;
  /** The rate that applies (see `rateFor`), or `null` when no rate exists. */
  readonly rate: LoadedRate | null;
}

/** The five values stamped on every entry that has hours. */
export interface LaborStamp {
  readonly hours: number;
  readonly regularHours: number;
  readonly overtimeHours: number;
  readonly rateCents: Cents | null;
  readonly overtimeRateCents: Cents | null;
  readonly laborCostCents: Cents;
  /** The part of labor cost that is overhead. */
  readonly overheadCents: Cents;
  readonly grossPayCents: Cents;
  /** True when cost is 0 because there is no rate. */
  readonly needsRate: boolean;
}

/**
 * Total labor hours from a crew: people times hours each, to 2 places.
 * 12 people for 8 hours is 96.00 labor hours.
 */
export function laborHoursFromCrew(people: Decimal, hoursEach: Decimal): number {
  const product = toScaled(people, 2) * hoursToScaled(hoursEach);
  return scaledToNumber(divRound(product, HUNDRED), 2);
}

/**
 * Stamps labor cost, overhead and gross pay for one entry.
 *
 * Example: 96.00 hours with 4.00 overtime at the Packer rate ($21.76, overtime $30.48, wage
 * $16.00, overhead $2.40) costs $2,123.84, of which $230.40 is overhead, and pays $1,568.00.
 */
export function laborCost(input: LaborEntryInput): LaborStamp {
  const hours = hoursToScaled(input.hours);
  const overtime = input.overtimeHours === null || input.overtimeHours === undefined || input.overtimeHours === '' ? ZERO : hoursToScaled(input.overtimeHours);
  if (hours < ZERO) throw new RangeError('Labor hours cannot be below zero');
  if (overtime < ZERO) throw new RangeError('Overtime hours cannot be below zero');
  if (overtime > hours) throw new RangeError('Overtime hours cannot be more than labor hours');
  const regular = hours - overtime;
  const base = { hours: scaledToNumber(hours, 2), regularHours: scaledToNumber(regular, 2), overtimeHours: scaledToNumber(overtime, 2) };
  const rate = input.rate;
  if (!rate) {
    return { ...base, rateCents: null, overtimeRateCents: null, laborCostCents: ZERO, overheadCents: ZERO, grossPayCents: ZERO, needsRate: hours > ZERO };
  }
  const laborCostCents = divRound(regular * rate.loadedRateCents, HUNDRED) + divRound(overtime * rate.overtimeRateCents, HUNDRED);
  const overheadCents = divRound(hours * rate.overheadPerHourCents, HUNDRED);
  const grossPayCents =
    rate.kind === 'default' ? laborCostCents : divRound(regular * rate.wageCents, HUNDRED) + divRound(overtime * rate.wageCents * rate.mult100, pow10(4));
  return { ...base, rateCents: rate.loadedRateCents, overtimeRateCents: rate.overtimeRateCents, laborCostCents, overheadCents, grossPayCents, needsRate: false };
}

/** The inline question shown when typed labor hours look far from people times shift length. */
export interface CrewHoursWarning {
  readonly people: number;
  readonly shiftHours: number;
  readonly expectedHours: number;
  readonly typedHours: number;
  /** Plain words, ready to show. */
  readonly message: string;
}

function trim(value: bigint, scale: number): string {
  const fixed = fromScaled(value, scale);
  return fixed.replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * Entry check (4.4): warns when typed labor hours are more than half a crew shift away from
 * people times the usual shift length. It is a question, never a block. `null` means it looks fine.
 */
export function crewHoursCheck(input: { hours: Decimal; people: Decimal | null | undefined; shiftHours: Decimal }): CrewHoursWarning | null {
  if (input.people === null || input.people === undefined || input.people === '') return null;
  const people = toScaled(input.people, 2);
  const shift = hoursToScaled(input.shiftHours);
  const typed = hoursToScaled(input.hours);
  if (people <= ZERO || shift <= ZERO) return null;
  // expected hours x 100, kept at scale 4 for an exact comparison
  const expected4 = people * shift;
  const typed4 = typed * HUNDRED;
  const gap = typed4 > expected4 ? typed4 - expected4 : expected4 - typed4;
  if (gap * BigInt(2) <= expected4) return null;
  const expected = divRound(expected4, HUNDRED);
  const peopleText = trim(people, 2);
  const shiftText = trim(shift, 2);
  const message = `${peopleText} ${peopleText === '1' ? 'person' : 'people'} for ${shiftText} ${shiftText === '1' ? 'hour' : 'hours'} is ${trim(expected, 2)} labor hours. You typed ${trim(typed, 2)}. Is that right?`;
  return { people: scaledToNumber(people, 2), shiftHours: scaledToNumber(shift, 2), expectedHours: scaledToNumber(expected, 2), typedHours: scaledToNumber(typed, 2), message };
}
