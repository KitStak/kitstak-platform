import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { AppShell, LockedScreen, NoAccessScreen } from '@/features/shell';
import { jobRouteMissing } from '@/features/jobs/server/job-exists';
import { importRouteMissing } from '@/features/imports/server/batch-exists';
import { profitRecordMissing } from '@/features/profit/server/record-exists';
import { loadShell } from '@/features/shell/shell-frame';
import { listOrgPeople } from '@/server/domain';
import { requirePageContext } from '@/server/session';
import { reportInfo } from '@/lib/reports';

/** Org people for the shell's people cache, stamped with when they were read (undefined on failure). */
async function loadPeople(ctx: Parameters<typeof listOrgPeople>[0]) {
  try {
    return { list: await listOrgPeople(ctx), loadedAt: Date.now() };
  } catch {
    return undefined;
  }
}

/**
 * Signed-in frame: session + active org, then two gates before any page renders.
 *  1. Entitlement: the org must have the `pulse` module (else the locked screen).
 *  2. Pulse role: the person must have one (else "Ask an admin for access"). Seeing money is opt in.
 */
export default async function AppLayout({ children }: { readonly children: React.ReactNode }) {
  const path = (await headers()).get('x-ks-path') ?? '/';
  const context = await requirePageContext(path);
  const shell = await loadShell(context);
  if (shell.plan.lock) {
    return (
      <AppShell context={shell.shellContext}>
        <LockedScreen lock={shell.plan.lock} />
      </AppShell>
    );
  }
  if (shell.access.role === 'none') {
    return (
      <AppShell context={shell.shellContext}>
        <NoAccessScreen orgName={context.org.name} portalUrl={shell.urls.portal} />
      </AppShell>
    );
  }
  // Unknown report URLs must answer a real 404. The (app) loading boundary starts streaming
  // (status 200) before the page runs, so check here, before any Suspense. The root not-found
  // page renders this same shell around the message. Record pages (jobs, clients) add their own
  // existence check here the same way.
  const report = /^\/reports\/([^/?#]+)/.exec(path);
  if (report && !reportInfo(decodeURIComponent(report[1] ?? ''))) notFound();
  if (await jobRouteMissing(shell.ctx, path)) notFound();
  if (await profitRecordMissing(shell.ctx, path)) notFound();
  if (await importRouteMissing(shell.ctx, path)) notFound();
  // Org people ride along with the first HTML so names (job owners, who logged a row) render on
  // the server instead of a placeholder that swaps in on the client.
  const people = await loadPeople(shell.ctx);
  return (
    <AppShell context={shell.shellContext} initialPeople={people?.list} peopleLoadedAt={people?.loadedAt}>
      {children}
    </AppShell>
  );
}
