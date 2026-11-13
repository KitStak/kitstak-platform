import { describe, expect, it } from 'vitest';
import {
  buildTicks,
  cascadeShifts,
  computeRange,
  criticalPath,
  dayToX,
  dragSpan,
  fitZoom,
  isConflict,
  rangeBetween,
  spanPatch,
  taskSpan,
  weekendBands,
  xToDay,
  type Span,
} from './timeline-model';

describe('timeline model', () => {
  it('turns task dates into bars', () => {
    expect(taskSpan({ startDate: '2026-11-02', dueDate: '2026-11-06' })).toEqual({ start: '2026-11-02', end: '2026-11-06' });
    expect(taskSpan({ startDate: null, dueDate: '2026-11-06' })).toEqual({ start: '2026-11-06', end: '2026-11-06' });
    expect(taskSpan({ startDate: '2026-11-09', dueDate: '2026-11-06' })).toEqual({ start: '2026-11-06', end: '2026-11-09' });
    expect(taskSpan({ startDate: null, dueDate: null })).toBeNull();
  });

  it('pads the range to whole months around every date', () => {
    const range = computeRange([{ start: '2026-11-10', end: '2026-12-20' }], '2026-11-13', ['2027-01-05']);
    expect(range.start).toBe('2026-10-01');
    expect(range.end).toBe('2027-03-31');
    expect(range.days).toBe(182);
  });

  it('maps days to pixels and back', () => {
    const range = { start: '2026-11-01', end: '2026-11-30' };
    expect(dayToX(range, '2026-11-11', 20)).toBe(200);
    expect(xToDay(range, 205, 20)).toBe('2026-11-11');
    expect(xToDay(range, 199, 20)).toBe('2026-11-10');
  });

  it('drags, resizes and never inverts a bar', () => {
    const span = { start: '2026-11-02', end: '2026-11-06' };
    expect(dragSpan(span, 'move', 3)).toEqual({ start: '2026-11-05', end: '2026-11-09' });
    expect(dragSpan(span, 'end', -10)).toEqual({ start: '2026-11-02', end: '2026-11-02' });
    expect(dragSpan(span, 'start', 9)).toEqual({ start: '2026-11-06', end: '2026-11-06' });
    expect(rangeBetween('2026-11-09', '2026-11-03')).toEqual({ start: '2026-11-03', end: '2026-11-09' });
  });

  it('keeps a due-date-only task due-date-only when moved', () => {
    expect(spanPatch({ startDate: null, dueDate: '2026-11-06' }, { start: '2026-11-08', end: '2026-11-08' })).toEqual({ dueDate: '2026-11-08' });
    expect(spanPatch({ startDate: null, dueDate: '2026-11-06' }, { start: '2026-11-06', end: '2026-11-09' })).toEqual({ startDate: '2026-11-06', dueDate: '2026-11-09' });
    expect(spanPatch({ startDate: null, dueDate: '2026-11-06', isMilestone: true }, { start: '2026-11-07', end: '2026-11-07' })).toEqual({ dueDate: '2026-11-07' });
  });

  it('builds header ticks and weekend bands', () => {
    const range = computeRange([], '2026-11-13');
    const { major, minor } = buildTicks(range, 'week');
    expect(major[0]?.label).toBe('October 2026');
    expect(minor.length).toBe(18);
    const weekends = weekendBands(range, 'day');
    expect(weekends[0]?.key).toBe('2026-10-03');
    expect(weekendBands(range, 'month')).toEqual([]);
    expect(buildTicks(range, 'quarter').major[0]?.label).toBe('2026');
  });

  it('flags a waiting task that starts too early', () => {
    expect(isConflict({ start: '2026-11-02', end: '2026-11-06' }, { start: '2026-11-06', end: '2026-11-08' })).toBe(true);
    expect(isConflict({ start: '2026-11-02', end: '2026-11-06' }, { start: '2026-11-07', end: '2026-11-08' })).toBe(false);
    expect(isConflict({ start: '2026-11-02', end: '2026-11-06' }, { start: '2026-11-08', end: '2026-11-09' }, 2)).toBe(true);
  });

  it('finds the critical path', () => {
    const spans = new Map<string, Span>([
      ['a', { start: '2026-11-02', end: '2026-11-04' }],
      ['b', { start: '2026-11-05', end: '2026-11-10' }],
      ['c', { start: '2026-11-05', end: '2026-11-06' }],
      ['d', { start: '2026-11-11', end: '2026-11-12' }],
      ['e', { start: '2026-11-01', end: '2026-11-03' }],
    ]);
    const edges = [
      { id: 'ab', blockingTaskId: 'a', blockedTaskId: 'b', lagDays: 0 },
      { id: 'ac', blockingTaskId: 'a', blockedTaskId: 'c', lagDays: 0 },
      { id: 'bd', blockingTaskId: 'b', blockedTaskId: 'd', lagDays: 0 },
      { id: 'cd', blockingTaskId: 'c', blockedTaskId: 'd', lagDays: 0 },
    ];
    const result = criticalPath(spans, edges);
    expect([...result.tasks].sort()).toEqual(['a', 'b', 'd']);
    expect([...result.edges].sort()).toEqual(['ab', 'bd']);
  });

  it('cascades shifts down a chain of waiting tasks', () => {
    const spans = new Map<string, Span>([
      ['a', { start: '2026-11-02', end: '2026-11-08' }],
      ['b', { start: '2026-11-05', end: '2026-11-06' }],
      ['c', { start: '2026-11-07', end: '2026-11-07' }],
    ]);
    const edges = [
      { id: 'ab', blockingTaskId: 'a', blockedTaskId: 'b', lagDays: 0 },
      { id: 'bc', blockingTaskId: 'b', blockedTaskId: 'c', lagDays: 0 },
    ];
    const shifts = cascadeShifts(spans, edges, 'a');
    expect(shifts.get('b')).toEqual({ start: '2026-11-09', end: '2026-11-10' });
    expect(shifts.get('c')).toEqual({ start: '2026-11-11', end: '2026-11-11' });
  });

  it('picks the closest zoom that fits', () => {
    expect(fitZoom(20, 900)).toBe('day');
    expect(fitZoom(120, 900)).toBe('month');
    expect(fitZoom(2000, 900)).toBe('quarter');
  });
});
