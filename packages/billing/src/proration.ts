/**
 * When a plan change is priced (review round 1, docs/billing/CONTRACTS.md section 24). PURE.
 *
 * The server picks the moment a change is prorated from, never the browser. It is always a whole
 * number of days before the end of the paid period, so:
 *
 *  - the amount matches the sentence under it ("for the 30 days left in this period"),
 *  - the amount does not move while a person reads the confirm panel (only at a day boundary),
 *  - a charge counts the day that has started (days left rounded up) and a credit counts only full
 *    days left (rounded down). So adding seats and taking them off again always costs at least one
 *    day, and a change can never hand back more than was paid for it.
 *
 * Gateways prorate by the second from the date they are given. Because the date is a whole number of
 * days from the period end, their by the second math lands on whole days.
 */

export type ProrationDirection = 'charge' | 'credit';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A change that raises the price per period is a charge. One that lowers it is a credit. A change of
 * billing period (monthly to yearly or back) starts a new period today and hands back the unused
 * part of the old one, so the prorated part of it is a credit.
 */
export function prorationDirection(input: {
  readonly oldRecurringCents: number;
  readonly newRecurringCents: number;
  readonly intervalChanged: boolean;
}): ProrationDirection {
  if (input.intervalChanged) return 'credit';
  return input.newRecurringCents >= input.oldRecurringCents ? 'charge' : 'credit';
}

/** Whole days left in the period: rounded up for a charge, down for a credit. Never below 0. */
export function prorationDaysLeft(input: {
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly now: Date;
  readonly direction: ProrationDirection;
}): number {
  const start = input.periodStart.getTime();
  const end = input.periodEnd.getTime();
  if (!(end > start)) return 0;
  const left = Math.min(end - start, Math.max(0, end - input.now.getTime()));
  return input.direction === 'charge' ? Math.ceil(left / DAY_MS) : Math.floor(left / DAY_MS);
}

/**
 * The date a change is prorated from: the period end minus the whole days left, kept inside the
 * period. For a charge this is now or up to a day before now. For a credit it is now or up to a day
 * after now.
 */
export function prorationDateFor(input: {
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly now: Date;
  readonly direction: ProrationDirection;
}): Date {
  const start = input.periodStart.getTime();
  const end = input.periodEnd.getTime();
  if (!(end > start)) return new Date(Math.floor(input.now.getTime() / 1000) * 1000);
  const at = end - prorationDaysLeft(input) * DAY_MS;
  return new Date(Math.min(end, Math.max(start, at)));
}
