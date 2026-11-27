/** Small pure helpers of the month close page. */

/** The month to open first: the one asked for, else the oldest month that is over and still open, else the newest. */
export function pickMonth(months: readonly { readonly periodMonth: string; readonly status: 'open' | 'closed'; readonly inProgress: boolean }[], wanted: string | null): string | null {
  if (wanted && months.some((month) => month.periodMonth === wanted)) return wanted;
  const waiting = months.filter((month) => month.status === 'open' && !month.inProgress);
  return waiting[waiting.length - 1]?.periodMonth ?? months[0]?.periodMonth ?? null;
}

/** The first day a month can be closed: the day after it ends. `2026-11-01` gives "December 1". */
export function closableFrom(periodMonth: string): string {
  const date = new Date(`${periodMonth.slice(0, 7)}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' }).format(date);
}

/** One step between job profit and company profit. `adds` is true when the step raises profit. */
export interface BridgeStep {
  readonly key: 'shared_gap' | 'missing_time' | 'overhead_gap';
  readonly label: string;
  /** The size of the step as stored: above zero takes away from profit. */
  readonly cents: number;
  readonly adds: boolean;
}

/**
 * The steps from job profit to company profit, in the words of SPEC 4.9. The overhead step is
 * left out when no company costs were typed in. Empty when money is hidden.
 */
export function bridgeSteps(bridge: { readonly sharedGapCents: number | null; readonly missingCostCents: number | null; readonly overheadGapCents: number | null; readonly hasCompanyCosts: boolean }): BridgeStep[] {
  if (bridge.sharedGapCents === null || bridge.missingCostCents === null) return [];
  const steps: BridgeStep[] = [
    { key: 'shared_gap', label: bridge.sharedGapCents < 0 ? 'Jobs carried more time not on a job than was logged' : 'Time not on a job that no job carried', cents: bridge.sharedGapCents, adds: bridge.sharedGapCents < 0 },
    { key: 'missing_time', label: 'Paid time not on any job', cents: bridge.missingCostCents, adds: bridge.missingCostCents < 0 },
  ];
  if (bridge.hasCompanyCosts && bridge.overheadGapCents !== null) {
    const over = bridge.overheadGapCents < 0;
    steps.push({ key: 'overhead_gap', label: over ? 'Your hourly rate covered more overhead than you spent' : 'Overhead your hourly rate did not cover', cents: bridge.overheadGapCents, adds: over });
  }
  return steps;
}

/** The one status a month shows, in the list and on its card. */
export interface MonthStatus {
  readonly key: 'closed' | 'in_progress' | 'to_fix' | 'ready';
  readonly label: string;
  readonly tone: 'neutral' | 'info' | 'danger' | 'success';
}

/**
 * One status at a time: a closed month is "Closed", a month that is not over is "In progress", an
 * open month with a "Fix this first" step says how many things to fix, and only a month with a
 * clear checklist is "Ready to close".
 */
export function monthStatus(month: { readonly status: 'open' | 'closed'; readonly inProgress: boolean }, toFix: number | null): MonthStatus {
  if (month.status === 'closed') return { key: 'closed', label: 'Closed', tone: 'neutral' };
  if (month.inProgress) return { key: 'in_progress', label: 'In progress', tone: 'info' };
  if (toFix !== null && toFix > 0) return { key: 'to_fix', label: `${toFix} ${toFix === 1 ? 'thing' : 'things'} to fix`, tone: 'danger' };
  return { key: 'ready', label: 'Ready to close', tone: 'success' };
}
