/**
 * React Query keys. Nested keys share a prefix, so
 * `queryClient.invalidateQueries({ queryKey: qk.job(ref) })` refreshes the job and everything
 * under it. Keep a list key and a count key on different prefixes (they collide otherwise).
 *
 * After a write, invalidate by prefix:
 *   - a production, material, cost, revenue or service entry: `qk.streams()`, `qk.jobsRoot()`, `qk.profitRoot()`, `qk.summaryRoot()`
 *   - a rate, a setting or a plan: the same, plus `qk.laborRates()` or `qk.settings()`
 */
type Params = Readonly<Record<string, unknown>> | undefined;

export const qk = {
  me: () => ['me'] as const,
  people: () => ['people'] as const,
  badges: () => ['badges'] as const,
  settings: () => ['settings'] as const,
  sites: () => ['sites'] as const,
  roles: () => ['roles'] as const,
  runState: () => ['roles', 'run-state'] as const,

  clients: (params?: Params) => ['clients', 'list', params ?? {}] as const,
  client: (id: string) => ['clients', 'one', id] as const,
  clientByRef: (params: Params) => ['clients', 'by-ref', params ?? {}] as const,
  jobTypes: (params?: Params) => ['job-types', params ?? {}] as const,
  laborClasses: (params?: Params) => ['labor-classes', params ?? {}] as const,
  laborRates: (params?: Params) => ['labor-rates', params ?? {}] as const,
  rateForEntry: (params: Params) => ['labor-rates', 'for-entry', params ?? {}] as const,
  items: (params?: Params) => ['items', params ?? {}] as const,
  services: (params?: Params) => ['services', 'list', params ?? {}] as const,
  service: (id: string) => ['services', 'one', id] as const,
  standards: (params?: Params) => ['standards', 'list', params ?? {}] as const,
  standardSuggestion: (params: Params) => ['standards', 'suggest', params ?? {}] as const,
  targets: (params?: Params) => ['targets', params ?? {}] as const,

  jobsRoot: () => ['jobs'] as const,
  jobs: (params?: Params) => ['jobs', 'list', params ?? {}] as const,
  jobsAttention: (limit?: number) => ['jobs', 'attention', limit ?? 10] as const,
  jobCounts: (params?: Params) => ['jobs', 'counts', params ?? {}] as const,
  jobsByLink: (type: string, id: string) => ['jobs', 'by-link', type, id] as const,
  deletedJobs: () => ['jobs', 'deleted'] as const,
  job: (ref: string) => ['jobs', 'one', ref] as const,
  jobPlans: (ref: string) => ['jobs', 'one', ref, 'plans'] as const,
  jobPrices: (ref: string) => ['jobs', 'one', ref, 'prices'] as const,
  jobDays: (ref: string, by?: string) => ['jobs', 'one', ref, 'days', by ?? 'day'] as const,

  streams: () => ['streams'] as const,
  logGrid: (date?: string | null, siteId?: string | null) => ['streams', 'log', date ?? 'today', siteId ?? 'default'] as const,
  previousCrew: (date: string, siteId?: string | null) => ['streams', 'previous-crew', date, siteId ?? 'default'] as const,
  production: (params?: Params) => ['streams', 'production', params ?? {}] as const,
  indirect: (params?: Params) => ['streams', 'indirect', params ?? {}] as const,
  paidHours: (params?: Params) => ['streams', 'paid-hours', params ?? {}] as const,
  materials: (params?: Params) => ['streams', 'materials', params ?? {}] as const,
  costs: (params?: Params) => ['streams', 'costs', params ?? {}] as const,
  revenue: (params?: Params) => ['streams', 'revenue', params ?? {}] as const,
  serviceEntries: (params?: Params) => ['streams', 'service-entries', params ?? {}] as const,
  dayReviews: (params?: Params) => ['streams', 'day-reviews', params ?? {}] as const,

  summaryRoot: () => ['summary'] as const,
  summary: (params?: Params) => ['summary', params ?? {}] as const,
  profitRoot: () => ['profit'] as const,
  profit: (by: string, params?: Params) => ['profit', 'rows', by, params ?? {}] as const,
  profitTrend: (params?: Params) => ['profit', 'trend', params ?? {}] as const,
  profitFacts: (params?: Params) => ['profit', 'facts', params ?? {}] as const,
  companyBridge: (params?: Params) => ['profit', 'bridge', params ?? {}] as const,
  laborSummary: (params?: Params) => ['profit', 'labor', params ?? {}] as const,

  periods: () => ['periods'] as const,
  closeChecklist: (month: string) => ['periods', 'checklist', month] as const,

  alertsRoot: () => ['alerts'] as const,
  alerts: (params?: Params) => ['alerts', 'list', params ?? {}] as const,
  alertsUnread: () => ['alerts', 'unread'] as const,
  alertRules: () => ['alert-rules'] as const,
  notifications: (params?: Params) => ['notifications', params ?? {}] as const,

  views: (page?: string | null) => ['views', page ?? 'all'] as const,
  prefs: () => ['prefs'] as const,
  activity: (params?: Params) => ['activity', params ?? {}] as const,
  search: (q: string) => ['search', q] as const,

  // Profit team: explain, pivot, drill down rows, reports and schedules.
  explain: (metric: string, params?: Params) => ['profit', 'explain', metric, params ?? {}] as const,
  profitPivot: (rows: string, cols: string, params?: Params) => ['profit', 'pivot', rows, cols, params ?? {}] as const,
  profitEntries: (params?: Params) => ['profit', 'entries', params ?? {}] as const,
  reportsRoot: () => ['reports'] as const,
  report: (slug: string, params?: Params) => ['reports', 'one', slug, params ?? {}] as const,
  reportSchedules: () => ['reports', 'schedules'] as const,
  reportRuns: () => ['reports', 'runs'] as const,
} as const;
