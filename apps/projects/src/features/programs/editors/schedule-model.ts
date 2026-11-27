/**
 * Pure model for the schedule editor (docs/programs/SPEC.md 5.4 Step 4, 5.13): the rule from the
 * form, the "What to build each time" lines, the 2 week preview, the next runs sentence and the
 * generation count, all from the engine (`occurrences`, `generationWindow`, `qtyFor`), so the
 * preview matches what the server makes. Unit tested.
 */
import {
  addDays,
  describeRule,
  fromScaled,
  generationWindow,
  isWorkDay,
  occurrences,
  occursOn,
  quantityToScaled,
  qtyFor,
  shortDate,
  startOfWeek,
  unitLabel,
  weekday,
  type ProgramCalendar,
  type ScheduleRule,
} from '@kitstak/programs-engine';
import type { IsoDate, ProgramWizardPayload, UnitLabel } from '@/lib/program-types';

export type SchedulePatternValue = 'daily' | 'weekdays' | 'custom_days' | 'every_n_weeks';

export interface ScheduleLineValue {
  readonly variantKey: string;
  readonly include: boolean;
  /** Plain qty text. */
  readonly qty: string;
  /** Weekday number ("1" is Monday) to qty; blank days use `qty`. Null when Vary by day is off. */
  readonly qtyByWeekday: Readonly<Record<string, string>> | null;
  readonly assigneeId: string | null;
}

export interface ScheduleEditorValue {
  readonly enabled: boolean;
  readonly name: string;
  readonly pattern: SchedulePatternValue;
  readonly days: readonly number[];
  readonly intervalWeeks: number;
  readonly startsOn: IsoDate;
  readonly endsOn: IsoDate | null;
  readonly leadDays: number;
  readonly skipHolidays: boolean;
  readonly lines: readonly ScheduleLineValue[];
}

