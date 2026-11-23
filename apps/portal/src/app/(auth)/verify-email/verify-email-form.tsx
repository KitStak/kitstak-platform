'use client';
import Link from 'next/link';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { CircleAlert, MailCheck } from 'lucide-react';
import { Badge } from '@/components/ui';
import { signOut } from '@/lib/auth-client';
import { resendVerificationAction, skipVerifyAction, verifyEmailAction } from '@/server/signup-actions';
import { CodeInput } from '../_components/code-input';
import { AuthHeading, FormAlert, NO_NETWORK_MESSAGE, SubmitButton, TAP_BUTTON, TAP_LINK } from '../_components/form-parts';

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
  const [notice, setNotice] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'checking' | 'done' | 'sending' | 'skipping'>('idle');
  const [wait, setWait] = useState(initialWaitSeconds);
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
        setNotice(`We sent a new code to ${email}.`);
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
            We sent a 6 digit code to <span className="font-semibold break-all text-fg">{email}</span>. It works for{' '}
            {minutes} minutes.
          </>
        }
      />
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5" aria-busy={state === 'checking'}>
        {notice ? <FormAlert tone="success">{notice}</FormAlert> : null}
        {devOutbox ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border-default bg-sunken/60 px-3.5 py-3 text-sm text-fg-secondary">
            <Badge tone="info">
              <span data-testid="test-mode-label">Test mode</span>
            </Badge>
            <span>
              <Link href="/dev/outbox" target="_blank" className={`${TAP_LINK} font-semibold text-fg-link underline underline-offset-2`}>
                Open the email outbox
              </Link>{' '}
              to see your code.
            </span>
          </div>
        ) : null}
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
      <p className="mt-6 text-center text-sm text-fg-muted">
        Not your address?{' '}
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
