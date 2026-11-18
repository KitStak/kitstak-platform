/**
 * Extra service math, with no React in it: what one unit of a service should cost, its margin at
 * the list price, what it really made in a period, whether it is underpriced, and the price that
 * would reach the target margin. Prices of small things run under a cent, so every figure here is
 * an exact fraction from `@/lib/money`, rounded once at the end to 4 places.
 */
import { FRAC_ZERO, frac, fracAdd, fracCmp, fracDiv, fracOf, fracSub, fracToNumber, fracToScaled, fromScaled, type Fraction } from '@/lib/money';
import type { LaborClassDTO, ProfitRowDTO, VasServiceDTO } from '@/lib/types';

/** Dollars as a decimal with up to 4 places ("0.0793"), or null. */
export type Price = string | null;

const toPrice = (value: Fraction | null): Price => (value === null ? null : fromScaled(fracToScaled(value, 4), 4));
const dollars = (value: string | null | undefined): Fraction | null => (value === null || value === undefined || value === '' ? null : fracOf(value, 4));
const cents = (value: number | null): Fraction | null => (value === null ? null : frac(BigInt(value), BigInt(100)));
const marginOf = (price: Fraction | null, cost: Fraction | null): number | null => (price === null || cost === null || fracCmp(price, FRAC_ZERO) <= 0 ? null : fracToNumber(fracDiv(fracSub(price, cost), price), 4) * 10000);

export type ServiceFlag = 'below_cost' | 'under_target' | 'no_price' | 'standard_below_cost' | 'standard_under_target';

export const SERVICE_FLAG_WORDS: Readonly<Record<ServiceFlag, string>> = {
  below_cost: 'Costs more than it earns',
  under_target: 'Under your target margin',
  no_price: 'No price set',
  standard_below_cost: 'Priced under its standard cost',
  standard_under_target: 'Priced under your target margin',
};

export interface ServiceLine {
  readonly service: VasServiceDTO;
  /** List price and what a unit should cost: parts per unit plus labor at the target pace. */
  readonly price: Price;
  readonly standardLabor: Price;
  readonly standardCost: Price;
  readonly standardMarginBp: number | null;
  /** What happened in the period. */
  readonly volume: number;
  readonly revenueCents: number | null;
  readonly costCents: number | null;
  readonly profitCents: number | null;
  readonly marginBp: number | null;
  readonly revenuePerUnit: Price;
  readonly costPerUnit: Price;
  readonly trend: readonly number[] | null;
  readonly flag: ServiceFlag | null;
  /** The price a unit needs to reach the target margin, from real cost when there is volume, else from standard cost. */
  readonly priceForTarget: Price;
}

/** The real cost of an hour to use for a service: its own labor class, else the default class. */
export function serviceRateCents(service: Pick<VasServiceDTO, 'defaultLaborClassId'>, classes: readonly LaborClassDTO[]): number | null {
  const own = classes.find((item) => item.id === service.defaultLaborClassId);
  const fallback = classes.find((item) => item.isDefault);
  return own?.currentLoadedRateCents ?? fallback?.currentLoadedRateCents ?? null;
}

/**
 * Builds the line for one service.
 * Worked example: Labeling sells at $0.12 a label, parts cost $0.015, target pace 420 labels per
 * person per hour at $27.00 an hour. Labor is 27 / 420 = $0.0643, so a label should cost $0.0793
 * and the margin at list price is (0.12 - 0.0793) / 0.12 = 33.9%.
 */
