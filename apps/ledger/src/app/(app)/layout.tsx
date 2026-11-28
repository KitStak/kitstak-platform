import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { AppShell, LockedFrame, NoAccessScreen, PreviewLockedScreen } from '@/features/shell';
import { routeMissing } from '@/features/routes/route-missing';
import { loadShell } from '@/features/shell/shell-frame';
import { requirePageContext } from '@/server/session';

/**
 * Signed in frame: session and active org, then two gates before any page renders.
 *  1. The preview gate (SPEC 3.1): the org must be let in (else the locked screen, no navigation).
 *  2. The Ledger role (SPEC 3.2): the person must have one (else "Ask an admin for access").
 * The shell also makes the org's defaults on the first read (chart, terms, numbering, settings).
 */
export default async function AppLayout({ children }: { readonly children: React.ReactNode }) {
  const path = (await headers()).get('x-ks-path') ?? '/';
  const context = await requirePageContext(path);
  const shell = await loadShell(context);
  if (!shell.shellContext || !shell.access) {
    return (
      <LockedFrame orgName={context.org.name} urls={shell.urls} modules={shell.modules}>
        <PreviewLockedScreen orgName={context.org.name} portalUrl={shell.urls.portal} />
      </LockedFrame>
    );
  }
  // No Ledger role: a friendly screen, never a money page. (An admin always has a role, so the claim step is on Home and Welcome.)
  if (shell.access.role === 'none') {
    return (
      <AppShell context={shell.shellContext}>
        <NoAccessScreen orgName={context.org.name} portalUrl={shell.urls.portal} />
      </AppShell>
    );
  }
  // Unknown records, reports, sections and months answer a real 404. The (app) loading boundary
  // starts streaming (status 200) before the page runs, so check here, before any Suspense.
  if (await routeMissing(shell.ctx, path)) notFound();
  return <AppShell context={shell.shellContext}>{children}</AppShell>;
}
