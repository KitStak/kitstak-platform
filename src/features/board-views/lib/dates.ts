/**
 * Calendar-date math on ISO `YYYY-MM-DD` strings. Everything runs in UTC so a date never
 * shifts with the viewer's time zone (cell values are plain calendar dates).
 */
export type IsoDate = string;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})/;
const DAY_MS = 86_400_000;

export function isIsoDate(value: unknown): value is IsoDate {
  return typeof value === 'string' && ISO_RE.test(value);
}

/** Midnight UTC timestamp of an ISO date, or null when malformed. */
export function isoToTime(iso: string): number | null {
  const match = ISO_RE.exec(iso);
  if (!match) return null;
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(time) ? null : time;
}

export function timeToIso(time: number): IsoDate {
  return new Date(time).toISOString().slice(0, 10);
}

/** Today's calendar date in the viewer's local time zone. */
export function todayIso(now: Date = new Date()): IsoDate {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  const time = isoToTime(iso);
  return time === null ? iso : timeToIso(time + days * DAY_MS);
}

/** Whole days from `a` to `b` (positive when b is later). */
export function diffDays(a: IsoDate, b: IsoDate): number {
  const ta = isoToTime(a);
  const tb = isoToTime(b);
  if (ta === null || tb === null) return 0;
  return Math.round((tb - ta) / DAY_MS);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(iso: IsoDate): number {
  const time = isoToTime(iso);
  return time === null ? 0 : new Date(time).getUTCDay();
}

export function startOfWeek(iso: IsoDate, weekStartsOn: 0 | 1): IsoDate {
  const offset = (weekdayOf(iso) - weekStartsOn + 7) % 7;
  return addDays(iso, -offset);
}

export function startOfMonth(iso: IsoDate): IsoDate {
  return `${iso.slice(0, 7)}-01`;
}

export function addMonths(iso: IsoDate, months: number): IsoDate {
  const time = isoToTime(iso);
  if (time === null) return iso;
  const date = new Date(time);
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return timeToIso(target.getTime());
}

export function isSameMonth(a: IsoDate, b: IsoDate): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

/** Full weeks covering the month of `anchor` (4–6 rows of 7 ISO dates). */
export function monthMatrix(anchor: IsoDate, weekStartsOn: 0 | 1): IsoDate[][] {
  const first = startOfMonth(anchor);
  const nextMonth = startOfMonth(addMonths(first, 1));
  let cursor = startOfWeek(first, weekStartsOn);
  const weeks: IsoDate[][] = [];
  while (cursor < nextMonth || weeks.length === 0) {
    const week = Array.from({ length: 7 }, (_, index) => addDays(cursor, index));
    weeks.push(week);
    cursor = addDays(cursor, 7);
  }
  return weeks;
}

export function weekDays(anchor: IsoDate, weekStartsOn: 0 | 1): IsoDate[] {
  const start = startOfWeek(anchor, weekStartsOn);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

export function isWeekend(iso: IsoDate): boolean {
  const day = weekdayOf(iso);
  return day === 0 || day === 6;
}

const FORMATTERS = {
  short: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
  full: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }),
  month: new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
  monthShort: new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }),
  weekday: new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }),
  weekdayLong: new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }),
};

export type DateFormat = keyof typeof FORMATTERS;

export function formatIso(iso: IsoDate, format: DateFormat = 'short'): string {
  const time = isoToTime(iso);
  return time === null ? '' : FORMATTERS[format].format(new Date(time));
}

/** "Nov 12 → Nov 19 (8d)" — inclusive day count. */
export function formatSpan(from: IsoDate, to: IsoDate): string {
  const days = diffDays(from, to) + 1;
  return from === to ? `${formatIso(from)} (1d)` : `${formatIso(from)} → ${formatIso(to)} (${days}d)`;
}

/** ISO week-number-free bucket key for chart date grouping. */
export function dateBucket(iso: IsoDate, bucket: 'day' | 'week' | 'month' | 'quarter' | 'year'): { key: string; label: string } {
  switch (bucket) {
    case 'day':
      return { key: iso, label: formatIso(iso) };
    case 'week': {
      const start = startOfWeek(iso, 1);
      return { key: start, label: `Wk of ${formatIso(start)}` };
    }
    case 'month':
      return { key: iso.slice(0, 7), label: `${formatIso(iso, 'monthShort')} ${iso.slice(0, 4)}` };
    case 'quarter': {
      const quarter = Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1;
      return { key: `${iso.slice(0, 4)}-Q${quarter}`, label: `Q${quarter} ${iso.slice(0, 4)}` };
    }
    case 'year':
      return { key: iso.slice(0, 4), label: iso.slice(0, 4) };
  }
}
