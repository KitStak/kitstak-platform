import { Link2Off } from 'lucide-react';
import { CrewMark } from '@/features/shell/logo';
import { arrivesIn, type BuildPhase } from '@/lib/pages';

/**
 * A public device or agency link that cannot open (docs/crew/SPEC.md 3.4 and 6.1): no login, no
 * workspace name, nothing about who made it. The agency form (phase 1) shows it for a link that is
 * revoked, expired, full or from a workspace outside the preview; the kiosk (phase 3) still lands here.
 */
export function InactiveLink({ what, phase }: { readonly what: string; readonly phase?: BuildPhase }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-app p-6">
      <div className="w-full max-w-md rounded-2xl border border-border-subtle bg-panel p-8 text-center shadow-sm" data-testid="inactive-link">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-sunken">
          <CrewMark size={34} />
        </div>
        <h1 className="mt-5 flex items-center justify-center gap-2 text-2xl font-semibold text-fg">
          <Link2Off aria-hidden className="size-6 text-icon" />
          This link is not active.
        </h1>
        <p className="mt-2 text-base text-fg-secondary">Ask the person who sent you this {what} for a new one.</p>
        {phase ? <p className="mt-4 text-xs text-fg-muted">{arrivesIn(phase)}</p> : null}
      </div>
    </main>
  );
}
