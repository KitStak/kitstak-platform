/**
 * Why profit changed: the variance waterfall (docs/pulse/SPEC.md 4.11). Each bar is rounded to a
 * cent and "Other" is the balancing bar, so the bars always add up exactly to the total. Pure functions.
 */
import { type Cents, ZERO, absBig, divRound, hoursToScaled, scaledToNumber } from '../money';
import type { ActualTotals, PlanTotals } from './types';
import { type FlexFactor, type PlanFigures, flexFactor, flexPlan, planFigures } from './plan';
import { type SentenceOptions, sentenceMoney, sentenceNumber } from './words';

/**
 * `so_far` (open jobs): from the plan for the work done so far to actual. `at_finish` (open jobs):
 * the same, with the projection as "actual" and a volume bar. `whole_job` (completed jobs): from
 * the whole plan to actual, with a volume bar.
 */
export type VarianceMode = 'so_far' | 'at_finish' | 'whole_job';

export type VarianceKey = 'volume' | 'price' | 'labor_rate' | 'labor_efficiency' | 'scrap' | 'material' | 'shared' | 'other';

/** The on screen name of each bar. */
export const VARIANCE_LABELS: Readonly<Record<VarianceKey, string>> = {
  volume: 'Volume',
  price: 'Price',
  labor_rate: 'Labor rate',
  labor_efficiency: 'Labor efficiency',
  scrap: 'Scrap',
  material: 'Material',
  shared: 'Time not on a job',
  other: 'Other',
};

/** Bar order on the chart. */
export const VARIANCE_ORDER: readonly VarianceKey[] = ['volume', 'price', 'labor_rate', 'labor_efficiency', 'scrap', 'material', 'shared', 'other'];

export interface VarianceBar {
  readonly key: VarianceKey;
  readonly label: string;
  /** Effect on profit: above zero helped, below zero hurt. */
  readonly amountCents: Cents;
}

export interface Waterfall {
  readonly mode: VarianceMode;
  readonly factor: FlexFactor;
  /** The whole plan. */
  readonly plan: PlanFigures;
  /** The plan flexed to the work done. */
  readonly flexed: PlanFigures;
  /** Where the chart starts: the flexed plan profit in `so_far` mode, the whole plan profit otherwise. */
  readonly startCents: Cents;
  /** Actual (or projected) profit. */
  readonly endCents: Cents;
  /** `endCents - startCents`. The bars add up to this exactly. */
  readonly totalCents: Cents;
  readonly bars: VarianceBar[];
  /** Labor hours above the flexed plan (below zero means fewer). */
  readonly hoursOverPlan: number;
  /** Planned labor rate in cents an hour, or `null` when the plan has no hours. */
  readonly planRateCents: Cents | null;
}

function profitOf(totals: ActualTotals): Cents {
  return totals.revenueCents - totals.laborCents - totals.materialCents - totals.otherCents - totals.sharedCents;
}

/**
 * Splits the gap between planned and actual profit into bars.
 *
 * Worked example (so far): plan flexed to 40% has profit $1,800.00 and actual profit is
 * $1,565.00. Bars: price $0.00, labor rate -$125.00, labor efficiency -$550.00, scrap -$90.00,
 * material -$10.00, time not on a job -$60.00, other +$600.00. Total -$235.00.
 */
export function varianceWaterfall(input: { plan: PlanTotals; actual: ActualTotals; mode?: VarianceMode }): Waterfall {
  const mode = input.mode ?? 'so_far';
  const a = input.actual;
  const whole = planFigures(input.plan);
  const factor = flexFactor(input.plan, a);
  const flexed = flexPlan(input.plan, factor);
  const actualProfit = profitOf(a);
  const scrap = a.scrapCents ?? ZERO;
  const hoursA = hoursToScaled(a.hours);
  const hoursP = hoursToScaled(flexed.laborHours);

  const price = a.revenueCents - flexed.revenueCents;
  let laborRate = ZERO;
  let laborEfficiency: Cents;
  if (hoursP <= ZERO || hoursA <= ZERO) {
    laborEfficiency = -(a.laborCents - flexed.laborCents);
  } else {
    laborRate = -(a.laborCents - divRound(hoursA * flexed.laborCents, hoursP));
    laborEfficiency = -divRound((hoursA - hoursP) * flexed.laborCents, hoursP);
  }
  const scrapBar = -scrap;
  const material = -(a.materialCents - scrap - flexed.materialCents);
  const shared = -(a.sharedCents - flexed.sharedCents);
  const other = actualProfit - flexed.profitCents - (price + laborRate + laborEfficiency + scrapBar + material + shared);

  const bars: VarianceBar[] = [];
  const push = (key: VarianceKey, amountCents: Cents): void => {
    bars.push({ key, label: VARIANCE_LABELS[key], amountCents });
  };
  const startCents = mode === 'so_far' ? flexed.profitCents : whole.profitCents;
  if (mode !== 'so_far') push('volume', flexed.profitCents - whole.profitCents);
  push('price', price);
  push('labor_rate', laborRate);
  push('labor_efficiency', laborEfficiency);
  push('scrap', scrapBar);
  push('material', material);
  push('shared', shared);
  push('other', other);
  return {
    mode,
    factor,
    plan: whole,
    flexed,
    startCents,
    endCents: actualProfit,
    totalCents: actualProfit - startCents,
    bars,
    hoursOverPlan: scaledToNumber(hoursA - hoursP, 2),
    planRateCents: hoursP > ZERO ? divRound(flexed.laborCents * BigInt(100), hoursP) : null,
  };
}

