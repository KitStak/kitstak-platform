import { headers } from 'next/headers';
import { AppShell, LockedScreen } from '@/features/shell';
import { listProjects, listSpaces, toDomainContext, unreadCount } from '@/server/domain';
import { orgHasProjectsModule, orgModuleFlags } from '@/server/entitlements';
import { appUrls } from '@/server/env';
import { integrationAvailability } from '@/server/integrations';
import { requirePageContext } from '@/server/session';
import { canOrg } from '@/lib/permissions';

/** Signed-in frame: session + active org + entitlement gate, then the app shell. */
export default async function AppLayout({ children }: { readonly children: React.ReactNode }) {
  const path = (await headers()).get('x-ks-path') ?? '/';
  const context = await requirePageContext(path);
  const ctx = toDomainContext(context);
  const [entitled, modules, integrations] = await Promise.all([
    orgHasProjectsModule(context.org.id),
    orgModuleFlags(context.org.id),
    integrationAvailability(ctx),
  ]);
  const urls = appUrls();
  const shellContext = {
    user: context.user,
    org: context.org,
    orgRole: context.orgRole,
    orgs: context.orgs,
    appUrls: urls,
    modules: { ...modules, projects: entitled },
    integrations,
  };
  if (!entitled) {
    return (
      <AppShell context={shellContext} initialProjects={[]} initialSpaces={[]} initialUnread={0}>
        <LockedScreen orgName={context.org.name} portalUrl={urls.portal} canManage={canOrg(context.orgRole, 'workspace:manage')} />
      </AppShell>
    );
  }
  const [projects, spaces, unread] = await Promise.all([listProjects(ctx), listSpaces(ctx), unreadCount(ctx)]);
  return (
    <AppShell context={shellContext} initialProjects={projects} initialSpaces={spaces} initialUnread={unread}>
      {children}
    </AppShell>
  );
}
