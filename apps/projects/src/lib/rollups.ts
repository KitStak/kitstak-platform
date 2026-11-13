/**
 * Progress rollups (pure): key results → goal, projects → goal, tasks → project.
 * All results are integers 0-100.
 */
import type { GoalProgressMode, KeyResultKind } from './constants';

const clamp = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

export interface KeyResultInput {
  readonly kind: KeyResultKind;
  readonly startValue: number;
  readonly targetValue: number;
  readonly currentValue: number;
  /** For kind = project: that project's completion percent. */
  readonly projectPercent?: number | null;
}

/** Progress of one key result. Works for "decrease" targets too (start > target). */
export function keyResultProgress(kr: KeyResultInput): number {
  if (kr.kind === 'project') return clamp(kr.projectPercent ?? 0);
  if (kr.kind === 'boolean') return kr.currentValue >= 1 ? 100 : 0;
  const span = kr.targetValue - kr.startValue;
  if (span === 0) return kr.currentValue === kr.targetValue ? 100 : 0;
  return clamp(((kr.currentValue - kr.startValue) / span) * 100);
}

export interface GoalRollupInput {
  readonly mode: GoalProgressMode;
  readonly manualProgress: number;
  readonly keyResults: readonly KeyResultInput[];
  /** Completion percent of each linked project. */
  readonly projectPercents: readonly number[];
  /** Rolled-up progress of child goals (included in key_results/projects modes). */
  readonly childGoalPercents?: readonly number[];
}

const average = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

export function goalProgress(input: GoalRollupInput): number {
  const children = input.childGoalPercents ?? [];
  switch (input.mode) {
    case 'manual':
      return clamp(input.manualProgress);
    case 'key_results':
      return clamp(average([...input.keyResults.map(keyResultProgress), ...children]));
    case 'projects':
      return clamp(average([...input.projectPercents, ...children]));
  }
}

/** Task completion percent for a project (cancelled tasks don't count). */
export function projectPercent(counts: { readonly total: number; readonly done: number }): number {
  return counts.total === 0 ? 0 : clamp((counts.done / counts.total) * 100);
}

/** Expected progress for a date range (used to suggest at risk / off track). */
export function expectedProgress(start: string | null, due: string | null, today: string): number | null {
  if (!start || !due || due <= start) return null;
  const s = Date.parse(start);
  const d = Date.parse(due);
  const t = Date.parse(today);
  return clamp(((t - s) / (d - s)) * 100);
}

/** Suggested health from actual vs expected progress. */
export function suggestHealth(actual: number, expected: number | null): 'on_track' | 'at_risk' | 'off_track' {
  if (expected === null) return 'on_track';
  const gap = expected - actual;
  if (gap >= 30) return 'off_track';
  if (gap >= 12) return 'at_risk';
  return 'on_track';
}
