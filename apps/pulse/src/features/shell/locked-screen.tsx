import { ShieldQuestion } from 'lucide-react';
import { PlanLockScreen, type PlanLockView } from '@kitstak/ui/plan-lock';
import { PulseMark } from './logo';

const primaryLink =
  'inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-base font-medium text-primary-fg hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

function Frame({ testId, children }: { readonly testId: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-border-subtle bg-panel p-8 text-center shadow-sm" data-testid={testId}>
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-sunken">
          <PulseMark size={34} />
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Shown inside the app frame when Pulse is not in the org's plan. A thin wrapper over the shared
 * `PlanLockScreen`: the title, the price and both links come from `planLockFor` in
 * `@kitstak/billing`, so every KitStak app shows the same screen (docs/billing/SPEC.md 9.3).
 */
export function LockedScreen({ lock }: { readonly lock: PlanLockView }) {
  return <PlanLockScreen app="pulse" lock={lock} />;
}

/** Shown when the org has Pulse but this person has no Pulse role yet. Seeing money is opt in. */
export function NoAccessScreen({ orgName, portalUrl }: { readonly orgName: string; readonly portalUrl: string }) {
  return (
    <Frame testId="no-access-screen">
      <h1 className="mt-5 text-xl font-semibold text-fg">Ask an admin for access</h1>
      <p className="mt-2 text-base text-fg-secondary">
        Pulse shows what {orgName} earns and spends, so nobody gets in by accident. An owner or admin can give you a role under Settings, People and roles.
      </p>
      <p className="mt-3 inline-flex items-center gap-2 text-sm text-fg-muted">
        <ShieldQuestion aria-hidden className="size-4" />
        You are signed in. You just do not have a Pulse role yet.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <a href={portalUrl} className={primaryLink}>
          Back to Portal
        </a>
      </div>
    </Frame>
  );
}
