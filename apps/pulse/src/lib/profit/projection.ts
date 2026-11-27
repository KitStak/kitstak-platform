/**
 * Projected finish (docs/pulse/SPEC.md 4.13): what a job will cost and earn by the time it is
 * done, from the pace so far blended with the plan. Estimates stay exact fractions and are
 * rounded only at the named outputs: pace to 3 places, hours to 2 places, money to a cent.
 * Pure functions.
 */
import {
  type Cents,
  type Decimal,
  type Fraction,
  FRAC_ONE,
  FRAC_ZERO,
  ZERO,
  frac,
  fracAdd,
  fracCeil,
  fracCmp,
  fracDiv,
  fracMax,
  fracMin,
  fracMul,
  fracOf,
  fracRound,
  fracSub,
  fracToNumber,
  fracToScaled,
  hoursToScaled,
  marginBp,
  quantityToScaled,
  scaledToNumber,
} from '../money';
import { DEFAULT_WORKING_DAYS, addWorkDays } from './calendar';
import { planFigures, planHasCosts } from './plan';
import { CONFIDENCE_LABELS, type ActualTotals, type Confidence, type IsoDate, type JobKind, type JobMode, type JobStatus, type MaterialMethod, type MoneyBuckets, type PlanTotals, type PricingModel } from './types';
import { type SentenceOptions, countWord, sentenceNumber } from './words';

const HUNDRED = BigInt(100);
const THOUSAND = BigInt(1000);

