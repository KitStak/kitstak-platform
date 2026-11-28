import Link from 'next/link';
import { ShieldQuestion, Sparkles } from 'lucide-react';
import { CrewMark, Logo } from './logo';

const primaryLink =
  'inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-base font-medium text-primary-fg hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

function Card({ testId, children }: { readonly testId: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-border-subtle bg-panel p-8 text-center shadow-sm" data-testid={testId}>
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-sunken">
          <CrewMark size={34} />
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * The locked screen of docs/crew/SPEC.md 3.4: the workspace is not in the preview. No billing link,
 * because nothing can be bought yet. No navigation either: nothing can be opened in a locked app.
 */
export function PreviewLockedFrame({ orgName, portalUrl }: { readonly orgName: string; readonly portalUrl: string }) {
  return (
    <div className="flex min-h-dvh flex-col bg-app">
      <header className="flex h-[var(--topbar-height)] items-center justify-between border-b border-border-subtle bg-panel px-4">
        <Link href="/" aria-label="KitStak Crew home">
          <Logo size={24} />
        </Link>
        <span className="truncate text-sm text-fg-secondary">{orgName}</span>
      </header>
      <main className="flex-1">
        <Card testId="preview-locked-screen">
          <h1 className="mt-5 text-xl font-semibold text-fg">Crew is in preview. Ask KitStak to add your workspace.</h1>
          <p className="mt-2 text-base text-fg-secondary">
            Crew is the people app for your floor: people, shifts, the time clock and labor planning. A few workspaces are trying it first.
          </p>
          <p className="mt-3 inline-flex items-center gap-2 text-sm text-fg-muted">
            <Sparkles aria-hidden className="size-4" />
            Write to support@kitstak.com and name {orgName}.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <a href={portalUrl} className={primaryLink}>
              Back to Portal
            </a>
          </div>
        </Card>
      </main>
    </div>
  );
}

/** Shown when the org is in the preview but this person has no Crew role and is not linked to a person. */
export function NoAccessScreen({ orgName, portalUrl }: { readonly orgName: string; readonly portalUrl: string }) {
  return (
    <Card testId="no-access-screen">
      <h1 className="mt-5 text-xl font-semibold text-fg">Ask an admin for access</h1>
      <p className="mt-2 text-base text-fg-secondary">
        Crew holds pay and private details for the people of {orgName}, so nobody gets in by accident. An owner or admin can give you a Crew role under Settings, People and roles.
      </p>
      <p className="mt-3 inline-flex items-center gap-2 text-sm text-fg-muted">
        <ShieldQuestion aria-hidden className="size-4" />
        You are signed in. You just do not have a Crew role yet.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <a href={portalUrl} className={primaryLink}>
          Back to Portal
        </a>
      </div>
    </Card>
  );
}
