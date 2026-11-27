/**
 * In-app URL builders. Use these instead of string literals so routes stay consistent.
 * Project pages are keyed by project key (`/p/OPS`), tasks by key + number (`/p/OPS/42`).
 */
import type { ProjectKind, ViewType } from './constants';
import type { BuildView, ProgramTab } from './program-types';

export type { BuildView, ProgramTab } from './program-types';

export const PROGRAM_TABS: readonly ProgramTab[] = ['overview', 'builds', 'variants', 'price-card', 'schedule', 'linked', 'activity', 'settings'];
export const BUILD_VIEWS: readonly BuildView[] = ['runs', 'board', 'list', 'table', 'calendar', 'timeline'];

export type NewProgramMode = 'scratch' | 'deal' | 'template' | 'copy' | 'quick';

export type ProjectTab =
  | 'overview'
  | ViewType
  | 'files'
  | 'activity'
  | 'settings';

export const PROJECT_TABS: readonly ProjectTab[] = [
  'overview',
  'board',
  'list',
  'table',
  'timeline',
  'calendar',
  'workload',
  'files',
  'activity',
  'settings',
];

export const routes = {
  home: () => '/',
  /** My work, optionally narrowed to one due-date group: `/my-work?when=overdue|today|upcoming|done`. */
  myWork: (when?: 'overdue' | 'today' | 'upcoming' | 'done') => (when ? `/my-work?when=${when}` : '/my-work'),
  inbox: () => '/inbox',
  /** Global search page: `/search?q=…&type=tasks|comments|projects|people|goals`. */
  search: (q?: string, type?: string) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (type && type !== 'all') params.set('type', type);
    const query = params.toString();
    return query ? `/search?${query}` : '/search';
  },
  projects: () => '/projects',
  newProject: (opts?: { template?: string; crmItemId?: string; customerId?: string; name?: string }) => {
    const params = new URLSearchParams();
    if (opts?.template) params.set('template', opts.template);
    if (opts?.crmItemId) params.set('crmItem', opts.crmItemId);
    if (opts?.customerId) params.set('customer', opts.customerId);
    if (opts?.name) params.set('name', opts.name);
    const query = params.toString();
    return query ? `/projects/new?${query}` : '/projects/new';
  },
  project: (key: string) => `/p/${encodeURIComponent(key)}`,
  projectTab: (key: string, tab: ProjectTab) =>
    tab === 'overview' ? `/p/${encodeURIComponent(key)}` : `/p/${encodeURIComponent(key)}/${tab}`,
  /** Planning pages next to the view tabs (planning team): `/p/OPS/cycles?cycle=<id>`, `/p/OPS/triage`. */
  projectCycles: (key: string, cycleId?: string) => `/p/${encodeURIComponent(key)}/cycles${cycleId ? `?cycle=${encodeURIComponent(cycleId)}` : ''}`,
  projectTriage: (key: string) => `/p/${encodeURIComponent(key)}/triage`,
  /** Full-page task. Views open the drawer with `?task=OPS-42` instead (see taskDrawerParam). */
  task: (projectKey: string, number: number) => `/p/${encodeURIComponent(projectKey)}/${number}`,
  /** Programs directory, Floor today and the program workspace (docs/programs/SPEC.md 4.8). */
  programs: () => '/programs',
  programsToday: (date?: string) => (date ? `/programs/today?date=${encodeURIComponent(date)}` : '/programs/today'),
  newProgram: (opts?: { mode?: NewProgramMode; crmItem?: string; template?: string; copy?: string; customer?: string; name?: string; draft?: string }) => {
    const params = new URLSearchParams();
    if (opts?.mode) params.set('mode', opts.mode);
    if (opts?.crmItem) params.set('crmItem', opts.crmItem);
    if (opts?.template) params.set('template', opts.template);
    if (opts?.copy) params.set('copy', opts.copy);
    if (opts?.customer) params.set('customer', opts.customer);
    if (opts?.name) params.set('name', opts.name);
    if (opts?.draft) params.set('draft', opts.draft);
    const query = params.toString();
    return query ? `/programs/new?${query}` : '/programs/new';
  },
  program: (key: string) => `/programs/${encodeURIComponent(key)}`,
  programTab: (key: string, tab: ProgramTab) => (tab === 'overview' ? `/programs/${encodeURIComponent(key)}` : `/programs/${encodeURIComponent(key)}/${tab}`),
  programBuilds: (key: string, view: BuildView = 'runs') => `/programs/${encodeURIComponent(key)}/builds/${view}`,
  /** Full page build: `/programs/GLOVE/212`. */
  build: (key: string, number: number) => `/programs/${encodeURIComponent(key)}/${number}`,
  /** A task or build page by the container kind. */
  taskAny: (kind: ProjectKind | null | undefined, key: string, number: number) =>
    kind === 'program' ? `/programs/${encodeURIComponent(key)}/${number}` : `/p/${encodeURIComponent(key)}/${number}`,
  calendarSettings: () => '/settings/calendar',
  goals: () => '/goals',
  goal: (id: string) => `/goals?goal=${encodeURIComponent(id)}`,
  dashboards: () => '/dashboards',
  /** Automations, optionally on a tab and filtered: `/automations?state=on`, `/automations?tab=history&result=failed`. */
  automations: (opts?: { tab?: 'rules' | 'recipes' | 'apps' | 'history'; state?: 'on' | 'off'; result?: 'success' | 'failed' }) => {
    const params = new URLSearchParams();
    if (opts?.tab && opts.tab !== 'rules') params.set('tab', opts.tab);
    if (opts?.state) params.set('state', opts.state);
    if (opts?.result) params.set('result', opts.result);
    const query = params.toString();
    return query ? `/automations?${query}` : '/automations';
  },
  templates: () => '/templates',
  publicForm: (token: string) => `/forms/${encodeURIComponent(token)}`,
  /** Intake forms list (studio); `form(id, tab?)` opens the builder for one form. */
  forms: (projectId?: string) => (projectId ? `/forms?project=${encodeURIComponent(projectId)}` : '/forms'),
  form: (id: string, tab?: 'questions' | 'settings' | 'share' | 'responses') =>
    `/forms?form=${encodeURIComponent(id)}${tab && tab !== 'questions' ? `&tab=${tab}` : ''}`,
  settings: (section?: string) => (section ? `/settings?section=${encodeURIComponent(section)}` : '/settings'),
  space: (id: string) => `/projects?space=${encodeURIComponent(id)}`,
  login: (next?: string) => (next ? `/login?next=${encodeURIComponent(next)}` : '/login'),
} as const;

/** Search param that opens the task drawer over any view: `?task=OPS-42`. */
export const TASK_DRAWER_PARAM = 'task';

/** Program overlay params (4.8): `?log=2026-11-25[&run=]`, `?plan=week|day`, `?version=<id>`, `?statement=2026-11`, `?close=2026-10`, `?import=output|plan`, `?report=<runId|week>`. */
export const PROGRAM_OVERLAY_PARAMS = ['log', 'run', 'plan', 'version', 'statement', 'close', 'import', 'report'] as const;

/** Only allow same-origin relative redirects (prevents open redirects via ?next=). */
export function safeNextPath(next: string | null | undefined, fallback = '/'): string {
  if (!next) return fallback;
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  if (/^\/login(\/|\?|$)/.test(next)) return fallback;
  return next;
}
