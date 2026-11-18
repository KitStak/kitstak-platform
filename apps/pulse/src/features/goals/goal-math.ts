/**
 * Goal math: how far along a goal is, and whether the pace will get there. Pure, so the goals
 * page, the server and the tests share it. Every number is a whole "natural unit": money in
 * cents, percents in basis points, pace in thousandths of a unit per person per hour. Ratios are
 * worked out with the same rounding rule as the rest of Pulse (`@/lib/money`).
 */
import type { TargetMetric, TargetScope } from '@/lib/constants';
import { decimalToCents, mulRatio, ratioBp, toScaled } from '@/lib/money';

export type GoalUnit = 'percent' | 'money' | 'pace' | 'money_per_unit';
export type GoalStatus = 'ahead' | 'close' | 'behind' | 'no_data';

export interface GoalMetricInfo {
  readonly label: string;
  /** The sentence start of the editor: "Margin of at least". */
  readonly phrase: string;
  readonly unit: GoalUnit;
  /** `up`: more is better. `down`: less is better. */
  readonly better: 'up' | 'down';
  /** `sum` goals add up over the month (profit, revenue), so they have a pace. `rate` goals do not. */
  readonly kind: 'sum' | 'rate';
  readonly needsMoney: boolean;
  readonly scopes: readonly TargetScope[];
  readonly help: string;
}

const ALL: readonly TargetScope[] = ['org', 'site', 'client', 'job_type', 'vas_service'];

export const GOAL_METRICS: Readonly<Record<TargetMetric, GoalMetricInfo>> = {
  margin_pct: { label: 'Margin', phrase: 'Margin of at least', unit: 'percent', better: 'up', kind: 'rate', needsMoney: true, scopes: ALL, help: 'Profit as a share of revenue, after all costs.' },
  profit: { label: 'Profit', phrase: 'Profit of at least', unit: 'money', better: 'up', kind: 'sum', needsMoney: true, scopes: ALL, help: 'Revenue less every cost, added up over the month.' },
  revenue: { label: 'Revenue', phrase: 'Revenue of at least', unit: 'money', better: 'up', kind: 'sum', needsMoney: true, scopes: ALL, help: 'What the work earned, added up over the month.' },
  units_per_labor_hour: { label: 'Units per person per hour', phrase: 'A pace of at least', unit: 'pace', better: 'up', kind: 'rate', needsMoney: false, scopes: ['org', 'site', 'client', 'job_type'], help: 'Good units divided by labor hours.' },
  labor_pct_of_revenue: { label: 'Labor as a share of revenue', phrase: 'Labor at or under', unit: 'percent', better: 'down', kind: 'rate', needsMoney: true, scopes: ALL, help: 'Labor cost divided by revenue. Lower is better.' },
  cost_per_unit: { label: 'Cost per unit', phrase: 'Cost per unit at or under', unit: 'money_per_unit', better: 'down', kind: 'rate', needsMoney: true, scopes: ['org', 'site', 'client', 'job_type'], help: 'All cost divided by good units. Lower is better.' },
  utilization_pct: { label: 'Paid time spent on jobs', phrase: 'Paid time on jobs of at least', unit: 'percent', better: 'up', kind: 'rate', needsMoney: false, scopes: ['org', 'site'], help: 'Hours logged on jobs divided by paid hours.' },
};

export const GOAL_SCOPE_LABELS: Readonly<Record<TargetScope, string>> = { org: 'Whole company', site: 'Site', client: 'Client', job_type: 'Job type', vas_service: 'Extra service' };

/** A stored goal value ("28.0000", "95000.0000", "44.0000") as a whole natural unit. `null` when it cannot be read. */
export function goalToNatural(metric: TargetMetric, value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  try {
    const unit = GOAL_METRICS[metric].unit;
    if (unit === 'percent') return Number(toScaled(value, 2));
    if (unit === 'pace') return Number(toScaled(value, 3));
    return Number(decimalToCents(Number(value).toFixed(2)));
  } catch {
    return null;
  }
}

/** What a person types for a goal ("28", "$95,000", "44.5") as the text the server stores. `null` when it is not a usable number. */
export function typedGoalToStored(metric: TargetMetric, typed: string): string | null {
  const text = typed.replace(/[$,%\s]/g, '');
  if (!/^\d{1,9}(\.\d{1,4})?$/.test(text)) return null;
  const value = Number(text);
  if (!(value > 0)) return null;
  if (GOAL_METRICS[metric].unit === 'percent' && value > 100) return null;
  return text;
}

export interface GoalInput {
  readonly metric: TargetMetric;
  readonly goal: number | null;
  readonly actual: number | null;
  /** Work days of the month that are over, today included. */
  readonly elapsedWorkDays: number;
  readonly totalWorkDays: number;
}

export interface GoalReading {
  readonly status: GoalStatus;
  /** Actual as a share of the goal, in basis points. For "less is better" goals it is goal over actual. */
  readonly progressBp: number | null;
  /** Sum goals: where the number should be by today to land on the goal. */
  readonly expected: number | null;
  /** Sum goals: where the month lands if every work day left goes like the ones so far. */
  readonly projected: number | null;
  /** Actual minus goal (rate goals) or actual minus expected (sum goals). */
  readonly gap: number | null;
}

/** At or over the line is ahead. Within 10% under it is close. Anything lower is behind. */
function statusFor(scoreBp: number | null): GoalStatus {
  if (scoreBp === null) return 'no_data';
  if (scoreBp >= 10000) return 'ahead';
  return scoreBp >= 9000 ? 'close' : 'behind';
}

export function readGoal(input: GoalInput): GoalReading {
  const info = GOAL_METRICS[input.metric];
  const { goal, actual } = input;
  if (goal === null || actual === null || !(goal > 0)) return { status: 'no_data', progressBp: null, expected: null, projected: null, gap: null };
  if (info.kind === 'sum') {
    const total = Math.max(input.totalWorkDays, 1);
    const elapsed = Math.min(Math.max(input.elapsedWorkDays, 0), total);
    const expected = Number(mulRatio(BigInt(Math.round(goal)), BigInt(elapsed), BigInt(total)));
    const projected = elapsed > 0 ? Number(mulRatio(BigInt(Math.round(actual)), BigInt(total), BigInt(elapsed))) : null;
    const paceBp = expected > 0 ? ratioBp(BigInt(Math.round(actual)), BigInt(expected)) : null;
    return { status: elapsed === 0 ? 'no_data' : statusFor(paceBp ?? (actual >= expected ? 10000 : 0)), progressBp: ratioBp(BigInt(Math.round(actual)), BigInt(Math.round(goal))), expected, projected, gap: actual - expected };
  }
  const scoreBp = info.better === 'up' ? ratioBp(BigInt(Math.round(actual)), BigInt(Math.round(goal))) : actual > 0 ? ratioBp(BigInt(Math.round(goal)), BigInt(Math.round(actual))) : 10000;
  return { status: statusFor(scoreBp ?? (actual <= 0 && info.better === 'up' ? 0 : null)), progressBp: scoreBp, expected: null, projected: null, gap: actual - goal };
}

export const GOAL_STATUS_LABELS: Readonly<Record<GoalStatus, string>> = { ahead: 'On pace', close: 'Close', behind: 'Behind', no_data: 'No numbers yet' };
