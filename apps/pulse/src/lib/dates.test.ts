import { describe, expect, it } from 'vitest';
import { addDaysIso, diffDays, dueBucket, formatDue, formatMinutes, formatRelative, isIsoDate, isOverdue, startOfWeekIso, formatLongDate } from './dates';

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

  it('words relative times by calendar day so they match day headings', () => {
    const now = new Date(2026, 10, 13, 9, 0); // Fri Nov 13, 9:00 local
    expect(formatRelative(new Date(2026, 10, 13, 8, 59, 40).toISOString(), now)).toBe('just now');
    expect(formatRelative(new Date(2026, 10, 13, 8, 30).toISOString(), now)).toBe('30 minutes ago');
    expect(formatRelative(new Date(2026, 10, 13, 1, 0).toISOString(), now)).toBe('8 hours ago');
    expect(formatRelative(new Date(2026, 10, 12, 10, 0).toISOString(), now)).toBe('yesterday');
    // Calendar days, not 24-hour blocks: 33 hours back is still Thursday, 33.5 is Wednesday.
    expect(formatRelative(new Date(2026, 10, 12, 0, 0).toISOString(), now)).toBe('yesterday');
    expect(formatRelative(new Date(2026, 10, 11, 23, 30).toISOString(), now)).toBe('2 days ago');
    expect(formatRelative(new Date(2026, 10, 1, 12, 0).toISOString(), now)).toBe('Nov 1');
  });
});

describe('template offsets skip weekends', () => {
  it('rolls Saturday and Sunday to the next Monday', async () => {
    const { rollToWorkdayIso, templateOffsetDateIso } = await import('./dates');
    expect(rollToWorkdayIso('2026-11-14')).toBe('2026-11-16');
    expect(rollToWorkdayIso('2026-11-15')).toBe('2026-11-16');
    expect(rollToWorkdayIso('2026-11-13')).toBe('2026-11-13');
    // Friday start: +2 is Sunday, +30 is Sunday Dec 13.
    expect(templateOffsetDateIso('2026-11-13', 2)).toBe('2026-11-16');
    expect(templateOffsetDateIso('2026-11-13', 30)).toBe('2026-12-14');
    // Monday start: +6 is Sunday.
    expect(templateOffsetDateIso('2026-11-16', 6)).toBe('2026-11-23');
  });

  it('never lands the Warehouse go-live work on a weekend, in order, for any start day', async () => {
    const { templateOffsetDateIso, parseIsoDate, addDaysIso } = await import('./dates');
    const offsets = [2, 6, 8, 10, 11, 14, 16, 22, 25, 30, 35];
    for (let i = 0; i < 7; i += 1) {
      const start = addDaysIso('2026-11-09', i);
      const dates = offsets.map((o) => templateOffsetDateIso(start, o));
      for (const date of dates) expect([0, 6]).not.toContain(parseIsoDate(date).getDay());
      expect([...dates].sort()).toEqual(dates);
      expect(dates[dates.length - 1] > dates[offsets.indexOf(30)]).toBe(true);
    }
  });

  it('formats a long date the same way on the server and in the browser', () => {
    expect(formatLongDate('2026-11-17')).toBe('Tuesday, November 17, 2026');
    expect(formatLongDate('2027-01-01')).toBe('Friday, January 1, 2027');
  });
});
