import { describe, expect, it } from 'vitest';
import { CALENDAR } from './glove.fixture';
import { type ScheduleRule, describeRule, generationWindow, listDays, nextOccurrence, nextOccurrenceDate, nextWorkDay, occurrences, occursOn, qtyFor, todayIn } from './schedule';

const rule = (partial: Partial<ScheduleRule>): ScheduleRule => ({ pattern: 'weekdays', days: [], intervalWeeks: 1, startsOn: '2026-09-15', endsOn: null, skipHolidays: true, skipDates: [], ...partial });

describe('occurrences', () => {
  it('E28 weekdays in November skip the day off', () => {
    const dates = occurrences(rule({}), CALENDAR, '2026-11-01', '2026-11-30');
    expect(dates).toHaveLength(20);
    expect(dates[0]).toBe('2026-11-02');
    expect(dates[dates.length - 1]).toBe('2026-11-30');
    expect(dates).not.toContain('2026-11-26');
  });
  it('E29 every 2 weeks on Monday', () => {
    expect(occurrences(rule({ pattern: 'every_n_weeks', days: [1], intervalWeeks: 2, startsOn: '2026-11-02' }), CALENDAR, '2026-11-01', '2026-11-30')).toEqual(['2026-11-02', '2026-11-16', '2026-11-30']);
  });
  it('daily, chosen days, skips and dates', () => {
    expect(occurrences(rule({ pattern: 'daily' }), CALENDAR, '2026-11-25', '2026-11-28')).toEqual(['2026-11-25', '2026-11-27', '2026-11-28']);
    expect(occurrences(rule({ pattern: 'daily', skipHolidays: false }), CALENDAR, '2026-11-25', '2026-11-27')).toEqual(['2026-11-25', '2026-11-26', '2026-11-27']);
    expect(occurrences(rule({ pattern: 'custom_days', days: [1, 3, 5], skipDates: ['2026-11-25'] }), CALENDAR, '2026-11-23', '2026-11-29')).toEqual(['2026-11-23', '2026-11-27']);
    expect(occurrences(rule({ endsOn: '2026-11-24' }), CALENDAR, '2026-11-23', '2026-11-30')).toEqual(['2026-11-23', '2026-11-24']);
    expect(occurrences(rule({ startsOn: '2026-12-01' }), CALENDAR, '2026-11-23', '2026-11-30')).toEqual([]);
  });
  it('paused days and days outside the program always skip; extra work days count', () => {
    const calendar = { ...CALENDAR, paused: [{ from: '2026-11-24', to: '2026-11-24' }], extraWorkDays: ['2026-11-28'], activeTo: '2026-11-30' };
    expect(occurrences(rule({}), calendar, '2026-11-23', '2026-12-02')).toEqual(['2026-11-23', '2026-11-25', '2026-11-27', '2026-11-28', '2026-11-30']);
    expect(occursOn(rule({}), CALENDAR, '2026-09-14')).toBe(false);
  });
  it('finds the next occurrence', () => {
    expect(nextOccurrence(rule({}), CALENDAR, '2026-11-25')).toBe('2026-11-27');
    expect(nextOccurrence(rule({ endsOn: '2026-11-26' }), CALENDAR, '2026-11-25')).toBeNull();
    expect(nextOccurrence(rule({ pattern: 'custom_days', days: [] }), CALENDAR, '2026-11-25')).toBeNull();
  });
});

describe('qtyFor', () => {
  it('E43 varies by weekday', () => {
    const line = { variantId: 'v', qty: '240', qtyByWeekday: { '6': '120', '1': '300', '3': ' ' } };
    expect(qtyFor(line, '2026-11-28')).toBe('120');
    expect(qtyFor(line, '2026-11-30')).toBe('300');
    expect(qtyFor(line, '2026-11-25')).toBe('240');
    expect(qtyFor({ ...line, qtyByWeekday: null }, '2026-11-30')).toBe('240');
  });
});

describe('generationWindow', () => {
  it('starts today or after what was made, and ends at the lead days or the end', () => {
    expect(generationWindow({ asOf: '2026-11-25', leadDays: 14, generatedThrough: null, startsOn: '2026-09-15', endsOn: null })).toEqual({ from: '2026-11-25', to: '2026-12-09' });
    expect(generationWindow({ asOf: '2026-11-25', leadDays: 14, generatedThrough: '2026-12-01', startsOn: '2026-09-15', endsOn: '2026-12-05' })).toEqual({ from: '2026-12-02', to: '2026-12-05' });
    expect(generationWindow({ asOf: '2026-11-25', leadDays: 14, generatedThrough: '2026-12-09', startsOn: '2026-09-15', endsOn: null })).toBeNull();
    expect(generationWindow({ asOf: '2026-11-25', leadDays: 7, generatedThrough: null, startsOn: '2027-01-01', endsOn: null })).toBeNull();
  });
});

