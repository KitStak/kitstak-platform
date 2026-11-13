import { describe, expect, it } from 'vitest';
import { addDaysIso, diffDays, dueBucket, formatDue, formatMinutes, isIsoDate, isOverdue, startOfWeekIso } from './dates';

describe('dates', () => {
  it('validates ISO dates', () => {
    expect(isIsoDate('2026-11-13')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('13/11/2026')).toBe(false);
  });

  it('adds and diffs days across months', () => {
    expect(addDaysIso('2026-11-29', 3)).toBe('2026-12-02');
    expect(diffDays('2026-11-13', '2026-12-02')).toBe(19);
  });

  it('starts weeks on Monday', () => {
    expect(startOfWeekIso('2026-11-13')).toBe('2026-11-09');
    expect(startOfWeekIso('2026-11-09')).toBe('2026-11-09');
    expect(startOfWeekIso('2026-11-15')).toBe('2026-11-09');
  });

  it('buckets due dates', () => {
    const today = '2026-11-13';
    expect(dueBucket('2026-11-12', today)).toBe('overdue');
    expect(dueBucket('2026-11-13', today)).toBe('today');
    expect(dueBucket('2026-11-14', today)).toBe('tomorrow');
    expect(dueBucket('2026-11-15', today)).toBe('this_week');
    expect(dueBucket('2026-11-20', today)).toBe('next_week');
    expect(dueBucket('2026-12-20', today)).toBe('later');
    expect(dueBucket(null, today)).toBe('none');
  });

  it('flags overdue only for open tasks', () => {
    expect(isOverdue('2026-11-01', false, '2026-11-13')).toBe(true);
    expect(isOverdue('2026-11-01', true, '2026-11-13')).toBe(false);
    expect(isOverdue(null, false, '2026-11-13')).toBe(false);
  });

  it('formats friendly labels', () => {
    expect(formatDue('2026-11-13', '2026-11-13')).toBe('Today');
    expect(formatDue('2026-11-14', '2026-11-13')).toBe('Tomorrow');
    expect(formatDue('2026-11-12', '2026-11-13')).toBe('Yesterday');
    expect(formatMinutes(90)).toBe('1h 30m');
    expect(formatMinutes(45)).toBe('45m');
    expect(formatMinutes(120)).toBe('2h');
  });
});
