/**
 * In-app URL builders. Use these instead of string literals so routes stay consistent.
 * Project pages are keyed by project key (`/p/OPS`), tasks by key + number (`/p/OPS/42`).
 */
import type { ViewType } from './constants';

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
  myWork: () => '/my-work',
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
  /** Full-page task. Views open the drawer with `?task=OPS-42` instead (see taskDrawerParam). */
  task: (projectKey: string, number: number) => `/p/${encodeURIComponent(projectKey)}/${number}`,
  goals: () => '/goals',
  goal: (id: string) => `/goals?goal=${encodeURIComponent(id)}`,
  dashboards: () => '/dashboards',
  automations: () => '/automations',
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

/** Only allow same-origin relative redirects (prevents open redirects via ?next=). */
export function safeNextPath(next: string | null | undefined, fallback = '/'): string {
  if (!next) return fallback;
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  if (/^\/login(\/|\?|$)/.test(next)) return fallback;
  return next;
}
