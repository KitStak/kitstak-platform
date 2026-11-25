/**
 * The A15 calendar merge (docs/programs/SPEC.md 2.2.3, 2.2.4, 3.2): a program uses the workspace
 * calendar (`pm.org_calendar`, a missing row means the defaults) and can add days off, add work
 * days, or set its own work days. Pure, so the Projects domain (`programCalendar`) and the shared
 * loader merge the same way.
 */
import type { DateRange, IsoDate, ProgramCalendar } from '@kitstak/programs-engine/types';

export const DEFAULT_PROGRAM_TIMEZONE = 'America/Chicago';
export const DEFAULT_WORKING_DAYS: readonly number[] = [1, 2, 3, 4, 5];

export interface OrgCalendarFacts {
  readonly timezone: string | null;
  readonly workingDays: readonly number[] | null;
  readonly holidays: readonly { readonly date: IsoDate; readonly name?: string }[] | null;
}

export interface ProgramCalendarFacts {
  readonly timezone: string | null;
  readonly workingDays: readonly number[] | null;
  readonly useOrgHolidays: boolean;
  readonly extraDaysOff: readonly IsoDate[];
  readonly extraWorkDays: readonly IsoDate[];
  readonly pausedRanges: readonly DateRange[];
  readonly activeFrom: IsoDate | null;
  readonly activeTo: IsoDate | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True for an IANA zone this runtime knows. */
export function isKnownTimezone(zone: unknown): zone is string {
  if (typeof zone !== 'string' || zone.trim() === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** A zone that is safe to hand to Postgres `AT TIME ZONE`, else the default. */
export function safeTimezone(zone: string | null | undefined): string {
  return isKnownTimezone(zone) ? zone : DEFAULT_PROGRAM_TIMEZONE;
}

function cleanDays(days: readonly number[] | null | undefined): number[] | null {
  if (!days || days.length === 0) return null;
  const set = new Set<number>();
  for (const day of days) {
    const value = Number(day);
    if (Number.isInteger(value) && value >= 0 && value <= 6) set.add(value);
  }
  return set.size > 0 ? [...set].sort((a, b) => a - b) : null;
}

function cleanDates(dates: readonly unknown[] | null | undefined): IsoDate[] {
  const set = new Set<IsoDate>();
  for (const date of dates ?? []) {
    const value = typeof date === 'string' ? date.slice(0, 10) : '';
    if (DATE_RE.test(value)) set.add(value);
  }
  return [...set].sort();
}

/** Paused ranges from the jsonb column, invalid entries dropped. */
export function parsePausedRanges(value: unknown): DateRange[] {
  const list = typeof value === 'string' ? safeJson(value) : value;
  if (!Array.isArray(list)) return [];
  const ranges: DateRange[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const from = (item as { from?: unknown }).from;
    const to = (item as { to?: unknown }).to;
    if (typeof from !== 'string' || !DATE_RE.test(from)) continue;
    if (to !== null && to !== undefined && (typeof to !== 'string' || !DATE_RE.test(to))) continue;
    ranges.push({ from, to: typeof to === 'string' ? to : null });
  }
  return ranges.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}

/** Holiday dates from the jsonb column, invalid entries dropped. */
export function parseHolidays(value: unknown): { date: IsoDate; name: string }[] {
  const list = typeof value === 'string' ? safeJson(value) : value;
  if (!Array.isArray(list)) return [];
  const out: { date: IsoDate; name: string }[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const date = (item as { date?: unknown }).date;
    const name = (item as { name?: unknown }).name;
    if (typeof date === 'string' && DATE_RE.test(date)) out.push({ date, name: typeof name === 'string' ? name : '' });
  }
  return out;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * The engine calendar for a program. Work days: the program's own list, else the workspace's,
 * else Monday to Friday. Days off: workspace holidays when the program uses them, plus the
 * program's extra days off. Extra work days beat both.
 */
export function mergeProgramCalendar(org: OrgCalendarFacts | null, program: ProgramCalendarFacts): ProgramCalendar {
  const workingDays = cleanDays(program.workingDays) ?? cleanDays(org?.workingDays) ?? [...DEFAULT_WORKING_DAYS];
  const holidays = program.useOrgHolidays ? (org?.holidays ?? []).map((holiday) => holiday.date) : [];
  return {
    timezone: safeTimezone(program.timezone ?? org?.timezone ?? null),
    workingDays,
    daysOff: cleanDates([...holidays, ...program.extraDaysOff]),
    extraWorkDays: cleanDates(program.extraWorkDays),
    activeFrom: program.activeFrom && DATE_RE.test(program.activeFrom) ? program.activeFrom : null,
    activeTo: program.activeTo && DATE_RE.test(program.activeTo) ? program.activeTo : null,
    paused: [...program.pausedRanges],
  };
}
