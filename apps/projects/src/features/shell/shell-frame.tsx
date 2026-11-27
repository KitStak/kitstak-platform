import 'server-only';
import { AppShell } from '@/features/shell';
import { listProjects, listSpaces, toDomainContext, unreadCount } from '@/server/domain';
import { orgModuleFlags } from '@/server/entitlements';
import { appUrls } from '@/server/env';
import { integrationAvailability } from '@/server/integrations';
import { getPlanView, projectsBillingLink } from '@/server/plan';
import type { ProjectsContext } from '@/server/session';

/**
 * Everything the signed-in app shell needs (sidebar projects, spaces, unread count, sibling app
 * flags). Shared by the (app) layout and the root not-found page, so a 404 keeps the shell.
 */
export async function loadShell(context: ProjectsContext) {
  const ctx = toDomainContext(context);
  const [plan, modules, integrations] = await Promise.all([
    getPlanView({ orgId: context.org.id, userId: context.user.id, role: context.org.roleString }),
    orgModuleFlags(context.org.id),
    integrationAvailability(ctx),
  ]);
  // Not in the plan: the lock screen. View only (trial over, payment late, paused, plan ended)
  // still opens the app, with the banner on top; the server refuses every change.
  const entitled = plan.access !== 'locked';
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
    // Plan state per app (Trial, Active, Payment due, View only, Not in your plan, Included).
    // A row that is not in the plan opens the plan picker with that app turned on.
    planBadges: plan.badges,
    addHrefs: {
      crm: projectsBillingLink({ to: 'add', product: 'crm' }),
      wms: projectsBillingLink({ to: 'add', product: 'wms' }),
      projects: projectsBillingLink({ to: 'add', product: 'projects' }),
      pulse: projectsBillingLink({ to: 'add', product: 'pulse' }),
    },
    plan: { access: plan.access === 'read_only' ? ('read_only' as const) : ('full' as const), notice: plan.notice },
  };
  if (!entitled) return { ctx, entitled, plan, urls, shellContext, projects: [], spaces: [], unread: 0 };
  const [projects, spaces, unread] = await Promise.all([listProjects(ctx), listSpaces(ctx), unreadCount(ctx)]);
  return { ctx, entitled, plan, urls, shellContext, projects, spaces, unread };
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
