/**
 * Program alerts (docs/programs/PULSE_PROGRAMS_SPEC.md section 6): rules P1 to P7, each with one
 * sentence and one action. Shown on the program page, behind the program list health dot and in
 * Alerts. Pure: the caller passes the month figures, the plan, the cost forecast, the target and
 * the org's risk settings. Sentences are written here, at read time, so a reader who cannot see
 * money never gets a money rule.
 */
import { type Cents, type CentsLike, type Decimal, ZERO, divRound, quantityToScaled, toCents } from '../money';
import { formatMoney, pluralize } from '../format';
import { startOfWeek } from './calendar';
import type { ProgramMonth } from './program';
import { DEFAULT_RISK_THRESHOLDS, type RiskThresholds } from './risk';
import type { IsoDate } from './types';
import { type SentenceOptions, countWord, sentenceMoney, sentencePercent, sentenceUnitMoney } from './words';

export const PROGRAM_RULES = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'] as const;
export type ProgramRule = (typeof PROGRAM_RULES)[number];

export const PROGRAM_ALERT_ACTIONS = ['see_variants', 'see_days', 'open_variant', 'open_in_projects', 'add_hours'] as const;
export type ProgramAlertAction = (typeof PROGRAM_ALERT_ACTIONS)[number];

/** The words on each action button. */
export const PROGRAM_ALERT_ACTION_LABELS: Readonly<Record<ProgramAlertAction, string>> = {
  see_variants: 'See by variant',
  see_days: 'See days',
  open_variant: 'Open variant',
  open_in_projects: 'Open program in Projects',
  add_hours: 'Add hours',
};

const RULE_ACTION: Readonly<Record<ProgramRule, ProgramAlertAction>> = {
  P1: 'see_variants',
  P2: 'see_variants',
  P3: 'see_days',
  P4: 'open_variant',
  P5: 'open_in_projects',
  P6: 'add_hours',
  P7: 'see_days',
};

/** Rules that talk about money or margin. A reader who cannot see money never gets them. */
const MONEY_RULES: ReadonlySet<ProgramRule> = new Set<ProgramRule>(['P1', 'P2', 'P3', 'P4', 'P5']);

/** P1 and P2 need this many work days with units in the month. */
export const PROGRAM_MARGIN_MIN_DAYS = 3;
/** P3: cost per unit this far above the last closed months, in basis points (10%). */
export const PROGRAM_COST_RISE_BP = 1000;
/** P4: a variant needs at least this many units in the month. */
export const PROGRAM_VARIANT_MIN_UNITS = 100;
/** P7: units per hour this week this far under the month, in basis points (15%). */
export const PROGRAM_SLOWER_BP = 1500;
/** P3 compares with up to this many closed months. */
export const PROGRAM_CLOSED_MONTHS = 3;

/** One closed month of the program, for P3. */
export interface ProgramClosedMonth {
  readonly month: string;
  readonly units: Decimal;
  readonly costCents: CentsLike;
}

export interface ProgramRiskInput {
  /** The name in sentences, the program key: "GLOVE". */
  readonly programLabel: string;
  /** Today in the program time zone. P7 reads the week that holds it. */
  readonly asOf: IsoDate;
  readonly figures: Pick<ProgramMonth, 'totals' | 'byVariant' | 'days'>;
  /** From `programMonthPlan`. */
  readonly plan: { readonly projectedGapCents: Cents; readonly minimumCents: Cents | null };
  /** From `programCostForecast`. */
  readonly forecastMarginBp: number | null;
  /** From `programTargetMargin`. */
  readonly targetMarginBp: number;
  /** The org's risk settings. Only `atRiskGapBp` and `marginFloorBp` are read. */
  readonly thresholds?: Partial<Pick<RiskThresholds, 'atRiskGapBp' | 'marginFloorBp'>>;
  /** Closed months of the program, any order. The newest 3 are used. */
  readonly closedMonths?: readonly ProgramClosedMonth[];
  /** Variant names by id. An unknown id reads "Removed variant". */
  readonly variantNames?: Readonly<Record<string, string>>;
}

export interface ProgramAlert {
  readonly rule: ProgramRule;
  readonly sentence: string;
  readonly action: ProgramAlertAction;
  readonly actionLabel: string;
  /** The variant the action opens (P4), else null. */
  readonly variantId: string | null;
}

/** "a 30%", "an 18%", "an 8%", "an 11%": the article that goes before a spoken whole percent. */
function article(percent: string): 'a' | 'an' {
  const digits = percent.replace(/[^\d]/g, '');
  if (percent.trim().startsWith('-')) return 'a';
  if (digits.startsWith('8')) return 'an';
  if (digits === '11' || digits === '18') return 'an';
  return 'a';
}

/**
 * Every program alert that fires, in rule order (P4 worst variant first). With
 * `seesMoney: false` only the rules with no money in them (P6, P7) are returned. The unit word
 * comes from `unitLabel` (default "unit").
 *
 * - P1 forecast margin below the target by more than the at risk gap (not when P2 fires).
 * - P2 forecast margin below the floor. P1 and P2 need 3 work days with units.
 * - P3 cost per unit this month more than 10% above the last 3 closed months.
 * - P4 a variant with at least 100 units and a margin under the floor.
 * - P5 a projected gap to the monthly minimum.
 * - P6 days with units and no hours.
 * - P7 units per hour this week 15% or more under the month.
 */
