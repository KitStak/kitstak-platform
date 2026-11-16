import 'server-only';
import { AppShell } from '@/features/shell';
import { listProjects, listSpaces, toDomainContext, unreadCount } from '@/server/domain';
import { orgHasProjectsModule, orgModuleFlags } from '@/server/entitlements';
import { appUrls } from '@/server/env';
import { integrationAvailability } from '@/server/integrations';
import type { ProjectsContext } from '@/server/session';

/**
 * Everything the signed-in app shell needs (sidebar projects, spaces, unread count, sibling app
 * flags). Shared by the (app) layout and the root not-found page, so a 404 keeps the shell.
 */
export async function loadShell(context: ProjectsContext) {
  const ctx = toDomainContext(context);
  const [entitled, modules, integrations] = await Promise.all([orgHasProjectsModule(context.org.id), orgModuleFlags(context.org.id), integrationAvailability(ctx)]);
  const urls = appUrls();
  const shellContext = {
    user: context.user,
    org: context.org,
    orgRole: context.orgRole,
    orgs: context.orgs,
    appUrls: urls,
    modules: { ...modules, projects: entitled },
    integrations,
    // One separate warehouse per organization: any org may hold WMS; the entitlement flags
    // drive the switcher, so nothing is "not in plan" any more.
    notInPlan: [] as const,
  };
  if (!entitled) return { ctx, entitled, urls, shellContext, projects: [], spaces: [], unread: 0 };
  const [projects, spaces, unread] = await Promise.all([listProjects(ctx), listSpaces(ctx), unreadCount(ctx)]);
  return { ctx, entitled, urls, shellContext, projects, spaces, unread };
}

/** The signed-in shell around arbitrary content. */
export async function ShellFrame({ context, children }: { readonly context: ProjectsContext; readonly children: React.ReactNode }) {
  const shell = await loadShell(context);
  return (
    <AppShell context={shell.shellContext} initialProjects={shell.projects} initialSpaces={shell.spaces} initialUnread={shell.unread}>
      {children}
    </AppShell>
  );
}
