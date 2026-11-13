import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { AppShell, LockedScreen } from '@/features/shell';
import { getProjectDetail, listProjects, listSpaces, resolveTaskKey, toDomainContext, unreadCount } from '@/server/domain';
import { isDomainError } from '@/server/errors';
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
  // Unknown project or task URLs must answer a real 404. The (app) loading boundary starts
  // streaming (status 200) before the /p/[key] layout runs, so check here, before any Suspense.
  const match = /^\/p\/([^/?#]+)(?:\/(\d+))?(?:[/?#]|$)/.exec(path);
  if (match) {
    const key = decodeURIComponent(match[1] ?? '').toUpperCase();
    /** `false` for "no such project or task" (or no access), rethrows anything else. */
    const found = (error: unknown) => {
      if (isDomainError(error) && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) return false;
      throw error;
    };
    let exists = projects.some((project) => project.key.toUpperCase() === key);
    if (!exists) exists = await getProjectDetail(ctx, { key }).then(() => true, found);
    if (!exists) notFound();
    const number = match[2] ? Number(match[2]) : null;
    if (number !== null && !(await resolveTaskKey(ctx, key, number).then(() => true, found))) notFound();
  }
  return (
    <AppShell context={shellContext} initialProjects={projects} initialSpaces={spaces} initialUnread={unread}>
      {children}
    </AppShell>
  );
}