describe('describeRule', () => {
  it('says the rule in plain words', () => {
    expect(describeRule(rule({}), CALENDAR)).toBe('Every weekday');
    expect(describeRule(rule({}), { ...CALENDAR, workingDays: [1, 2, 3, 4, 5, 6] })).toBe('Every work day');
    expect(describeRule(rule({ pattern: 'daily' }), CALENDAR)).toBe('Every day');
    expect(describeRule(rule({ pattern: 'custom_days', days: [5, 1, 3] }), CALENDAR)).toBe('Mon, Wed and Fri');
    expect(describeRule(rule({ pattern: 'custom_days', days: [2] }), CALENDAR)).toBe('Every Tuesday');
    expect(describeRule(rule({ pattern: 'custom_days', days: [0, 1, 2, 3, 4, 5, 6] }), CALENDAR)).toBe('Every day');
    expect(describeRule(rule({ pattern: 'custom_days', days: [] }), CALENDAR)).toBe('No days picked');
    expect(describeRule(rule({ pattern: 'every_n_weeks', days: [1], intervalWeeks: 2 }), CALENDAR)).toBe('Every 2 weeks on Monday');
    expect(describeRule(rule({ pattern: 'every_n_weeks', days: [4, 1], intervalWeeks: 1 }), CALENDAR)).toBe('Every week on Mon and Thu');
    expect(describeRule(rule({ pattern: 'every_n_weeks', days: [], intervalWeeks: 3 }), CALENDAR)).toBe('Every 3 weeks no days picked');
  });
  it('lists days Monday first', () => {
    expect(listDays([0, 6, 1], 'long')).toBe('Monday, Saturday and Sunday');
    expect(listDays([])).toBe('');
  });
});

describe('dates and zones', () => {
  it('E30 today in Chicago late at night UTC', () => {
    expect(todayIn('America/Chicago', new Date('2026-11-26T04:30:00Z'))).toBe('2026-11-25');
    expect(todayIn('UTC', new Date('2026-11-26T04:30:00Z'))).toBe('2026-11-26');
  });
  it('finds the next work day', () => {
    expect(nextWorkDay(CALENDAR, '2026-11-25')).toBe('2026-11-27');
    expect(nextWorkDay(CALENDAR, '2026-11-27')).toBe('2026-11-30');
    expect(nextWorkDay({ ...CALENDAR, workingDays: [] }, '2026-11-27')).toBe('2026-11-28');
  });
  it('repeats tasks on date strings', () => {
    expect(nextOccurrenceDate('2026-11-25', { frequency: 'daily', interval: 2 })).toBe('2026-11-27');
    expect(nextOccurrenceDate('2026-11-25', { frequency: 'weekly', interval: 1, weekdays: [1, 5] })).toBe('2026-11-27');
    expect(nextOccurrenceDate('2026-11-25', { frequency: 'weekly', interval: 2 })).toBe('2026-12-09');
    expect(nextOccurrenceDate('2026-01-31', { frequency: 'monthly', interval: 1 })).toBe('2026-02-28');
    expect(nextOccurrenceDate('2028-02-29', { frequency: 'yearly', interval: 1 })).toBe('2029-02-28');
    expect(nextOccurrenceDate('2026-11-25', { frequency: 'daily', interval: 0 })).toBe('2026-11-26');
    expect(() => nextOccurrenceDate('2026-13-01', { frequency: 'daily', interval: 1 })).toThrow(RangeError);
  });
});

describe('weekdays and Skip holidays', () => {
  it('keeps Thanksgiving when Skip holidays is off and leaves it out when it is on', () => {
    const off = occurrences(rule({ skipHolidays: false }), CALENDAR, '2026-11-23', '2026-11-27');
    expect(off).toEqual(['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27']);
    const on = occurrences(rule({ skipHolidays: true }), CALENDAR, '2026-11-23', '2026-11-27');
    expect(on).toEqual(['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-27']);
  });
  it('still adds extra work days and skips weekends and paused days', () => {
    const calendar = { ...CALENDAR, extraWorkDays: ['2026-11-28'], paused: [{ from: '2026-11-24', to: '2026-11-24' }] };
    expect(occurrences(rule({ skipHolidays: false }), calendar, '2026-11-23', '2026-11-29')).toEqual(['2026-11-23', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28']);
  });
});
