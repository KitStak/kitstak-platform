import { Clock3, ShieldQuestion } from 'lucide-react';
import { LEDGER_PREVIEW_LOCKED as LOCKED_SENTENCE } from '@kitstak/ledger-bridge/types';
import { LedgerMark } from './logo';

const primaryLink =
  'inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-base font-medium text-primary-fg hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

function Frame({ testId, children }: { readonly testId: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-[480px] items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-border-subtle bg-panel p-8 text-center shadow-sm" data-testid={testId}>
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-sunken">
          <LedgerMark size={34} />
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * The preview gate's locked screen (SPEC 3.1). Before launch Ledger cannot be bought, so there is
 * no link to plans: only the preview sentence and a way back to the Portal.
 */
export function PreviewLockedScreen({ orgName, portalUrl }: { readonly orgName: string; readonly portalUrl: string }) {
  return (
    <Frame testId="preview-locked-screen">
      <h1 className="mt-5 text-xl font-semibold text-fg">Ledger is not open for {orgName} yet</h1>
      <p className="mt-2 text-base text-fg-secondary">{LOCKED_SENTENCE}</p>
      <p className="mt-3 inline-flex items-center gap-2 text-sm text-fg-muted">
        <Clock3 aria-hidden className="size-4" />
        Your other KitStak apps work as before.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <a href={portalUrl} className={primaryLink}>
          Back to Portal
        </a>
      </div>
    </Frame>
  );
}

/** Shown when the org is let in but this person has no Ledger role. Money is never inherited. */
export function NoAccessScreen({ orgName, portalUrl }: { readonly orgName: string; readonly portalUrl: string }) {
  return (
    <Frame testId="no-access-screen">
      <h1 className="mt-5 text-xl font-semibold text-fg">Ask an admin for access</h1>
      <p className="mt-2 text-base text-fg-secondary">
        Ledger holds what {orgName} is owed and what it owes, so nobody gets in by accident. An owner or admin can give you a role under Settings, People and roles.
      </p>
      <p className="mt-3 inline-flex items-center gap-2 text-sm text-fg-muted">
        <ShieldQuestion aria-hidden className="size-4" />
        You are signed in. You just do not have a Ledger role yet.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <a href={portalUrl} className={primaryLink}>
          Back to Portal
        </a>
      </div>
    </Frame>
  );
}
