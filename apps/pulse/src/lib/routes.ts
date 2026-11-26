/**
 * In-app URL builders. Use these instead of string literals so routes stay consistent.
 * Jobs are keyed by job number or id (`/jobs/J-1042`). Route list: docs/pulse/SPEC.md section 6.
 */

export const JOB_TABS = ['overview', 'plan', 'work', 'materials', 'money-in', 'activity'] as const;
export type JobTab = (typeof JOB_TABS)[number];

export const JOB_TAB_LABELS: Readonly<Record<JobTab, string>> = {
  overview: 'Overview',
  plan: 'Plan vs actual',
  work: 'Work log',
  materials: 'Materials',
  'money-in': 'Money in',
  activity: 'Activity',
};

/**
 * Browser tab title for a job page: the job number first, so several open jobs can be told apart
 * ("J-1026", "J-1026 · Work log"). A link by id, which says nothing to a person, keeps the tab's name.
 */
export function jobPageTitle(ref: string, tab: JobTab): string {
  const isNumber = /^[A-Za-z]{1,6}-?\d{1,12}$/.test(ref);
  if (!isNumber) return tab === 'overview' ? 'Job' : JOB_TAB_LABELS[tab];
  return tab === 'overview' ? ref.toUpperCase() : `${ref.toUpperCase()} · ${JOB_TAB_LABELS[tab]}`;
}

export const PROFIT_VIEWS = ['job', 'client', 'type', 'service', 'site', 'program', 'month', 'week', 'day'] as const;
export type ProfitView = (typeof PROFIT_VIEWS)[number];

/** Tabs of a program page (docs/programs/PULSE_PROGRAMS_SPEC.md 7.3), carried as `?tab=`. */
export const PROGRAM_TABS = ['overview', 'variants', 'months', 'days', 'labor'] as const;
export type ProgramTab = (typeof PROGRAM_TABS)[number];

export const PROGRAM_TAB_LABELS: Readonly<Record<ProgramTab, string>> = {
  overview: 'Overview',
  variants: 'By variant',
  months: 'By month',
  days: 'Days',
  labor: 'Labor',
};

export const LABOR_TABS = ['rates', 'time', 'cost'] as const;
export type LaborTab = (typeof LABOR_TABS)[number];

