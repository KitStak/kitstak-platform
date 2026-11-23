'use client';
/**
 * "Continue with Google" and "Continue with Microsoft". Rendered only for the providers whose keys
 * are set (the server passes the list), so there is never a dead button.
 */
import { useState } from 'react';
import { Spinner, buttonVariants, cn } from '@/components/ui';
import { signIn } from '@/lib/auth-client';
import { SOCIAL_LABELS, type SocialProviderId } from '@/features/signup/social';
import { NO_NETWORK_MESSAGE } from './form-parts';

function GoogleMark() {
  return (
    <svg aria-hidden viewBox="0 0 18 18" width="18" height="18">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}

function MicrosoftMark() {
  return (
    <svg aria-hidden viewBox="0 0 18 18" width="18" height="18">
      <rect x="1" y="1" width="7.5" height="7.5" fill="#F25022" />
      <rect x="9.5" y="1" width="7.5" height="7.5" fill="#7FBA00" />
      <rect x="1" y="9.5" width="7.5" height="7.5" fill="#00A4EF" />
      <rect x="9.5" y="9.5" width="7.5" height="7.5" fill="#FFB900" />
    </svg>
  );
}

const MARKS: Readonly<Record<SocialProviderId, () => React.JSX.Element>> = {
  google: GoogleMark,
  microsoft: MicrosoftMark,
};

export interface SocialButtonsProps {
  readonly providers: readonly SocialProviderId[];
  /** Where the person lands after the provider sends them back. A portal path. */
  readonly callbackPath: string;
  /** Where a failed attempt lands. A portal path. Default: the callback path. */
  readonly errorPath?: string;
  readonly disabled?: boolean;
  readonly onError: (message: string) => void;
  /** The words between the buttons and the form below them. */
  readonly dividerLabel?: string;
}

export function SocialButtons({
  providers,
  callbackPath,
  errorPath,
  disabled,
  onError,
  dividerLabel = 'or use your email',
}: SocialButtonsProps) {
  const [pending, setPending] = useState<SocialProviderId | null>(null);
  if (providers.length === 0) return null;

  const start = async (provider: SocialProviderId) => {
    if (pending) return;
    setPending(provider);
    try {
      const result = await signIn.social({
        provider,
        callbackURL: callbackPath,
        errorCallbackURL: errorPath ?? callbackPath,
      });
      if (result.error) {
        onError(result.error.message || 'That did not work. Try again, or use your email.');
        setPending(null);
      }
      // On success the browser is already on its way to the provider.
    } catch {
      onError(NO_NETWORK_MESSAGE);
      setPending(null);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2.5">
        {providers.map((provider) => {
          const Mark = MARKS[provider];
          const busy = pending === provider;
          return (
            <button
              key={provider}
              type="button"
              disabled={disabled || pending !== null}
              aria-busy={busy || undefined}
              data-testid={`social-${provider}`}
              onClick={() => void start(provider)}
              className={cn(buttonVariants({ variant: 'secondary', size: 'lg', fullWidth: true }), 'h-12 gap-2.5 sm:h-11')}
            >
              {busy ? <Spinner size="sm" label={null} /> : <Mark />}
              {SOCIAL_LABELS[provider]}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-3" role="separator" aria-label={dividerLabel}>
        <span className="h-px flex-1 bg-border-default" aria-hidden />
        <span className="text-xs text-fg-muted" aria-hidden>
          {dividerLabel}
        </span>
        <span className="h-px flex-1 bg-border-default" aria-hidden />
      </div>
    </div>
  );
}

/** Plain words for the error codes a provider round trip can come back with. */
export function socialErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  switch (code) {
    case 'account_not_linked':
    case 'unable_to_link_account':
      return 'This email already has a KitStak account. Sign in with your email and password.';
    case 'access_denied':
      return 'You closed the sign in window. Try again, or use your email.';
    case 'signup_disabled':
      return 'We could not find an account for that sign in. Create one with your email.';
    default:
      return 'That sign in did not work. Try again, or use your email.';
  }
}
