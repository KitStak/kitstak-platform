import { describe, expect, it } from 'vitest';
import {
  activeRange,
  addDays,
  addMonths,
  addWorkDays,
  daysBetween,
  daysInMonth,
  eachDay,
  endOfMonth,
  firstDayOfMonth,
  inRanges,
  isActiveDay,
  isPausedOn,
  isPlannableDay,
  isRealDate,
  isRealMonth,
  isWorkDay,
  lastDayOfMonth,
  maxDate,
  minDate,
  monthOf,
  monthsBetween,
  poolPeriod,
  shiftMonth,
  shortDate,
  startOfMonth,
  startOfWeek,
  weekday,
  weekdayName,
  workDaysBetween,
  workDaysInMonth,
} from './calendar';
import { CALENDAR } from './glove.fixture';

describe('date strings (moved from Pulse)', () => {
  it('adds days and counts across month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-11-01', '2026-12-01')).toBe(30);
  });
  it('checks real dates', () => {
    expect(isRealDate('2028-02-29')).toBe(true);
    expect(isRealDate('2026-02-29')).toBe(false);
    expect(isRealDate('11/30/2026')).toBe(false);
    expect(isRealDate(20261130)).toBe(false);
  });
  it('weekdays and work days', () => {
    expect(weekday('2026-11-25')).toBe(3);
    expect(weekdayName('2026-11-25')).toBe('Wednesday');
    expect(isWorkDay('2026-11-28')).toBe(false);
    expect(isWorkDay('2026-11-28', [6])).toBe(true);
    expect(addWorkDays('2026-11-27', 1)).toBe('2026-11-30');
    expect(addWorkDays('2026-11-27', 1, [])).toBeNull();
    expect(workDaysBetween('2026-11-22', '2026-11-29')).toBe(5);
  });
  it('months and weeks', () => {
    expect(startOfMonth('2026-11-25')).toBe('2026-11-01');
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28');
    expect(endOfMonth('2026-12-10')).toBe('2026-12-31');
    expect(startOfWeek('2026-11-25')).toBe('2026-11-23');
    expect(startOfWeek('2026-11-25', 0)).toBe('2026-11-22');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-01-15', -2)).toBe('2025-11-15');
    expect(shortDate('2026-12-09')).toBe('Dec 9');
  });
  it('pool periods stay inside one month', () => {
    expect(poolPeriod('2026-12-01', 'week')).toEqual({ start: '2026-12-01', end: '2026-12-06' });
    expect(poolPeriod('2026-11-25', 'day')).toEqual({ start: '2026-11-25', end: '2026-11-25' });
    expect(poolPeriod('2026-11-25', 'month')).toEqual({ start: '2026-11-01', end: '2026-11-30' });
  });
});

describe('program calendars (3.2)', () => {
  it('isWorkDay with a calendar honors days off and extra work days', () => {
    expect(isWorkDay(CALENDAR, '2026-11-26')).toBe(false);
    expect(isWorkDay(CALENDAR, '2026-11-25')).toBe(true);
    expect(isWorkDay({ ...CALENDAR, extraWorkDays: ['2026-11-28'] }, '2026-11-28')).toBe(true);
  });
  it('months', () => {
    expect(isRealMonth('2026-11')).toBe(true);
    expect(isRealMonth('2026-13')).toBe(false);
    expect(isRealMonth(202611)).toBe(false);
    expect(monthOf('2026-11-25')).toBe('2026-11');
    expect(firstDayOfMonth('2026-11')).toBe('2026-11-01');
    expect(lastDayOfMonth('2028-02')).toBe('2028-02-29');
    expect(daysInMonth('2026-11')).toBe(30);
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(monthsBetween('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(monthsBetween('2027-02', '2026-11')).toEqual([]);
    expect(() => firstDayOfMonth('2026-1')).toThrow(RangeError);
  });
  it('ranges, pauses and the active part of a month', () => {
    expect(eachDay('2026-11-29', '2026-12-01')).toEqual(['2026-11-29', '2026-11-30', '2026-12-01']);
    expect(maxDate('2026-11-01', '2026-10-31')).toBe('2026-11-01');
    expect(minDate('2026-11-01', '2026-10-31')).toBe('2026-10-31');
    expect(inRanges([{ from: '2026-11-09', to: null }], '2027-01-01')).toBe(true);
    const paused = { ...CALENDAR, paused: [{ from: '2026-11-09', to: '2026-11-15' }], activeTo: '2026-11-20' };
    expect(isPausedOn(paused, '2026-11-10')).toBe(true);
    expect(isActiveDay(paused, '2026-11-21')).toBe(false);
    expect(isActiveDay(paused, '2026-09-14')).toBe(false);
    expect(isPlannableDay(paused, '2026-11-10')).toBe(false);
    expect(activeRange(CALENDAR, '2026-09')).toEqual({ from: '2026-09-15', to: '2026-09-30' });
    expect(activeRange(CALENDAR, '2026-08')).toBeNull();
    expect(activeRange(paused, '2026-11')).toEqual({ from: '2026-11-01', to: '2026-11-20' });
    expect(workDaysInMonth(CALENDAR, '2026-12')).toHaveLength(22);
    expect(workDaysInMonth(paused, '2026-11')).toHaveLength(10);
  });
});