function withQuery(path: string, params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

export interface NewJobPrefill {
  readonly crmDeal?: string;
  readonly wmsWorkOrder?: string;
  readonly project?: string;
  readonly scenario?: string;
  readonly client?: string;
  readonly coreCustomerId?: string;
  readonly crmAccountItemId?: string;
  readonly name?: string;
  readonly value?: string | number;
}

export const routes = {
  home: () => '/',
  welcome: () => '/welcome',
  jobs: (opts?: { tab?: 'open' | 'all' | 'completed' | 'planned'; risk?: string; view?: string; q?: string }) => withQuery('/jobs', { tab: opts?.tab, risk: opts?.risk, view: opts?.view, q: opts?.q }),
  /** Jobs that were deleted, with Restore. Managers and up. */
  deletedJobs: () => '/jobs/deleted',
  newJob: (prefill: NewJobPrefill = {}) => withQuery('/jobs/new', { ...prefill }),
  job: (ref: string) => `/jobs/${encodeURIComponent(ref)}`,
  jobTab: (ref: string, tab: JobTab) => (tab === 'overview' ? `/jobs/${encodeURIComponent(ref)}` : `/jobs/${encodeURIComponent(ref)}/${tab}`),
  log: (opts?: { date?: string; job?: string; site?: string }) => withQuery('/log', { date: opts?.date, job: opts?.job, site: opts?.site }),
  /** The days to review. With a month (`2026-01`) it lists that month's days, not the last 21. */
  logReview: (opts?: { month?: string }) => withQuery('/log/review', { month: opts?.month ? opts.month.slice(0, 7) : undefined }),
  /** Every production entry. `from`/`to` pick the days, `needsHours` keeps rows with units and no hours. */
  logEntries: (opts?: { from?: string; to?: string; needsHours?: boolean }) =>
    withQuery('/log/entries', { from: opts?.from, to: opts?.to, needsHours: opts?.needsHours ? '1' : undefined }),
  /** Many days at once (the bulk grid). */
  logBulk: () => '/log/bulk',
  profit: (opts?: { by?: ProfitView; client?: string; jobType?: string; from?: string; to?: string }) =>
    withQuery('/profit', { by: opts?.by, client: opts?.client, jobType: opts?.jobType, from: opts?.from, to: opts?.to }),
  /** The Programs list. `month` is `YYYY-MM` (this month when left out). */
  programs: (opts?: { month?: string; q?: string }) => withQuery('/programs', { month: opts?.month ? opts.month.slice(0, 7) : undefined, q: opts?.q }),
  /** One program page by key (`/programs/GLOVE`). `tab` is left out for the Overview; `month` is `YYYY-MM`. */
  program: (key: string, opts?: { month?: string; tab?: ProgramTab }) =>
    withQuery(`/programs/${encodeURIComponent(key)}`, { month: opts?.month ? opts.month.slice(0, 7) : undefined, tab: opts?.tab && opts.tab !== 'overview' ? opts.tab : undefined }),
  /** The raw job page of a program job, without the redirect to its program (`?view=job`). */
  programJob: (ref: string) => withQuery(`/jobs/${encodeURIComponent(ref)}`, { view: 'job' }),
  client: (id: string) => `/clients/${encodeURIComponent(id)}`,
  services: () => '/services',
  /**
   * The extra service entries with no price, with "Set the price" on each row. With a month
   * (`2026-10`) it lists that month, the month close count. Without one it lists every month that
   * is still open, the Home count.
   */
  servicesNoPrice: (month?: string) => withQuery('/services', { show: 'no-price', month: month ? month.slice(0, 7) : undefined }),
  service: (id: string) => `/services/${encodeURIComponent(id)}`,
  /** A labor tab. With `range` the Time and Cost tabs open on exactly those days. */
  labor: (tab?: LaborTab, range?: { from: string; to: string }) =>
    withQuery('/labor', { tab, range: range ? 'custom' : undefined, from: range?.from, to: range?.to }),
  targetPace: () => '/target-pace',
  calculator: (opts?: { job?: string; scenario?: string }) => withQuery('/calculator', { job: opts?.job, scenario: opts?.scenario }),
  goals: () => '/goals',
  alerts: () => '/alerts',
  alertRules: () => '/alerts/rules',
  reports: () => '/reports',
  report: (slug: string) => `/reports/${encodeURIComponent(slug)}`,
  importCenter: () => '/import',
  newImport: (stream?: string) => withQuery('/import/new', { stream }),
  importBatch: (batchId: string) => `/import/${encodeURIComponent(batchId)}`,
  exportCenter: () => '/export',
  wall: () => '/wall',
  /** `section` jumps to one block of the settings page (`general`, `sites`, `job-types`, `people`, `cost-rules`, `devices`, `sample-data`, `math`). */
  settings: (section?: string) => withQuery('/settings', { section }),
  settingsClose: () => '/settings/close',
  settingsApps: () => '/settings/apps',
  settingsAudit: () => '/settings/audit',
  /** Global search page: `/search?q=...`. */
  search: (q?: string) => withQuery('/search', { q }),
  login: (next?: string) => (next ? `/login?next=${encodeURIComponent(next)}` : '/login'),
} as const;

/** Only allow same-origin relative redirects (prevents open redirects via ?next=). */
export function safeNextPath(next: string | null | undefined, fallback = '/'): string {
  if (!next) return fallback;
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  if (/^\/login(\/|\?|$)/.test(next)) return fallback;
  return next;
}
