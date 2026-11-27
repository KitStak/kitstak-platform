'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
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
  OutboxHint,
  PasswordInput,
  QuietRow,
  ROW_LINK,
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

/** The query key that says "the code step". The address is then `/login?step=code#e=...`. */
const STEP_KEY = 'step';
const CODE_STEP = 'code';

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
   * "Email me a code instead": the second way in, with no password.
   *
   * The code step has its own address (review round 4): `/login?step=code`, with the email after
   * the "#", where no server and no log sees it. So a refresh, a tab the phone reloaded while the
   * person read their mail, or Back from another page all show the code field again, for the same
   * address, and the code that was mailed still works. The step is read from the address, never
   * kept only in this component.
   */
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const onCodeStep = searchParams.get(STEP_KEY) === CODE_STEP;
  /** True when the page was opened on the code step (a reload, Back, a tab the phone brought back). */
  const [openedOnCodeStep] = useState(onCodeStep);
  /** False until the part after the "#" was read. Until then the code step does not know its address. */
  const [hashRead, setHashRead] = useState(false);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [sendingCode, setSendingCode] = useState(false);
  /** True when the last ask sent no new code, because the one before it is still good. */
  const [noNewCode, setNoNewCode] = useState(false);
  const codeInput = useRef<HTMLInputElement | null>(null);
  /** The step the person just asked for. Its field gets the focus once that step is on the page. */
  const focusAfterStep = useRef<'code' | 'password' | null>(null);
  const focusStepField = (step: 'code' | 'password') => {
    if (!prefersAutoFocus()) return;
    (step === 'code' ? codeInput.current : passwordInput.current)?.focus({ preventScroll: true });
  };

  /** The address of this screen with or without the code step. Everything else in the link is kept. */
  const stepUrl = (step: 'code' | 'password', forEmail: string): string => {
    const params = new URLSearchParams(window.location.search);
    if (step === 'code') params.set(STEP_KEY, CODE_STEP);
    else params.delete(STEP_KEY);
    const query = params.toString();
    const hash = step === 'code' ? `#${encodeHandoffIdentity({ email: forEmail })}` : '';
    return `${pathname}${query ? `?${query}` : ''}${hash}`;
  };

  const parsedHandoff = useMemo(() => readHandoff(handoff), [handoff]);
  const carriesCart = hasHandoff(parsedHandoff);
  // After sign in: the place asked for, else signup with the cart, else wherever the person left off.
  const afterSignIn = next ?? (carriesCart ? withHandoff('/signup', parsedHandoff) : null);
  const signupHref = withHandoff('/signup', parsedHandoff);

  // An address passed after the "#" (from signup or password reset) is filled in, then removed.
  // On the code step it stays, like on the reset password screen, so a reload keeps it.
  // This runs once, for the address the page was opened with. So it asks how the page was opened
  // (`openedOnCodeStep`), never where the person is by now.
  useHashIdentity(
    (identity) => {
      if (identity.email) setEmail((current) => current || identity.email || '');
      setHashRead(true);
      if (openedOnCodeStep && !identity.email) {
        // The code step was opened with no address (a link someone cut short). There is nobody to
        // send a code to, so this is the normal sign in form.
        window.history.replaceState(null, '', stepUrl('password', ''));
      }
      if (prefersAutoFocus()) {
        const target = openedOnCodeStep && identity.email ? codeInput.current : identity.email ? passwordInput.current : emailInput.current;
        target?.focus({ preventScroll: true });
      }
    },
    { strip: !openedOnCodeStep },
  );

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
      leaveTo(destination);
    } catch {
      setError(NO_NETWORK_MESSAGE);
      submitting.current = false;
      setPending(false);
      setSignedIn(false);
    }
  };

  /**
   * Leaves the sign in page. A Portal path goes through the router. A page in another app (the CRM,
   * the WMS, Projects or Pulse send their signed out visitors here with a full address) is a plain
   * browser visit: the router would first try to fetch it from here, which the browser blocks and
   * logs as three console errors before it falls back.
   */
  const leaveTo = (destination: string) => {
    if (!destination.startsWith('/')) {
      window.location.assign(destination);
      return;
    }
    router.replace(destination);
    router.refresh();
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
    leaveTo(destination);
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
      // 'code_sent_recently': no new code went out, because the last one is still fresh and still
      // works. The code step opens all the same and says so, with the real wait.
      const lastCodeStillGood = !result.ok && result.code === 'code_sent_recently';
      if (!result.ok && !lastCodeStillGood) {
        setError(result.error ?? NO_NETWORK_MESSAGE);
      } else {
        setCode('');
        setNoNewCode(lastCodeStillGood);
        if (lastCodeStillGood) setCodeError(result.error ?? null);
        // The code step gets its own entry in the history, with the address after the "#". Asking
        // for a new code on the step itself keeps the one entry.
        const url = stepUrl('code', email.trim());
        if (onCodeStep) window.history.replaceState(null, '', url);
        else window.history.pushState(null, '', url);
        focusAfterStep.current = 'code';
        // Asking again on the code step itself: the field is already on the page.
        if (onCodeStep) focusStepField('code');
      }
    } catch {
      setError(NO_NETWORK_MESSAGE);
    }
    setSendingCode(false);
  };

  const submitCode = async (value: string) => {
    // No address yet (the link is read a moment after the page shows): nothing to check a code against.
    if (submitting.current || email.trim() === '') return;
    if (value.length !== 6) {
      setCodeError('Enter the 6 digit code from your email.');
      codeInput.current?.focus();
      return;
    }
    submitting.current = true;
    setPending(true);
    setCodeError(null);
    try {
      const result = await signInWithCodeAction({ email: email.trim(), code: value, ...(afterSignIn ? { next: afterSignIn } : {}) });
      if (!result.ok) {
        setCodeError(result.error ?? 'That code is not right. Check it and try again.');
        setCode('');
        submitting.current = false;
        setPending(false);
        requestAnimationFrame(() => codeInput.current?.focus());
        return;
      }
      // The server names a stop on the way when it has something to say first: the account page,
      // when an old password that was never confirmed was removed (it carries the way on).
      if (result.next) {
        setSignedIn(true);
        leaveTo(result.next);
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

  // The step comes from the address. An address with no email (after the "#" was read) is not a code step.
  const codeEmail = email.trim();
  const mode: 'password' | 'code' = onCodeStep && (!hashRead || codeEmail !== '') ? 'code' : 'password';

  // The step changes a moment after the address does, so the field of the new step is focused here,
  // once it is on the page. Only after the person switched steps, and only with a mouse or trackpad:
  // a phone keeps its keyboard down until the person taps a field.
  useEffect(() => {
    if (focusAfterStep.current !== mode) return;
    focusAfterStep.current = null;
    focusStepField(mode);
  }, [mode]);

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
          <p className="text-base text-fg-secondary" role="status" data-testid="login-code-sent">
            {codeEmail ? (
              <>
                If <span className="font-medium text-fg [overflow-wrap:anywhere]">{codeEmail}</span> has a KitStak account, {noNewCode ? 'we sent it a code a moment ago.' : 'a code is on its way.'}
              </>
            ) : (
              // The address is read from the link a moment after the page shows.
              'If that address has a KitStak account, a code is on its way.'
            )}{' '}
            {noNewCode ? null : 'It works for 10 minutes.'}
          </p>
          {/* The same pill as on the verify email and reset password screens. */}
          {devOutbox ? <OutboxHint testId="login-code-dev" /> : null}
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
          <div className="-my-2 flex flex-wrap items-center justify-between gap-x-4 text-sm">
            <button type="button" className={ROW_LINK} disabled={sendingCode || pending} onClick={() => void sendCode()} data-testid="login-code-resend">
              {sendingCode ? 'Sending a new code' : 'Send a new code'}
            </button>
            <button
              type="button"
              className={ROW_LINK}
              disabled={pending}
              data-testid="login-use-password"
              onClick={() => {
                // Back to the normal form, at its own address. The email stays in the field.
                window.history.replaceState(null, '', stepUrl('password', ''));
                setCodeError(null);
                focusAfterStep.current = 'password';
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
          <QuietRow lead="Or skip the password." className="-my-2">
            <button type="button" className={ROW_LINK} disabled={sendingCode || pending} onClick={() => void sendCode()} data-testid="login-email-code">
              {sendingCode ? 'Sending your code' : 'Email me a code instead'}
            </button>
          </QuietRow>
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
