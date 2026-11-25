'use client';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { CircleAlert, MailCheck } from 'lucide-react';
import { EmailText } from '@/components/ui';
import { signOut } from '@/lib/auth-client';
import { changeUnverifiedEmailAction, resendVerificationAction, skipVerifyAction, verifyEmailAction } from '@/server/signup-actions';
import { CodeInput } from '../_components/code-input';
import { AuthHeading, FormAlert, NO_NETWORK_MESSAGE, OutboxHint, SubmitButton, TAP_BUTTON } from '../_components/form-parts';

const LINK_BUTTON =
  'inline-flex min-h-11 items-center rounded-md px-1 font-semibold text-fg-link hover:underline disabled:cursor-not-allowed disabled:font-medium disabled:text-fg-muted disabled:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

export interface VerifyEmailFormProps {
  readonly email: string;
  /** A checked portal path. */
  readonly next: string;
  readonly minutes: number;
  readonly initialWaitSeconds: number;
  readonly resendWaitSeconds: number;
  readonly devOutbox: boolean;
}

export function VerifyEmailForm({
  email,
  next,
  minutes,
  initialWaitSeconds,
  resendWaitSeconds,
  devOutbox,
}: VerifyEmailFormProps) {
  const router = useRouter();
  const codeId = useId();
  const errorId = `${codeId}-error`;
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<ReactNode>(null);
  const [state, setState] = useState<'idle' | 'checking' | 'done' | 'sending' | 'skipping'>('idle');
  const [wait, setWait] = useState(initialWaitSeconds);
  // "Change email": fixes a typo without losing the account, the organization or the free trial.
  const [changing, setChanging] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [changeError, setChangeError] = useState<string | null>(null);
  const [savingEmail, setSavingEmail] = useState(false);
  const newEmailId = `${codeId}-new-email`;
  const working = useRef(false);
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) input.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  const verify = async (value: string) => {
    if (working.current) return;
    if (value.length !== 6) {
      setError('Enter the 6 digit code from your email.');
      input.current?.focus();
      return;
    }
    working.current = true;
    setState('checking');
    setError(null);
    setNotice(null);
    try {
      const result = await verifyEmailAction({ code: value });
      if (result.ok) {
        setState('done');
        router.replace(next);
        router.refresh();
        return;
      }
      setError(result.error ?? 'That code is not right. Check it and try again.');
    } catch {
      setError(NO_NETWORK_MESSAGE);
    }
    working.current = false;
    setState('idle');
    // Keep what was typed, select it, and let the person fix it.
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.select();
    });
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void verify(code);
  };

  const resend = async () => {
    if (working.current || wait > 0) return;
    working.current = true;
    setState('sending');
    setError(null);
    setNotice(null);
    try {
      const result = await resendVerificationAction();
      if (result.ok) {
        // The address is one box with its full stop inside, so a long one never leaves a "." on a line by itself.
        setNotice(
          <>
            We sent a new code to <EmailText email={email} className="font-semibold" after="." />
          </>,
        );
        setCode('');
        setWait(resendWaitSeconds);
      } else {
        setError(result.error ?? 'We could not send the code. Try again.');
      }
    } catch {
      setError(NO_NETWORK_MESSAGE);
    }
    working.current = false;
    setState('idle');
    input.current?.focus();
  };

  const skip = async () => {
    if (working.current) return;
    working.current = true;
    setState('skipping');
    try {
      const result = await skipVerifyAction({ next });
      router.replace(result.next ?? '/');
      router.refresh();
    } catch {
      setError(NO_NETWORK_MESSAGE);
      working.current = false;
      setState('idle');
    }
  };

  const changeEmail = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (working.current) return;
    const wanted = newEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(wanted)) {
      setChangeError('Enter a valid email.');
      return;
    }
    working.current = true;
    setSavingEmail(true);
    setChangeError(null);
    setError(null);
    setNotice(null);
    try {
      const result = await changeUnverifiedEmailAction({ email: wanted });
      if (result.ok) {
        setChanging(false);
        setNewEmail('');
        setCode('');
        setNotice(
          result.error ?? (
            <>
              Your email is now <EmailText email={wanted.toLowerCase()} className="font-semibold" after="." /> We sent a new code there.
            </>
          ),
        );
        setWait(resendWaitSeconds);
        router.refresh();
        requestAnimationFrame(() => input.current?.focus());
      } else {
        setChangeError(result.error ?? 'We could not change your email. Try again.');
      }
    } catch {
      setChangeError(NO_NETWORK_MESSAGE);
    }
    working.current = false;
    setSavingEmail(false);
  };

  const startOver = async () => {
    try {
      await signOut();
    } finally {
      router.replace('/signup');
      router.refresh();
    }
  };

  const busy = state !== 'idle';
  return (
    <>
      <span className="mb-5 flex size-11 items-center justify-center rounded-full bg-info-subtle text-info-text">
        <MailCheck aria-hidden className="size-5" />
      </span>
      <AuthHeading
        title="Check your email"
        subtitle={
          <>
            We sent a 6 digit code to <EmailText email={email} className="font-semibold text-fg" after="." /> It works for{' '}
            {minutes} minutes.
          </>
        }
      />
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5" aria-busy={state === 'checking'}>
        {notice ? <FormAlert tone="success">{notice}</FormAlert> : null}
        {devOutbox ? <OutboxHint /> : null}
        <div className="flex flex-col gap-2">
          <label htmlFor={codeId} className="text-xs font-medium text-fg-secondary">
            6 digit code
          </label>
          <CodeInput
            ref={input}
            id={codeId}
            testId="verify-code"
            value={code}
            onChange={(value) => {
              setCode(value);
              if (error) setError(null);
            }}
            onComplete={(value) => void verify(value)}
            invalid={Boolean(error)}
            disabled={state === 'checking' || state === 'done'}
            describedBy={error ? errorId : undefined}
          />
          {error ? (
            <p id={errorId} role="alert" className="flex items-center gap-1 text-xs font-medium text-danger-text">
              <CircleAlert aria-hidden className="size-3.5 shrink-0" />
              {error}
            </p>
          ) : null}
        </div>
        <SubmitButton
          data-testid="verify-submit"
          disabled={state === 'sending' || state === 'skipping'}
          busyLabel={state === 'checking' ? 'Checking your code…' : state === 'done' ? 'Email verified' : null}
        >
          Verify email
        </SubmitButton>
      </form>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4">
        <button
          type="button"
          data-testid="verify-resend"
          onClick={() => void resend()}
          disabled={busy || wait > 0}
          className={LINK_BUTTON}
        >
          {state === 'sending'
            ? 'Sending…'
            : wait > 0
              ? `Send a new code in ${wait} ${wait === 1 ? 'second' : 'seconds'}`
              : 'Send a new code'}
        </button>
        <button type="button" data-testid="verify-skip" onClick={() => void skip()} disabled={busy} className={LINK_BUTTON}>
          I will do this later
        </button>
      </div>
      {changing ? (
        <form noValidate onSubmit={changeEmail} className="mt-6 flex flex-col gap-3 rounded-lg border border-border-default bg-sunken/60 p-4" data-testid="change-email-form">
          <label htmlFor={newEmailId} className="text-xs font-medium text-fg-secondary">
            Your right email
          </label>
          <input
            id={newEmailId}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            required
            value={newEmail}
            onChange={(event) => {
              setNewEmail(event.target.value);
              if (changeError) setChangeError(null);
            }}
            aria-invalid={changeError ? true : undefined}
            aria-describedby={changeError ? `${newEmailId}-error` : `${newEmailId}-hint`}
            data-testid="change-email-input"
            className="h-12 w-full rounded-md border border-border-strong bg-surface px-3 text-base text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:h-11"
          />
          {changeError ? (
            <p id={`${newEmailId}-error`} role="alert" className="flex items-center gap-1 text-xs font-medium text-danger-text">
              <CircleAlert aria-hidden className="size-3.5 shrink-0" />
              {changeError}
            </p>
          ) : (
            <p id={`${newEmailId}-hint`} className="text-xs text-fg-muted">
              We send a new code there. Your account, your organization and your free trial stay as they are.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <button type="submit" data-testid="change-email-save" disabled={savingEmail} className={LINK_BUTTON}>
              {savingEmail ? 'Saving…' : 'Save and send a new code'}
            </button>
            <button
              type="button"
              disabled={savingEmail}
              onClick={() => {
                setChanging(false);
                setChangeError(null);
              }}
              className={`${LINK_BUTTON} font-medium text-fg-secondary`}
            >
              Go back
            </button>
          </div>
        </form>
      ) : (
        <p className="mt-6 text-center text-sm text-fg-muted">
          Typed the wrong address?{' '}
          <button
            type="button"
            data-testid="change-email"
            onClick={() => {
              setChanging(true);
              setChangeError(null);
            }}
            disabled={busy}
            className={`${TAP_BUTTON} rounded-sm font-medium text-fg-link underline underline-offset-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus`}
          >
            Change email
          </button>
        </p>
      )}
      <p className="mt-2 text-center text-sm text-fg-muted">
        Not your account?{' '}
        <button
          type="button"
          onClick={() => void startOver()}
          className={`${TAP_BUTTON} rounded-sm font-medium text-fg-secondary underline underline-offset-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus`}
        >
          Sign out and start again
        </button>
      </p>
    </>
  );
}