export interface WaterfallSum {
  readonly startCents: Cents;
  readonly endCents: Cents;
  readonly totalCents: Cents;
  readonly bars: VarianceBar[];
  readonly jobCount: number;
}

/**
 * Adds waterfalls of many jobs for a client, a job type, a site or a month. The bars are worked
 * out per job and then summed: units of different jobs are never added into one share done.
 */
export function sumWaterfalls(list: readonly Pick<Waterfall, 'startCents' | 'endCents' | 'totalCents' | 'bars'>[]): WaterfallSum {
  const amounts = new Map<VarianceKey, Cents>();
  let startCents = ZERO;
  let endCents = ZERO;
  for (const waterfall of list) {
    startCents += waterfall.startCents;
    endCents += waterfall.endCents;
    for (const bar of waterfall.bars) amounts.set(bar.key, (amounts.get(bar.key) ?? ZERO) + bar.amountCents);
  }
  const bars = VARIANCE_ORDER.filter((key) => amounts.has(key)).map((key) => ({ key, label: VARIANCE_LABELS[key], amountCents: amounts.get(key) as Cents }));
  return { startCents, endCents, totalCents: endCents - startCents, bars, jobCount: list.length };
}

/** The bar that hurt profit the most, or `null` when no bar is below zero. */
export function biggestDrag(bars: readonly VarianceBar[]): VarianceBar | null {
  let worst: VarianceBar | null = null;
  for (const bar of bars) if (bar.amountCents < ZERO && (!worst || bar.amountCents < worst.amountCents)) worst = bar;
  return worst;
}

/** The bar that helped profit the most, or `null` when no bar is above zero. */
export function biggestLift(bars: readonly VarianceBar[]): VarianceBar | null {
  let best: VarianceBar | null = null;
  for (const bar of bars) if (bar.amountCents > ZERO && (!best || bar.amountCents > best.amountCents)) best = bar;
  return best;
}

function effect(amount: Cents, options: SentenceOptions): string {
  if (options.seesMoney === false || amount === ZERO) return '';
  return amount < ZERO ? ` That cost ${sentenceMoney(amount, options)}.` : ` That saved ${sentenceMoney(amount, options)}.`;
}

/**
 * One plain line for a bar, for example "Labor efficiency: the crew needed 25 more hours than
 * planned for this many units. That cost $550." Pass `seesMoney: false` for the line with no money in it.
 */
export function varianceReading(bar: VarianceBar, waterfall: Pick<Waterfall, 'hoursOverPlan'>, options: SentenceOptions = {}): string {
  const amount = bar.amountCents;
  const money = options.seesMoney === false ? '' : sentenceMoney(amount, options);
  const flat = amount === ZERO;
  switch (bar.key) {
    case 'volume':
      if (flat) return 'Volume: the job made the planned number of units.';
      return amount > ZERO
        ? `Volume: the job made more units than planned.${money ? ` That added ${money}.` : ''}`
        : `Volume: the job made fewer units than planned.${money ? ` That took away ${money}.` : ''}`;
    case 'price':
      if (flat) return 'Price: revenue matched the plan for this many units.';
      return amount > ZERO
        ? `Price: revenue came in over the plan for this many units.${money ? ` That added ${money}.` : ''}`
        : `Price: revenue came in under the plan for this many units.${money ? ` That took away ${money}.` : ''}`;
    case 'labor_rate':
      if (flat) return 'Labor rate: an hour cost what the plan said.';
      return amount < ZERO ? `Labor rate: an hour cost more than planned.${effect(amount, options)}` : `Labor rate: an hour cost less than planned.${effect(amount, options)}`;
    case 'labor_efficiency': {
      const hours = Math.abs(waterfall.hoursOverPlan);
      const hoursText = `${sentenceNumber(hours, 2, options)} ${hours === 1 ? 'hour' : 'hours'}`;
      if (flat) return 'Labor efficiency: the crew used the planned hours for this many units.';
      if (hours === 0) return amount < ZERO ? `Labor efficiency: labor cost more than planned.${effect(amount, options)}` : `Labor efficiency: labor cost less than planned.${effect(amount, options)}`;
      return amount < ZERO
        ? `Labor efficiency: the crew needed ${hoursText.replace(/ (hours?)$/, ' more $1')} than planned for this many units.${effect(amount, options)}`
        : `Labor efficiency: the crew needed ${hoursText.replace(/ (hours?)$/, ' fewer $1')} than planned for this many units.${effect(amount, options)}`;
    }
    case 'scrap':
      if (flat) return 'Scrap: no material was scrapped.';
      return money ? `Scrap: ${money} of material was scrapped.` : 'Scrap: some material was scrapped.';
    case 'material':
      if (flat) return 'Material: good units used the planned amount of material.';
      return amount < ZERO ? `Material: parts for good units cost more than planned.${effect(amount, options)}` : `Material: parts for good units cost less than planned.${effect(amount, options)}`;
    case 'shared':
      if (flat) return 'Time not on a job: this job carried what the plan said.';
      return amount < ZERO
        ? `Time not on a job: this job carried more meetings, cleanup and waiting than planned.${effect(amount, options)}`
        : `Time not on a job: this job carried less meetings, cleanup and waiting than planned.${effect(amount, options)}`;
    default:
      if (flat) return 'Other: everything else matched the plan.';
      return amount < ZERO ? `Other: other costs and fees came in worse than planned.${effect(amount, options)}` : `Other: other costs and fees came in better than planned.${effect(amount, options)}`;
  }
}

/** The share of the job that is done, in basis points: a factor of 2/5 is 4000 (40%). */
export function factorBp(factor: FlexFactor): number {
  return Number(divRound(factor.num * BigInt(10000), absBig(factor.den)));
}
