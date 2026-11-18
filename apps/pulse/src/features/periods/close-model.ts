/** Small pure helpers of the month close page. */

/** The month to open first: the one asked for, else the oldest month that is over and still open, else the newest. */
export function pickMonth(months: readonly { readonly periodMonth: string; readonly status: 'open' | 'closed'; readonly inProgress: boolean }[], wanted: string | null): string | null {
  if (wanted && months.some((month) => month.periodMonth === wanted)) return wanted;
  const waiting = months.filter((month) => month.status === 'open' && !month.inProgress);
  return waiting[waiting.length - 1]?.periodMonth ?? months[0]?.periodMonth ?? null;
}

const DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const DAY_TIME = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

/** "Oct 3, 2026" from a timestamp. */
export const dayText = (iso: string | null): string => (iso ? DAY.format(new Date(iso)) : '');
/** "Oct 3, 2026, 4:12 PM" from a timestamp. */
export const dayTimeText = (iso: string | null): string => (iso ? DAY_TIME.format(new Date(iso)) : '');

/** The first day a month can be closed: the day after it ends. `2026-11-01` gives "December 1". */
export function closableFrom(periodMonth: string): string {
  const date = new Date(`${periodMonth.slice(0, 7)}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' }).format(date);
}
