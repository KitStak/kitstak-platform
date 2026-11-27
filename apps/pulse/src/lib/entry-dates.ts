/**
 * The one date rule for every typed entry (round five): work, extra services, time not on a job,
 * material use, other costs, revenue, paid hours and punches. A typed date may not be after today
 * at the site, and may not be more than 10 years before it.
 *
 * Why 10 years: the spec sets no first day, and a workspace may import or sync years of history
 * from before it started using Pulse (the first sync pulls all history, SPEC 8), so the
 * workspace's first month is not a safe line. Ten years keeps every real history and still stops
 * a slip of the year such as 1990 or 2062.
 *
 * Rows copied from another app (warehouse, CRM, Projects, the time clock rollup) and rows Pulse
 * makes itself keep their own dates: the rule is for dates a person typed or put in a file.
 * Pure: no server imports, safe for tests and the client.
 */

/** How many years back a typed entry may be dated. */
export const ENTRY_YEARS_BACK = 10;

export type EntryDateKind = 'work' | 'vas' | 'indirect' | 'material' | 'cost' | 'revenue' | 'paid_hours' | 'punch';

/** The subject of the sentence for each kind of entry, in the on screen words. */
const SUBJECT: Readonly<Record<EntryDateKind, string>> = {
  work: 'Work',
  vas: 'An extra service',
  indirect: 'Time not on a job',
  material: 'Material use',
  cost: 'A cost',
  revenue: 'Revenue',
  paid_hours: 'Paid hours',
  punch: 'A punch',
};

/** Sources whose dates come from another app or from Pulse itself. Their rows keep their dates. */
const SYNCED_SOURCES: ReadonlySet<string> = new Set(['wms', 'crm', 'projects', 'punch', 'system']);

/** True when a person typed the date (on a form, the API or a file). */
export const isTypedSource = (source: string | null | undefined): boolean => !SYNCED_SOURCES.has(source ?? 'manual');

/** The first day a typed entry may have: the same day of the year, 10 years before today. */
export function earliestEntryDate(today: string): string {
  const year = Number(today.slice(0, 4)) - ENTRY_YEARS_BACK;
  const rest = today.slice(4) === '-02-29' ? '-02-28' : today.slice(4);
  return `${String(year).padStart(4, '0')}${rest}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const spoken = (date: string): string => `${MONTHS[Number(date.slice(5, 7)) - 1] ?? ''} ${Number(date.slice(8, 10))}, ${date.slice(0, 4)}`;

export interface EntryDateProblem {
  /** The sentence for the whole form. */
  readonly message: string;
  /** The short note for the date box. */
  readonly field: string;
  readonly reason: 'future' | 'too_old';
}

/** What is wrong with a typed date, or null when it is fine. `today` is today at the site. */
export function entryDateProblem(kind: EntryDateKind, date: string, today: string): EntryDateProblem | null {
  if (date > today) return { message: `${SUBJECT[kind]} cannot be dated after today. Pick today or an earlier day.`, field: 'This day is after today.', reason: 'future' };
  const earliest = earliestEntryDate(today);
  if (date < earliest) {
    return { message: `${SUBJECT[kind]} cannot be dated more than ${ENTRY_YEARS_BACK} years ago, before ${spoken(earliest)}. Check the year.`, field: `This day is more than ${ENTRY_YEARS_BACK} years ago.`, reason: 'too_old' };
  }
  return null;
}
