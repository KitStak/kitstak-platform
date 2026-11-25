/**
 * Calendar math on `YYYY-MM-DD` strings, done in UTC day numbers so no time zone or daylight
 * saving change can move a date. Used by the projection (finish date), the shared cost pools and
 * the trend helpers. Pure functions.
 *
 * Moved from `apps/pulse/src/lib/profit/calendar.ts` (Pulse re-exports it). The program section
 * at the end adds months and program calendars (docs/programs/SPEC.md 3.2).
 */
import type { IsoDate, IsoMonth, ProgramCalendar, SharedSpread } from './types';

const DAY_MS = 86_400_000;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Monday to Friday, as JS weekday numbers (0 is Sunday). The default for `settings.working_days`. */
export const DEFAULT_WORKING_DAYS: readonly number[] = [1, 2, 3, 4, 5];

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/** Days since 1970-01-01 for a real calendar date. Throws on anything that is not one. */
export function dayNumber(date: IsoDate): number {
  const match = ISO.exec(date);
  if (!match) throw new RangeError(`Not a YYYY-MM-DD date: "${date}"`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(2000, month - 1, day));
  utc.setUTCFullYear(year);
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) throw new RangeError(`Not a real date: "${date}"`);
  return Math.round(utc.getTime() / DAY_MS);
}

