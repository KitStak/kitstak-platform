import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { AppShell, LockedScreen } from '@/features/shell';
import { loadShell } from '@/features/shell/shell-frame';
import { getProjectDetail, listOrgPeople, resolveTaskKey } from '@/server/domain';
import { isDomainError } from '@/server/errors';
import { requirePageContext } from '@/server/session';
import { canOrg } from '@/lib/permissions';

/** Org people for the shell's people cache, stamped with when they were read (undefined on failure). */
async function loadPeople(ctx: Parameters<typeof listOrgPeople>[0]) {
  try {
    return { list: await listOrgPeople(ctx), loadedAt: Date.now() };
  } catch {
    return undefined;
  }
}

/** Signed-in frame: session + active org + entitlement gate, then the app shell. */
export default async function AppLayout({ children }: { readonly children: React.ReactNode }) {
  const path = (await headers()).get('x-ks-path') ?? '/';
  const context = await requirePageContext(path);
  const shell = await loadShell(context);
  if (!shell.entitled) {
    return (
      <AppShell context={shell.shellContext} initialProjects={[]} initialSpaces={[]} initialUnread={0}>
        <LockedScreen orgName={context.org.name} portalUrl={shell.urls.portal} canManage={canOrg(context.orgRole, 'workspace:manage')} />
      </AppShell>
    );
  }
  const { ctx, projects } = shell;
  // Org people ride along with the first HTML so names (goal owners, workload rows, assignees)
  // render on the server instead of a placeholder that swaps in on the client.
  const peoplePromise = loadPeople(ctx);
  // Unknown project or task URLs must answer a real 404. The (app) loading boundary starts
  // streaming (status 200) before the /p/[key] layout runs, so check here, before any Suspense.
  // The root not-found page renders this same shell around the message.
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
  const people = await peoplePromise;
  return (
    <AppShell context={shell.shellContext} initialProjects={projects} initialSpaces={shell.spaces} initialUnread={shell.unread} initialPeople={people?.list} peopleLoadedAt={people?.loadedAt}>
      {children}
    </AppShell>
  );
}
