'use client';

import * as React from 'react';
import Link from 'next/link';
import { Check, Circle, KeyRound } from 'lucide-react';
import { apiRequest, isApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Spinner } from '@/components/ui/spinner';
import { TextField } from '@/components/ui/text-field';
import { cn } from '@/lib/utils';
import { passwordChecks, passwordMeetsPolicy, type PasswordPolicyHints } from './password-checks';

function FieldError({ id, message }: { readonly id: string; readonly message?: string }) {
  return message ? (
    <p id={id} className="text-2xs text-danger">
      {message}
    </p>
  ) : null;
}

/** Consumes a reset token and sets a new password (every session is then revoked). */
export function ResetPasswordForm({
  token,
  policy,
}: {
  readonly token: string;
  readonly policy: PasswordPolicyHints;
}) {
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [submitted, setSubmitted] = React.useState(false);
  const [status, setStatus] = React.useState<'idle' | 'saving' | 'done'>('idle');
  const [error, setError] = React.useState<string | null>(null);
  const checks = passwordChecks(password, policy);
  const passwordError =
    submitted && !passwordMeetsPolicy(password, policy)
      ? 'Your password does not meet the requirements below.'
      : undefined;
  const confirmError = submitted && confirm !== password ? 'Passwords do not match.' : undefined;

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSubmitted(true);
    if (!passwordMeetsPolicy(password, policy) || confirm !== password || status === 'saving') return;
    setStatus('saving');
    setError(null);
    try {
      await apiRequest('/api/auth/reset', {
        method: 'POST',
        body: { token, password },
        skipAuthRedirect: true,
      });
      setStatus('done');
    } catch (err) {
      setStatus('idle');
      setError(isApiError(err) ? err.message : 'Network error. Check your connection and try again.');
    }
  };

  if (status === 'done') {
    return (
      <div className="flex flex-col gap-4">
        <Callout variant="success" title="Password updated">
          You can now log in with your new password. Other devices were signed out.
        </Callout>
        <Link
          href="/login"
          className="inline-flex h-9 items-center justify-center rounded-md bg-primary text-sm font-medium text-white hover:bg-primary-hover"
        >
          Log in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {error ? (
        <Callout variant="error">
          {error}{' '}
          <Link href="/forgot-password" className="font-semibold underline">
            Request a new link
          </Link>
        </Callout>
      ) : null}
      <div className="flex flex-col gap-1">
        <label htmlFor="new-password" className="text-xs font-semibold text-body">
          New password <span className="text-danger">*</span>
        </label>
        <TextField
          id="new-password"
          type="password"
          autoComplete="new-password"
          autoFocus
          value={password}
          invalid={Boolean(passwordError)}
          aria-describedby="password-rules"
          onChange={(e) => setPassword(e.target.value)}
        />
        <FieldError id="new-password-error" message={passwordError} />
        <ul id="password-rules" className="mt-1 grid grid-cols-1 gap-0.5 sm:grid-cols-2">
          {checks.map((check) => (
            <li
              key={check.key}
              className={cn('flex items-center gap-1 text-2xs', check.ok ? 'text-success' : 'text-faint')}
            >
              {check.ok ? (
                <Check className="h-3 w-3" aria-hidden />
              ) : (
                <Circle className="h-2.5 w-2.5" aria-hidden />
              )}
              {check.label}
              <span className="sr-only">{check.ok ? '(met)' : '(not met)'}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="confirm-password" className="text-xs font-semibold text-body">
          Confirm password <span className="text-danger">*</span>
        </label>
        <TextField
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          invalid={Boolean(confirmError)}
          aria-describedby={confirmError ? 'confirm-password-error' : undefined}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <FieldError id="confirm-password-error" message={confirmError} />
      </div>
      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={status === 'saving'}>
        {status === 'saving' ? (
          <Spinner className="h-4 w-4" label="Saving" />
        ) : (
          <KeyRound className="h-4 w-4" aria-hidden />
        )}
        {status === 'saving' ? 'Saving…' : 'Set new password'}
      </Button>
    </form>
  );
}