export const WEEK_ORDER: readonly number[] = [1, 2, 3, 4, 5, 6, 0];
export const WEEKDAY_SHORT: readonly string[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function toRule(value: Pick<ScheduleEditorValue, 'pattern' | 'days' | 'intervalWeeks' | 'startsOn' | 'endsOn' | 'skipHolidays'>): ScheduleRule {
  return { pattern: value.pattern, days: value.days, intervalWeeks: value.intervalWeeks, startsOn: value.startsOn, endsOn: value.endsOn, skipHolidays: value.skipHolidays, skipDates: [] };
}

/** The engine lines for included rows with a qty. */
export function activeLines(value: Pick<ScheduleEditorValue, 'lines'>): { variantId: string; qty: string; qtyByWeekday: Record<string, string> | null }[] {
  return value.lines
    .filter((line) => line.include && line.qty.trim() !== '')
    .map((line) => ({
      variantId: line.variantKey,
      qty: line.qty.replace(/,/g, ''),
      qtyByWeekday: line.qtyByWeekday ? Object.fromEntries(Object.entries(line.qtyByWeekday).filter(([, qty]) => qty.trim() !== '').map(([day, qty]) => [day, qty.replace(/,/g, '')])) : null,
    }));
}

function safeQty(text: string): bigint {
  try {
    return quantityToScaled(text);
  } catch {
    return BigInt(0);
  }
}

export interface GenerationCount {
  readonly from: IsoDate | null;
  readonly to: IsoDate | null;
  readonly dates: readonly IsoDate[];
  readonly builds: number;
  /** 3 decimal text. */
  readonly units: string;
}

/** What the server makes now: the dates in the generation window and the builds and units on them. */
export function generationCount(value: ScheduleEditorValue, calendar: ProgramCalendar, asOf: IsoDate): GenerationCount {
  const window = generationWindow({ asOf, leadDays: value.leadDays, generatedThrough: null, startsOn: value.startsOn, endsOn: value.endsOn });
  if (!window || !value.enabled) return { from: null, to: null, dates: [], builds: 0, units: '0.000' };
  const dates = occurrences(toRule(value), calendar, window.from, window.to);
  const lines = activeLines(value);
  let builds = 0;
  let units = BigInt(0);
  for (const date of dates) {
    for (const line of lines) {
      const qty = safeQty(qtyFor(line, date));
      if (qty <= BigInt(0)) continue;
      builds += 1;
      units += qty;
    }
  }
  return { from: window.from, to: window.to, dates, builds, units: fromScaled(units, 3) };
}

/** "40 builds and 4,000 kits in the next 7 days" (or "today only" when no lead days). */
export function generationText(count: GenerationCount, unit: UnitLabel, leadDays: number): string {
  const when = leadDays === 0 ? 'today' : `in the next ${leadDays} ${leadDays === 1 ? 'day' : 'days'}`;
  if (count.builds === 0) return `No builds ${when}`;
  return `${count.builds} ${count.builds === 1 ? 'build' : 'builds'} and ${unitLabel(count.units, unit)} ${when}`;
}

export interface PreviewDay {
  readonly date: IsoDate;
  readonly occurs: boolean;
  /** The pattern matches but the day is skipped (a day off). */
  readonly skipped: boolean;
  readonly workDay: boolean;
  readonly isToday: boolean;
}

/** Two weeks from the Monday of the week of `from`, Monday first. */
export function twoWeeks(value: ScheduleEditorValue, calendar: ProgramCalendar, from: IsoDate, today: IsoDate): PreviewDay[] {
  const start = startOfWeek(from, 1);
  const rule = toRule(value);
  const loose = { ...rule, skipHolidays: false };
  return Array.from({ length: 14 }, (_, index) => {
    const date = addDays(start, index);
    const occurs = value.enabled && occursOn(rule, calendar, date);
    const skipped = value.enabled && !occurs && value.skipHolidays && occursOn(loose, calendar, date);
    return { date, occurs, skipped, workDay: isWorkDay(calendar, date), isToday: date === today };
  });
}

/** "Wed Nov 25". */
export function dayText(date: IsoDate): string {
  return `${WEEKDAY_SHORT[weekday(date)]} ${shortDate(date)}`;
}

/**
 * "Next 5 runs: Wed Nov 25, Thu Nov 26 skipped (Thanksgiving), Fri Nov 27, Mon Nov 30, Tue Dec 1".
 * Skipped days (the pattern matches, the calendar has the day off) are named with the holiday and
 * take one of the places, as in the spec example.
 */
export function nextRunsText(value: ScheduleEditorValue, calendar: ProgramCalendar, from: IsoDate, holidays: readonly { readonly date: IsoDate; readonly name: string }[] = [], count = 5): string {
  if (!value.enabled) return 'No runs. The schedule is off.';
  const rule = toRule(value);
  const loose = { ...rule, skipHolidays: false };
  const names = new Map(holidays.map((holiday) => [holiday.date, holiday.name]));
  const parts: string[] = [];
  let runs = 0;
  let date = from < value.startsOn ? value.startsOn : from;
  for (let guard = 0; parts.length < count && guard < 400; guard += 1, date = addDays(date, 1)) {
    if (value.endsOn && date > value.endsOn) break;
    if (occursOn(rule, calendar, date)) {
      parts.push(dayText(date));
      runs += 1;
    } else if (value.skipHolidays && occursOn(loose, calendar, date)) {
      parts.push(`${dayText(date)} skipped (${names.get(date) ?? 'day off'})`);
    }
  }
  if (runs === 0) return 'No runs in the next year with these settings.';
  return `Next ${parts.length} ${parts.length === 1 ? 'run' : 'runs'}: ${parts.join(', ')}`;
}

/** "Every weekday · 8 kits" style rule text from the engine. */
export function scheduleRuleText(value: ScheduleEditorValue, calendar: ProgramCalendar): string {
  return describeRule(toRule(value), calendar);
}

/** What to fix, by field. */
export function scheduleProblems(value: ScheduleEditorValue): Partial<Record<'name' | 'days' | 'startsOn' | 'endsOn' | 'lines' | `line:${string}`, string>> {
  if (!value.enabled) return {};
  const out: Partial<Record<'name' | 'days' | 'startsOn' | 'endsOn' | 'lines' | `line:${string}`, string>> = {};
  if (!value.name.trim()) out.name = 'Name the schedule.';
  if ((value.pattern === 'custom_days' || value.pattern === 'every_n_weeks') && value.days.length === 0) out.days = 'Pick at least one day.';
  if (!value.startsOn) out.startsOn = 'Pick the first day.';
  if (value.endsOn && value.endsOn < value.startsOn) out.endsOn = 'The last day must be on or after the first day.';
  const included = value.lines.filter((line) => line.include);
  if (included.length === 0) out.lines = 'Include at least one variant.';
  for (const line of included) {
    const texts = [line.qty, ...Object.values(line.qtyByWeekday ?? {})].filter((text) => text.trim() !== '');
    if (!line.qty.trim()) out[`line:${line.variantKey}`] = 'Add a qty.';
    else if (texts.some((text) => !/^\d{1,8}(\.\d{1,3})?$/.test(text.replace(/,/g, '').trim()))) out[`line:${line.variantKey}`] = 'Use a number with up to 3 decimals.';
  }
  return out;
}

/** The wizard `schedule` payload. */
export function toSchedulePayload(value: ScheduleEditorValue): ProgramWizardPayload['schedule'] {
  return {
    enabled: value.enabled,
    name: value.name.trim(),
    pattern: value.pattern,
    days: [...value.days],
    intervalWeeks: value.intervalWeeks,
    startsOn: value.startsOn,
    endsOn: value.endsOn,
    leadDays: value.leadDays,
    lines: activeLines(value).map((line, index) => ({ variantKey: line.variantId, qty: line.qty, qtyByWeekday: line.qtyByWeekday && Object.keys(line.qtyByWeekday).length ? line.qtyByWeekday : null, assigneeId: value.lines.filter((entry) => entry.include && entry.qty.trim() !== '')[index]?.assigneeId ?? null })),
  };
}

/** Lines for a set of variants at their default qty (or `fallback`). */
export function linesFor(variants: readonly { readonly key: string; readonly defaultQty: string | null }[], fallback = '100'): ScheduleLineValue[] {
  return variants.map((variant) => ({ variantKey: variant.key, include: true, qty: variant.defaultQty ? variant.defaultQty.replace(/\.0+$/, '') : fallback, qtyByWeekday: null, assigneeId: null }));
}
