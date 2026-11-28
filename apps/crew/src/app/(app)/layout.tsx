import { headers } from 'next/headers';
import { AppShell, NoAccessScreen, PreviewLockedFrame } from '@/features/shell';
import { loadShell } from '@/features/shell/shell-frame';
import { requirePageContext } from '@/server/session';

/** Pages a person with role none may still open: their own work, the phone clock and the claim step. */
const OPEN_TO_EVERY_MEMBER = /^\/(me|clock|welcome)(\/|\?|$)/;

/**
 * Signed in frame: session and active org, then two gates before any page renders.
 *  1. Preview: the org must be let in (docs/crew/SPEC.md 3.4), else the locked screen.
 *  2. Crew role: the person must have one, else "Ask an admin for access". A linked person with
 *     role none still gets My work and the phone clock, and anyone may open the claim step.
 */
export default async function AppLayout({ children }: { readonly children: React.ReactNode }) {
  const path = (await headers()).get('x-ks-path') ?? '/';
  const context = await requirePageContext(path);
  const shell = await loadShell(context);
  if (!shell.entitled) return <PreviewLockedFrame orgName={context.org.name} portalUrl={shell.urls.portal} />;
  if (shell.access.role === 'none' && !OPEN_TO_EVERY_MEMBER.test(path)) {
    return (
      <AppShell context={shell.shellContext}>
        <NoAccessScreen orgName={context.org.name} portalUrl={shell.urls.portal} />
      </AppShell>
    );
  }
  return <AppShell context={shell.shellContext}>{children}</AppShell>;
}
