/** URL builders for the authenticated app. Every link in the shell goes through these. */
export const routes = {
  home: (orgSlug: string) => `/${orgSlug}`,
  myWork: (orgSlug: string) => `/${orgSlug}/my-work`,
  inbox: (orgSlug: string) => `/${orgSlug}/inbox`,
  notifications: (orgSlug: string) => `/${orgSlug}/inbox?tab=notifications`,
  workspace: (orgSlug: string, workspaceId: string) => `/${orgSlug}/workspaces/${workspaceId}`,
  board: (orgSlug: string, boardId: string) => `/${orgSlug}/boards/${boardId}`,
  /** Board with the item panel open (the board module reads `?item=`). */
  item: (orgSlug: string, boardId: string, itemId: string) => `/${orgSlug}/boards/${boardId}?item=${itemId}`,
  person: (orgSlug: string, userId: string) => `/${orgSlug}/admin/members?user=${userId}`,
  /**
   * The template center. It is a wizard, not a page: `?wizard=templates` on any app URL opens it
   * (WizardDeepLink in the shell), so the link lands on Home with the wizard open.
   */
  templates: (orgSlug: string, templateId?: string) =>
    `/${orgSlug}?wizard=templates${templateId ? `&template=${encodeURIComponent(templateId)}` : ''}`,
  dashboard: (orgSlug: string, dashboardId: string) => `/${orgSlug}/dashboards/${dashboardId}`,
  importData: (orgSlug: string) => `/${orgSlug}/import`,
  admin: (orgSlug: string) => `/${orgSlug}/admin`,
  members: (orgSlug: string) => `/${orgSlug}/admin/members`,
  profile: (orgSlug: string) => `/${orgSlug}/settings/profile`,
  trash: (orgSlug: string) => `/${orgSlug}/trash`,
} as const;

export type EntityRouteType = 'board' | 'dashboard' | 'workspace';

export function entityHref(orgSlug: string, type: EntityRouteType | string, id: string): string | null {
  if (type === 'board') return routes.board(orgSlug, id);
  if (type === 'dashboard') return routes.dashboard(orgSlug, id);
  if (type === 'workspace') return routes.workspace(orgSlug, id);
  return null;
}

/** Only allow same-origin relative redirects (prevents open redirects via ?next=). */
export function safeNextPath(next: string | null | undefined, fallback = '/'): string {
  if (!next) return fallback;
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  if (/^\/(login|signup|forgot-password|reset-password)(\/|\?|$)/.test(next)) return fallback;
  return next;
}
