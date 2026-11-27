/**
 * The numbers behind the new job wizard's live preview. Every figure comes from the pure money
 * and profit libraries; this file only reads what was typed and hands it over. The quote that
 * gets saved is built from the same lines the preview adds up, so the two always agree.
 */
import {
  addCents,
  decimalToCents,
  hoursToScaled,
  maxCents,
  mulHoursRate,
  mulQuantityPrice,
  scaledToNumber,
  subCents,
  centsToNumber,
  type Cents,
} from '@/lib/money';
import {
  breakevenPrice,
  breakevenUnits,
  earnedHours,
  planFigures,
  planSharedAuto,
  revenueForMargin,
  type PlanFigures,
  type SharedCostRule,
} from '@/lib/profit';
import type { PricingModelValue } from '@/lib/constants';

const ZERO = BigInt(0);

/** Reads typed text as an exact decimal with up to `scale` places. Null when it is not a number of 0 or more. */
export function readDecimal(text: string | null | undefined, scale: number): string | null {
  const cleaned = (text ?? '').trim().replace(/[$,\s]/g, '');
  if (!cleaned) return null;
  return new RegExp(`^\\d{1,9}(\\.\\d{1,${scale}})?$`).test(cleaned) ? cleaned : null;
}

/** Typed dollars as whole cents. Null when blank or not a number. */
export function readCents(text: string | null | undefined): number | null {
  const value = readDecimal(text, 2);
  return value === null ? null : centsToNumber(decimalToCents(value));
}

export interface WizardCostLine {
  readonly label: string;
  readonly amount: string;
}

export interface WizardServiceLine {
  readonly serviceId: string | null;
  readonly label: string;
  readonly quantity: string;
  readonly price: string;
  readonly cost: string;
}

export interface WizardNumbers {
  readonly pricingModel: PricingModelValue;
  readonly units: string;
  readonly unitPrice: string;
  readonly fixedPrice: string;
  readonly billRate: string;
  readonly laborMode: 'hours' | 'pace';
  readonly laborHours: string;
  readonly pace: string;
  readonly setupHours: string;
  /** Real cost of an hour, in dollars. */
  readonly rate: string;
  readonly laborClassId: string | null;
  readonly materialPerUnit: string;
  readonly partsOwner: 'us' | 'client';
  readonly otherCosts: readonly WizardCostLine[];
  readonly services: readonly WizardServiceLine[];
  readonly targetMarginBp: number;
  readonly sharedRule: SharedCostRule;
  readonly sharedPctBp: number;
  /** The workspace's time not on a job and labor cost over the last 90 days (for the hours rules). */
  readonly shared90Cents: number | null;
  readonly labor90Cents: number | null;
}

export interface QuoteLineDraft {
  readonly category: 'revenue' | 'labor' | 'setup' | 'material' | 'other';
  readonly description: string;
  readonly quantity: string | null;
  readonly unit: 'unit' | 'hour' | 'each' | 'flat';
  readonly unitAmount: string | null;
  readonly amountCents: number;
  readonly laborClassId?: string | null;
  readonly vasServiceId?: string | null;
}

export interface JobPreview {
  /** True when there is enough typed to show money. */
  readonly ready: boolean;
  readonly units: string;
  readonly totalHours: number;
  readonly runHours: number;
  readonly setupHours: number;
  readonly baseRevenueCents: Cents;
  readonly serviceRevenueCents: Cents;
  readonly laborCents: Cents;
  readonly materialCents: Cents;
  readonly otherCents: Cents;
  readonly serviceCostCents: Cents;
  readonly sharedCents: Cents;
  readonly figures: PlanFigures;
  readonly marginBeforeSharedBp: number | null;
  /** The price for one unit where profit is zero. Only for per unit pricing. */
  readonly breakevenPrice: string | null;
  /** The price for one unit that reaches the target margin. Only for per unit pricing. */
  readonly targetPrice: string | null;
  /** Units needed at the typed price to win back setup and other fixed costs. */
  readonly breakevenUnits: number | null;
  /** The gap between the margin and the target, in basis points (below zero is under target). */
  readonly marginGapBp: number | null;
  readonly lines: readonly QuoteLineDraft[];
}

