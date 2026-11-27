/**
 * Pure helpers for the Work calendar (docs/programs/SPEC.md 5.19, A15): "Copy last year's
 * holidays" moves each of last year's holidays to this year (floating holidays keep their
 * weekday, like the fourth Thursday of November), and the edit checks. Unit tested.
 */
import { addDays, daysInMonth, weekday } from '@kitstak/programs-engine';

export interface Holiday {
  readonly date: string;
  readonly name: string;
}

/** Holidays that move with the weekday: name words to the rule they follow. */
const FLOATING: readonly { readonly words: RegExp; readonly last?: boolean }[] = [
  { words: /thanksgiving/i },
  { words: /labou?r day/i },
  { words: /memorial day/i, last: true },
  { words: /martin luther king|mlk/i },
  { words: /president/i },
  { words: /columbus|indigenous/i },
  { words: /day after thanksgiving|black friday/i },
];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** The date of the nth (1 based) weekday of a month, or the last one. */
function nthWeekday(year: number, month: number, day: number, nth: number | 'last'): string {
  const first = `${year}-${pad(month)}-01`;
  const offset = (day - weekday(first) + 7) % 7;
  if (nth === 'last') {
    const days = daysInMonth(`${year}-${pad(month)}`);
    let date = addDays(first, offset);
    while (Number(addDays(date, 7).slice(8, 10)) <= days && addDays(date, 7).slice(5, 7) === pad(month)) date = addDays(date, 7);
    return date;
  }
  return addDays(first, offset + (nth - 1) * 7);
}

/** One holiday moved to `year`. */
export function moveHoliday(holiday: Holiday, year: number): Holiday {
  const [, m, d] = holiday.date.split('-').map(Number) as [number, number, number];
  const floating = FLOATING.find((rule) => rule.words.test(holiday.name));
  if (floating) {
    if (/day after thanksgiving|black friday/i.test(holiday.name)) return { name: holiday.name, date: addDays(nthWeekday(year, 11, 4, 4), 1) };
    const nth = floating.last ? 'last' : Math.ceil(d / 7);
    return { name: holiday.name, date: nthWeekday(year, m, weekday(holiday.date), nth) };
  }
  const days = daysInMonth(`${year}-${pad(m)}`);
  return { name: holiday.name, date: `${year}-${pad(m)}-${pad(Math.min(d, days))}` };
}

/** Last year's holidays moved to `year`, leaving out dates already in the list. */
export function copyLastYear(holidays: readonly Holiday[], year: number): Holiday[] {
  const have = new Set(holidays.map((holiday) => holiday.date));
  const added = holidays.filter((holiday) => holiday.date.startsWith(`${year - 1}-`)).map((holiday) => moveHoliday(holiday, year)).filter((holiday) => !have.has(holiday.date));
  return [...holidays, ...added].sort((a, b) => a.date.localeCompare(b.date));
}

export interface CalendarDraft {
  readonly timezone: string;
  readonly workingDays: readonly number[];
  readonly holidays: readonly Holiday[];
  readonly capacity: string;
}

export function calendarProblems(draft: CalendarDraft): Record<string, string> {
  const out: Record<string, string> = {};
  if (draft.workingDays.length === 0) out.workingDays = 'Pick at least one work day.';
  const seen = new Set<string>();
  draft.holidays.forEach((holiday, index) => {
    if (!holiday.name.trim()) out[`holiday:${index}`] = 'Name the holiday.';
    else if (seen.has(holiday.date)) out[`holiday:${index}`] = 'This day is already a holiday.';
    seen.add(holiday.date);
  });
  if (draft.capacity.trim() && !/^\d{1,6}(\.\d{1,2})?$/.test(draft.capacity.trim())) out.capacity = 'Use hours like 80 or 7.5.';
  return out;
}
