/**
 * Schedules (docs/programs/SPEC.md 3.10, D8): repeating rules that make builds ahead of time,
 * how far ahead to make them, the qty for a day, the rule in words, and time zone safe "today".
 * Pure functions on `YYYY-MM-DD` strings.
 */
import { addDays, addMonths, daysBetween, isActiveDay, isPausedOn, isRealDate, isWorkDay, maxDate, minDate, startOfWeek, weekday } from './calendar';
import type { IsoDate, ProgramCalendar } from './types';

export type SchedulePattern = 'daily' | 'weekdays' | 'custom_days' | 'every_n_weeks';

export interface ScheduleRule {
  readonly pattern: SchedulePattern;
  /** JS weekday numbers (0 is Sunday) for `custom_days` and `every_n_weeks`. */
  readonly days: readonly number[];
  /** For `every_n_weeks`. */
  readonly intervalWeeks: number;
  readonly startsOn: IsoDate;
  readonly endsOn: IsoDate | null;
  readonly skipHolidays: boolean;
  readonly skipDates: readonly IsoDate[];
}

export interface ScheduleLine {
  readonly variantId: string;
  readonly qty: string;
  /** Weekday number (as a string) to qty, for "Vary by day". */
  readonly qtyByWeekday: Readonly<Record<string, string>> | null;
}

/** How far ahead `nextOccurrence` looks before it gives up. */
const SEARCH_DAYS = 3 * 366;

function matchesPattern(rule: ScheduleRule, calendar: ProgramCalendar, date: IsoDate): boolean {
  switch (rule.pattern) {
    case 'daily':
      return true;
    case 'weekdays':
      // The program's working weekdays plus its extra work days. Days off are left to the
      // `skipHolidays` check in `occursOn`, so unticking "Skip holidays" really keeps them.
      return calendar.workingDays.includes(weekday(date)) || calendar.extraWorkDays.includes(date);
    case 'custom_days':
      return rule.days.includes(weekday(date));
    case 'every_n_weeks': {
      if (!rule.days.includes(weekday(date))) return false;
      const interval = Math.max(1, Math.floor(rule.intervalWeeks || 1));
      const weeks = Math.floor(daysBetween(startOfWeek(rule.startsOn), startOfWeek(date)) / 7);
      return weeks >= 0 && weeks % interval === 0;
    }
  }
}

/**
 * True when the rule makes builds on the date: inside its own dates and the program's active
 * dates, the pattern matches, and it is not skipped (days off when `skipHolidays`, paused days
 * and `skipDates` always).
 */
export function occursOn(rule: ScheduleRule, calendar: ProgramCalendar, date: IsoDate): boolean {
  if (date < rule.startsOn) return false;
  if (rule.endsOn !== null && date > rule.endsOn) return false;
  if (!isActiveDay(calendar, date)) return false;
  if (!matchesPattern(rule, calendar, date)) return false;
  if (rule.skipHolidays && calendar.daysOff.includes(date) && !calendar.extraWorkDays.includes(date)) return false;
  if (isPausedOn(calendar, date)) return false;
  if (rule.skipDates.includes(date)) return false;
  return true;
}

/** Every date from `from` through `to` (inclusive) the rule makes builds on, sorted and unique. */
export function occurrences(rule: ScheduleRule, calendar: ProgramCalendar, from: IsoDate, to: IsoDate): IsoDate[] {
  const start = maxDate(from, rule.startsOn);
  const end = rule.endsOn === null ? to : minDate(to, rule.endsOn);
  const out: IsoDate[] = [];
  if (start > end) return out;
  for (let date = start; date <= end; date = addDays(date, 1)) if (occursOn(rule, calendar, date)) out.push(date);
  return out;
}

/** The first date after `after` the rule makes builds on, or null when there is none. */
export function nextOccurrence(rule: ScheduleRule, calendar: ProgramCalendar, after: IsoDate): IsoDate | null {
  let date = maxDate(addDays(after, 1), rule.startsOn);
  const limit = addDays(date, SEARCH_DAYS);
  while (date <= limit) {
    if (rule.endsOn !== null && date > rule.endsOn) return null;
    if (occursOn(rule, calendar, date)) return date;
    date = addDays(date, 1);
  }
  return null;
}

/** The qty a line makes on a date: the qty for that weekday when set, else the line qty. */
export function qtyFor(line: ScheduleLine, date: IsoDate): string {
  const byDay = line.qtyByWeekday?.[String(weekday(date))];
  return byDay !== undefined && byDay !== null && byDay.trim() !== '' ? byDay : line.qty;
}

