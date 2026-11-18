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

/* ------------------------------------------------------------------ date range presets (profit team) */

/** The date range presets of the global filter bar (SPEC section 6). `custom` carries its own days. */
export const RANGE_PRESETS = ['this_week', 'last_week', 'this_month', 'last_month', 'last_30', 'last_90', 'this_quarter', 'this_year', 'custom'] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export const RANGE_PRESET_LABELS: Readonly<Record<RangePreset, string>> = {
  this_week: 'This week',
  last_week: 'Last week',
  this_month: 'This month',
  last_month: 'Last month',
  last_30: 'Last 30 days',
  last_90: 'Last 90 days',
  this_quarter: 'This quarter',
  this_year: 'This year',
  custom: 'Custom',
};

/** What a period is compared with. */
export const COMPARE_MODES = ['none', 'prior', 'last_year'] as const;
export type CompareMode = (typeof COMPARE_MODES)[number];

export const COMPARE_MODE_LABELS: Readonly<Record<CompareMode, string>> = {
  none: 'No comparison',
  prior: 'The period before',
  last_year: 'Same period last year',
};

/** Short words for a delta badge: "vs the period before". */
export const COMPARE_MODE_SHORT: Readonly<Record<CompareMode, string>> = {
  none: '',
  prior: 'vs before',
  last_year: 'vs last year',
};

const DAY_MS = 86_400_000;
const dayToMs = (date: string): number => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
const msToDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const shiftDay = (date: string, days: number): string => msToDay(dayToMs(date) + days * DAY_MS);

/**
 * Turns a preset into real days. "This" periods end today, so a half done month is never compared
 * as if it were whole. Weeks start on `weekStart` (0 is Sunday).
 */
export function resolveRange(preset: RangePreset, today: string, weekStart = 1, custom?: { from?: string | null; to?: string | null }): { from: string; to: string } {
  const weekday = new Date(dayToMs(today)).getUTCDay();
  const startOfWeek = shiftDay(today, -((weekday - weekStart + 7) % 7));
  const startOfMonth = `${today.slice(0, 7)}-01`;
  switch (preset) {
    case 'this_week':
      return { from: startOfWeek, to: today };
    case 'last_week':
      return { from: shiftDay(startOfWeek, -7), to: shiftDay(startOfWeek, -1) };
    case 'this_month':
      return { from: startOfMonth, to: today };
    case 'last_month': {
      const end = shiftDay(startOfMonth, -1);
      return { from: `${end.slice(0, 7)}-01`, to: end };
    }
    case 'last_30':
      return { from: shiftDay(today, -29), to: today };
    case 'last_90':
      return { from: shiftDay(today, -89), to: today };
    case 'this_quarter': {
      const month = Math.floor((Number(today.slice(5, 7)) - 1) / 3) * 3 + 1;
      return { from: `${today.slice(0, 4)}-${String(month).padStart(2, '0')}-01`, to: today };
    }
    case 'this_year':
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case 'custom': {
      const from = custom?.from && /^\d{4}-\d{2}-\d{2}$/.test(custom.from) ? custom.from : startOfMonth;
      const to = custom?.to && /^\d{4}-\d{2}-\d{2}$/.test(custom.to) ? custom.to : today;
      return from <= to ? { from, to } : { from: to, to: from };
    }
  }
}

/** The range a period is compared with, or null for "no comparison". */
export function compareRange(mode: CompareMode, range: { from: string; to: string }): { from: string; to: string } | null {
  if (mode === 'none') return null;
  if (mode === 'prior') {
    const length = Math.round((dayToMs(range.to) - dayToMs(range.from)) / DAY_MS) + 1;
    return { from: shiftDay(range.from, -length), to: shiftDay(range.from, -1) };
  }
  const back = (date: string): string => {
    const year = Number(date.slice(0, 4)) - 1;
    const rest = date.slice(4);
    // Feb 29 has no twin in a plain year: use Feb 28.
    return rest === '-02-29' ? `${year}-02-28` : `${year}${rest}`;
  };
  return { from: back(range.from), to: back(range.to) };
}

