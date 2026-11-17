/**
 * Quote, budget and plan vs actual (docs/pulse/SPEC.md 4.10). The quote is what you told the
 * client. The budget is what you think it will cost you. Actual is what happened. Pure functions.
 */
import {
  type Cents,
  type CentsLike,
  type Decimal,
  ZERO,
  absBig,
  allocate,
  divRound,
  hoursToScaled,
  marginBp,
  mulBp,
  perUnitCents,
  quantityToScaled,
  scaledToNumber,
  toCents,
  toScaled,
} from '../money';
import type { Tone } from '../format';
import type { ActualTotals, PlanTotals, SharedCostRule } from './types';

const ONE = BigInt(1);
const BP = BigInt(10000);

/** How much of the job is done, as an exact fraction, and what it was measured by. */
export interface FlexFactor {
  readonly num: bigint;
  readonly den: bigint;
  /** `units`: units good over plan units. `hours`: labor hours over plan hours. `whole`: no way to tell, so the whole plan is used. */
  readonly basis: 'units' | 'hours' | 'whole';
}

/** A plan with every blank filled in as 0 and the profit worked out. */
export interface PlanFigures {
  readonly units: number;
  readonly revenueCents: Cents;
  readonly laborHours: number;
  readonly laborCents: Cents;
  readonly setupHours: number;
  readonly setupCents: Cents;
  readonly materialCents: Cents;
  readonly otherCents: Cents;
  readonly sharedCents: Cents;
  readonly costCents: Cents;
  readonly profitCents: Cents;
  readonly marginBp: number | null;
}

interface Scaled {
  units: bigint;
  revenue: Cents;
  hours: bigint;
  labor: Cents;
  setupHours: bigint;
  setupCents: Cents;
  material: Cents;
  other: Cents;
  shared: Cents;
}

