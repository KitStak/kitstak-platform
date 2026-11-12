/**
 * Wave-rule schedule math (pure; shared by the wizard, the grid countdown and the
 * scheduler). Times are "HH:mm" in the warehouse time zone; days are Mon..Sun.
 */
import { WEEKDAYS } from '@/lib/enums';

export type Weekday = (typeof WEEKDAYS)[number];

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY_MS = 86_400_000;

export function isTime(value: string): boolean {
  return TIME_RE.test(value);
}

export function toMinutes(time: string): number {
  const m = TIME_RE.exec(time);
  if (!m) throw new Error(`Invalid time "${time}"`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function fromMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** "Repeat every n minutes" bounds (validated inline in the wizard, never clamped silently). */
export const MIN_REPEAT_MINUTES = 5;
export const MAX_REPEAT_MINUTES = 720;
/** Above this many runs a day the wizard warns (every run allocates stock and creates jobs). */
export const HIGH_FREQUENCY_RUNS = 48;

/**
 * Critic R4: schedule-related instants are shown in the warehouse time zone, labelled, in the
 * app's grid date shape: "11/10/2026 2:00 PM EST".
 */
export function formatInZone(iso: string | Date, timeZone: string): string {
  const at = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(at.getTime())) return '—';
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).formatToParts(at);
  } catch {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).formatToParts(at);
  }
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('month')}/${get('day')}/${get('year')} ${get('hour')}:${get('minute')} ${get('dayPeriod')} ${get('timeZoneName')}`.trim();
}

/** "Repeat every n minutes From/To" → the generated start times (inclusive). */
export function timesForPeriod(everyMinutes: number, from: string, to: string): string[] {
  if (!Number.isInteger(everyMinutes) || everyMinutes < 1) return [];
  const start = toMinutes(from);
  const end = toMinutes(to);
  if (end < start) return [];
  const out: string[] = [];
  for (let m = start; m <= end; m += everyMinutes) out.push(fromMinutes(m));
  return out;
}

/** Sorted unique times. */
export function normalizeTimes(times: readonly string[]): string[] {
  return [...new Set(times.filter(isTime))].sort((a, b) => toMinutes(a) - toMinutes(b));
}

interface LocalParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly weekday: Weekday;
  readonly minutes: number;
}

const WEEKDAY_SHORT: Readonly<Record<string, Weekday>> = {
  Mon: 'Mon',
  Tue: 'Tue',
  Wed: 'Wed',
  Thu: 'Thu',
  Fri: 'Fri',
  Sat: 'Sat',
  Sun: 'Sun',
};

export function localParts(at: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '0';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    weekday: WEEKDAY_SHORT[get('weekday')] ?? 'Mon',
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

/** UTC instant of a wall-clock time in `timeZone` (handles DST by re-probing the offset). */
export function zonedToUtc(
  year: number,
  month: number,
  day: number,
  minutes: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60);
  let utc = guess;
  for (let i = 0; i < 2; i += 1) {
    const p = localParts(new Date(utc), timeZone);
    const shown = Date.UTC(p.year, p.month - 1, p.day, Math.floor(p.minutes / 60), p.minutes % 60);
    utc += guess - shown;
  }
  return new Date(utc);
}

/** Next run strictly after `now`, or null when the rule is unscheduled. */
export function nextRunAt(
  days: readonly string[],
  times: readonly string[],
  timeZone: string,
  now: Date,
): Date | null {
  const ts = normalizeTimes(times);
  if (days.length === 0 || ts.length === 0) return null;
  for (let offset = 0; offset <= 7; offset += 1) {
    const probe = localParts(new Date(now.getTime() + offset * DAY_MS), timeZone);
    if (!days.includes(probe.weekday)) continue;
    for (const time of ts) {
      const at = zonedToUtc(probe.year, probe.month, probe.day, toMinutes(time), timeZone);
      if (at.getTime() > now.getTime()) return at;
    }
  }
  return null;
}

/** Logiwa countdown: HH:MM:SS under a day, DDDD:HH:MM:SS beyond. */
export function formatWaveCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const hms = [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
  // Critic R3: readable "1d 10:46:40" instead of Logiwa's zero-padded "0001:10:46:40".
  return days > 0 ? `${days}d ${hms}` : hms;
}