export function programAlerts(input: ProgramRiskInput, options: SentenceOptions = {}): ProgramAlert[] {
  const t = { ...DEFAULT_RISK_THRESHOLDS, ...input.thresholds };
  const unit = options.unitLabel ?? 'unit';
  const units = pluralize(unit);
  const name = input.programLabel;
  const totals = input.figures.totals;
  const alerts: ProgramAlert[] = [];
  const add = (rule: ProgramRule, sentence: string, variantId: string | null = null): void => {
    const action = RULE_ACTION[rule];
    alerts.push({ rule, sentence, action, actionLabel: PROGRAM_ALERT_ACTION_LABELS[action], variantId });
  };
  const pct = (bp: number): string => sentencePercent(bp, options);

  // P1, P2: forecast margin.
  const margin = input.forecastMarginBp;
  if (margin !== null && totals.daysWithUnits >= PROGRAM_MARGIN_MIN_DAYS) {
    if (margin < t.marginFloorBp) add('P2', `${name} is heading below the ${pct(t.marginFloorBp)} floor this month.`);
    else if (margin < input.targetMarginBp - t.atRiskGapBp) {
      const heading = pct(margin);
      add('P1', `${name} is heading for ${article(heading)} ${heading} margin this month. The target is ${pct(input.targetMarginBp)}.`);
    }
  }

  // P3: cost per unit against the last closed months.
  const monthUnits = quantityToScaled(totals.units);
  const closed = [...(input.closedMonths ?? [])].sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : 0)).slice(0, PROGRAM_CLOSED_MONTHS);
  let priorCost = ZERO;
  let priorUnits = ZERO;
  for (const month of closed) {
    priorCost += toCents(month.costCents);
    priorUnits += quantityToScaled(month.units);
  }
  if (monthUnits > ZERO && priorUnits > ZERO && priorCost > ZERO) {
    const nowCost = totals.costCents;
    // cost / units > prior / priorUnits * 1.10, cross multiplied so nothing is rounded
    if (nowCost * priorUnits * BigInt(10000) > priorCost * monthUnits * BigInt(10000 + PROGRAM_COST_RISE_BP)) {
      const now = divRound(nowCost * BigInt(1000), monthUnits);
      const before = divRound(priorCost * BigInt(1000), priorUnits);
      add('P3', `Each ${unit} costs ${sentenceUnitMoney(now, options)} this month, up from ${sentenceUnitMoney(before, options)}.`);
    }
  }

  // P4: variants under the floor, worst first.
  const minUnits = quantityToScaled(String(PROGRAM_VARIANT_MIN_UNITS));
  const weak = input.figures.byVariant
    .filter((row) => row.variantId !== null && quantityToScaled(row.units) >= minUnits)
    .filter((row) => (row.marginBp === null ? row.profitCents < ZERO : row.marginBp < t.marginFloorBp))
    .sort((a, b) => {
      const am = a.marginBp ?? -Infinity;
      const bm = b.marginBp ?? -Infinity;
      if (am !== bm) return am < bm ? -1 : 1;
      return (a.variantId ?? '') < (b.variantId ?? '') ? -1 : 1;
    });
  for (const row of weak) {
    const variantName = (row.variantId && input.variantNames?.[row.variantId]) || 'Removed variant';
    const perUnit = row.profitPerUnitCents ?? ZERO;
    const sentence =
      perUnit < ZERO || row.profitCents < ZERO
        ? `${variantName} loses ${sentenceUnitMoney(perUnit, options)} a ${unit}.`
        : `${variantName} makes ${sentenceUnitMoney(perUnit, options)} a ${unit}, under the ${pct(t.marginFloorBp)} floor.`;
    add('P4', sentence, row.variantId);
  }

  // P5: the monthly minimum.
  if (input.plan.minimumCents !== null && input.plan.projectedGapCents > ZERO) {
    add('P5', `May miss the ${sentenceMoney(input.plan.minimumCents, options)} minimum by ${formatMoney(input.plan.projectedGapCents, { currency: options.currency, locale: options.locale })}.`);
  }

  // P6: days with units and no hours.
  const missing = input.figures.days.filter((day) => day.missingHours).length;
  if (missing > 0) add('P6', `${countWord(missing, 'day')} ${missing === 1 ? 'has' : 'have'} ${units} but no hours.`);

  // P7: units per hour this week against the month.
  const weekStart = startOfWeek(input.asOf);
  let weekUnits = ZERO;
  let weekHours = ZERO;
  for (const day of input.figures.days) {
    if (day.date < weekStart || day.date > input.asOf) continue;
    weekUnits += quantityToScaled(day.units);
    weekHours += quantityToScaled(day.hours);
  }
  const monthHours = quantityToScaled(totals.hours);
  if (weekHours > ZERO && monthHours > ZERO && monthUnits > ZERO) {
    // week pace over month pace, in basis points: (weekUnits / weekHours) / (monthUnits / monthHours)
    const ratio = divRound(weekUnits * monthHours * BigInt(10000), monthUnits * weekHours);
    if (ratio <= BigInt(10000 - PROGRAM_SLOWER_BP)) add('P7', `The crew is ${pct(10000 - Number(ratio))} slower this week.`);
  }

  if (options.seesMoney === false) return alerts.filter((alert) => !MONEY_RULES.has(alert.rule));
  return alerts;
}
