import { Lock, ShieldQuestion } from 'lucide-react';
import { PulseMark } from './logo';

const primaryLink =
  'inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-base font-medium text-primary-fg hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';
const secondaryLink =
  'inline-flex h-10 items-center rounded-md border border-border-input bg-panel px-4 text-base font-medium text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

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

/** Shown inside the app frame when the org is not entitled to KitStak Pulse. */
export function LockedScreen({ orgName, portalUrl, canManage }: { readonly orgName: string; readonly portalUrl: string; readonly canManage: boolean }) {
  return (
    <Frame testId="locked-screen">
      <h1 className="mt-5 text-xl font-semibold text-fg">KitStak Pulse is not turned on for {orgName}</h1>
      <p className="mt-2 text-base text-fg-secondary">
        {canManage ? 'Turn it on from the Portal to see profit by job, client and service.' : 'Ask an owner or admin of your organization to turn it on in the Portal.'}
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <a href={`${portalUrl}/billing?module=pulse`} className={primaryLink}>
          <Lock aria-hidden className="size-4" />
          {canManage ? 'Turn on Pulse' : 'View plans'}
        </a>
        <a href={portalUrl} className={secondaryLink}>
          Back to Portal
        </a>
      </div>
    </Frame>
  );
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
