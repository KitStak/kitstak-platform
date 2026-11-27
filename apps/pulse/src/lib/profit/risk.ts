/**
 * Risk status (docs/pulse/SPEC.md 4.14): is a job on track, worth a heads up, at risk or losing
 * money, and why. Rules are grouped; the first group with a matching rule sets the status.
 * Reasons carry numbers only. The words are written at read time by `riskSentence`, so a reader
 * who cannot see money gets the variant with no money in it. Pure functions.
 */
import { type Cents, type Decimal, ZERO, centsToNumber, divRound, hoursToScaled, mulBp, perUnitCents, priceToScaled, quantityToScaled, toScaled } from '../money';
import type { PulseStatus } from '../constants';
import { DEFAULT_WORKING_DAYS, daysBetween, shortDate, weekdayName, workDaysBetween } from './calendar';
import { flexFactor, flexPlan, planFigures, planHasCosts } from './plan';
import type { Projection } from './projection';
import type { ActualTotals, IsoDate, JobMode, JobStatus, PlanTotals } from './types';
import { type SentenceOptions, countWord, sentenceMoney, sentenceNumber, sentencePercent, sentenceUnitMoney } from './words';

/** Editable thresholds from `pulse.settings`. */
export interface RiskThresholds {
  /** R2: margin under this is at risk. Default 1000 (10%). */
  readonly marginFloorBp: number;
  /** R1: margin this far under target is at risk. Default 1000 (10 points). */
  readonly atRiskGapBp: number;
  /** W2: labor hours this far over plan get a heads up. Default 500 (5%). */
  readonly laborWatchOverBp: number;
  /** R3: labor hours this far over plan are at risk. Default 1500 (15%). */
  readonly laborRiskOverBp: number;
  /** W3: pace under this share of target gets a heads up. Default 9500 (95%). */
  readonly productivityWatchBp: number;
  /** R4: pace under this share of target is at risk. Default 8000 (80%). */
  readonly productivityRiskBp: number;
  /** W4: material per unit this far over plan gets a heads up. Default 500 (5%). */
  readonly materialWatchOverBp: number;
  /** W5: work days with nothing logged. Default 3. */
  readonly noEntryDays: number;
}

export const DEFAULT_RISK_THRESHOLDS: RiskThresholds = {
  marginFloorBp: 1000,
  atRiskGapBp: 1000,
  laborWatchOverBp: 500,
  laborRiskOverBp: 1500,
  productivityWatchBp: 9500,
  productivityRiskBp: 8000,
  materialWatchOverBp: 500,
  noEntryDays: 3,
};

/** Every rule, in the order of the spec table. The order breaks ties between reasons. */
export const RISK_RULES = ['L1', 'L2', 'L3', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'D1', 'D2', 'D3', 'D4', 'W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8'] as const;
export type RiskRule = (typeof RISK_RULES)[number];

/** The status each rule belongs to. */
export function ruleStatus(rule: RiskRule): PulseStatus {
  const group = rule.charAt(0);
  return group === 'L' ? 'losing' : group === 'R' ? 'at_risk' : group === 'D' ? 'no_data' : 'heads_up';
}

/** Status groups in the order they are checked. Losing money and At risk win over Not enough data. */
const STATUS_ORDER: readonly PulseStatus[] = ['losing', 'at_risk', 'no_data', 'heads_up'];

export const NEXT_STEPS = [
  'check_crew',
  'review_price',
  'review_job',
  'log_missing_days',
  'add_labor_rate',
  'add_hours',
  'add_price',
  'add_plan',
  'update_plan',
  'check_materials',
  'check_due_date',
  'check_parts',
] as const;
export type NextStep = (typeof NEXT_STEPS)[number];