export function previewJob(n: WizardNumbers): JobPreview {
  const units = readDecimal(n.units, 3) ?? '0';
  const rate = decimalToCents(readDecimal(n.rate, 2) ?? '0');
  const rateText = readDecimal(n.rate, 2);
  const setupText = readDecimal(n.setupHours, 2) ?? '0';
  const setupScaled = hoursToScaled(setupText);
  let runScaled = ZERO;
  if (n.laborMode === 'pace') {
    const pace = readDecimal(n.pace, 3);
    const run = pace && Number(pace) > 0 ? earnedHours(units, pace) : null;
    runScaled = run === null ? ZERO : hoursToScaled(run);
  } else {
    const total = hoursToScaled(readDecimal(n.laborHours, 2) ?? '0');
    runScaled = total > setupScaled ? total - setupScaled : ZERO;
  }
  const runHours = scaledToNumber(runScaled, 2);
  const setupHours = scaledToNumber(setupScaled, 2);
  const totalHours = scaledToNumber(runScaled + setupScaled, 2);
  const runCents = mulHoursRate(runHours, rate);
  const setupCents = mulHoursRate(setupHours, rate);
  const laborCents = addCents(runCents, setupCents);

  const materialText = n.partsOwner === 'client' ? null : readDecimal(n.materialPerUnit, 4);
  const materialCents = materialText ? mulQuantityPrice(units, materialText) : ZERO;

  const lines: QuoteLineDraft[] = [];
  let baseRevenue = ZERO;
  if (n.pricingModel === 'per_unit') {
    const price = readDecimal(n.unitPrice, 4);
    baseRevenue = price ? mulQuantityPrice(units, price) : ZERO;
    lines.push({
      category: 'revenue',
      description: 'Units',
      quantity: units,
      unit: 'unit',
      unitAmount: price,
      amountCents: centsToNumber(baseRevenue),
    });
  } else if (n.pricingModel === 'fixed') {
    baseRevenue = decimalToCents(readDecimal(n.fixedPrice, 2) ?? '0');
    lines.push({
      category: 'revenue',
      description: 'Fixed price',
      quantity: units,
      unit: 'unit',
      unitAmount: null,
      amountCents: centsToNumber(baseRevenue),
    });
  } else {
    const bill = readDecimal(n.billRate, 2);
    baseRevenue = bill ? mulHoursRate(totalHours, decimalToCents(bill)) : ZERO;
    lines.push({
      category: 'revenue',
      description: 'Billed hours',
      quantity: units,
      unit: 'unit',
      unitAmount: null,
      amountCents: centsToNumber(baseRevenue),
    });
  }

  let serviceRevenue = ZERO;
  let serviceCost = ZERO;
  const serviceCostLines: QuoteLineDraft[] = [];
  for (const service of n.services) {
    const quantity = readDecimal(service.quantity, 3);
    if (!quantity || Number(quantity) === 0) continue;
    const price = readDecimal(service.price, 4);
    const cost = readDecimal(service.cost, 4);
    const label = service.label.trim() || 'Extra service';
    const revenue = price ? mulQuantityPrice(quantity, price) : ZERO;
    serviceRevenue += revenue;
    lines.push({
      category: 'revenue',
      description: label,
      quantity,
      unit: 'each',
      unitAmount: price,
      amountCents: centsToNumber(revenue),
      vasServiceId: service.serviceId,
    });
    if (cost && Number(cost) > 0) {
      const amount = mulQuantityPrice(quantity, cost);
      serviceCost += amount;
      serviceCostLines.push({
        category: 'other',
        description: `${label} cost`,
        quantity,
        unit: 'each',
        unitAmount: cost,
        amountCents: centsToNumber(amount),
        vasServiceId: service.serviceId,
      });
    }
  }

  if (runHours > 0 || rate > ZERO)
    lines.push({
      category: 'labor',
      description: 'Labor',
      quantity: String(runHours),
      unit: 'hour',
      unitAmount: rateText,
      amountCents: centsToNumber(runCents),
      laborClassId: n.laborClassId,
    });
  if (setupHours > 0)
    lines.push({
      category: 'setup',
      description: 'Setup',
      quantity: String(setupHours),
      unit: 'hour',
      unitAmount: rateText,
      amountCents: centsToNumber(setupCents),
      laborClassId: n.laborClassId,
    });
  if (materialText && materialCents > ZERO)
    lines.push({
      category: 'material',
      description: 'Material',
      quantity: units,
      unit: 'unit',
      unitAmount: materialText,
      amountCents: centsToNumber(materialCents),
    });

  let typedOther = ZERO;
  for (const cost of n.otherCosts) {
    const cents = readCents(cost.amount);
    if (cents === null || cents === 0) continue;
    typedOther += BigInt(cents);
    lines.push({
      category: 'other',
      description: cost.label.trim() || 'Other cost',
      quantity: null,
      unit: 'flat',
      unitAmount: null,
      amountCents: cents,
    });
  }
  lines.push(...serviceCostLines);
  const otherCents = addCents(typedOther, serviceCost);

  const sharedCents = planSharedAuto({
    rule: n.sharedRule,
    laborCents,
    sharedPctBp: n.sharedPctBp,
    shared90Cents: n.shared90Cents ?? 0,
    labor90Cents: n.labor90Cents ?? 0,
  });
  const revenueCents = addCents(baseRevenue, serviceRevenue);
  const plan = {
    units,
    revenueCents,
    laborHours: totalHours,
    laborCents,
    setupHours,
    setupCents,
    materialCents,
    otherCents,
    sharedCents,
  };
  const figures = planFigures(plan);
  const beforeShared = planFigures({ ...plan, sharedCents: ZERO });

  const hasUnits = Number(units) > 0;
  const costLessServices = maxCents(ZERO, subCents(figures.costCents, serviceRevenue));
  const targetRevenue = revenueForMargin(figures.costCents, n.targetMarginBp);
  const perUnit = n.pricingModel === 'per_unit' && hasUnits;
  const price = readDecimal(n.unitPrice, 4);
  const variableCents = addCents(
    runCents,
    materialCents,
    subCents(
      sharedCents,
      planSharedAuto({
        rule: n.sharedRule,
        laborCents: setupCents,
        sharedPctBp: n.sharedPctBp,
        shared90Cents: n.shared90Cents ?? 0,
        labor90Cents: n.labor90Cents ?? 0,
      }),
    ),
  );
  const variablePerUnit = hasUnits ? breakevenPrice(variableCents, units) : null;
  const fixedCents = subCents(figures.costCents, variableCents);

  return {
    ready: figures.revenueCents > ZERO || figures.costCents > ZERO,
    units,
    totalHours,
    runHours,
    setupHours,
    baseRevenueCents: baseRevenue,
    serviceRevenueCents: serviceRevenue,
    laborCents,
    materialCents,
    otherCents,
    serviceCostCents: serviceCost,
    sharedCents,
    figures,
    marginBeforeSharedBp: beforeShared.marginBp,
    breakevenPrice: perUnit ? breakevenPrice(costLessServices, units) : null,
    targetPrice:
      perUnit && targetRevenue !== null
        ? breakevenPrice(maxCents(ZERO, subCents(targetRevenue, serviceRevenue)), units)
        : null,
    breakevenUnits:
      perUnit && price && variablePerUnit
        ? breakevenUnits({
            fixedCostCents: maxCents(ZERO, subCents(fixedCents, serviceRevenue)),
            pricePerUnit: price,
            variableCostPerUnit: variablePerUnit,
          })
        : null,
    marginGapBp: figures.marginBp === null ? null : figures.marginBp - n.targetMarginBp,
    lines,
  };
}