function blank(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

/**
 * How a job is judged. `projected`: an active one time job with planned units or plan hours.
 * `actuals`: an active ongoing job, or an active job with nothing planned. `final`: a completed
 * job. Planned, on hold and cancelled jobs have no mode (`null`).
 */
export function jobMode(input: { status: JobStatus; kind: JobKind; plannedUnits?: Decimal | null; planLaborHours?: Decimal | null }): JobMode | null {
  if (input.status === 'completed') return 'final';
  if (input.status !== 'active') return null;
  const units = blank(input.plannedUnits) ? ZERO : quantityToScaled(input.plannedUnits as Decimal);
  const hours = blank(input.planLaborHours) ? ZERO : hoursToScaled(input.planLaborHours as Decimal);
  return input.kind === 'one_time' && (units > ZERO || hours > ZERO) ? 'projected' : 'actuals';
}

/** Totals of the last evidence days (see `lastEvidenceWindow`). */
export interface ProjectionWindow {
  /** Number of evidence days in the window (up to 5). */
  readonly days: number;
  readonly unitsGood: Decimal;
  readonly paceHours: Decimal;
  /** All labor hours of those days. When left out the pace hours are used. */
  readonly hours?: Decimal | null;
  readonly laborCostCents: Cents;
}

export interface ProjectionInput {
  readonly status: JobStatus;
  readonly kind: JobKind;
  readonly pricingModel: PricingModel;
  readonly plannedUnits: Decimal | null;
  /** The budget, or the quote when there is no budget, or `null` with no plan. */
  readonly plan: PlanTotals | null;
  /** Whole job totals so far. */
  readonly actual: ActualTotals;
  /** Service revenue inside `actual.revenueCents`. Default 0. */
  readonly serviceRevenueCents?: Cents;
  /** Other revenue (fees, adjustments, credits) inside `actual.revenueCents`. Default 0. */
  readonly otherRevenueCents?: Cents;
  /** Cost of the service entries so far (their labor, material and shared). Default 0. */
  readonly serviceCostCents?: Cents;
  /** The material part of `serviceCostCents`, kept out of the material per unit rate. Default 0. */
  readonly serviceMaterialCents?: Cents;
  /** The last 5 evidence days, or `null` when there is none yet. */
  readonly window: ProjectionWindow | null;
  /** Evidence days over the whole job. */
  readonly evidenceDays: number;
  /** Target pace (4.12), or `null`. */
  readonly targetPace: Decimal | null;
  readonly unitPrice?: Decimal | null;
  readonly fixedPriceCents?: Cents | null;
  readonly billRateCents?: Cents | null;
  readonly materialMethod?: MaterialMethod;
  /** The job's material cost per unit, the last fallback for material still to come. */
  readonly materialCostPerUnit?: Decimal | null;
  /** For `actual` jobs with planned quantities: see `materialLeftFromUsage`. */
  readonly plannedMaterialLeftCents?: Cents | null;
  /** Today's regular rate of the job's labor class, else the org default rate. The last fallback for the cost of an hour. */
  readonly fallbackRateCents?: Cents | null;
  /** Today in the site time zone. */
  readonly today: IsoDate;
  /** `settings.working_days` as JS weekday numbers. Default Monday to Friday. */
  readonly workingDays?: readonly number[];
  /** Actuals mode: the money of the last 30 days. */
  readonly last30?: (MoneyBuckets & { readonly unitsGood?: Decimal; readonly hours?: Decimal }) | null;
}

export interface Projection {
  readonly mode: JobMode | null;
  /** What the projection is measured by: units left, plan hours left, or nothing (no projection). */
  readonly basis: 'units' | 'hours' | 'none';
  /** False when there is no target pace and no evidence day, so the projection equals the plan. */
  readonly paceKnown: boolean;
  /**
   * False when Pulse cannot price the work still to do: no cost plan and nothing to project from,
   * or hours left with no cost of an hour. Unknown cost is never counted as zero cost: the
   * margin is `null` and the money at finish is only what happened so far (rule D4).
   */
  readonly costKnown: boolean;
  readonly unitsLeft: number | null;
  /** Share done in basis points. It can pass 10000 when more is made than planned. */
  readonly pctCompleteBp: number | null;
  /** The same, capped at 10000 for progress bars. */
  readonly pctCompleteShownBp: number | null;
  /** Units per person per hour over the last evidence days, to 3 places. */
  readonly actualPace: number | null;
  /** Target pace, to 3 places. */
  readonly planPace: number | null;
  /** `w` from 4.13 in basis points: how much the projection trusts the actual pace over the plan. */
  readonly paceWeightBp: number | null;
  /** The pace the rest of the job is assumed to run at, to 3 places. */
  readonly paceUph: number | null;
  readonly confidence: Confidence | null;
  readonly hoursLeft: number | null;
  /** Cost of an hour assumed for the rest of the job, in cents. */
  readonly rateLeftCents: Cents | null;
  readonly laborLeftCents: Cents;
  readonly sharedLeftCents: Cents;
  readonly materialLeftCents: Cents;
  readonly otherLeftCents: Cents;
  readonly serviceCostLeftCents: Cents;
  readonly serviceRevenueLeftCents: Cents;
  readonly costSoFarCents: Cents;
  readonly costAtFinishCents: Cents;
  readonly revenueAtFinishCents: Cents;
  readonly projectedProfitCents: Cents;
  readonly projectedMarginBp: number | null;
  readonly projectedLaborHours: number;
  readonly projectedUnits: number;
  /** Units a day at the assumed pace and the crew hours of the last evidence days. */
  readonly unitsPerDay: number | null;
  readonly workDaysLeft: number | null;
  readonly projectedFinishDate: IsoDate | null;
  /** The projection as totals, for the "Projected at finish" column and the at finish waterfall. */
  readonly atFinish: ActualTotals;
  /** Number of days in the pace window, for the note. */
  readonly windowDays: number;
}

function costOf(totals: MoneyBuckets): Cents {
  return totals.laborCents + totals.materialCents + totals.otherCents + totals.sharedCents;
}

function cents(value: Cents): Fraction {
  return frac(value);
}

/** Days of real work it takes before a projection can be called "Solid". One day is only ever an early guess. */
const SOLID_DAYS = 3;

function confidenceOf(weight: Fraction, hasEvidence: boolean, evidenceDays: number): Confidence {
  if (!hasEvidence) return 'plan';
  if (evidenceDays <= 1) return 'early';
  if (fracCmp(weight, FRAC_ONE) >= 0 && evidenceDays >= SOLID_DAYS) return 'solid';
  return fracCmp(weight, frac(BigInt(1), BigInt(2))) < 0 ? 'early' : 'good';
}

/** "Based on the plan" only when there is a plan to base it on. */
function withPlan(confidence: Confidence, input: ProjectionInput): Confidence | null {
  return confidence === 'plan' && input.plan === null ? null : confidence;
}

function flat(input: ProjectionInput, mode: JobMode | null, totals: ActualTotals): Projection {
  const cost = costOf(totals);
  const profit = totals.revenueCents - cost;
  return {
    mode,
    basis: 'none',
    paceKnown: true,
    costKnown: true,
    unitsLeft: null,
    pctCompleteBp: null,
    pctCompleteShownBp: null,
    actualPace: null,
    planPace: blank(input.targetPace) ? null : fracToNumber(fracOf(input.targetPace as Decimal, 3), 3),
    paceWeightBp: null,
    paceUph: null,
    confidence: null,
    hoursLeft: null,
    rateLeftCents: null,
    laborLeftCents: ZERO,
    sharedLeftCents: ZERO,
    materialLeftCents: ZERO,
    otherLeftCents: ZERO,
    serviceCostLeftCents: ZERO,
    serviceRevenueLeftCents: ZERO,
    costSoFarCents: cost,
    costAtFinishCents: cost,
    revenueAtFinishCents: totals.revenueCents,
    projectedProfitCents: profit,
    projectedMarginBp: marginBp(profit, totals.revenueCents),
    projectedLaborHours: scaledToNumber(hoursToScaled(totals.hours), 2),
    projectedUnits: scaledToNumber(quantityToScaled(totals.unitsGood), 3),
    unitsPerDay: null,
    workDaysLeft: null,
    projectedFinishDate: null,
    atFinish: totals,
    windowDays: 0,
  };
}

/**
 * Projects one job to its finish.
 *
 * Projected mode, unit based: the pace for the rest of the job is a blend of the target pace and
 * the pace of the last 5 evidence days, weighted by `w = min(1, max(share done / 20%, evidence
 * days / 3))`. Hours left, labor, time not on a job, material, other cost and service money are
 * added to what happened so far. Hour based jobs (no planned units) run out their plan hours.
 * Actuals mode returns the last 30 days. Final mode returns the whole job.
 *
 * Worked example: 4,000 of 10,000 units done, last 5 evidence days at 32 units per person per
 * hour and $23.00 an hour, gives 187.50 hours left, cost at finish $13,587.50, revenue at finish
 * $17,500.00, projected profit $3,912.50 and a 22.36% margin.
 */
export function projectJob(input: ProjectionInput): Projection {
  const plannedUnits = blank(input.plannedUnits) ? ZERO : quantityToScaled(input.plannedUnits as Decimal);
  const plan = input.plan ? planFigures(input.plan) : null;
  const planHours = plan ? hoursToScaled(plan.laborHours) : ZERO;
  const mode = jobMode({ status: input.status, kind: input.kind, plannedUnits: input.plannedUnits, planLaborHours: plan ? plan.laborHours : null });
  const a = input.actual;
  if (mode === 'actuals') {
    const last = input.last30;
    if (!last) return flat(input, mode, { unitsGood: 0, hours: 0, revenueCents: ZERO, laborCents: ZERO, materialCents: ZERO, otherCents: ZERO, sharedCents: ZERO });
    return flat(input, mode, { unitsGood: last.unitsGood ?? 0, hours: last.hours ?? 0, revenueCents: last.revenueCents, laborCents: last.laborCents, materialCents: last.materialCents, otherCents: last.otherCents, sharedCents: last.sharedCents });
  }
  if (mode !== 'projected') return flat(input, mode, a);

  const unitsGood = quantityToScaled(a.unitsGood);
  const hoursSoFar = hoursToScaled(a.hours);
  const costSoFar = costOf(a);
  const window = input.window && input.window.days > 0 ? input.window : null;
  const windowPaceHours = window ? hoursToScaled(window.paceHours) : ZERO;
  const windowUnits = window ? quantityToScaled(window.unitsGood) : ZERO;
  const hasEvidence = input.evidenceDays > 0 && window !== null && windowPaceHours > ZERO;
  const unitBased = plannedUnits > ZERO;
  const serviceRevenue = input.serviceRevenueCents ?? ZERO;
  const serviceCost = input.serviceCostCents ?? ZERO;
  const otherRevenue = input.otherRevenueCents ?? ZERO;

  // share done and the trust weight w
  const pct: Fraction = unitBased ? frac(unitsGood, plannedUnits) : frac(hoursSoFar, planHours);
  const weight = fracMin(FRAC_ONE, fracMax(fracMul(pct, frac(BigInt(5))), frac(BigInt(Math.max(0, Math.trunc(input.evidenceDays))), BigInt(3))));
  const pctBp = Number(fracRound(fracMul(pct, frac(BigInt(10000)))));

  // pace
  const planPace = blank(input.targetPace) ? null : fracOf(input.targetPace as Decimal, 3);
  const planPaceOk = planPace !== null && planPace.n > ZERO ? planPace : null;
  // units x 1000 over hours x 100, so times 100 / 1000 gives units an hour
  const actualPace = hasEvidence ? frac(windowUnits * HUNDRED, windowPaceHours * THOUSAND) : null;
  let pace: Fraction | null = null;
  if (unitBased) {
    if (planPaceOk && actualPace) pace = fracAdd(fracMul(planPaceOk, fracSub(FRAC_ONE, weight)), fracMul(actualPace, weight));
    else pace = actualPace ?? planPaceOk;
    if (pace && pace.n <= ZERO) pace = planPaceOk;
  }

  const unitsLeft = unitBased ? (plannedUnits > unitsGood ? plannedUnits - unitsGood : ZERO) : ZERO;
  const unitsLeftFrac = frac(unitsLeft, THOUSAND);
  const paceKnown = !unitBased || unitsLeft === ZERO || pace !== null;

  // hours left, as an exact fraction of hours
  let hoursLeft: Fraction = FRAC_ZERO;
  if (unitBased) hoursLeft = pace && unitsLeft > ZERO ? fracDiv(unitsLeftFrac, pace) : FRAC_ZERO;
  else hoursLeft = frac(planHours > hoursSoFar ? planHours - hoursSoFar : ZERO, HUNDRED);

  // cost of an hour for the rest of the job, in cents
  const windowHours = window ? (blank(window.hours) ? windowPaceHours : hoursToScaled(window.hours as Decimal)) : ZERO;
  let rateLeft: Fraction | null = null;
  if (hasEvidence && window && windowHours > ZERO && window.laborCostCents > ZERO) rateLeft = frac(window.laborCostCents * HUNDRED, windowHours);
  else if (hoursSoFar > ZERO && a.laborCents > ZERO) rateLeft = frac(a.laborCents * HUNDRED, hoursSoFar);
  else if (plan && planHours > ZERO && plan.laborCents > ZERO) rateLeft = frac(plan.laborCents * HUNDRED, planHours);
  else if (input.fallbackRateCents !== null && input.fallbackRateCents !== undefined) rateLeft = cents(input.fallbackRateCents);

  const planUnits = plan ? quantityToScaled(plan.units) : ZERO;

  if (!paceKnown) {
    // No target pace and no evidence day: the projection equals the plan. With no cost plan (none at
    // all, or only a price) the cost of the work left is unknown, so only what happened so far is shown.
    const costPlan = input.plan !== null && planHasCosts(input.plan) && plan !== null;
    const totals: ActualTotals = costPlan
      ? { unitsGood: scaledToNumber(plannedUnits, 3), hours: plan.laborHours, revenueCents: plan.revenueCents, laborCents: plan.laborCents, materialCents: plan.materialCents, otherCents: plan.otherCents, sharedCents: plan.sharedCents }
      : a;
    const base = flat(input, mode, totals);
    return {
      ...base,
      basis: 'units',
      paceKnown: false,
      costKnown: costPlan,
      projectedMarginBp: costPlan ? base.projectedMarginBp : null,
      unitsLeft: scaledToNumber(unitsLeft, 3),
      pctCompleteBp: pctBp,
      pctCompleteShownBp: Math.min(10000, pctBp),
      paceWeightBp: Number(fracRound(fracMul(weight, frac(BigInt(10000))))),
      confidence: costPlan ? 'plan' : null,
      costSoFarCents: costSoFar,
      rateLeftCents: rateLeft ? fracRound(rateLeft) : null,
    };
  }

  const laborLeft = rateLeft ? fracRound(fracMul(hoursLeft, rateLeft)) : ZERO;

  let sharedLeft = ZERO;
  if (hoursSoFar > ZERO) sharedLeft = fracRound(fracMul(hoursLeft, frac(a.sharedCents * HUNDRED, hoursSoFar)));
  else if (plan && unitBased && planUnits > ZERO) sharedLeft = fracRound(fracMul(cents(plan.sharedCents), frac(unitsLeft, planUnits)));
  else if (plan && !unitBased && planHours > ZERO) sharedLeft = fracRound(fracMul(cents(plan.sharedCents), fracDiv(hoursLeft, frac(planHours, HUNDRED))));

  let materialLeft = ZERO;
  if (unitBased && unitsLeft > ZERO) {
    const jobMaterial = a.materialCents - (input.serviceMaterialCents ?? ZERO);
    if (input.materialMethod === 'actual' && input.plannedMaterialLeftCents !== null && input.plannedMaterialLeftCents !== undefined) {
      materialLeft = input.plannedMaterialLeftCents;
    } else if (unitsGood > ZERO) {
      materialLeft = fracRound(fracMul(cents(jobMaterial), frac(unitsLeft, unitsGood)));
    } else if (plan && planUnits > ZERO && planHasCosts(input.plan)) {
      materialLeft = fracRound(fracMul(cents(plan.materialCents), frac(unitsLeft, planUnits)));
    } else if (!blank(input.materialCostPerUnit)) {
      materialLeft = fracRound(fracMul(fracMul(unitsLeftFrac, fracOf(input.materialCostPerUnit as Decimal, 4)), frac(HUNDRED)));
    }
    if (materialLeft < ZERO) materialLeft = ZERO;
  }

  const otherLeft = plan && plan.otherCents > a.otherCents ? plan.otherCents - a.otherCents : ZERO;

  let serviceRevenueLeft = ZERO;
  let serviceCostLeft = ZERO;
  if (unitBased && unitsGood > ZERO && unitsLeft > ZERO) {
    const share = frac(unitsLeft, unitsGood);
    serviceRevenueLeft = fracRound(fracMul(cents(serviceRevenue), share));
    serviceCostLeft = fracRound(fracMul(cents(serviceCost), share));
  }

  const costAtFinish = costSoFar + laborLeft + sharedLeft + materialLeft + otherLeft + serviceCostLeft;

  let revenueAtFinish: Cents;
  if (input.pricingModel === 'fixed' && input.fixedPriceCents !== null && input.fixedPriceCents !== undefined) {
    revenueAtFinish = input.fixedPriceCents + serviceRevenue + otherRevenue + serviceRevenueLeft;
  } else if (input.pricingModel === 'hourly') {
    const billed = input.billRateCents !== null && input.billRateCents !== undefined ? fracRound(fracMul(hoursLeft, cents(input.billRateCents))) : ZERO;
    revenueAtFinish = a.revenueCents + billed + serviceRevenueLeft;
  } else if (input.pricingModel === 'per_unit') {
    const more = blank(input.unitPrice) ? ZERO : fracRound(fracMul(fracMul(unitsLeftFrac, fracOf(input.unitPrice as Decimal, 4)), frac(HUNDRED)));
    revenueAtFinish = a.revenueCents + more + serviceRevenueLeft;
  } else {
    revenueAtFinish = a.revenueCents + serviceRevenueLeft;
  }

  const projectedProfit = revenueAtFinish - costAtFinish;
  // Hours still to work with no cost of an hour anywhere: their labor is unknown, not free.
  const costKnown = !(rateLeft === null && fracCmp(hoursLeft, FRAC_ZERO) > 0);
  const hoursLeftScaled = fracToScaled(hoursLeft, 2);
  const projectedHours = hoursSoFar + hoursLeftScaled;

  // finish date from pace
  let unitsPerDay: Fraction | null = null;
  let workDaysLeft: number | null = null;
  let finish: IsoDate | null = null;
  if (unitBased) {
    if (unitsLeft === ZERO) {
      workDaysLeft = 0;
      finish = input.today;
    }
    if (pace && hasEvidence && window) {
      unitsPerDay = fracMul(pace, frac(windowPaceHours, HUNDRED * BigInt(window.days)));
      if (unitsLeft > ZERO && unitsPerDay.n > ZERO) {
        workDaysLeft = Number(fracCeil(fracDiv(unitsLeftFrac, unitsPerDay)));
        finish = addWorkDays(input.today, workDaysLeft, input.workingDays ?? DEFAULT_WORKING_DAYS);
      }
    }
  }

  const projectedUnits = unitBased ? (unitsGood > plannedUnits ? unitsGood : plannedUnits) : unitsGood;
  // Service cost still to come has no bucket of its own in the totals, so it rides with other cost.
  const atFinish: ActualTotals = {
    unitsGood: scaledToNumber(projectedUnits, 3),
    hours: scaledToNumber(projectedHours, 2),
    revenueCents: revenueAtFinish,
    laborCents: a.laborCents + laborLeft,
    materialCents: a.materialCents + materialLeft,
    scrapCents: a.scrapCents ?? ZERO,
    otherCents: a.otherCents + otherLeft + serviceCostLeft,
    sharedCents: a.sharedCents + sharedLeft,
    setupHours: a.setupHours,
  };

  return {
    mode,
    basis: unitBased ? 'units' : 'hours',
    paceKnown: true,
    costKnown,
    unitsLeft: unitBased ? scaledToNumber(unitsLeft, 3) : null,
    pctCompleteBp: pctBp,
    pctCompleteShownBp: Math.min(10000, pctBp),
    actualPace: actualPace ? fracToNumber(actualPace, 3) : null,
    planPace: planPaceOk ? fracToNumber(planPaceOk, 3) : null,
    paceWeightBp: Number(fracRound(fracMul(weight, frac(BigInt(10000))))),
    paceUph: pace ? fracToNumber(pace, 3) : null,
    confidence: withPlan(unitBased ? confidenceOf(weight, hasEvidence, input.evidenceDays) : hoursSoFar > ZERO ? confidenceOf(weight, true, input.evidenceDays > 0 ? input.evidenceDays : SOLID_DAYS) : 'plan', input),
    hoursLeft: scaledToNumber(hoursLeftScaled, 2),
    rateLeftCents: rateLeft ? fracRound(rateLeft) : null,
    laborLeftCents: laborLeft,
    sharedLeftCents: sharedLeft,
    materialLeftCents: materialLeft,
    otherLeftCents: otherLeft,
    serviceCostLeftCents: serviceCostLeft,
    serviceRevenueLeftCents: serviceRevenueLeft,
    costSoFarCents: costSoFar,
    costAtFinishCents: costAtFinish,
    revenueAtFinishCents: revenueAtFinish,
    projectedProfitCents: projectedProfit,
    projectedMarginBp: costKnown ? marginBp(projectedProfit, revenueAtFinish) : null,
    projectedLaborHours: scaledToNumber(projectedHours, 2),
    projectedUnits: scaledToNumber(projectedUnits, 3),
    unitsPerDay: unitsPerDay ? fracToNumber(unitsPerDay, 3) : null,
    workDaysLeft,
    projectedFinishDate: finish,
    atFinish,
    windowDays: window ? window.days : 0,
  };
}

/**
 * Says in words what the projection assumed, with the confidence word first, for example
 * "Early guess. We assume the rest of the job runs at 35 units per person per hour, a blend of
 * your plan (40) and your first day (25)."
 */
export function projectionNote(projection: Projection, options: SentenceOptions = {}): string {
  const n = (value: number): string => sentenceNumber(value, 1, options);
  if (projection.mode === 'final') return 'This job is complete. These are the final numbers.';
  if (projection.mode === 'actuals') return 'This is ongoing work, so Pulse shows the last 30 days in place of a projection.';
  if (projection.mode === null) return 'This job is not active, so there is no projection.';
  const lead = projection.confidence ? `${CONFIDENCE_LABELS[projection.confidence]}.` : '';
  if (projection.basis === 'hours') {
    return `${lead} We assume the job uses the rest of its planned hours: ${sentenceNumber(projection.hoursLeft ?? 0, 2, options)} labor hours to go.`.trim();
  }
  if (!projection.paceKnown) return 'There is no target pace and no finished day yet, so the projection is the plan.';
  if (projection.unitsLeft === 0) return 'This job has reached its planned units, so the projection is what happened so far.';
  const pace = projection.paceUph;
  if (pace === null) return 'There is no target pace and no finished day yet, so the projection is the plan.';
  const days = projection.windowDays;
  const evidence = days === 1 ? 'your first day' : `your last ${countWord(days, 'day')}`;
  if (projection.actualPace !== null && projection.planPace !== null && (projection.paceWeightBp ?? 0) < 10000) {
    return `${lead} We assume the rest of the job runs at ${n(pace)} units per person per hour, a blend of your plan (${n(projection.planPace)}) and ${evidence} (${n(projection.actualPace)}).`;
  }
  if (projection.actualPace !== null) return `${lead} We assume the rest of the job runs at ${n(pace)} units per person per hour, the pace of ${evidence}.`;
  return `${lead} We assume the rest of the job runs at your target pace of ${n(pace)} units per person per hour.`;
}