/** The words on the next step button. */
export const NEXT_STEP_LABELS: Readonly<Record<NextStep, string>> = {
  check_crew: 'Check the crew size',
  review_price: 'Review the price with the client',
  review_job: 'See why profit changed',
  log_missing_days: 'Log the missing days',
  add_labor_rate: 'Add a labor rate',
  add_hours: 'Add the hours',
  add_price: 'Add a price',
  add_plan: 'Add a quote or a budget',
  update_plan: 'Update the plan or finish the job',
  check_materials: 'Check material use and scrap',
  check_due_date: 'Talk to the client about the due date',
  check_parts: 'Check the parts with the warehouse',
};

const RULE_NEXT_STEP: Readonly<Record<RiskRule, NextStep>> = {
  L1: 'review_price',
  L2: 'review_job',
  L3: 'review_price',
  R1: 'review_price',
  R2: 'review_price',
  R3: 'check_crew',
  R4: 'check_crew',
  R5: 'check_due_date',
  R6: 'check_parts',
  D1: 'add_hours',
  D2: 'add_price',
  D3: 'add_labor_rate',
  D4: 'add_plan',
  W1: 'review_price',
  W2: 'check_crew',
  W3: 'check_crew',
  W4: 'check_materials',
  W5: 'log_missing_days',
  W6: 'check_due_date',
  W7: 'add_plan',
  W8: 'update_plan',
};

/** Numbers and short codes only, so a reason can be stored as JSON and worded later. Money is whole cents. */
export type RiskParams = Readonly<Record<string, number | string | null>>;

export interface RiskReason {
  readonly rule: RiskRule;
  readonly status: PulseStatus;
  readonly params: RiskParams;
  /** How much the rule moves projected profit: 0 or less. */
  readonly impactCents: Cents;
  readonly nextStep: NextStep;
}

export interface RiskAssessment {
  /** `null` for planned, on hold and cancelled jobs: they have no status. */
  readonly status: PulseStatus | null;
  /** Every matching rule. The headline is first, then the rest by impact. Show up to three. */
  readonly reasons: RiskReason[];
  /** The reason that explains the status, or `null` when the job is on track. */
  readonly headline: RiskReason | null;
  /** True when a Not enough data rule matched: mark profit "Not complete yet" and keep the job out of best job lists. */
  readonly laborMissing: boolean;
  /** Numbers for the on track sentence. */
  readonly summary: RiskParams;
}

export interface RiskInput {
  readonly status: JobStatus;
  /** The projection (4.13). In actuals mode it holds the last 30 days, in final mode the whole job. */
  readonly projection: Projection;
  /** Whole job totals so far. */
  readonly actual: ActualTotals;
  /** The budget, or the quote when there is no budget, or `null` when the job has neither. */
  readonly plan: PlanTotals | null;
  readonly plannedUnits: Decimal | null;
  /** The job's target margin (see `targetMarginBp`). */
  readonly targetMarginBp: number;
  readonly thresholds?: Partial<RiskThresholds>;
  /** Evidence days over the whole job. */
  readonly evidenceDays: number;
  /** Pace of the last 5 evidence days. */
  readonly window?: { readonly uph: number | null; readonly paceHours: Decimal; readonly unitsGood: Decimal; readonly days?: number } | null;
  readonly targetPace?: Decimal | null;
  /** Current unit price, for the losing money sentence. */
  readonly unitPrice?: Decimal | null;
  readonly dueDate?: IsoDate | null;
  /** Today in the site time zone. */
  readonly today: IsoDate;
  readonly workingDays?: readonly number[];
  /** R6: the linked warehouse work order is short on parts. */
  readonly wmsShortage?: boolean;
  /** D1: days that have units and no confirmed hours. */
  readonly daysMissingHours?: number;
  /** D2: the job has no price for its pricing model. */
  readonly noPrice?: boolean;
  /** D3: some hours have no labor rate. */
  readonly needsRate?: boolean;
  /** W5: fully past work days in a row with no production entry, counted from the later of the start date and the day the job became active. */
  readonly workDaysSinceLastEntry?: number | null;
  /** L3: days with entries in the last 30 days (actuals mode). */
  readonly entryDays30?: number;
  /** Actuals mode: the plan totals are "per month", so the labor and due date rules apply. */
  readonly hasMonthlyPlan?: boolean;
  /**
   * The job holds a KitStak program (`jobs.program_job`, docs/programs/PULSE_PROGRAMS_SPEC.md 5.2):
   * its plan is the program's month plan, never a quote or a budget, so W7 (no cost plan), D4 (no
   * plan), W8 (past planned units) and the "Add a quote or a budget" next step never fire. The
   * program alerts (P1 to P7) take their place.
   */
  readonly programJob?: boolean;
}