/** The `YYYY-MM-DD` string of a day number. */
export function fromDayNumber(day: number): IsoDate {
  const utc = new Date(day * DAY_MS);
  const y = String(utc.getUTCFullYear()).padStart(4, '0');
  const m = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const d = String(utc.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** True for a real `YYYY-MM-DD` calendar date. */
export function isRealDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string') return false;
  try {
    dayNumber(value);
    return true;
  } catch {
    return false;
  }
}

/** The date `days` later (or earlier, when negative). */
export function addDays(date: IsoDate, days: number): IsoDate {
  return fromDayNumber(dayNumber(date) + days);
}

/** Whole days from `from` to `to` (`to - from`). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return dayNumber(to) - dayNumber(from);
}

/** JS weekday number: 0 is Sunday, 6 is Saturday. */
export function weekday(date: IsoDate): number {
  return (((dayNumber(date) + 4) % 7) + 7) % 7;
}

/**
 * True when the date is a work day. Two forms:
 *
 * - `isWorkDay(date, workingDays?)`: the weekday is one of the working days (Pulse).
 * - `isWorkDay(calendar, date)`: a program day (3.2). The date is one of `extraWorkDays`, or its
 *   weekday is a working day and it is not one of `daysOff`.
 */
export function isWorkDay(date: IsoDate, workingDays?: readonly number[]): boolean;
export function isWorkDay(calendar: ProgramCalendar, date: IsoDate): boolean;
export function isWorkDay(first: IsoDate | ProgramCalendar, second?: readonly number[] | IsoDate): boolean {
  if (typeof first === 'string') {
    const workingDays = Array.isArray(second) ? (second as readonly number[]) : DEFAULT_WORKING_DAYS;
    return workingDays.includes(weekday(first));
  }
  const date = second as IsoDate;
  if (first.extraWorkDays.includes(date)) return true;
  return first.workingDays.includes(weekday(date)) && !first.daysOff.includes(date);
}

/**
 * The date `count` work days after `date`. The start day itself is not counted, so 1 work day
 * after a Friday is the next Monday. `count` of 0 returns the date unchanged.
 * Returns `null` when there are no working days to count.
 */
export function addWorkDays(date: IsoDate, count: number, workingDays: readonly number[] = DEFAULT_WORKING_DAYS): IsoDate | null {
  if (count <= 0) return date;
  if (!workingDays.some((day) => day >= 0 && day <= 6)) return null;
  let day = dayNumber(date);
  let left = Math.ceil(count);
  while (left > 0) {
    day += 1;
    if (workingDays.includes((((day + 4) % 7) + 7) % 7)) left -= 1;
  }
  return fromDayNumber(day);
}

/** Work days after `from`, up to and including `to`. 0 when `to` is not after `from`. */
export function workDaysBetween(from: IsoDate, to: IsoDate, workingDays: readonly number[] = DEFAULT_WORKING_DAYS): number {
  const start = dayNumber(from);
  const end = dayNumber(to);
  let count = 0;
  for (let day = start + 1; day <= end; day += 1) if (workingDays.includes((((day + 4) % 7) + 7) % 7)) count += 1;
  return count;
}

/** First day of the month of `date`. */
export function startOfMonth(date: IsoDate): IsoDate {
  return `${date.slice(0, 8)}01`;
}

/** Last day of the month of `date`. */
export function endOfMonth(date: IsoDate): IsoDate {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const next = month === 12 ? `${String(year + 1).padStart(4, '0')}-01-01` : `${date.slice(0, 5)}${String(month + 1).padStart(2, '0')}-01`;
  return addDays(next, -1);
}

/** First day of the week of `date`. `weekStart` is a JS weekday number (default 1, Monday). */
export function startOfWeek(date: IsoDate, weekStart = 1): IsoDate {
  const offset = (weekday(date) - weekStart + 7) % 7;
  return addDays(date, -offset);
}

/** The same day of the month `months` later, moved back to the month end when that day does not exist. */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const index = year * 12 + (month - 1) + months;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  const first = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`;
  const last = Number(endOfMonth(first).slice(8, 10));
  return `${first.slice(0, 8)}${String(Math.min(day, last)).padStart(2, '0')}`;
}

/**
 * The shared cost pool that holds `date` (4.5): a day, a week or a month. A week that crosses a
 * month end is cut at the month boundary, so every pool sits inside one calendar month.
 */
export function poolPeriod(date: IsoDate, spread: SharedSpread, weekStart = 1): { start: IsoDate; end: IsoDate } {
  if (spread === 'day') return { start: date, end: date };
  const monthStart = startOfMonth(date);
  const monthEnd = endOfMonth(date);
  if (spread === 'month') return { start: monthStart, end: monthEnd };
  const weekBegin = startOfWeek(date, weekStart);
  const weekEnd = addDays(weekBegin, 6);
  return { start: weekBegin < monthStart ? monthStart : weekBegin, end: weekEnd > monthEnd ? monthEnd : weekEnd };
}

/** "Dec 9" for sentences. */
export function shortDate(date: IsoDate): string {
  dayNumber(date);
  return `${MONTHS_SHORT[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`;
}

/** "Friday" for sentences. */
export function weekdayName(date: IsoDate): string {
  return WEEKDAYS[weekday(date)] as string;
}

/* ------------------------------------------------------------------------------------------ */
/* Months and program calendars (docs/programs/SPEC.md 3.2)                                   */
/* ------------------------------------------------------------------------------------------ */

const ISO_MONTH = /^(\d{4})-(\d{2})$/;

/** True for a real `YYYY-MM` month. */
export function isRealMonth(value: unknown): value is IsoMonth {
  if (typeof value !== 'string') return false;
  const match = ISO_MONTH.exec(value);
  if (!match) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

function assertMonth(month: IsoMonth): void {
  if (!isRealMonth(month)) throw new RangeError(`Not a YYYY-MM month: "${month}"`);
}

/** The `YYYY-MM` month of a date. */
export function monthOf(date: IsoDate): IsoMonth {
  dayNumber(date);
  return date.slice(0, 7);
}

/** The first day of a `YYYY-MM` month. */
export function firstDayOfMonth(month: IsoMonth): IsoDate {
  assertMonth(month);
  return `${month}-01`;
}

/** The last day of a `YYYY-MM` month. */
export function lastDayOfMonth(month: IsoMonth): IsoDate {
  return endOfMonth(firstDayOfMonth(month));
}

/** Number of calendar days in a `YYYY-MM` month. */
export function daysInMonth(month: IsoMonth): number {
  return Number(lastDayOfMonth(month).slice(8, 10));
}

/** The month `count` months later (or earlier, when negative). */
export function shiftMonth(month: IsoMonth, count: number): IsoMonth {
  return addMonths(firstDayOfMonth(month), count).slice(0, 7);
}

/** Every month from `from` through `to`, inclusive. Empty when `to` is before `from`. */
export function monthsBetween(from: IsoMonth, to: IsoMonth): IsoMonth[] {
  assertMonth(from);
  assertMonth(to);
  const out: IsoMonth[] = [];
  for (let month = from; month <= to; month = shiftMonth(month, 1)) out.push(month);
  return out;
}

/** Every date from `from` through `to`, inclusive. Empty when `to` is before `from`. */
export function eachDay(from: IsoDate, to: IsoDate): IsoDate[] {
  const start = dayNumber(from);
  const end = dayNumber(to);
  const out: IsoDate[] = [];
  for (let day = start; day <= end; day += 1) out.push(fromDayNumber(day));
  return out;
}

/** The later of two dates. */
export function maxDate(a: IsoDate, b: IsoDate): IsoDate {
  return a > b ? a : b;
}

/** The earlier of two dates. */
export function minDate(a: IsoDate, b: IsoDate): IsoDate {
  return a < b ? a : b;
}

/** True when the date is inside one of the ranges (inclusive; an open `to` runs forever). */
export function inRanges(ranges: readonly { readonly from: IsoDate; readonly to: IsoDate | null }[], date: IsoDate): boolean {
  return ranges.some((range) => range.from <= date && (range.to === null || date <= range.to));
}

/** True when the program is paused on the date. */
export function isPausedOn(calendar: ProgramCalendar, date: IsoDate): boolean {
  return inRanges(calendar.paused, date);
}

/** True when the date is between the program start and end dates (either may be open). */
export function isActiveDay(calendar: ProgramCalendar, date: IsoDate): boolean {
  if (calendar.activeFrom !== null && date < calendar.activeFrom) return false;
  if (calendar.activeTo !== null && date > calendar.activeTo) return false;
  return true;
}

/** A program work day that counts for plans and forecasts: a work day, inside the active range and not paused. */
export function isPlannableDay(calendar: ProgramCalendar, date: IsoDate): boolean {
  return isWorkDay(calendar, date) && isActiveDay(calendar, date) && !isPausedOn(calendar, date);
}

/** The active part of a month: `max(month start, activeFrom)` to `min(month end, activeTo)`, or null when none. */
export function activeRange(calendar: ProgramCalendar, month: IsoMonth): { from: IsoDate; to: IsoDate } | null {
  const from = calendar.activeFrom === null ? firstDayOfMonth(month) : maxDate(firstDayOfMonth(month), calendar.activeFrom);
  const to = calendar.activeTo === null ? lastDayOfMonth(month) : minDate(lastDayOfMonth(month), calendar.activeTo);
  return from > to ? null : { from, to };
}

/** Program work days in a month (work days inside the active range, not paused). */
export function workDaysInMonth(calendar: ProgramCalendar, month: IsoMonth): IsoDate[] {
  return eachDay(firstDayOfMonth(month), lastDayOfMonth(month)).filter((date) => isPlannableDay(calendar, date));
}
