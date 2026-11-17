/**
 * Breakeven and the what if quote calculator. Type the units, the target pace, the crew, the real
 * cost of an hour, material per unit and any extra services, pick a target margin, and get the
 * price per unit, the total, the margin and the breakeven. Pure functions over exact fractions:
 * prices are rounded up to 4 places so the target is always met.
 */
import {
  type Cents,
  type CentsLike,
  type Decimal,
  type Fraction,
  FRAC_ZERO,
  ZERO,
  divCeil,
  divRound,
  frac,
  fracAdd,
  fracCeil,
  fracCmp,
  fracDiv,
  fracMul,
  fracOf,
  fracRound,
  fracSub,
  fracToNumber,
  fromScaled,
  marginBp,
  mulBp,
  mulQuantityPrice,
  pow10,
  quantityToScaled,
  toCents,
  toScaled,
} from '../money';
import { DEFAULT_WORKING_DAYS, addWorkDays } from './calendar';
import type { IsoDate, PlanTotals } from './types';

const HUNDRED = BigInt(100);
const BP = BigInt(10000);
const PRICE_UNIT = pow10(4);

function blank(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

/** Rounds cents per unit up to a price with 4 places, as a decimal string like "2.7500". */
function priceUp(centsPerUnit: Fraction): string {
  // cents per unit x 100 = price x 10000
  const scaled = divCeil(centsPerUnit.n * HUNDRED, centsPerUnit.d);
  return fromScaled(scaled < ZERO ? ZERO : scaled, 4);
}

/**
 * The lowest revenue that reaches a margin: `cost / (1 - margin)`, rounded up to a cent.
 * `null` when the margin is 100% or more.
 */
export function revenueForMargin(costCents: CentsLike, targetMarginBp: number): Cents | null {
  if (!Number.isFinite(targetMarginBp) || targetMarginBp >= 10000) return null;
  const cost = toCents(costCents);
  return divCeil(cost * BP, BP - BigInt(Math.round(targetMarginBp)));
}

/** The price per unit that just covers a cost: cost over units, rounded up to 4 places. `null` with no units. */
export function breakevenPrice(costCents: CentsLike, units: Decimal): string | null {
  const quantity = quantityToScaled(units);
  if (quantity <= ZERO) return null;
  return priceUp(frac(toCents(costCents) * BigInt(1000), quantity));
}

export interface BreakevenUnitsInput {
  /** Costs that do not change with units: setup labor, tooling, freight in. */
  readonly fixedCostCents: CentsLike;
  /** Price for one unit. */
  readonly pricePerUnit: Decimal;
  /** Cost that each extra unit adds: labor, material and shared for one unit. */
  readonly variableCostPerUnit: Decimal;
}

/**
 * Units needed before a job stops losing money: `fixed cost / (price - variable cost per unit)`,
 * rounded up to a whole unit. `null` when the price does not cover the cost of one more unit.
 * 0 when there is no fixed cost to win back.
 */
export function breakevenUnits(input: BreakevenUnitsInput): number | null {
  const contribution = fracSub(fracOf(input.pricePerUnit, 4), fracOf(input.variableCostPerUnit, 4));
  if (contribution.n <= ZERO) return null;
  const fixed = toCents(input.fixedCostCents);
  if (fixed <= ZERO) return 0;
  return Number(fracCeil(fracDiv(frac(fixed, HUNDRED), contribution)));
}

/** One extra service on a quote. */
export interface QuoteService {
  readonly label?: string;
  readonly quantity: Decimal;
  /** What the client pays for one. */
  readonly unitPrice: Decimal;
  /** What one costs you. Default 0. */
  readonly costPerUnit?: Decimal | null;
}

export interface QuoteInput {
  /** Units to build. */
  readonly units: Decimal;
  /** Target pace: units one person finishes in an hour. */
  readonly standardUph: Decimal;
  /** People on the line. Used for the days needed. Default 1. */
  readonly crewSize?: Decimal | null;
  /** Hours each person works a day. Default 8. */
  readonly shiftHours?: Decimal | null;
  /** Real cost of an hour, in cents. */
  readonly laborRateCents: CentsLike;
  /** Setup hours that produce no units. Default 0. */
  readonly setupHours?: Decimal | null;
  /** Cost of what you buy for one unit. Default 0. */
  readonly materialPerUnit?: Decimal | null;
  /** Other costs for the whole job: freight, packaging, outside help. Default 0. */
  readonly otherCostCents?: CentsLike | null;
  /** Extra services sold with the job. */
  readonly services?: readonly QuoteService[];
  /** Time not on a job, as basis points of labor cost. Default 0. */
  readonly sharedPctBp?: number | null;
  /** The margin you want after all costs, in basis points. */
  readonly targetMarginBp: number;
  /** A price to test. When set, `atPrice` shows what that price earns. */
  readonly pricePerUnit?: Decimal | null;
  /** With a start date the result carries a finish date. */
  readonly startDate?: IsoDate | null;
  readonly workingDays?: readonly number[];
}

/** What one price earns. */
export interface QuoteAtPrice {
  /** Price per unit to 4 places, for example "2.7500". */
  readonly pricePerUnit: string;
  /** Units times price, plus the services. */
  readonly revenueCents: Cents;
  readonly profitCents: Cents;
  /** Margin after all costs. */
  readonly marginBp: number | null;
  /** Margin before shared costs. */
  readonly marginBeforeSharedBp: number | null;
  readonly profitPerUnitCents: Cents | null;
  /** Units needed at this price to cover the fixed costs. `null` when a unit sells for less than it costs to add. */
  readonly breakevenUnits: number | null;
  /** True when the price reaches the target margin. */
  readonly meetsTarget: boolean;
}

export interface QuoteResult {
  /** Run hours: units over pace, to 2 places. */
  readonly runHours: number;
  readonly setupHours: number;
  /** Run hours plus setup hours. */
  readonly laborHours: number;
  /** Work days for the crew: labor hours over people times shift hours, rounded up. */
  readonly workDays: number | null;
  readonly finishDate: IsoDate | null;
  readonly laborCents: Cents;
  readonly materialCents: Cents;
  readonly otherCents: Cents;
  /** Cost of the extra services. Counted inside `otherCents` in `planTotals`. */
  readonly serviceCostCents: Cents;
  readonly serviceRevenueCents: Cents;
  readonly sharedCents: Cents;
  /** All cost: labor, material, other, services and shared. */
  readonly costCents: Cents;
  readonly costBeforeSharedCents: Cents;
  /** Cost for one unit to 4 places, for example "1.3588". `null` with no units. */
  readonly costPerUnit: string | null;
  /** Costs that do not change with units: setup labor with its shared part, and other costs. */
  readonly fixedCostCents: Cents;
  /** Cost one more unit adds, to 4 places. */
  readonly variableCostPerUnit: string | null;
  /** The price that reaches the target margin after all costs. `null` when the target is 100% or there are no units. */
  readonly target: QuoteAtPrice | null;
  /** The price where profit is 0 after all costs. */
  readonly breakeven: QuoteAtPrice | null;
  /** The lowest price worth taking: it covers every cost before shared costs, so the job still helps pay the rent. */
  readonly lowest: QuoteAtPrice | null;
  /** What the typed price earns. `null` when no price was typed. */
  readonly atPrice: QuoteAtPrice | null;
  /** The quote as plan totals at the target price (or the typed price), ready to save as a job's quote. */
  readonly planTotals: PlanTotals | null;
}

/**
 * The what if quote calculator.
 *
 * Example: 10,000 units at 40 units per person per hour, 5 people, $22.00 an hour, $0.45 of
 * material a unit, $1,000.00 of other cost and a 30% target gives 250 labor hours, $5,500.00 of
 * labor, $11,000.00 of cost and a target price of $1.5715 a unit.
 */
export function quoteCalculator(input: QuoteInput): QuoteResult {
  const units = quantityToScaled(input.units);
  const pace = toScaled(input.standardUph, 3);
  if (units < ZERO) throw new RangeError('Units cannot be below zero');
  if (pace <= ZERO) throw new RangeError('The target pace must be above zero');
  const rate = toCents(input.laborRateCents);
  const unitsFrac = frac(units, BigInt(1000));
  const paceFrac = frac(pace, BigInt(1000));
  const runHours = fracDiv(unitsFrac, paceFrac);
  const setupHours = blank(input.setupHours) ? FRAC_ZERO : fracOf(input.setupHours as Decimal, 2);
  const laborHours = fracAdd(runHours, setupHours);
  const laborCents = fracRound(fracMul(laborHours, frac(rate)));
  const setupLaborCents = fracRound(fracMul(setupHours, frac(rate)));
  const materialPerUnit = blank(input.materialPerUnit) ? '0' : (input.materialPerUnit as Decimal);
  const materialCents = mulQuantityPrice(fromScaled(units, 3), materialPerUnit);
  const otherCents = blank(input.otherCostCents) ? ZERO : toCents(input.otherCostCents as CentsLike);
  let serviceRevenueCents = ZERO;
  let serviceCostCents = ZERO;
  for (const service of input.services ?? []) {
    serviceRevenueCents += mulQuantityPrice(service.quantity, service.unitPrice);
    if (!blank(service.costPerUnit)) serviceCostCents += mulQuantityPrice(service.quantity, service.costPerUnit as Decimal);
  }
  const sharedBp = input.sharedPctBp ?? 0;
  const sharedCents = mulBp(laborCents, sharedBp);
  const costBeforeSharedCents = laborCents + materialCents + otherCents + serviceCostCents;
  const costCents = costBeforeSharedCents + sharedCents;

  // fixed and variable parts, for breakeven units
  const fixedCostCents = setupLaborCents + mulBp(setupLaborCents, sharedBp) + otherCents;
  const laborPerUnit = fracDiv(frac(rate, HUNDRED), paceFrac);
  const variablePerUnit = fracAdd(fracMul(laborPerUnit, frac(BP + BigInt(sharedBp), BP)), fracOf(materialPerUnit, 4));
  const variableText = fromScaled(divCeil(variablePerUnit.n * PRICE_UNIT, variablePerUnit.d), 4);

  const crew = blank(input.crewSize) ? frac(BigInt(1)) : fracOf(input.crewSize as Decimal, 2);
  const shift = blank(input.shiftHours) ? frac(BigInt(8)) : fracOf(input.shiftHours as Decimal, 2);
  const perDay = fracMul(crew, shift);
  const workDays = perDay.n > ZERO ? Number(fracCeil(fracDiv(laborHours, perDay))) : null;
  const finishDate = input.startDate && workDays !== null ? addWorkDays(input.startDate, Math.max(0, workDays - 1), input.workingDays ?? DEFAULT_WORKING_DAYS) : null;

  const hasUnits = units > ZERO;
  const unitsText = fromScaled(units, 3);
  const at = (price: string): QuoteAtPrice => {
    const revenueCents = mulQuantityPrice(unitsText, price) + serviceRevenueCents;
    const profitCents = revenueCents - costCents;
    const margin = marginBp(profitCents, revenueCents);
    return {
      pricePerUnit: price,
      revenueCents,
      profitCents,
      marginBp: margin,
      marginBeforeSharedBp: marginBp(revenueCents - costBeforeSharedCents, revenueCents),
      profitPerUnitCents: hasUnits ? divRound(profitCents * BigInt(1000), units) : null,
      breakevenUnits: breakevenUnits({ fixedCostCents, pricePerUnit: price, variableCostPerUnit: variableText }),
      meetsTarget: margin !== null && margin >= input.targetMarginBp,
    };
  };
  /** Price per unit so that units x price + services reaches `revenue`. */
  const priceForRevenue = (revenue: Cents): string => {
    let price = priceUp(frac((revenue - serviceRevenueCents) * BigInt(1000), units));
    // Rounding the product to a cent can land one cent short: step the price up until it does not.
    for (let i = 0; i < 3 && mulQuantityPrice(unitsText, price) + serviceRevenueCents < revenue; i += 1) price = fromScaled(toScaled(price, 4) + BigInt(1), 4);
    return price;
  };

  const targetRevenue = revenueForMargin(costCents, input.targetMarginBp);
  const target = hasUnits && targetRevenue !== null ? at(priceForRevenue(targetRevenue)) : null;
  const breakeven = hasUnits ? at(priceForRevenue(costCents)) : null;
  const lowest = hasUnits ? at(priceForRevenue(costBeforeSharedCents)) : null;
  const atPrice = hasUnits && !blank(input.pricePerUnit) ? at(fromScaled(toScaled(input.pricePerUnit as Decimal, 4), 4)) : null;
  const chosen = atPrice ?? target;

  return {
    runHours: fracToNumber(runHours, 2),
    setupHours: fracToNumber(setupHours, 2),
    laborHours: fracToNumber(laborHours, 2),
    workDays,
    finishDate,
    laborCents,
    materialCents,
    otherCents,
    serviceCostCents,
    serviceRevenueCents,
    sharedCents,
    costCents,
    costBeforeSharedCents,
    costPerUnit: hasUnits ? fromScaled(divRound(costCents * BigInt(1000) * HUNDRED, units), 4) : null,
    fixedCostCents,
    variableCostPerUnit: variableText,
    target,
    breakeven,
    lowest,
    atPrice,
    planTotals: chosen
      ? {
          units: unitsText,
          revenueCents: chosen.revenueCents,
          laborHours: fracToNumber(laborHours, 2),
          laborCents,
          setupHours: fracToNumber(setupHours, 2),
          setupCents: setupLaborCents,
          materialCents,
          otherCents: otherCents + serviceCostCents,
          sharedCents,
        }
      : null,
  };
}

export interface QuoteSensitivityRow {
  /** Pace as a share of the target pace, in basis points: 8000 is a crew running at 80%. */
  readonly paceBp: number;
  /** The pace itself, to 3 places. */
  readonly uph: number;
  readonly costCents: Cents;
  readonly profitCents: Cents;
  readonly marginBp: number | null;
}

/**
 * What happens to profit at one price when the crew runs slower or faster than the target pace.
 * Default steps: 70%, 80%, 90%, 100%, 110% and 120% of the target pace.
 */
export function quoteSensitivity(input: QuoteInput, pricePerUnit: Decimal, paceStepsBp: readonly number[] = [7000, 8000, 9000, 10000, 11000, 12000]): QuoteSensitivityRow[] {
  const pace = toScaled(input.standardUph, 3);
  return paceStepsBp.map((paceBp) => {
    const stepped = divRound(pace * BigInt(paceBp), BP);
    const safe = stepped > ZERO ? stepped : BigInt(1);
    const result = quoteCalculator({ ...input, standardUph: fromScaled(safe, 3), pricePerUnit });
    const at = result.atPrice;
    return { paceBp, uph: Number(fromScaled(safe, 3)), costCents: result.costCents, profitCents: at ? at.profitCents : -result.costCents, marginBp: at ? at.marginBp : null };
  });
}

/** True when price a is below price b. Small helper for forms that compare a typed price with the lowest price worth taking. */
export function priceBelow(a: Decimal, b: Decimal): boolean {
  return fracCmp(fracOf(a, 4), fracOf(b, 4)) < 0;
}
