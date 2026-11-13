import { describe, expect, it } from 'vitest';
import { expectedProgress, goalProgress, keyResultProgress, projectPercent, suggestHealth } from './rollups';

describe('rollups', () => {
  it('computes key result progress, including decreasing targets', () => {
    expect(keyResultProgress({ kind: 'number', startValue: 0, targetValue: 200, currentValue: 50 })).toBe(25);
    expect(keyResultProgress({ kind: 'percent', startValue: 10, targetValue: 2, currentValue: 6 })).toBe(50);
    expect(keyResultProgress({ kind: 'number', startValue: 0, targetValue: 10, currentValue: 20 })).toBe(100);
    expect(keyResultProgress({ kind: 'boolean', startValue: 0, targetValue: 1, currentValue: 1 })).toBe(100);
    expect(keyResultProgress({ kind: 'project', startValue: 0, targetValue: 100, currentValue: 0, projectPercent: 64 })).toBe(64);
  });

  it('rolls goals up by mode', () => {
    const krs = [
      { kind: 'number' as const, startValue: 0, targetValue: 100, currentValue: 50 },
      { kind: 'number' as const, startValue: 0, targetValue: 100, currentValue: 100 },
    ];
    expect(goalProgress({ mode: 'key_results', manualProgress: 0, keyResults: krs, projectPercents: [] })).toBe(75);
    expect(goalProgress({ mode: 'projects', manualProgress: 0, keyResults: [], projectPercents: [20, 40] })).toBe(30);
    expect(goalProgress({ mode: 'manual', manualProgress: 140, keyResults: [], projectPercents: [] })).toBe(100);
    expect(goalProgress({ mode: 'projects', manualProgress: 0, keyResults: [], projectPercents: [], childGoalPercents: [50] })).toBe(50);
  });

  it('computes project percent and health suggestions', () => {
    expect(projectPercent({ total: 0, done: 0 })).toBe(0);
    expect(projectPercent({ total: 8, done: 2 })).toBe(25);
    expect(expectedProgress('2026-11-01', '2026-11-11', '2026-11-06')).toBe(50);
    expect(suggestHealth(45, 50)).toBe('on_track');
    expect(suggestHealth(30, 50)).toBe('at_risk');
    expect(suggestHealth(10, 50)).toBe('off_track');
  });
});
