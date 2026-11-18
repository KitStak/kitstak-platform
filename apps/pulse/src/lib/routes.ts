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

export const PROFIT_VIEWS = ['job', 'client', 'type', 'service', 'site', 'month', 'week', 'day'] as const;
export type ProfitView = (typeof PROFIT_VIEWS)[number];

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
  jobs: (opts?: { tab?: 'open' | 'all' | 'completed' | 'planned'; risk?: string; view?: string }) => withQuery('/jobs', { tab: opts?.tab, risk: opts?.risk, view: opts?.view }),
  newJob: (prefill: NewJobPrefill = {}) => withQuery('/jobs/new', { ...prefill }),
  job: (ref: string) => `/jobs/${encodeURIComponent(ref)}`,
  jobTab: (ref: string, tab: JobTab) => (tab === 'overview' ? `/jobs/${encodeURIComponent(ref)}` : `/jobs/${encodeURIComponent(ref)}/${tab}`),
  log: (opts?: { date?: string; job?: string; site?: string }) => withQuery('/log', { date: opts?.date, job: opts?.job, site: opts?.site }),
  logReview: () => '/log/review',
  logEntries: () => '/log/entries',
  /** Many days at once (the bulk grid). */
  logBulk: () => '/log/bulk',
  profit: (opts?: { by?: ProfitView; client?: string; from?: string; to?: string }) =>
    withQuery('/profit', { by: opts?.by, client: opts?.client, from: opts?.from, to: opts?.to }),
  client: (id: string) => `/clients/${encodeURIComponent(id)}`,
  services: () => '/services',
  service: (id: string) => `/services/${encodeURIComponent(id)}`,
  labor: (tab?: LaborTab) => withQuery('/labor', { tab }),
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