function nonPositive(value: Cents): Cents {
  return value > ZERO ? ZERO : value;
}

function num(value: Cents): number {
  return centsToNumber(value);
}

/**
 * Judges one job. Returns the status, every matching reason with its impact on projected profit,
 * and the headline reason.
 *
 * Worked example: projected margin 22.36% against a 30% target, with labor heading for 312.50
 * hours on a 250 hour plan. R3 fires (over 287.50), so the job is At risk. W1 also matches.
 * Impacts: R3 -$1,687.50, W1 -$1,337.50. Headline: "Labor is heading 25% over the plan."
 */
export function assessRisk(input: RiskInput): RiskAssessment {
  const mode: JobMode | null = input.projection.mode;
  const t: RiskThresholds = { ...DEFAULT_RISK_THRESHOLDS, ...input.thresholds };
  const p = input.projection;
  const target = input.targetMarginBp;
  const pm = p.projectedMarginBp;
  const profit = p.projectedProfitCents;
  const revenue = p.revenueAtFinishCents;
  const summary: RiskParams = { mode, marginBp: pm, targetBp: target };
  if (mode === null || input.status === 'planned' || input.status === 'on_hold' || input.status === 'cancelled') {
    return { status: null, reasons: [], headline: null, laborMissing: false, summary };
  }

  const reasons: RiskReason[] = [];
  const fired = new Set<RiskRule>();
  const add = (rule: RiskRule, params: RiskParams, impactCents: Cents = ZERO): void => {
    fired.add(rule);
    reasons.push({ rule, status: ruleStatus(rule), params: { mode, ...params }, impactCents: nonPositive(impactCents), nextStep: RULE_NEXT_STEP[rule] });
  };

  const plan = input.plan ? planFigures(input.plan) : null;
  const planHours = plan ? hoursToScaled(plan.laborHours) : ZERO;
  const unitsGood = quantityToScaled(input.actual.unitsGood);
  const plannedUnits = input.plannedUnits === null || input.plannedUnits === '' ? ZERO : quantityToScaled(input.plannedUnits);
  const pct = p.pctCompleteBp ?? 0;
  const planApplies = mode !== 'actuals' || input.hasMonthlyPlan === true;
  const underTarget = pm === null || pm < target;

  // Losing money
  if (mode === 'projected' && profit < ZERO && (input.evidenceDays >= 2 || pct >= 2000)) {
    const costPerUnit = perUnitCents(p.costAtFinishCents, p.projectedUnits);
    const price = input.unitPrice === null || input.unitPrice === undefined || input.unitPrice === '' ? null : divRound(priceToScaled(input.unitPrice), BigInt(100));
    // Cost for one unit holds extra services and fees, so the revenue side has to hold them too or the two numbers would not explain the loss.
    const revenuePerUnit = perUnitCents(p.revenueAtFinishCents, p.projectedUnits);
    add('L1', { lossCents: num(-profit), costPerUnitCents: costPerUnit === null ? null : num(costPerUnit), pricePerUnitCents: price === null ? null : num(price), revenuePerUnitCents: revenuePerUnit === null ? null : num(revenuePerUnit) }, profit);
  }
  if (mode === 'final' && profit < ZERO) {
    let laborOverBp: number | null = null;
    if (input.plan) {
      const flexed = flexPlan(input.plan, flexFactor(input.plan, input.actual));
      if (flexed.laborCents > ZERO && input.actual.laborCents > flexed.laborCents) {
        laborOverBp = Number(divRound((input.actual.laborCents - flexed.laborCents) * BigInt(10000), flexed.laborCents));
      }
    }
    add('L2', { lossCents: num(-profit), laborOverBp }, profit);
  }
  if (mode === 'actuals' && profit < ZERO && (input.entryDays30 ?? 0) >= 5) add('L3', { lossCents: num(-profit) }, profit);

  // At risk
  // Under the floor says it all: the "far under target" reason would repeat the same margin.
  const underFloor = pm !== null && pm < t.marginFloorBp;
  if (pm !== null && !underFloor && pm < target - t.atRiskGapBp) add('R1', { marginBp: pm, targetBp: target }, profit - mulBp(revenue, target - t.atRiskGapBp));
  if (pm !== null && underFloor) add('R2', { marginBp: pm, floorBp: t.marginFloorBp }, profit - mulBp(revenue, t.marginFloorBp));
  const projectedHours = hoursToScaled(p.projectedLaborHours);
  const laborOverBp = planHours > ZERO ? Number(divRound((projectedHours - planHours) * BigInt(10000), planHours)) : null;
  const laborImpact = plan ? -(p.atFinish.laborCents - plan.laborCents) : ZERO;
  if (planApplies && planHours > ZERO && projectedHours * BigInt(10000) > planHours * BigInt(10000 + t.laborRiskOverBp) && underTarget) {
    add('R3', { overBp: laborOverBp, projectedHours: p.projectedLaborHours, planHours: plan ? plan.laborHours : null }, laborImpact);
  }
  const windowUph = input.window ? input.window.uph : null;
  const targetPace = input.targetPace === null || input.targetPace === undefined || input.targetPace === '' ? null : toScaled(input.targetPace, 3);
  let paceImpact = ZERO;
  if (input.window && windowUph !== null && targetPace !== null && targetPace > ZERO) {
    // pace hours of the window minus the hours those units should have taken, in hours x 100
    const should = divRound(quantityToScaled(input.window.unitsGood) * BigInt(100), targetPace);
    const extra = hoursToScaled(input.window.paceHours) - should;
    if (extra > ZERO && p.rateLeftCents !== null) paceImpact = -divRound(extra * p.rateLeftCents, BigInt(100));
  }
  const paceRatio = windowUph !== null && targetPace !== null && targetPace > ZERO ? toScaled(windowUph, 3) * BigInt(10000) : null;
  const paceParams = { uph: windowUph, targetPace: targetPace === null ? null : Number(targetPace) / 1000, days: input.window?.days ?? null };
  if (input.evidenceDays >= 2 && paceRatio !== null && targetPace !== null && paceRatio < targetPace * BigInt(t.productivityRiskBp) && underTarget) {
    add('R4', paceParams, paceImpact);
  }
  if (planApplies && p.projectedFinishDate && input.dueDate && p.projectedFinishDate > input.dueDate && mode !== 'final') {
    add('R5', { finishDate: p.projectedFinishDate, dueDate: input.dueDate, daysLate: daysBetween(input.dueDate, p.projectedFinishDate) });
  }
  if (input.wmsShortage && mode !== 'final') add('R6', {});

  // Not enough data
  if ((input.daysMissingHours ?? 0) > 0) add('D1', { days: input.daysMissingHours ?? 0 });
  if (input.noPrice) add('D2', {});
  const costPlan = planHasCosts(input.plan);
  const costUnknown = mode === 'projected' && !p.costKnown;
  // Hours left with no cost of an hour on a job that does have a cost plan: the rate is what is missing.
  if (input.needsRate || (costUnknown && costPlan)) add('D3', {});
  const programJob = input.programJob === true;
  // D4: no cost plan (none, or only a price) and nothing to project the rest of the job from.
  if (costUnknown && !costPlan && !programJob) add('D4', { priceOnly: input.plan ? 1 : 0 });

  // Heads up
  if (pm !== null && pm < target && !fired.has('R1') && !fired.has('R2')) add('W1', { marginBp: pm, targetBp: target }, profit - mulBp(revenue, target));
  if (planApplies && !fired.has('R3') && planHours > ZERO && projectedHours > planHours && projectedHours * BigInt(10000) >= planHours * BigInt(10000 + t.laborWatchOverBp)) {
    add('W2', { overBp: laborOverBp, projectedHours: p.projectedLaborHours, planHours: plan ? plan.laborHours : null }, laborImpact);
  }
  if (!fired.has('R4') && paceRatio !== null && targetPace !== null && paceRatio < targetPace * BigInt(t.productivityWatchBp)) add('W3', paceParams, paceImpact);
  if (plan && unitsGood > ZERO) {
    const planUnits = quantityToScaled(plan.units);
    if (planUnits > ZERO && plan.materialCents > ZERO && input.actual.materialCents * planUnits * BigInt(10000) > plan.materialCents * unitsGood * BigInt(10000 + t.materialWatchOverBp)) {
      // per unit cost in hundredths of a cent, so a $0.035 label still compares exactly
      const actualPer = divRound(input.actual.materialCents * BigInt(100000), unitsGood);
      const planPer = divRound(plan.materialCents * BigInt(100000), planUnits);
      const basis = plannedUnits > ZERO ? plannedUnits : planUnits;
      add('W4', { actualPerUnit: Number(actualPer) / 10000, planPerUnit: Number(planPer) / 10000 }, -divRound((actualPer - planPer) * basis, BigInt(100000)));
    }
  }
  if (mode !== 'final' && input.workDaysSinceLastEntry !== null && input.workDaysSinceLastEntry !== undefined && input.workDaysSinceLastEntry >= t.noEntryDays) {
    add('W5', { days: input.workDaysSinceLastEntry });
  }
  if (mode !== 'final' && planApplies && input.dueDate && p.pctCompleteBp !== null && p.pctCompleteBp < 9000) {
    const daysLeft = workDaysBetween(input.today, input.dueDate, input.workingDays ?? DEFAULT_WORKING_DAYS);
    if (daysLeft <= 3) add('W6', { dueDate: input.dueDate, pctBp: p.pctCompleteBp, calendarDays: daysBetween(input.today, input.dueDate) });
  }
  // W7: nothing to compare with. D4 already says it more strongly when it fired.
  if (!costPlan && !fired.has('D4') && !programJob) add('W7', input.plan ? { priceOnly: 1 } : {});
  if (!programJob && mode !== 'final' && plannedUnits > ZERO && unitsGood > plannedUnits) add('W8', { unitsGood: Number(unitsGood) / 1000, plannedUnits: Number(plannedUnits) / 1000 });

  const status = STATUS_ORDER.find((candidate) => reasons.some((reason) => reason.status === candidate)) ?? 'on_track';
  const order = (reason: RiskReason): number => RISK_RULES.indexOf(reason.rule);
  const byImpact = (a: RiskReason, b: RiskReason): number => (a.impactCents === b.impactCents ? order(a) - order(b) : a.impactCents < b.impactCents ? -1 : 1);
  const own = reasons.filter((reason) => reason.status === status).sort(byImpact);
  const rest = reasons.filter((reason) => reason.status !== status).sort(byImpact);
  const sorted = [...own, ...rest];
  return { status, reasons: sorted, headline: sorted[0] ?? null, laborMissing: fired.has('D1') || fired.has('D2') || fired.has('D3') || fired.has('D4'), summary };
}

