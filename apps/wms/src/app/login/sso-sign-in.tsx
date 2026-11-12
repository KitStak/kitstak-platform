'use client';

/**
 * Sign-in page SSO (Apps › Single sign-on, OpenID Connect) and the Custom Branding message.
 * `SsoButton` replaces the old disabled placeholder: live once `/api/auth/sso/status` says SSO
 * is on, disabled with the reason otherwise. `SsoNotices` shows an `sso_error` from the
 * callback, the "SSO required" note and the branding sign-in message.
 */
import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';

export interface SsoStatus {
  readonly enabled: boolean;
  readonly label: string | null;
  readonly enforced: boolean;
  readonly loginMessage: string | null;
}

export const SSO_DISABLED_REASON = "SSO isn't configured for this workspace";

let cached: Promise<SsoStatus | null> | null = null;
function loadStatus(): Promise<SsoStatus | null> {
  cached ??= fetch('/api/auth/sso/status', { headers: { accept: 'application/json' } })
    .then((r) => r.json() as Promise<{ data?: SsoStatus }>)
    .then((b) => b.data ?? null)
    .catch(() => {
      cached = null;
      return null;
    });
  return cached;
}

function useSsoStatus(): SsoStatus | null {
  const [status, setStatus] = React.useState<SsoStatus | null>(null);
  React.useEffect(() => {
    let live = true;
    void loadStatus().then((s) => {
      if (live) setStatus(s);
    });
    return () => {
      live = false;
    };
  }, []);
  return status;
}

export function SsoButton() {
  const status = useSsoStatus();
  const params = useSearchParams();
  const next = params.get('next') ?? params.get('returnTo');
  if (status?.enabled) {
    const href = `/api/auth/sso/start${next && next.startsWith('/') && !next.startsWith('//') ? `?returnTo=${encodeURIComponent(next)}` : ''}`;
    return (
      <a
        href={href}
        className="mt-5 flex h-10 w-full items-center justify-center gap-2 rounded-md border border-border bg-surface text-base font-semibold text-foreground shadow-xs hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      >
        <KeyRound className="h-4 w-4 text-primary" aria-hidden />
        {status.label}
      </a>
    );
  }
  return (
    <Tooltip content={SSO_DISABLED_REASON}>
      <span
        tabIndex={0}
        aria-label={SSO_DISABLED_REASON}
        className="mt-5 flex w-full cursor-not-allowed rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      >
        {/* pointer-events-none: a disabled button swallows hover, so the span drives the tooltip. */}
        <Button type="button" size="lg" className="pointer-events-none w-full" disabled>
          <KeyRound className="h-4 w-4 text-secondary" aria-hidden />
          Log in with SSO
        </Button>
      </span>
    </Tooltip>
  );
}

export function SsoNotices() {
  const status = useSsoStatus();
  const error = useSearchParams().get('sso_error');
  if (!error && !status?.enforced && !status?.loginMessage) return null;
  return (
    <div className="mt-4 flex w-full max-w-[400px] flex-col gap-2">
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger"
        >
          Single sign-on: {error}
        </p>
      ) : null}
      {status?.enforced ? (
        <p className="text-center text-2xs text-secondary">
          Your company signs in with single sign-on. Password sign-in is for administrators only.
        </p>
      ) : null}
      {status?.loginMessage ? (
        <p className="text-center text-xs text-secondary">{status.loginMessage}</p>
      ) : null}
    </div>
  );
}
