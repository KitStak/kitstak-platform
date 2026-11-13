/**
 * React Query keys. Invalidate by prefix: `queryClient.invalidateQueries({ queryKey: qk.project(key) })`
 * refreshes the project detail AND everything under it (tasks, activity, files, views…).
 */
export const qk = {
  me: () => ['me'] as const,
  people: () => ['people'] as const,
  spaces: () => ['spaces'] as const,
  projects: (params?: Record<string, unknown>) => (params ? (['projects', params] as const) : (['projects'] as const)),
  project: (key: string) => ['project', key] as const,
  projectTasks: (key: string) => ['project', key, 'tasks'] as const,
  projectActivity: (key: string) => ['project', key, 'activity'] as const,
  projectFiles: (key: string) => ['project', key, 'files'] as const,
  projectViews: (key: string) => ['project', key, 'views'] as const,
  projectDependencies: (key: string) => ['project', key, 'dependencies'] as const,
  projectLinks: (key: string) => ['project', key, 'links'] as const,
  /** Task-level CRM/WMS links of every task in the project (views-a). */
  projectTaskLinks: (key: string) => ['project', key, 'task-links'] as const,
  projectAutomations: (key: string) => ['project', key, 'automations'] as const,
  projectForms: (key: string) => ['project', key, 'forms'] as const,
  projectGoals: (key: string) => ['project', key, 'goals'] as const,
  projectTrash: (key: string) => ['project', key, 'trash'] as const,
  task: (id: string) => ['task', id] as const,
  taskComments: (id: string) => ['task', id, 'comments'] as const,
  taskActivity: (id: string) => ['task', id, 'activity'] as const,
  taskTime: (id: string) => ['task', id, 'time'] as const,
  taskAttachments: (id: string) => ['task', id, 'attachments'] as const,
  myTasks: (scope = 'assigned', completed?: boolean) => ['my-tasks', scope, completed ?? 'default'] as const,
  notifications: (filter = 'all') => ['notifications', filter] as const,
  // Not ['notifications', 'unread']: that key is the unread-filter inbox list.
  unread: () => ['notifications', 'unread-count'] as const,
  search: (q: string) => ['search', q] as const,
  goals: () => ['goals'] as const,
  automations: (projectId?: string | null) => ['automations', projectId ?? 'all'] as const,
  automationRuns: (id: string) => ['automations', 'runs', id] as const,
  /** Run history across rules (Automations → Run history); `id` 'all' or a rule id. */
  automationRunHistory: (id = 'all', status = 'all') => ['automations', 'history', id, status] as const,
  templates: () => ['templates'] as const,
  dashboards: (projectId?: string | null) => ['dashboards', projectId ?? 'all'] as const,
  forms: (projectId?: string) => ['forms', projectId ?? 'all'] as const,
  formSubmissions: (id: string) => ['forms', 'submissions', id] as const,
  labels: (projectId?: string | null) => ['labels', projectId ?? 'workspace'] as const,
  customFields: (projectId?: string | null) => ['custom-fields', projectId ?? 'workspace'] as const,
  recents: () => ['recents'] as const,
  runningTimer: () => ['time', 'running'] as const,
  integrationStatus: () => ['integrations', 'status'] as const,
  integrationSearch: (type: string, q: string) => ['integrations', 'search', type, q] as const,
  links: (type: string, id: string) => ['links', type, id] as const,
  /** Portfolio team: status update history (under the project prefix), goal check-ins, reports. */
  projectUpdates: (key: string) => ['project', key, 'updates'] as const,
  goalCheckIns: (goalId: string) => ['goals', 'check-ins', goalId] as const,
  /** Planning team: cycles and triage (under the project prefix so qk.project(key) refreshes them). */
  cycles: (key: string) => ['project', key, 'cycles'] as const,
  cycle: (id: string) => ['cycles', id] as const,
  triage: (key: string, filter: string) => ['project', key, 'triage', filter] as const,
  report: (scope: { project?: string; space?: string | null; weeks?: number }) => ['reports', scope.project ?? 'portfolio', scope.space ?? 'all', scope.weeks ?? 8] as const,
} as const;
