/** Every Crew path in one place (docs/crew/SPEC.md section 6.1). Pure module. */
const withQuery = (path: string, params: Record<string, string | undefined> = {}): string => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  const qs = query.toString();
  return qs ? `${path}?${qs}` : path;
};

export const routes = {
  home: () => '/',
  today: (site?: string) => withQuery('/today', { site }),
  people: () => '/people',
  newPerson: () => '/people/new',
  person: (id: string) => `/people/${encodeURIComponent(id)}`,
  agencies: () => '/people/agencies',
  agency: (vendorId: string) => `/people/agencies/${encodeURIComponent(vendorId)}`,
  schedule: (site?: string, week?: string) => withQuery('/schedule', { site, week }),
  scheduleTemplates: () => '/schedule/templates',
  scheduleRequests: () => '/schedule/requests',
  clock: () => '/clock',
  me: () => '/me',
  time: (site?: string, week?: string) => withQuery('/time', { site, week }),
  timePerson: (personId: string, week?: string) => withQuery(`/time/${encodeURIComponent(personId)}`, { week }),
  timeFixes: () => '/time/fixes',
  timeExport: () => '/time/export',
  attendance: () => '/attendance',
  timeOff: () => '/time-off',
  skills: () => '/skills',
  plan: (site?: string) => withQuery('/plan', { site }),
  planPaces: () => '/plan/paces',
  importCenter: () => '/import',
  importBatch: (batchId: string) => `/import/${encodeURIComponent(batchId)}`,
  exportCenter: () => '/export',
  settings: () => '/settings',
  settingsRules: () => '/settings/rules',
  settingsKiosks: () => '/settings/kiosks',
  settingsApps: () => '/settings/apps',
  welcome: () => '/welcome',
  search: (q?: string) => withQuery('/search', { q }),
  login: () => '/login',
} as const;

/** A `next` value that is safe to redirect to: a local path, never the sign in page itself. */
export function safeNextPath(next: string | null | undefined, fallback = '/'): string {
  if (!next) return fallback;
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  if (/^\/login(\/|\?|$)/.test(next)) return fallback;
  return next;
}
