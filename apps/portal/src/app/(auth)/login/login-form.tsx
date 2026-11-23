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
import { signIn } from '@/lib/auth-client';
import { resumeAfterSignInAction } from '@/server/signup-actions';
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
}

export function LoginForm({ next, notice, handoff, providers, legal, providerError }: LoginFormProps) {
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
      const result = await signIn.email({ email: email.trim(), password, rememberMe: remember });
      if (result.error) {
        setError(authErrorMessage(result.error));
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
