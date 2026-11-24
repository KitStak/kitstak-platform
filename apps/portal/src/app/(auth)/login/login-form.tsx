'use client';
import Link from 'next/link';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Mail } from 'lucide-react';
import { HandoffScreen } from '@kitstak/ui/handoff';
import { encodeHandoffIdentity } from '@kitstak/billing/handoff';
import { Checkbox, Field } from '@/components/ui';
import { hasHandoff, readHandoff, withHandoff } from '@/features/signup/cart';
import { emailIssue } from '@/features/signup/fields';
import type { SocialProviderId } from '@/features/signup/social';
import { signInAction } from '@/server/auth-relay-actions';
import { requestSignInCodeAction, resumeAfterSignInAction, signInWithCodeAction } from '@/server/signup-actions';
import {
  AuthHeading,
  AuthInput,
  FormAlert,
  NO_NETWORK_MESSAGE,
  PasswordInput,
  SubmitButton,
  TAP_BUTTON,
  authErrorMessage,
} from '../_components/form-parts';
import { CodeInput } from '../_components/code-input';
import { LegalLine, type LegalUrls } from '../_components/legal-line';
import { SocialButtons, socialErrorMessage } from '../_components/social-buttons';
import { prefersAutoFocus, useHashIdentity } from '../_components/use-hash-identity';

type FieldErrors = Partial<Record<'email' | 'password', string>>;

export interface LoginFormProps {
  /** A checked portal path the person asked for, or null. */
  readonly next: string | null;
  readonly notice: string | null;
  /** The cleaned cart from the link, kept so "Create an account" and the return trip carry it. */
  readonly handoff: Readonly<Record<string, string>>;
  readonly providers: readonly SocialProviderId[];
  readonly legal: LegalUrls;
  readonly providerError: string | null;
  /** True when emails land in the dev outbox page, so the code step can point there. */
  readonly devOutbox?: boolean;
}

const LINK_BUTTON = `${TAP_BUTTON} rounded-sm text-sm font-semibold text-fg-link hover:underline disabled:cursor-not-allowed disabled:text-fg-muted disabled:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus`;