/**
 * The dates a schedule should make builds for now: from the latest of its start, the day after
 * what it already made, and today; to the earlier of its end and today plus the lead days. Null
 * when there is nothing to make. Past days are never made.
 */
export function generationWindow(input: { readonly asOf: IsoDate; readonly leadDays: number; readonly generatedThrough: IsoDate | null; readonly startsOn: IsoDate; readonly endsOn: IsoDate | null }): { from: IsoDate; to: IsoDate } | null {
  let from = maxDate(input.startsOn, input.asOf);
  if (input.generatedThrough !== null) from = maxDate(from, addDays(input.generatedThrough, 1));
  const ahead = addDays(input.asOf, Math.max(0, Math.floor(input.leadDays)));
  const to = input.endsOn === null ? ahead : minDate(input.endsOn, ahead);
  return from > to ? null : { from, to };
}

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const LONG_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/** Weekday numbers in week order, Monday first. */
function weekOrder(days: readonly number[]): number[] {
  return [...new Set(days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
}

/** "Mon", "Mon and Fri", "Mon, Wed and Fri". */
export function listDays(days: readonly number[], style: 'short' | 'long' = 'short'): string {
  const names = weekOrder(days).map((day) => (style === 'short' ? SHORT_DAYS[day] : LONG_DAYS[day]) as string);
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function sameDays(a: readonly number[], b: readonly number[]): boolean {
  const x = weekOrder(a);
  const y = weekOrder(b);
  return x.length === y.length && x.every((day, index) => day === y[index]);
}

/** The rule in words: "Every weekday", "Mon, Wed and Fri", "Every 2 weeks on Monday". */
export function describeRule(rule: ScheduleRule, calendar: ProgramCalendar): string {
  switch (rule.pattern) {
    case 'daily':
      return 'Every day';
    case 'weekdays':
      return sameDays(calendar.workingDays, [1, 2, 3, 4, 5]) ? 'Every weekday' : 'Every work day';
    case 'custom_days': {
      const days = weekOrder(rule.days);
      if (days.length === 0) return 'No days picked';
      if (days.length === 7) return 'Every day';
      if (days.length === 1) return `Every ${LONG_DAYS[days[0] as number]}`;
      return listDays(days);
    }
    case 'every_n_weeks': {
      const days = weekOrder(rule.days);
      const interval = Math.max(1, Math.floor(rule.intervalWeeks || 1));
      const when = days.length === 0 ? 'no days picked' : `on ${days.length === 1 ? LONG_DAYS[days[0] as number] : listDays(days)}`;
      return interval === 1 ? `Every week ${when}` : `Every ${interval} weeks ${when}`;
    }
  }
}

/** Today's date in a time zone: `todayIn('America/Chicago', new Date('2026-11-26T04:30:00Z'))` is `'2026-11-25'`. */
export function todayIn(timezone: string, now: Date): IsoDate {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: string): string => parts.find((row) => row.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** The first program work day after `after` that is not paused. The next calendar day when the calendar has none. */
export function nextWorkDay(calendar: ProgramCalendar, after: IsoDate): IsoDate {
  for (let offset = 1; offset <= SEARCH_DAYS; offset += 1) {
    const date = addDays(after, offset);
    if (isWorkDay(calendar, date) && !isPausedOn(calendar, date)) return date;
  }
  return addDays(after, 1);
}

export interface TaskRecurrenceRule {
  readonly frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  readonly interval: number;
  readonly weekdays?: readonly number[];
}

/**
 * The next due date of a repeating task (extracted from Projects `tasks.ts`, now on date strings
 * only so no time zone can move it). Weekly with weekdays picks the next listed weekday within
 * the interval; monthly keeps the day of the month, capped at the month's last day; yearly keeps
 * the date (Feb 29 becomes Feb 28 in a year without one).
 */
export function nextOccurrenceDate(from: IsoDate, recurrence: TaskRecurrenceRule): IsoDate {
  if (!isRealDate(from)) throw new RangeError(`Not a YYYY-MM-DD date: "${from}"`);
  const interval = Math.max(1, Math.floor(recurrence.interval || 1));
  switch (recurrence.frequency) {
    case 'daily':
      return addDays(from, interval);
    case 'weekly': {
      if (recurrence.weekdays && recurrence.weekdays.length > 0) {
        for (let i = 1; i <= 7 * interval; i += 1) {
          const candidate = addDays(from, i);
          if (recurrence.weekdays.includes(weekday(candidate))) return candidate;
        }
      }
      return addDays(from, 7 * interval);
    }
    case 'monthly':
      return addMonths(from, interval);
    case 'yearly':
      return addMonths(from, 12 * interval);
  }
}