function text(params: RiskParams, key: string): string | null {
  const value = params[key];
  return typeof value === 'string' ? value : null;
}

function number(params: RiskParams, key: string): number | null {
  const value = params[key];
  return typeof value === 'number' ? value : null;
}

/**
 * Names the pace window, so a reason pace (the last evidence days) is never mistaken for the
 * whole job pace on the Pace card: "In the last 5 work days". `null` when the window is unknown.
 */
export function recentDays(days: number | null): string | null {
  if (days === null || !(days > 0)) return null;
  return days === 1 ? 'On the last work day' : `In the last ${days} work days`;
}

function marginLead(mode: string | null, percent: string): string {
  if (mode === 'final') return `Margin came in at ${percent}`;
  if (mode === 'actuals') return `Margin was ${percent} in the last 30 days`;
  return `Margin is heading for ${percent}`;
}

function laborLead(mode: string | null, percent: string): string {
  if (mode === 'final') return `Labor ran ${percent} over the plan.`;
  if (mode === 'actuals') return `Labor ran ${percent} over the monthly plan in the last 30 days.`;
  return `Labor is heading ${percent} over the plan.`;
}

/**
 * The plain sentence for one reason. With `seesMoney: false` the sentence has no money and no
 * margin in it. The unit word comes from `unitLabel` (default "unit").
 */
