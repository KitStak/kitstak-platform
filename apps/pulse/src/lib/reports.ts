/**
 * The report library (docs/pulse/SPEC.md section 6, `/reports`). Pure catalog: slug, name, what
 * the report answers and whether it shows money. Every report has filters, a chart, a table, a
 * print view, a CSV export and "Build on a schedule".
 */

export type ReportGroup = 'profit' | 'plan' | 'floor' | 'close';

export interface ReportInfo {
  readonly slug: string;
  readonly name: string;
  /** The question this report answers, in plain words. */
  readonly description: string;
  readonly group: ReportGroup;
  /** Needs `money:read`. Reports without money are open to every Pulse role. */
  readonly needsMoney: boolean;
}

export const REPORT_GROUP_LABELS: Readonly<Record<ReportGroup, string>> = {
  profit: 'Profit',
  plan: 'Plan and risk',
  floor: 'Work on the floor',
  close: 'Billing and month end',
};

export const REPORTS: readonly ReportInfo[] = [
  { slug: 'job-profit', name: 'Job profit', description: 'Revenue, cost, profit and margin for every job.', group: 'profit', needsMoney: true },
  { slug: 'profit-by-client', name: 'Profit by client', description: 'Which clients make you money and which ones cost you.', group: 'profit', needsMoney: true },
  { slug: 'profit-by-job-type', name: 'Profit by job type', description: 'Which kinds of work pay best.', group: 'profit', needsMoney: true },
  { slug: 'profit-by-service', name: 'Profit by service', description: 'Revenue, cost and margin for each extra service.', group: 'profit', needsMoney: true },
  { slug: 'profit-by-site', name: 'Profit by site', description: 'Your sites side by side: margin, pace and time not on a job.', group: 'profit', needsMoney: true },
  { slug: 'monthly-profit-and-loss', name: 'Monthly profit and loss', description: 'Each month from job profit down to company profit.', group: 'profit', needsMoney: true },
  { slug: 'cost-to-serve', name: 'Cost to serve', description: 'What it really costs to serve each client, per unit and per job.', group: 'profit', needsMoney: true },
  { slug: 'plan-vs-actual', name: 'Plan vs actual', description: 'What you planned next to what happened, line by line.', group: 'plan', needsMoney: true },
  { slug: 'quote-vs-actual', name: 'Quote vs actual', description: 'How each job is doing against the price you quoted.', group: 'plan', needsMoney: true },
  { slug: 'open-jobs-at-risk', name: 'Open jobs at risk', description: 'Open jobs that are at risk or losing money, worst first, with the reason.', group: 'plan', needsMoney: true },
  { slug: 'why-profit-changed', name: 'Why profit changed', description: 'What moved profit away from the plan: price, pace, rates, materials or volume.', group: 'plan', needsMoney: true },
  { slug: 'pace-vs-target', name: 'Pace vs target', description: 'Units per person per hour against the target pace, by job and day.', group: 'floor', needsMoney: false },
  { slug: 'labor-summary', name: 'Labor summary', description: 'Hours and labor cost by labor class, job type and client.', group: 'floor', needsMoney: true },
  { slug: 'paid-time-not-on-any-job', name: 'Paid time not on any job', description: 'Hours you paid for that nobody logged to a job or a reason.', group: 'floor', needsMoney: false },
  { slug: 'material-and-scrap', name: 'Material and scrap', description: 'Parts used, parts scrapped and what the scrap cost.', group: 'floor', needsMoney: true },
  { slug: 'daily-production-log', name: 'Daily production log', description: 'Every production entry: units, people, hours and notes.', group: 'floor', needsMoney: false },
  { slug: 'ready-to-bill', name: 'Ready to bill', description: 'Work that is done and earned but not billed yet.', group: 'close', needsMoney: true },
  { slug: 'month-close-pack', name: 'Month close pack', description: 'Everything finance needs to close the month in one place.', group: 'close', needsMoney: true },
  { slug: 'audit-log', name: 'Audit log', description: 'Who changed what, and when, with the before and after.', group: 'close', needsMoney: false },
];

const BY_SLUG: ReadonlyMap<string, ReportInfo> = new Map(REPORTS.map((report) => [report.slug, report]));

export function reportInfo(slug: string): ReportInfo | null {
  return BY_SLUG.get(slug) ?? null;
}
