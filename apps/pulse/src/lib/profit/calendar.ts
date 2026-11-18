/**
 * Calendar math on `YYYY-MM-DD` strings, done in UTC day numbers so no time zone or daylight
 * saving change can move a date. Used by the projection (finish date), the shared cost pools and
 * the trend helpers. Pure functions.
 */
import type { IsoDate, SharedSpread } from './types';

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

/** True when the date is one of the working days. */
export function isWorkDay(date: IsoDate, workingDays: readonly number[] = DEFAULT_WORKING_DAYS): boolean {
  return workingDays.includes(weekday(date));
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