export function riskSentence(reason: Pick<RiskReason, 'rule' | 'params'>, options: SentenceOptions = {}): string {
  const money = options.seesMoney !== false;
  const params = reason.params;
  const mode = text(params, 'mode');
  const cents = (key: string): Cents => BigInt(Math.round(number(params, key) ?? 0));
  const pctOf = (key: string): string => sentencePercent(number(params, key) ?? 0, options);
  const unit = options.unitLabel ?? 'unit';
  switch (reason.rule) {
    case 'L1': {
      if (!money) return 'At this pace the job ends in the red. It costs more to make than it sells for.';
      const lead = `At this pace the job ends about ${sentenceMoney(cents('lossCents'), options)} in the red.`;
      const cost = number(params, 'costPerUnitCents');
      const price = number(params, 'pricePerUnitCents');
      if (cost === null || price === null) return lead;
      const earned = number(params, 'revenuePerUnitCents');
      // These are the numbers at the finish, so the words say so: the "so far" cost on the job card is a different number.
      if (earned !== null && Math.round(earned) !== Math.round(price))
        return `${lead} By the finish, each ${unit} costs ${sentenceUnitMoney(cents('costPerUnitCents'), options)} to make and brings in ${sentenceUnitMoney(cents('revenuePerUnitCents'), options)}, extra services and fees included.`;
      return `${lead} By the finish, each ${unit} costs ${sentenceUnitMoney(cents('costPerUnitCents'), options)} to make and sells for ${sentenceUnitMoney(cents('pricePerUnitCents'), options)}.`;
    }
    case 'L2': {
      const lead = money ? `This job lost ${sentenceMoney(cents('lossCents'), options)}.` : 'This job lost money.';
      return number(params, 'laborOverBp') === null ? lead : `${lead} Labor ran ${pctOf('laborOverBp')} over the budget.`;
    }
    case 'L3':
      return money ? `This work lost ${sentenceMoney(cents('lossCents'), options)} in the last 30 days.` : 'This work lost money in the last 30 days.';
    case 'R1':
      return money ? `${marginLead(mode, pctOf('marginBp'))}. Your target is ${pctOf('targetBp')}.` : 'Profit is heading well under your target.';
    case 'R2':
      return money ? `${marginLead(mode, pctOf('marginBp'))}, under your ${pctOf('floorBp')} floor.` : 'Profit is heading under your lowest allowed margin.';
    case 'R3':
    case 'W2':
      return laborLead(mode, pctOf('overBp'));
    case 'R4': {
      const pace = `${sentenceNumber(number(params, 'uph') ?? 0, 1, options)} units per person per hour. The target pace is ${sentenceNumber(number(params, 'targetPace') ?? 0, 1, options)}.`;
      const lately = recentDays(number(params, 'days'));
      return lately ? `${lately} the crew made ${pace}` : `The crew is making ${pace}`;
    }
    case 'R5':
      return `At this pace the job finishes ${shortDate(text(params, 'finishDate') ?? '1970-01-01')}. It is due ${shortDate(text(params, 'dueDate') ?? '1970-01-01')}.`;
    case 'R6':
      return 'The warehouse is short on parts for this job.';
    case 'D1': {
      const days = number(params, 'days') ?? 0;
      return `${countWord(days, 'day')} ${days === 1 ? 'has' : 'have'} units and no hours. Profit is not complete yet.`;
    }
    case 'D2':
      return 'This job has no price yet, so Pulse cannot work out profit.';
    case 'D3':
      return 'Some hours have no labor rate, so their cost is missing.';
    case 'W1':
      return money ? `${marginLead(mode, pctOf('marginBp'))}, a little under your ${pctOf('targetBp')} target.` : 'Profit is heading a little under your target.';
    case 'W3': {
      const lately = recentDays(number(params, 'days'));
      return `${lately ? `${lately} the crew was` : 'The crew is'} a bit under the target pace: ${sentenceNumber(number(params, 'uph') ?? 0, 1, options)} of ${sentenceNumber(number(params, 'targetPace') ?? 0, 1, options)} units per person per hour.`;
    }
    case 'W4': {
      if (!money) return `Materials cost more for each ${unit} than the plan.`;
      const per = (key: string): Cents => BigInt(Math.round((number(params, key) ?? 0) * 100));
      return `Materials cost ${sentenceUnitMoney(per('actualPerUnit'), options)} a ${unit}. The plan was ${sentenceUnitMoney(per('planPerUnit'), options)}.`;
    }
    case 'W5':
      return `Nothing has been logged for ${countWord(number(params, 'days') ?? 0, 'work day')}.`;
    case 'W6': {
      const due = text(params, 'dueDate') ?? '1970-01-01';
      const away = number(params, 'calendarDays') ?? 0;
      const done = `${pctOf('pctBp')} done`;
      if (away < 0) return `Was due ${shortDate(due)} and is ${done}.`;
      if (away === 0) return `Due today and ${done}.`;
      if (away === 1) return `Due tomorrow and ${done}.`;
      return `Due ${away < 7 ? weekdayName(due) : shortDate(due)} and ${done}.`;
    }
    case 'D4':
      return money ? 'No plan yet, so Pulse cannot tell if this job will make money.' : 'No plan yet, so Pulse cannot tell how this job will go.';
    case 'W7':
      return number(params, 'priceOnly') === 1
        ? 'This job has a price but no cost plan, so Pulse cannot compare it with anything.'
        : 'This job has no plan, so Pulse cannot compare it with anything.';
    default:
      return 'This job is past its planned units. Update the plan or finish the job.';
  }
}

/**
 * The one line shown next to the status: the headline reason, or the on track sentence
 * ("On track. Margin is heading for 34% against a 30% target."). Empty when the job has no status.
 */
export function riskHeadline(assessment: Pick<RiskAssessment, 'status' | 'headline' | 'summary'>, options: SentenceOptions = {}): string {
  if (assessment.status === null) return '';
  if (assessment.headline) return riskSentence(assessment.headline, options);
  const margin = number(assessment.summary, 'marginBp');
  const target = number(assessment.summary, 'targetBp');
  if (options.seesMoney === false || margin === null || target === null) return 'On track.';
  return `On track. ${marginLead(text(assessment.summary, 'mode'), sentencePercent(margin, options))} against a ${sentencePercent(target, options)} target.`;
}

/** The headline and up to two more sentences, ready for the job card. */
export function riskSentences(assessment: Pick<RiskAssessment, 'reasons'>, options: SentenceOptions = {}, limit = 3): string[] {
  return assessment.reasons.slice(0, limit).map((reason) => riskSentence(reason, options));
}
