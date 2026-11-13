/**
 * Calendar-date helpers. Task dates are plain `YYYY-MM-DD` strings (no time zone); "today" is
 * computed in the viewer's local time on the client and server-local time on the server.
 */
export type IsoDate = string;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const date = parseIsoDate(value);
  return !Number.isNaN(date.getTime()) && toIsoDate(date) === value;
}

/** Local-midnight Date for a `YYYY-MM-DD` string. */
export function parseIsoDate(value: IsoDate): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** `YYYY-MM-DD` of a Date in local time. */
export function toIsoDate(date: Date): IsoDate {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayIso(now: Date = new Date()): IsoDate {
  return toIsoDate(now);
}

export function addDaysIso(value: IsoDate, days: number): IsoDate {
  const date = parseIsoDate(value);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

/** Whole days from `a` to `b` (b - a). */
export function diffDays(a: IsoDate, b: IsoDate): number {
  const ms = parseIsoDate(b).getTime() - parseIsoDate(a).getTime();
  return Math.round(ms / 86_400_000);
}

/** Monday-start week containing `value`. */
export function startOfWeekIso(value: IsoDate): IsoDate {
  const date = parseIsoDate(value);
  const offset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offset);
  return toIsoDate(date);
}

export function isOverdue(dueDate: IsoDate | null | undefined, done: boolean, today: IsoDate = todayIso()): boolean {
  return Boolean(dueDate) && !done && (dueDate as string) < today;
}

export type DueBucket = 'overdue' | 'today' | 'tomorrow' | 'this_week' | 'next_week' | 'later' | 'none';

/** Bucket for Home / My Work grouping. */
export function dueBucket(dueDate: IsoDate | null | undefined, today: IsoDate = todayIso()): DueBucket {
  if (!dueDate) return 'none';
  if (dueDate < today) return 'overdue';
  if (dueDate === today) return 'today';
  if (dueDate === addDaysIso(today, 1)) return 'tomorrow';
  const weekEnd = addDaysIso(startOfWeekIso(today), 6);
  if (dueDate <= weekEnd) return 'this_week';
  if (dueDate <= addDaysIso(weekEnd, 7)) return 'next_week';
  return 'later';
}

const SHORT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const SHORT_YEAR = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'short' });

/** Friendly due label: "Today", "Tomorrow", "Yesterday", "Fri", "Mar 3", "Mar 3, 2027". */
export function formatDue(dueDate: IsoDate, today: IsoDate = todayIso()): string {
  const delta = diffDays(today, dueDate);
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Tomorrow';
  if (delta === -1) return 'Yesterday';
  const date = parseIsoDate(dueDate);
  if (delta > 1 && delta < 7) return WEEKDAY.format(date);
  return date.getFullYear() === parseIsoDate(today).getFullYear() ? SHORT.format(date) : SHORT_YEAR.format(date);
}

/** "Mar 3 to Mar 14" style range label (no dashes in KitStak copy). */
export function formatRange(start: IsoDate | null, end: IsoDate | null): string {
  if (start && end) return `${SHORT.format(parseIsoDate(start))} to ${SHORT.format(parseIsoDate(end))}`;
  if (end) return `Due ${SHORT.format(parseIsoDate(end))}`;
  if (start) return `Starts ${SHORT.format(parseIsoDate(start))}`;
  return 'No dates';
}

const RELATIVE = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' });

/** "just now", "5 minutes ago", "yesterday", "Mar 3". */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const seconds = Math.round((then.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return 'just now';
  if (abs < 3600) return RELATIVE.format(Math.round(seconds / 60), 'minute');
  // Count calendar days (local), so "yesterday" always matches the day headings beside it.
  const days = Math.round(
    (new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime() -
      new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) /
      86_400_000,
  );
  if (days === 0 || abs < 3600 * 6) return RELATIVE.format(Math.round(seconds / 3600), 'hour');
  if (Math.abs(days) < 7) return RELATIVE.format(days, 'day');
  return then.getFullYear() === now.getFullYear() ? SHORT.format(then) : SHORT_YEAR.format(then);
}

/** Minutes → "1h 30m", "45m", "0m". */
export function formatMinutes(minutes: number | null | undefined): string {
  const total = Math.max(0, Math.round(minutes ?? 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}
