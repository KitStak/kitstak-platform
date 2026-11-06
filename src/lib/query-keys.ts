/**
 * TanStack Query key factory. Every org-scoped key starts with `['org', orgId]` so switching
 * organizations (or signing out) can drop a whole tree with one `removeQueries`.
 *
 * Board-scoped keys share the `['org', orgId, 'board', boardId]` prefix: invalidating that
 * prefix refreshes the board payload, item pages, activity, automations and files at once.
 */
export const queryKeys = {
  me: () => ['me'] as const,
  org: (orgId: string) => ['org', orgId] as const,

  workspaces: (orgId: string) => ['org', orgId, 'workspaces'] as const,
  workspaceTree: (orgId: string, workspaceId: string) =>
    ['org', orgId, 'workspaces', workspaceId, 'tree'] as const,

  boards: (orgId: string, filters: Record<string, unknown> = {}) =>
    ['org', orgId, 'boards', filters] as const,
  boardTemplates: (orgId: string) => ['org', orgId, 'board-templates'] as const,

  board: (orgId: string, boardId: string) => ['org', orgId, 'board', boardId] as const,
  /** First-paint payload (board + columns + groups + views + first item page). */
  boardPayload: (orgId: string, boardId: string) => ['org', orgId, 'board', boardId, 'payload'] as const,
  boardItems: (orgId: string, boardId: string, params: Record<string, unknown> = {}) =>
    ['org', orgId, 'board', boardId, 'items', params] as const,
  boardActivity: (orgId: string, boardId: string) => ['org', orgId, 'board', boardId, 'activity'] as const,
  boardFiles: (orgId: string, boardId: string) => ['org', orgId, 'board', boardId, 'files'] as const,
  boardAutomations: (orgId: string, boardId: string) =>
    ['org', orgId, 'board', boardId, 'automations'] as const,

  item: (orgId: string, itemId: string) => ['org', orgId, 'item', itemId] as const,
  itemDetail: (orgId: string, itemId: string) => ['org', orgId, 'item', itemId, 'detail'] as const,
  itemUpdates: (orgId: string, itemId: string) => ['org', orgId, 'item', itemId, 'updates'] as const,
  itemActivity: (orgId: string, itemId: string) => ['org', orgId, 'item', itemId, 'activity'] as const,
  itemFiles: (orgId: string, itemId: string) => ['org', orgId, 'item', itemId, 'files'] as const,
  subitems: (orgId: string, itemId: string) => ['org', orgId, 'item', itemId, 'subitems'] as const,

  automationRuns: (orgId: string, automationId: string) =>
    ['org', orgId, 'automation', automationId, 'runs'] as const,

  dashboards: (orgId: string, workspaceId?: string) =>
    ['org', orgId, 'dashboards', workspaceId ?? 'all'] as const,
  dashboard: (orgId: string, dashboardId: string) => ['org', orgId, 'dashboard', dashboardId] as const,
  widgetData: (orgId: string, widgetId: string) => ['org', orgId, 'widget', widgetId, 'data'] as const,

  notifications: (orgId: string, filter = 'all') => ['org', orgId, 'notifications', filter] as const,
  notificationsRoot: (orgId: string) => ['org', orgId, 'notifications'] as const,
  unreadCount: (orgId: string) => ['org', orgId, 'notifications-unread'] as const,

  favorites: (orgId: string) => ['org', orgId, 'favorites'] as const,
  recents: (orgId: string) => ['org', orgId, 'recents'] as const,
  search: (orgId: string, q: string, options: Record<string, unknown> = {}) =>
    ['org', orgId, 'search', q, options] as const,

  members: (orgId: string) => ['org', orgId, 'members'] as const,
  invitations: (orgId: string) => ['org', orgId, 'invitations'] as const,
  teams: (orgId: string) => ['org', orgId, 'teams'] as const,
  auditLog: (orgId: string, filters: Record<string, unknown> = {}) =>
    ['org', orgId, 'audit-log', filters] as const,
} as const;

export type QueryKeys = typeof queryKeys;