function blank(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

function scalePlan(plan: PlanTotals): Scaled {
  return {
    units: blank(plan.units) ? ZERO : quantityToScaled(plan.units as Decimal),
    revenue: plan.revenueCents ?? ZERO,
    hours: blank(plan.laborHours) ? ZERO : hoursToScaled(plan.laborHours as Decimal),
    labor: plan.laborCents ?? ZERO,
    setupHours: blank(plan.setupHours) ? ZERO : hoursToScaled(plan.setupHours as Decimal),
    setupCents: plan.setupCents ?? ZERO,
    material: plan.materialCents ?? ZERO,
    other: plan.otherCents ?? ZERO,
    shared: plan.sharedCents ?? ZERO,
  };
}

function figures(s: Scaled): PlanFigures {
  const costCents = s.labor + s.material + s.other + s.shared;
  const profitCents = s.revenue - costCents;
  return {
    units: scaledToNumber(s.units, 3),
    revenueCents: s.revenue,
    laborHours: scaledToNumber(s.hours, 2),
    laborCents: s.labor,
    setupHours: scaledToNumber(s.setupHours, 2),
    setupCents: s.setupCents,
    materialCents: s.material,
    otherCents: s.other,
    sharedCents: s.shared,
    costCents,
    profitCents,
    marginBp: marginBp(profitCents, s.revenue),
  };
}

/** The whole plan with blanks as 0, total cost, profit and margin. */
export function planFigures(plan: PlanTotals): PlanFigures {
  return figures(scalePlan(plan));
}

/**
 * The share of the job that is done (`f` in 4.10): units good over plan units; for a plan with
 * no units, labor hours over plan hours; with neither, 1 ("Whole job"). It may go above 1.
 */
export function flexFactor(plan: PlanTotals, actual: { unitsGood: Decimal; hours: Decimal }): FlexFactor {
  const s = scalePlan(plan);
  if (s.units > ZERO) return { num: quantityToScaled(actual.unitsGood), den: s.units, basis: 'units' };
  if (s.hours > ZERO) return { num: hoursToScaled(actual.hours), den: s.hours, basis: 'hours' };
  return { num: ONE, den: ONE, basis: 'whole' };
}

/** A flex factor of exactly 1: the whole plan. */
export const WHOLE_JOB: FlexFactor = { num: ONE, den: ONE, basis: 'whole' };

/**
 * The plan for the work done so far. Units, revenue, material and shared cost scale with `f`.
 * Setup hours and setup cost do not scale; the rest of labor does. Other cost is compared whole.
 */
export function flexPlan(plan: PlanTotals, factor: FlexFactor): PlanFigures {
  const s = scalePlan(plan);
  const flex = (value: bigint): bigint => divRound(value * factor.num, factor.den);
  const setupHours = s.setupHours > s.hours ? s.hours : s.setupHours;
  const setupCents = s.setupCents > s.labor ? s.labor : s.setupCents;
  return figures({
    units: flex(s.units),
    revenue: flex(s.revenue),
    hours: setupHours + flex(s.hours - setupHours),
    labor: setupCents + flex(s.labor - setupCents),
    setupHours,
    setupCents,
    material: flex(s.material),
    other: s.other,
    shared: flex(s.shared),
  });
}

/** One line of a quote or a budget (`pulse.job_plan_lines`). */
export interface PlanLine {
  readonly category: 'revenue' | 'labor' | 'setup' | 'material' | 'other';
  readonly description?: string | null;
  readonly quantity?: Decimal | null;
  readonly unit?: 'unit' | 'hour' | 'each' | 'flat' | null;
  readonly unitAmount?: Decimal | null;
  readonly amountCents: CentsLike;
  /** `null` means the default for the category. */
  readonly flex?: boolean | null;
  readonly laborClass?: string | null;
  readonly serviceCode?: string | null;
  readonly itemSku?: string | null;
}

/**
 * Plan totals from lines. Units are the quantities on revenue lines with unit `unit`. Labor hours
 * are the quantities on labor and setup lines. Setup sits inside the labor totals.
 */
export function planTotalsFromLines(lines: readonly PlanLine[], sharedCents: Cents | null = null): PlanTotals {
  let units = ZERO;
  let revenue = ZERO;
  let hours = ZERO;
  let labor = ZERO;
  let setupHours = ZERO;
  let setupCents = ZERO;
  let material = ZERO;
  let other = ZERO;
  for (const line of lines) {
    const amount = toCents(line.amountCents);
    const quantity: Decimal = blank(line.quantity) ? 0 : (line.quantity as Decimal);
    if (line.category === 'revenue') {
      revenue += amount;
      if (line.unit === 'unit') units += quantityToScaled(quantity);
    } else if (line.category === 'labor' || line.category === 'setup') {
      labor += amount;
      const lineHours = toScaled(quantity, 2);
      hours += lineHours;
      if (line.category === 'setup') {
        setupHours += lineHours;
        setupCents += amount;
      }
    } else if (line.category === 'material') material += amount;
    else other += amount;
  }
  return {
    units: scaledToNumber(units, 3),
    revenueCents: revenue,
    laborHours: scaledToNumber(hours, 2),
    laborCents: labor,
    setupHours: scaledToNumber(setupHours, 2),
    setupCents,
    materialCents: material,
    otherCents: other,
    sharedCents,
  };
}

/**
 * Plan shared cost when it is not typed (4.10), so the plan and the actual carry the same kind of
 * cost: a percent of labor under `percent_of_labor`; labor times the org's shared to labor ratio
 * of the last 90 days under the hours rules; 0 under `none`.
 */
export function planSharedAuto(input: { rule: SharedCostRule; laborCents: CentsLike; sharedPctBp?: number; shared90Cents?: CentsLike; labor90Cents?: CentsLike }): Cents {
  const labor = toCents(input.laborCents);
  if (input.rule === 'none') return ZERO;
  if (input.rule === 'percent_of_labor') return mulBp(labor, input.sharedPctBp ?? 0);
  const labor90 = toCents(input.labor90Cents ?? ZERO);
  if (labor90 <= ZERO) return ZERO;
  return divRound(labor * toCents(input.shared90Cents ?? ZERO), labor90);
}

/** Plan cost for the work done so far, per good unit. Replaces a typed goal when a plan exists. `null` with no units. */
export function shouldCostPerUnit(plan: PlanTotals, actual: { unitsGood: Decimal; hours: Decimal }): Cents | null {
  return perUnitCents(flexPlan(plan, flexFactor(plan, actual)).costCents, actual.unitsGood);
}

export type PlanRowKey = 'units' | 'labor_hours' | 'uph' | 'labor' | 'material' | 'other' | 'shared' | 'cost' | 'revenue' | 'profit' | 'margin';

/** The on screen name of each row. */
export const PLAN_ROW_LABELS: Readonly<Record<PlanRowKey, string>> = {
  units: 'Units',
  labor_hours: 'Labor hours',
  uph: 'Units per person per hour',
  labor: 'Labor cost',
  material: 'Material cost',
  other: 'Other cost',
  shared: 'Time not on a job',
  cost: 'Total cost',
  revenue: 'Revenue',
  profit: 'Profit',
  margin: 'Margin',
};

interface PlanRowBase {
  readonly key: PlanRowKey;
  readonly label: string;
  /** Which way is good for this row: `up` for revenue, profit, units and pace; `down` for costs and hours. */
  readonly goodWhen: 'up' | 'down';
  /** Difference as a share of the plan, in basis points. `null` when the plan is 0, and for the margin row. */
  readonly differencePctBp: number | null;
  /** Good, bad or neutral for Actual against Plan. */
  readonly tone: Tone;
}

/** A row whose values are money in whole cents. */
export interface PlanMoneyRow extends PlanRowBase {
  readonly kind: 'money';
  readonly plan: Cents | null;
  readonly actual: Cents | null;
  readonly difference: Cents | null;
  readonly projected: Cents | null;
}

/** A row whose values are plain numbers: units, hours, pace, or a margin in basis points. */
export interface PlanNumberRow extends PlanRowBase {
  readonly kind: 'units' | 'hours' | 'pace' | 'margin';
  readonly plan: number | null;
  readonly actual: number | null;
  /** For the margin row this is in basis points (100 = 1 point). */
  readonly difference: number | null;
  readonly projected: number | null;
}

export type PlanRow = PlanMoneyRow | PlanNumberRow;

export interface PlanVsActual {
  /** `so_far`: the plan for the work done so far. `whole`: the whole job. */
  readonly basis: 'so_far' | 'whole';
  readonly factor: FlexFactor;
  /** The plan column as figures, or `null` when the job has no plan. */
  readonly plan: PlanFigures | null;
  /** The label of the Plan column. */
  readonly planLabel: 'For the work done so far' | 'Whole job';
  readonly rows: PlanRow[];
}

function toneOf(sign: number, goodWhen: 'up' | 'down'): Tone {
  if (sign === 0) return 'neutral';
  return (sign > 0) === (goodWhen === 'up') ? 'good' : 'bad';
}

function signOf(value: bigint): number {
  return value > ZERO ? 1 : value < ZERO ? -1 : 0;
}

function pctBp(difference: bigint, plan: bigint): number | null {
  if (plan === ZERO) return null;
  const bp = divRound(difference * BP, absBig(plan));
  return bp > BigInt(1_000_000) || bp < BigInt(-1_000_000) ? null : Number(bp);
}

function moneyRow(key: PlanRowKey, goodWhen: 'up' | 'down', plan: Cents | null, actual: Cents, projected: Cents | null): PlanMoneyRow {
  const difference = plan === null ? null : actual - plan;
  return {
    key,
    label: PLAN_ROW_LABELS[key],
    kind: 'money',
    goodWhen,
    plan,
    actual,
    difference,
    differencePctBp: difference === null || plan === null ? null : pctBp(difference, plan),
    projected,
    tone: difference === null ? 'neutral' : toneOf(signOf(difference), goodWhen),
  };
}

function numberRow(key: PlanRowKey, kind: PlanNumberRow['kind'], goodWhen: 'up' | 'down', scale: number, plan: bigint | null, actual: bigint | null, projected: bigint | null): PlanNumberRow {
  const difference = plan === null || actual === null ? null : actual - plan;
  return {
    key,
    label: PLAN_ROW_LABELS[key],
    kind,
    goodWhen,
    plan: plan === null ? null : scaledToNumber(plan, scale),
    actual: actual === null ? null : scaledToNumber(actual, scale),
    difference: difference === null ? null : scaledToNumber(difference, scale),
    differencePctBp: kind === 'margin' || difference === null || plan === null ? null : pctBp(difference, plan),
    projected: projected === null ? null : scaledToNumber(projected, scale),
    tone: difference === null ? 'neutral' : toneOf(signOf(difference), goodWhen),
  };
}

/** Units per non setup labor hour x 1000, or `null` when there are no such hours. */
function paceScaled(units1000: bigint, hours100: bigint, setup100: bigint): bigint | null {
  const paceHours = hours100 - setup100;
  if (paceHours <= ZERO || units1000 < ZERO) return null;
  return divRound(units1000 * BigInt(100), paceHours);
}

function actualPace(totals: ActualTotals): bigint | null {
  if (totals.uph !== undefined) return totals.uph === null ? null : toScaled(totals.uph, 3);
  return paceScaled(quantityToScaled(totals.unitsGood), hoursToScaled(totals.hours), hoursToScaled(totals.setupHours ?? 0));
}

function costOf(totals: ActualTotals): Cents {
  return totals.laborCents + totals.materialCents + totals.otherCents + totals.sharedCents;
}

export interface PlanVsActualInput {
  /** The quote or the budget to compare with. `null` when the job has no plan. */
  readonly plan: PlanTotals | null;
  readonly actual: ActualTotals;
  /** `so_far` (default for open jobs) judges a half done job fairly. `whole` compares with the whole plan. */
  readonly basis?: 'so_far' | 'whole';
  /** Totals projected at the finish (4.13), for the last column. */
  readonly projected?: ActualTotals | null;
}

/**
 * The Plan vs actual table: Units, Labor hours, Units per person per hour, Labor cost, Material
 * cost, Other cost, Time not on a job, Total cost, Revenue, Profit and Margin, each with Plan,
 * Actual, Difference, Difference % and Projected at finish, and a good or bad tone.
 * Cost rows are bad when actual is above plan. Revenue, profit, units and pace are bad when below.
 */
export function planVsActual(input: PlanVsActualInput): PlanVsActual {
  const basis = input.basis ?? 'so_far';
  const actual = input.actual;
  const projected = input.projected ?? null;
  const factor = input.plan && basis === 'so_far' ? flexFactor(input.plan, actual) : WHOLE_JOB;
  const plan = input.plan ? flexPlan(input.plan, factor) : null;
  const wholeFactor = factor.basis === 'whole';
  const p = plan
    ? {
        units: toScaled(plan.units, 3),
        hours: toScaled(plan.laborHours, 2),
        setup: toScaled(plan.setupHours, 2),
      }
    : null;
  const actualCost = costOf(actual);
  const actualProfit = actual.revenueCents - actualCost;
  const projectedCost = projected ? costOf(projected) : null;
  const projectedProfit = projected && projectedCost !== null ? projected.revenueCents - projectedCost : null;
  const margin = (profit: Cents | null, revenue: Cents | null): bigint | null => {
    if (profit === null || revenue === null) return null;
    const bp = marginBp(profit, revenue);
    return bp === null ? null : BigInt(bp);
  };
  const rows: PlanRow[] = [
    numberRow('units', 'units', 'up', 3, p ? p.units : null, quantityToScaled(actual.unitsGood), projected ? quantityToScaled(projected.unitsGood) : null),
    numberRow('labor_hours', 'hours', 'down', 2, p ? p.hours : null, hoursToScaled(actual.hours), projected ? hoursToScaled(projected.hours) : null),
    numberRow('uph', 'pace', 'up', 3, p ? paceScaled(p.units, p.hours, p.setup) : null, actualPace(actual), projected ? actualPace(projected) : null),
    moneyRow('labor', 'down', plan ? plan.laborCents : null, actual.laborCents, projected ? projected.laborCents : null),
    moneyRow('material', 'down', plan ? plan.materialCents : null, actual.materialCents, projected ? projected.materialCents : null),
    moneyRow('other', 'down', plan ? plan.otherCents : null, actual.otherCents, projected ? projected.otherCents : null),
    moneyRow('shared', 'down', plan ? plan.sharedCents : null, actual.sharedCents, projected ? projected.sharedCents : null),
    moneyRow('cost', 'down', plan ? plan.costCents : null, actualCost, projectedCost),
    moneyRow('revenue', 'up', plan ? plan.revenueCents : null, actual.revenueCents, projected ? projected.revenueCents : null),
    moneyRow('profit', 'up', plan ? plan.profitCents : null, actualProfit, projectedProfit),
    numberRow('margin', 'margin', 'up', 0, plan && plan.marginBp !== null ? BigInt(plan.marginBp) : null, margin(actualProfit, actual.revenueCents), margin(projectedProfit, projected ? projected.revenueCents : null)),
  ];
  return { basis, factor, plan, planLabel: basis === 'so_far' && !wholeFactor ? 'For the work done so far' : 'Whole job', rows };
}

/** Actual money in one bucket, for the per line quote table. */
export interface ActualBucket {
  readonly category: PlanLine['category'];
  readonly laborClass?: string | null;
  readonly serviceCode?: string | null;
  readonly itemSku?: string | null;
  readonly amountCents: CentsLike;
}

export interface QuoteLineRow {
  readonly index: number;
  readonly category: PlanLine['category'];
  readonly description: string | null;
  readonly quotedQuantity: number | null;
  readonly quotedCents: Cents;
  readonly actualCents: Cents;
  readonly differenceCents: Cents;
  readonly differencePctBp: number | null;
  readonly tone: Tone;
  /** What the actual amount was matched by. */
  readonly matchedBy: 'item' | 'service' | 'labor_class' | 'category';
}

function lineKey(line: { laborClass?: string | null; serviceCode?: string | null; itemSku?: string | null }): { by: QuoteLineRow['matchedBy']; key: string } {
  if (line.itemSku) return { by: 'item', key: `item:${line.itemSku.trim().toLowerCase()}` };
  if (line.serviceCode) return { by: 'service', key: `service:${line.serviceCode.trim().toLowerCase()}` };
  if (line.laborClass) return { by: 'labor_class', key: `class:${line.laborClass.trim().toLowerCase()}` };
  return { by: 'category', key: '' };
}

/**
 * Quote vs actual, line by line. A line with an item, a service or a labor class takes the
 * actual money that carries the same one. Lines with none of those share what is left of their
 * category, split by quoted amount, so the actual column always adds up to the real total.
 * In the labor category a setup line is matched within `setup` buckets and a labor line within `labor`.
 */
export function quoteLinesVsActual(lines: readonly PlanLine[], actuals: readonly ActualBucket[]): QuoteLineRow[] {
  const actualOf = new Array<Cents>(lines.length).fill(ZERO);
  const matched = lines.map((line) => lineKey(line));
  const categories = new Set<PlanLine['category']>([...lines.map((line) => line.category), ...actuals.map((bucket) => bucket.category)]);
  for (const category of categories) {
    const lineIndexes = lines.map((line, index) => (line.category === category ? index : -1)).filter((index) => index >= 0);
    if (lineIndexes.length === 0) continue;
    const keyed = new Map<string, number[]>();
    const open: number[] = [];
    for (const index of lineIndexes) {
      const match = matched[index] as { by: QuoteLineRow['matchedBy']; key: string };
      if (match.by === 'category') open.push(index);
      else keyed.set(match.key, [...(keyed.get(match.key) ?? []), index]);
    }
    const byKey = new Map<string, Cents>();
    let rest = ZERO;
    for (const bucket of actuals) {
      if (bucket.category !== category) continue;
      const amount = toCents(bucket.amountCents);
      const keys = [bucket.itemSku ? `item:${bucket.itemSku.trim().toLowerCase()}` : null, bucket.serviceCode ? `service:${bucket.serviceCode.trim().toLowerCase()}` : null, bucket.laborClass ? `class:${bucket.laborClass.trim().toLowerCase()}` : null];
      const hit = keys.find((key): key is string => key !== null && keyed.has(key));
      if (hit) byKey.set(hit, (byKey.get(hit) ?? ZERO) + amount);
      else rest += amount;
    }
    const share = (indexes: number[], amount: Cents): void => {
      if (indexes.length === 0) return;
      const weights = indexes.map((index) => absBig(toCents((lines[index] as PlanLine).amountCents)));
      const anyWeight = weights.some((weight) => weight > ZERO);
      const parts = allocate(amount, anyWeight ? weights : indexes.map(() => ONE));
      indexes.forEach((index, position) => {
        actualOf[index] = (actualOf[index] as Cents) + (parts[position] as Cents);
      });
    };
    for (const [key, indexes] of keyed) share(indexes, byKey.get(key) ?? ZERO);
    // Money with no matching line goes to the open lines; with none, to every line of the category.
    share(open.length > 0 ? open : lineIndexes, rest);
  }
  return lines.map((line, index) => {
    const quotedCents = toCents(line.amountCents);
    const actualCents = actualOf[index] as Cents;
    const differenceCents = actualCents - quotedCents;
    return {
      index,
      category: line.category,
      description: line.description ?? null,
      quotedQuantity: blank(line.quantity) ? null : scaledToNumber(quantityToScaled(line.quantity as Decimal), 3),
      quotedCents,
      actualCents,
      differenceCents,
      differencePctBp: pctBp(differenceCents, quotedCents),
      tone: toneOf(signOf(differenceCents), line.category === 'revenue' ? 'up' : 'down'),
      matchedBy: (matched[index] as { by: QuoteLineRow['matchedBy'] }).by,
    };
  });
}

export interface QuoteToBudgetRow {
  readonly key: 'revenue' | 'labor' | 'material' | 'other' | 'shared' | 'cost' | 'profit';
  readonly label: string;
  readonly quoteCents: Cents;
  readonly budgetCents: Cents;
  /** Budget minus quote. */
  readonly gapCents: Cents;
  readonly tone: Tone;
}

export interface QuoteToBudget {
  readonly rows: QuoteToBudgetRow[];
  readonly quoteMarginBp: number | null;
  readonly budgetMarginBp: number | null;
  /** Budget margin minus quote margin, in basis points. */
  readonly marginGapBp: number | null;
}

/** The "Quote to budget" strip: the gap between what was sold and what was planned. */
export function quoteToBudget(quote: PlanTotals, budget: PlanTotals): QuoteToBudget {
  const q = planFigures(quote);
  const b = planFigures(budget);
  const row = (key: QuoteToBudgetRow['key'], label: string, quoteCents: Cents, budgetCents: Cents, goodWhen: 'up' | 'down'): QuoteToBudgetRow => ({
    key,
    label,
    quoteCents,
    budgetCents,
    gapCents: budgetCents - quoteCents,
    tone: toneOf(signOf(budgetCents - quoteCents), goodWhen),
  });
  return {
    rows: [
      row('revenue', 'Revenue', q.revenueCents, b.revenueCents, 'up'),
      row('labor', 'Labor cost', q.laborCents, b.laborCents, 'down'),
      row('material', 'Material cost', q.materialCents, b.materialCents, 'down'),
      row('other', 'Other cost', q.otherCents, b.otherCents, 'down'),
      row('shared', 'Time not on a job', q.sharedCents, b.sharedCents, 'down'),
      row('cost', 'Total cost', q.costCents, b.costCents, 'down'),
      row('profit', 'Profit', q.profitCents, b.profitCents, 'up'),
    ],
    quoteMarginBp: q.marginBp,
    budgetMarginBp: b.marginBp,
    marginGapBp: q.marginBp === null || b.marginBp === null ? null : b.marginBp - q.marginBp,
  };
}
