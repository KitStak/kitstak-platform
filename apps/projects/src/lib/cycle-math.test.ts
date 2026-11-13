import { describe, expect, it } from 'vitest';
import { buildCycleReport, cycleDaysLeft, cycleState, nextCycleDates, type CycleMember } from './cycle-math';

const at = (day: string, hour = 10) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00`).toISOString();

describe('cycle state and dates', () => {
  it('reads the state from the dates', () => {
    const cycle = { startDate: '2026-11-02', endDate: '2026-11-15', completedAt: null };
    expect(cycleState(cycle, '2026-11-01')).toBe('upcoming');
    expect(cycleState(cycle, '2026-11-02')).toBe('current');
    expect(cycleState(cycle, '2026-11-15')).toBe('current');
    expect(cycleState(cycle, '2026-11-16')).toBe('done');
    expect(cycleState({ ...cycle, completedAt: at('2026-11-10') }, '2026-11-10')).toBe('done');
  });
  it('counts days left including today', () => {
    expect(cycleDaysLeft('2026-11-15', '2026-11-13')).toBe(3);
    expect(cycleDaysLeft('2026-11-15', '2026-11-20')).toBe(0);
  });
  it('plans the next cycle with the same length', () => {
    expect(nextCycleDates({ startDate: '2026-11-02', endDate: '2026-11-15' })).toEqual({ startDate: '2026-11-16', endDate: '2026-11-29' });
  });
});

describe('buildCycleReport', () => {
  const member = (taskId: string, partial: Partial<CycleMember> = {}): CycleMember => ({
    taskId,
    addedAt: at('2026-11-01'),
    removedAt: null,
    removedReason: null,
    completedAt: null,
    points: 1,
    ...partial,
  });
  const report = buildCycleReport({
    startDate: '2026-11-02',
    endDate: '2026-11-06',
    today: '2026-11-04',
    members: [
      member('a', { completedAt: at('2026-11-03'), points: 3 }),
      member('b'),
      member('c', { addedAt: at('2026-11-04') }),
      member('d', { removedAt: at('2026-11-03'), removedReason: 'removed' }),
    ],
  });

  it('draws the burndown and ideal line', () => {
    expect(report.days).toHaveLength(5);
    expect(report.days[0]).toMatchObject({ date: '2026-11-02', scope: 3, done: 0, remaining: 3, ideal: 3, future: false });
    expect(report.days[1]).toMatchObject({ scope: 2, done: 1, remaining: 1, removed: 1 });
    expect(report.days[2]).toMatchObject({ scope: 3, done: 1, added: 1 });
    expect(report.days[4]).toMatchObject({ ideal: 0, future: true });
  });
  it('sums scope changes and totals', () => {
    expect(report).toMatchObject({ plannedScope: 3, scope: 3, done: 1, remaining: 2, addedAfterStart: 1, removedAfterStart: 1, points: 5, donePoints: 3, percent: 33 });
  });
  it('keeps rolled-over tasks in scope until the end', () => {
    const rolled = buildCycleReport({
      startDate: '2026-11-02',
      endDate: '2026-11-03',
      today: '2026-11-04',
      members: [member('x', { removedAt: at('2026-11-04'), removedReason: 'rolled_over' })],
    });
    expect(rolled.days.map((d) => d.scope)).toEqual([1, 1]);
    expect(rolled).toMatchObject({ rolledOver: 1, remaining: 1, removedAfterStart: 0 });
  });
});
