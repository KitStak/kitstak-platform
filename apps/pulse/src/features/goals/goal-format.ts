/**
 * Words and numbers of the goals page. Pure. A goal's "natural" number is cents, basis points or
 * thousandths of a unit per person per hour (see `goal-math`); these turn one into text.
 */
import type { ChartFormatter } from '@/components/charts/chart-format';
import type { TargetMetric, TargetScope } from '@/lib/constants';
import { formatMoney, formatMoneyCompact, formatMoneyWhole, formatPace, formatPercentBp } from '@/lib/format';
import { GOAL_METRICS, type GoalUnit } from './goal-math';

const MONTH_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const MONTH_ONLY = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' });
const MONTH_SHORT = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });

/** "November 2026" for `2026-11-01`. */
export const monthLabel = (month: string): string => MONTH_FORMAT.format(new Date(`${month.slice(0, 7)}-01T00:00:00Z`));
/** "November" for `2026-11-01`. */
export const monthWord = (month: string): string => MONTH_ONLY.format(new Date(`${month.slice(0, 7)}-01T00:00:00Z`));
/** "Nov" for `2026-11-01`. */
export const monthShort = (month: string): string => MONTH_SHORT.format(new Date(`${month.slice(0, 7)}-01T00:00:00Z`));

function unitText(unit: GoalUnit, natural: number, whole: boolean): string {
  if (unit === 'percent') return formatPercentBp(natural, { digits: natural % 100 === 0 ? 0 : 1 });
  if (unit === 'pace') return formatPace(natural / 1000);
  if (unit === 'money' && whole) return formatMoneyWhole(natural);
  return formatMoney(natural);
}

/** A goal or an actual as text: "28%", "$95,000", "44.0", "$1.85". */
export function formatGoalNumber(metric: TargetMetric, natural: number | null | undefined, empty = 'No numbers yet'): string {
  if (natural === null || natural === undefined) return empty;
  const unit = GOAL_METRICS[metric].unit;
  return unitText(unit, natural, unit === 'money' && Math.abs(natural) >= 100_000);
}

/** A gap with its sign in words: "$2,100 ahead", "1.5 points under". */
export function formatGoalGap(metric: TargetMetric, gap: number | null): string | null {
  if (gap === null) return null;
  const info = GOAL_METRICS[metric];
  const size = Math.abs(gap);
  if (size === 0) return 'right on the line';
  const good = info.better === 'up' ? gap > 0 : gap < 0;
  const amount = info.unit === 'percent' ? `${(size / 100).toFixed(size % 100 === 0 ? 0 : 1)} ${size === 100 ? 'point' : 'points'}` : unitText(info.unit, size, info.unit === 'money' && size >= 100_000);
  if (info.kind === 'sum') return `${amount} ${good ? 'ahead' : 'behind'}`;
  return `${amount} ${gap > 0 ? 'over' : 'under'}`;
}

/** The short unit shown after the number box of the editor. */
export const GOAL_UNIT_SUFFIX: Readonly<Record<GoalUnit, string>> = { percent: 'percent', money: 'dollars a month', pace: 'units per person per hour', money_per_unit: 'dollars a unit' };

/** Chart text for a goal's natural number. */
export function goalChartFormat(metric: TargetMetric): ChartFormatter {
  const unit = GOAL_METRICS[metric].unit;
  return {
    axis: (value) => (unit === 'money' ? formatMoneyCompact(Math.round(value)) : unitText(unit, Math.round(value), false)),
    value: (value) => formatGoalNumber(metric, Math.round(value)),
  };
}

/** "Margin of at least 28% for Acme, every month." */
export function goalSentence(input: { metric: TargetMetric; scope: TargetScope; scopeLabel: string; natural: number | null; everyMonth: boolean; month: string }): string {
  const info = GOAL_METRICS[input.metric];
  const who = input.scope === 'org' ? 'the whole company' : input.scopeLabel;
  const number = input.natural === null ? 'a number you pick' : formatGoalNumber(input.metric, input.natural);
  return `${info.phrase} ${number} for ${who}, ${input.everyMonth ? 'every month' : `in ${monthWord(input.month)} only`}.`;
}