export function serviceLine(service: VasServiceDTO, actual: ProfitRowDTO | undefined, rateCents: number | null, targetMarginBp: number): ServiceLine {
  const price = dollars(service.defaultPrice);
  const parts = dollars(service.defaultCostPerUnit) ?? FRAC_ZERO;
  const pace = service.standardUph && Number(service.standardUph) > 0 ? fracOf(service.standardUph, 3) : null;
  const labor = pace !== null && rateCents !== null ? fracDiv(frac(BigInt(rateCents), BigInt(100)), pace) : null;
  // With no pace or no rate, the standard cost is only the parts, and only when parts were typed in.
  const standardCost = labor !== null ? fracAdd(parts, labor) : service.defaultCostPerUnit !== null ? parts : null;
  const standardMarginBp = marginOf(price, standardCost);

  const volume = actual ? Number(actual.unitsGood) : 0;
  const units = volume > 0 ? fracOf(actual!.unitsGood, 3) : null;
  const revenue = cents(actual?.revenueCents ?? null);
  const cost = cents(actual?.costCents ?? null);
  const revenuePerUnit = units && revenue ? fracDiv(revenue, units) : null;
  const costPerUnit = units && cost ? fracDiv(cost, units) : null;
  const marginBp = actual?.marginBp ?? null;

  let flag: ServiceFlag | null = null;
  if (revenuePerUnit !== null && costPerUnit !== null && fracCmp(revenuePerUnit, FRAC_ZERO) > 0) {
    if (fracCmp(costPerUnit, revenuePerUnit) >= 0) flag = 'below_cost';
    else if (marginBp !== null && marginBp < targetMarginBp) flag = 'under_target';
  } else if (price === null || fracCmp(price, FRAC_ZERO) <= 0) {
    flag = service.active ? 'no_price' : null;
  } else if (standardCost !== null && fracCmp(standardCost, price) >= 0) {
    flag = 'standard_below_cost';
  } else if (standardMarginBp !== null && standardMarginBp < targetMarginBp) {
    flag = 'standard_under_target';
  }

  const basis = costPerUnit ?? standardCost;
  const priceForTarget = basis !== null && targetMarginBp < 10000 && fracCmp(basis, FRAC_ZERO) > 0 ? fracDiv(basis, frac(BigInt(10000 - targetMarginBp), BigInt(10000))) : null;

  return {
    service,
    price: toPrice(price),
    standardLabor: toPrice(labor),
    standardCost: toPrice(standardCost),
    standardMarginBp: standardMarginBp === null ? null : Math.round(standardMarginBp),
    volume,
    revenueCents: actual?.revenueCents ?? null,
    costCents: actual?.costCents ?? null,
    profitCents: actual?.profitCents ?? null,
    marginBp,
    revenuePerUnit: toPrice(revenuePerUnit),
    costPerUnit: toPrice(costPerUnit),
    trend: actual?.trend ?? null,
    flag,
    priceForTarget: toPrice(priceForTarget),
  };
}

/** One plain sentence on why a service is flagged and what price would fix it. */
export function flagSentence(line: ServiceLine, targetMarginBp: number, money: (price: Price) => string, percent: (bp: number | null) => string): string | null {
  const fix = line.priceForTarget ? ` A price of ${money(line.priceForTarget)} would reach ${percent(targetMarginBp)}.` : '';
  switch (line.flag) {
    case 'below_cost':
      return `Each ${unitWord(line.service.unitLabel)} cost ${money(line.costPerUnit)} to do and earned ${money(line.revenuePerUnit)}.${fix}`;
    case 'under_target':
      return `It made a ${percent(line.marginBp)} margin. Your target is ${percent(targetMarginBp)}.${
        line.costPerUnit && line.revenuePerUnit
          ? ` Each ${unitWord(line.service.unitLabel)} cost ${money(line.costPerUnit)} to do and earned ${money(line.revenuePerUnit)}.`
          : ''
      }${fix}`;
    case 'no_price':
      return 'This service has no price, so every entry earns nothing until one is set.';
    case 'standard_below_cost':
      return `At the target pace one ${unitWord(line.service.unitLabel)} should cost ${money(line.standardCost)}, which is more than the ${money(line.price)} price.${fix}`;
    case 'standard_under_target':
      return `At the list price the margin would be ${percent(line.standardMarginBp)}. Your target is ${percent(targetMarginBp)}.${fix}`;
    default:
      return null;
  }
}

/** "labels" to "label", for sentences about one unit. */
export function unitWord(unitLabel: string | null | undefined): string {
  const word = (unitLabel ?? '').trim();
  if (!word) return 'unit';
  if (/ies$/i.test(word) && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(xes|ses|zes|ches|shes)$/i.test(word)) return word.slice(0, -2);
  if (/s$/i.test(word) && !/ss$/i.test(word) && word.length > 2) return word.slice(0, -1);
  return word;
}

export const BILLING_LABELS: Readonly<Record<string, string>> = { per_unit: 'Per unit', per_hour: 'Per hour', flat: 'Flat fee' };
