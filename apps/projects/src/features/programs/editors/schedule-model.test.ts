import { describe, expect, it } from 'vitest';
import type { ProgramCalendar } from '@kitstak/programs-engine';
import { activeLines, generationCount, generationText, linesFor, nextRunsText, scheduleProblems, scheduleRuleText, toSchedulePayload, twoWeeks, type ScheduleEditorValue } from './schedule-model';

const calendar: ProgramCalendar = { timezone: 'America/Chicago', workingDays: [1, 2, 3, 4, 5], daysOff: ['2026-11-26', '2026-12-25'], extraWorkDays: [], activeFrom: '2026-11-02', activeTo: null, paused: [] };
const variants = ['S-BRN', 'S-YLW', 'M-BRN', 'M-YLW', 'L-BRN', 'L-YLW', 'XL-BRN', 'XL-YLW'].map((key) => ({ key, defaultQty: '100.000' }));
const weekday: ScheduleEditorValue = { enabled: true, name: 'Weekday glove run', pattern: 'weekdays', days: [], intervalWeeks: 1, startsOn: '2026-11-02', endsOn: null, leadDays: 7, skipHolidays: true, lines: linesFor(variants) };
const kits = { singular: 'kit', plural: 'kits' };

describe('schedule model', () => {
  it('counts what the server makes: GLOVE, Nov 25 plus 7 days, Thanksgiving skipped', () => {
    const count = generationCount(weekday, calendar, '2026-11-25');
    expect(count.dates).toEqual(['2026-11-25', '2026-11-27', '2026-11-30', '2026-12-01', '2026-12-02']);
    expect(count.builds).toBe(40);
    expect(generationText(count, kits, 7)).toBe('40 builds and 4,000 kits in the next 7 days');
  });

  it('names skipped holidays in the next runs', () => {
    expect(nextRunsText(weekday, calendar, '2026-11-25', [{ date: '2026-11-26', name: 'Thanksgiving' }])).toBe('Next 5 runs: Wed Nov 25, Thu Nov 26 skipped (Thanksgiving), Fri Nov 27, Mon Nov 30, Tue Dec 1');
    expect(nextRunsText({ ...weekday, enabled: false }, calendar, '2026-11-25')).toBe('No runs. The schedule is off.');
  });

  it('uses Vary by day quantities', () => {
    const value: ScheduleEditorValue = { ...weekday, lines: [{ variantKey: 'S-BRN', include: true, qty: '100', qtyByWeekday: { '5': '50' }, assigneeId: null }] };
    const count = generationCount(value, calendar, '2026-11-25');
    expect(count.units).toBe('450.000');
    expect(activeLines(value)[0]?.qtyByWeekday).toEqual({ '5': '50' });
  });

  it('marks the 2 week preview', () => {
    const days = twoWeeks(weekday, calendar, '2026-11-25', '2026-11-25');
    expect(days).toHaveLength(14);
    expect(days[0]?.date).toBe('2026-11-23');
    expect(days.find((day) => day.date === '2026-11-26')).toMatchObject({ occurs: false, skipped: true });
    expect(days.find((day) => day.date === '2026-11-28')).toMatchObject({ occurs: false, skipped: false, workDay: false });
    expect(days.find((day) => day.date === '2026-11-25')?.isToday).toBe(true);
  });

  it('describes the rule and finds problems', () => {
    expect(scheduleRuleText(weekday, calendar)).toBe('Every weekday');
    expect(scheduleProblems({ ...weekday, name: '', pattern: 'custom_days', days: [], lines: [] })).toEqual({ name: 'Name the schedule.', days: 'Pick at least one day.', lines: 'Include at least one variant.' });
    expect(scheduleProblems({ ...weekday, endsOn: '2026-01-01' }).endsOn).toBeDefined();
    expect(scheduleProblems({ ...weekday, enabled: false, name: '' })).toEqual({});
  });

  it('builds the wizard payload', () => {
    const payload = toSchedulePayload({ ...weekday, lines: [{ variantKey: 'S-BRN', include: true, qty: '1,000', qtyByWeekday: {}, assigneeId: 'u1' }, { variantKey: 'S-YLW', include: false, qty: '5', qtyByWeekday: null, assigneeId: null }] });
    expect(payload.lines).toEqual([{ variantKey: 'S-BRN', qty: '1000', qtyByWeekday: null, assigneeId: 'u1' }]);
    expect(payload.name).toBe('Weekday glove run');
  });
});