export function LoginForm({ next, notice, handoff, providers, legal, providerError, devOutbox = false }: LoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(socialErrorMessage(providerError));
  const [pending, setPending] = useState(false);
  /** Signed in and on the way to the apps. Only then does the full screen handoff show. */
  const [signedIn, setSignedIn] = useState(false);
  const submitting = useRef(false);
  const emailInput = useRef<HTMLInputElement | null>(null);
  const passwordInput = useRef<HTMLInputElement | null>(null);
  /**
   * "Email me a code instead": the second way in, with no password. 'password' is the normal form,
   * 'code' shows the 6 digit field for the code that was just mailed.
   */
  const [mode, setMode] = useState<'password' | 'code'>('password');
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [sendingCode, setSendingCode] = useState(false);
  const codeInput = useRef<HTMLInputElement | null>(null);

  const parsedHandoff = useMemo(() => readHandoff(handoff), [handoff]);
  const carriesCart = hasHandoff(parsedHandoff);
  // After sign in: the place asked for, else signup with the cart, else wherever the person left off.
  const afterSignIn = next ?? (carriesCart ? withHandoff('/signup', parsedHandoff) : null);
  const signupHref = withHandoff('/signup', parsedHandoff);

  // An address passed after the "#" (from signup or password reset) is filled in, then removed.
  useHashIdentity((identity) => {
    if (identity.email) setEmail((current) => current || identity.email || '');
    if (prefersAutoFocus()) {
      (identity.email ? passwordInput.current : emailInput.current)?.focus({ preventScroll: true });
    }
  });

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current) return;
    setError(null);
    const issues: FieldErrors = {};
    const emailProblem = emailIssue(email, 'Enter a valid email address.');
    if (emailProblem) issues.email = emailProblem;
    if (password.length === 0) issues.password = 'Enter your password.';
    setFieldErrors(issues);
    if (issues.email) return emailInput.current?.focus();
    if (issues.password) return passwordInput.current?.focus();

    submitting.current = true;
    setPending(true);
    try {
      // A server action, not a browser call to the auth endpoint: a wrong password is an answer the
      // form shows, not a failed request in the console.
      const result = await signInAction({ email: email.trim(), password, rememberMe: remember });
      if (result.error) {
        // Sign in allows 10 tries a minute, so the wait is 1 minute.
        setError(authErrorMessage(result.error, 1));
        submitting.current = false;
        setPending(false);
        // Keep the email. Select the password so the next try is one keystroke away.
        requestAnimationFrame(() => {
          passwordInput.current?.focus();
          passwordInput.current?.select();
        });
        return;
      }
      setSignedIn(true);
      let destination = afterSignIn;
      if (!destination) {
        try {
          destination = (await resumeAfterSignInAction()).next ?? '/';
        } catch {
          destination = '/';
        }
      }
      router.replace(destination);
      router.refresh();
    } catch {
      setError(NO_NETWORK_MESSAGE);
      submitting.current = false;
      setPending(false);
      setSignedIn(false);
    }
  };

  const forgotHref = email.trim() ? `/forgot-password#${encodeHandoffIdentity({ email: email.trim() })}` : '/forgot-password';

  /** After any successful sign in: the place asked for, else wherever the person left off. */
  const goOn = async () => {
    setSignedIn(true);
    let destination = afterSignIn;
    if (!destination) {
      try {
        destination = (await resumeAfterSignInAction()).next ?? '/';
      } catch {
        destination = '/';
      }
    }
    router.replace(destination);
    router.refresh();
  };

  /** Mails a 6 digit sign in code to the address in the form and opens the code step. */
  const sendCode = async () => {
    if (sendingCode || submitting.current) return;
    setError(null);
    setCodeError(null);
    const emailProblem = emailIssue(email, 'Enter a valid email address.');
    if (emailProblem) {
      setFieldErrors({ email: emailProblem });
      emailInput.current?.focus();
      return;
    }
    setFieldErrors({});
    setSendingCode(true);
    try {
      const result = await requestSignInCodeAction({ email: email.trim() });
      if (!result.ok) {
        setError(result.error ?? NO_NETWORK_MESSAGE);
      } else {
        setCode('');
        setMode('code');
        requestAnimationFrame(() => codeInput.current?.focus());
      }
    } catch {
      setError(NO_NETWORK_MESSAGE);
    }
    setSendingCode(false);
  };

  const submitCode = async (value: string) => {
    if (submitting.current) return;
    if (value.length !== 6) {
      setCodeError('Enter the 6 digit code from your email.');
      codeInput.current?.focus();
      return;
    }
    submitting.current = true;
    setPending(true);
    setCodeError(null);
    try {
      const result = await signInWithCodeAction({ email: email.trim(), code: value });
      if (!result.ok) {
        setCodeError(result.error ?? 'That code is not right. Check it and try again.');
        setCode('');
        submitting.current = false;
        setPending(false);
        requestAnimationFrame(() => codeInput.current?.focus());
        return;
      }
      await goOn();
    } catch {
      setCodeError(NO_NETWORK_MESSAGE);
      submitting.current = false;
      setPending(false);
      setSignedIn(false);
    }
  };

  if (mode === 'code') {
    return (
      <>
        {signedIn ? <HandoffScreen title="Signing you in" detail="Opening your KitStak apps" /> : null}
        <AuthHeading title="Check your email" subtitle="Enter the 6 digit code to sign in. No password needed." />
        <form
          noValidate
          className="flex flex-col gap-5"
          aria-busy={pending}
          data-testid="login-code-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submitCode(code);
          }}
        >
          <p className="text-base text-fg-secondary" role="status">
            If <span className="font-medium text-fg [overflow-wrap:anywhere]">{email.trim()}</span> has a KitStak account, a code is on its way. It works for 10 minutes.
          </p>
          {devOutbox ? (
            <p className="text-sm text-fg-secondary" data-testid="login-code-dev">
              Test mode: no real email is sent. Find the code in the{' '}
              <Link href="/dev/outbox" target="_blank" className="font-semibold text-fg-link underline underline-offset-2">
                dev outbox
              </Link>
              .
            </p>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="login-code" className="text-xs font-medium text-fg-secondary">
              6 digit code
            </label>
            <CodeInput
              ref={codeInput}
              id="login-code"
              testId="login-code"
              value={code}
              onChange={(value) => {
                setCode(value);
                if (codeError) setCodeError(null);
              }}
              onComplete={(value) => void submitCode(value)}
              invalid={Boolean(codeError)}
              disabled={pending}
              describedBy={codeError ? 'login-code-error' : undefined}
            />
            {codeError ? (
              <p id="login-code-error" role="alert" className="text-xs font-medium text-danger-text">
                {codeError}
              </p>
            ) : null}
          </div>
          <SubmitButton busyLabel={pending ? 'Signing you in…' : null}>Sign in</SubmitButton>
          <div className="flex flex-wrap items-center justify-between gap-x-4">
            <button type="button" className={LINK_BUTTON} disabled={sendingCode || pending} onClick={() => void sendCode()} data-testid="login-code-resend">
              {sendingCode ? 'Sending a new code' : 'Send a new code'}
            </button>
            <button
              type="button"
              className={LINK_BUTTON}
              disabled={pending}
              data-testid="login-use-password"
              onClick={() => {
                setMode('password');
                setCodeError(null);
                requestAnimationFrame(() => passwordInput.current?.focus());
              }}
            >
              Use my password instead
            </button>
          </div>
        </form>
      </>
    );
  }

  return (
    <>
      {signedIn ? <HandoffScreen title="Signing you in" detail="Opening your KitStak apps" /> : null}
      <AuthHeading title="Welcome back" subtitle="Sign in to open your KitStak apps." />
      <div className="flex flex-col gap-5">
        <SocialButtons
          providers={providers}
          callbackPath={afterSignIn ?? '/login'}
          errorPath={withHandoff('/login', parsedHandoff, { next })}
          disabled={pending}
          onError={setError}
        />
        <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5" aria-busy={pending}>
          {notice ? <FormAlert tone="success">{notice}</FormAlert> : null}
          {error ? <FormAlert>{error}</FormAlert> : null}
          <Field label="Work email" error={fieldErrors.email}>
            {({ inputId, describedBy, invalid }) => (
              <AuthInput
                id={inputId}
                ref={emailInput}
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="next"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
                leadingIcon={<Mail aria-hidden />}
                aria-describedby={describedBy}
                invalid={invalid}
              />
            )}
          </Field>
          <Field
            label="Password"
            error={fieldErrors.password}
            labelAside={
              <Link
                href={forgotHref}
                className={`${TAP_BUTTON} rounded-sm text-xs font-semibold text-fg-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus`}
              >
                Forgot password?
              </Link>
            }
          >
            {({ inputId, describedBy, invalid }) => (
              <PasswordInput
                id={inputId}
                ref={passwordInput}
                name="password"
                autoComplete="current-password"
                enterKeyHint="go"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-describedby={describedBy}
                invalid={invalid}
              />
            )}
          </Field>
          <Checkbox
            label="Keep me signed in"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
          />
          <SubmitButton busyLabel={pending ? 'Signing you in…' : null}>Sign in</SubmitButton>
          {/* The second way in: no password at all. The code that is mailed signs the person in. */}
          <p className="-mt-2 text-center text-sm text-fg-secondary">
            Or skip the password.{' '}
            <button type="button" className={LINK_BUTTON} disabled={sendingCode || pending} onClick={() => void sendCode()} data-testid="login-email-code">
              {sendingCode ? 'Sending your code' : 'Email me a code instead'}
            </button>
          </p>
        </form>
        <LegalLine urls={legal} lead="By signing in" />
      </div>
      <p className="mt-7 text-center text-base text-fg-secondary">
        New to KitStak?{' '}
        <Link href={signupHref} className="py-3.5 font-semibold text-fg-link hover:underline">
          Start your free trial
        </Link>
      </p>
    </>
  );
}