/** "Nov 1 to Nov 17, 2026". */
export function rangeLabel(range: { from: string; to: string }): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const part = (date: string, withYear: boolean): string => `${months[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}${withYear ? `, ${date.slice(0, 4)}` : ''}`;
  if (range.from === range.to) return part(range.from, true);
  return `${part(range.from, range.from.slice(0, 4) !== range.to.slice(0, 4))} to ${part(range.to, true)}`;
}

/* ------------------------------------------------------------------ report schedules (profit team) */

export const SCHEDULE_CADENCES = ['daily', 'weekly', 'monthly'] as const;
export type ScheduleCadence = (typeof SCHEDULE_CADENCES)[number];

/** Ranges a scheduled build can cover. They are worked out on the day the build runs. */
export const SCHEDULE_RANGES = ['yesterday', 'last_week', 'this_month', 'last_month', 'last_90'] as const;
export type ScheduleRange = (typeof SCHEDULE_RANGES)[number];

export const SCHEDULE_RANGE_LABELS: Readonly<Record<ScheduleRange, string>> = {
  yesterday: 'Yesterday',
  last_week: 'Last week',
  this_month: 'This month so far',
  last_month: 'Last month',
  last_90: 'Last 90 days',
};

export const WEEKDAY_LABELS: readonly string[] = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function resolveScheduleRange(range: ScheduleRange, today: string, weekStart = 1): { from: string; to: string } {
  if (range === 'yesterday') return { from: shiftDay(today, -1), to: shiftDay(today, -1) };
  return resolveRange(range, today, weekStart);
}

function localParts(at: Date, timeZone: string): { weekday: number; day: number; hour: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', day: 'numeric', hour: 'numeric', hourCycle: 'h23' }).formatToParts(at);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  return { weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday')), day: Number(get('day')), hour: Number(get('hour')) % 24 };
}

/**
 * The next time a schedule should build, strictly after `after`, at `hour` o'clock in the site's
 * time zone. Monthly schedules on day 29 to 31 build on the last day of a shorter month.
 */
export function nextScheduleRun(schedule: { cadence: ScheduleCadence; weekday?: number | null; dayOfMonth?: number | null; hour: number }, timeZone: string, after: Date = new Date()): Date {
  let zone = timeZone;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
  } catch {
    zone = 'UTC';
  }
  const hourMs = 3_600_000;
  let at = new Date(Math.floor(after.getTime() / hourMs) * hourMs + hourMs);
  for (let step = 0; step < 24 * 63; step += 1, at = new Date(at.getTime() + hourMs)) {
    const now = localParts(at, zone);
    if (now.hour !== schedule.hour) continue;
    if (schedule.cadence === 'daily') return at;
    if (schedule.cadence === 'weekly') {
      if (now.weekday === (schedule.weekday ?? 1)) return at;
      continue;
    }
    const wanted = schedule.dayOfMonth ?? 1;
    if (now.day === wanted) return at;
    // The last day of a month shorter than the wanted day.
    const tomorrow = localParts(new Date(at.getTime() + 24 * hourMs), zone);
    if (tomorrow.day === 1 && now.day < wanted) return at;
  }
  return new Date(after.getTime() + 24 * hourMs);
}

/** "Every Monday at 7 AM". */
export function scheduleSentence(schedule: { cadence: ScheduleCadence; weekday?: number | null; dayOfMonth?: number | null; hour: number }): string {
  const hour = schedule.hour % 12 === 0 ? 12 : schedule.hour % 12;
  const time = `${hour} ${schedule.hour < 12 ? 'AM' : 'PM'}`;
  if (schedule.cadence === 'daily') return `Every day at ${time}`;
  if (schedule.cadence === 'weekly') return `Every ${WEEKDAY_LABELS[schedule.weekday ?? 1]} at ${time}`;
  const day = schedule.dayOfMonth ?? 1;
  const suffix = day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd' : day % 10 === 3 && day !== 13 ? 'rd' : 'th';
  return `On the ${day}${suffix} of each month at ${time}`;
}
