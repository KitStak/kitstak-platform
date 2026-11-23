/** Small date helpers shared by the server code and the test gateway. PURE. */
import type { BillingInterval } from './catalog';

/** Adds whole calendar months (UTC), keeping the day of the month where that month has it. */
export function addMonths(date: Date, months: number): Date {
  const out = new Date(date.getTime());
  const day = out.getUTCDate();
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, lastDay));
  return out;
}

/** The end of a billing period that starts at `date`. */
export function addInterval(date: Date, interval: BillingInterval): Date {
  return addMonths(date, interval === 'yearly' ? 12 : 1);
}
