'use client';
/**
 * Create your account (docs/billing/SPEC.md section 5.1): four fields, then straight to the app
 * picker. The account is made by a server action that runs the shared auth handler. The form is a
 * real form with the right autocomplete names, so password managers offer to save.
 * The workspace is then made by a server action together with the signup intent.
 */
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Mail, ShieldCheck, UserRound } from 'lucide-react';
import { encodeHandoffIdentity } from '@kitstak/billing/handoff';
import { BILLING_POLICY, CATALOG } from '@kitstak/billing/catalog';
import { Field } from '@/components/ui';
import { readHandoff, trialSummary, withHandoff } from '@/features/signup/cart';
import { clearSignupDraft, readSignupDraft, writeSignupDraft } from '@/features/signup/draft';
import {
  SIGNUP_FIELDS,
  companyIssue,
  signupFieldIssue,
  signupIssues,
  type SignupField,
  type SignupValues,
} from '@/features/signup/fields';
import { isRulesIssue } from '@/features/signup/password-rules';
import type { SocialProviderId } from '@/features/signup/social';
import { signUpAction } from '@/server/auth-relay-actions';
import { createWorkspaceAction } from '@/server/signup-actions';
import {
  AuthHeading,
  AuthInput,
  EmailHintLine,
  FormAlert,
  NO_NETWORK_MESSAGE,
  PasswordInput,
  PasswordRules,
  StepEyebrow,
  StrengthMeter,
  SubmitButton,
  TAP_BUTTON,
  authErrorMessage,
  hasEmailHint,
  isEmailTaken,
} from '../_components/form-parts';
import { LegalLine, type LegalUrls } from '../_components/legal-line';
import { SocialButtons, socialErrorMessage } from '../_components/social-buttons';
import { TrialSummaryInline } from '../_components/trial-summary-inline';
import { prefersAutoFocus, useHashIdentity } from '../_components/use-hash-identity';

type Stage = 'idle' | 'account' | 'workspace';

const BUSY_LABEL: Readonly<Record<Exclude<Stage, 'idle'>, string>> = {
  account: 'Creating your account…',
  workspace: 'Setting up your workspace…',
};

const EMPTY: SignupValues = { name: '', email: '', password: '', company: '' };

/** The browser's time zone, so "your trial ends on Dec 7" is the right day for this person. */
function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

export interface SignupFormProps {
  /** The cleaned cart and answers from the link. No price, no identity. */
  readonly handoff: Readonly<Record<string, string>>;
  readonly providers: readonly SocialProviderId[];
  readonly legal: LegalUrls;
  /** Error code from a Google or Microsoft round trip, if any. */
  readonly providerError: string | null;
}

export function SignupForm({ handoff, providers, legal, providerError }: SignupFormProps) {
  const router = useRouter();
  const [values, setValues] = useState<SignupValues>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<SignupField, string>>>({});
  /** "Email me a code instead": the account is made with no password a person knows. */
  const [noPassword, setNoPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(socialErrorMessage(providerError));
  const [emailTaken, setEmailTaken] = useState(false);
  const [stage, setStage] = useState<Stage>('idle');
  /** The account exists but the workspace step failed: only the company field is left. */
  const [companyOnly, setCompanyOnly] = useState(false);
  const submitting = useRef(false);
  const refs = useRef<Partial<Record<SignupField, HTMLInputElement | null>>>({});

  const parsedHandoff = useMemo(() => readHandoff(handoff), [handoff]);
  const summary = useMemo(() => trialSummary(parsedHandoff), [parsedHandoff]);
  const signInHref = withHandoff('/login', parsedHandoff);

  // Name, email and company ride after the "#", where no server and no log sees them. They are
  // read once, filled in, and taken out of the address bar.
  useHashIdentity((identity) => {
    const prefilled: SignupValues = {
      name: identity.name ?? '',
      email: identity.email ?? '',
      password: '',
      company: identity.company ?? '',
    };
    if (identity.name || identity.email || identity.company) {
      setValues((current) => ({
        name: current.name || prefilled.name,
        email: current.email || prefilled.email,
        password: current.password,
        company: current.company || prefilled.company,
      }));
    }
    // Focus the first empty field on desktop only. On a phone this would pop the keyboard over
    // the page before the person has read it.
    if (prefersAutoFocus()) {
      const firstEmpty = SIGNUP_FIELDS.find((field) => !(refs.current[field]?.value || prefilled[field]));
      refs.current[firstEmpty ?? 'name']?.focus({ preventScroll: true });
    }
  });

  // Name, email and company are kept in this tab until the account exists, so a refresh does not
  // empty the form (docs/billing/SPEC.md 5.6). The password is never stored anywhere.
  const restored = useRef(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const draft = readSignupDraft();
      restored.current = true;
      if (!draft) return;
      setValues((current) => ({
        name: current.name || draft.name,
        email: current.email || draft.email,
        password: current.password,
        company: current.company || draft.company,
      }));
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    if (!restored.current) return;
    writeSignupDraft({ name: values.name, email: values.email, company: values.company });
  }, [values.name, values.email, values.company]);

  const set = (field: SignupField) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setValues((current) => ({ ...current, [field]: value }));
    // A field that showed an error clears as soon as the person fixes it. Until then the sentence
    // follows what is typed, so it is never about an older try ("still needs a symbol" under a
    // long password that is refused for another reason).
    if (errors[field]) {
      const issue = signupFieldIssue(field, { ...values, [field]: value }) ?? undefined;
      setErrors((current) => ({ ...current, [field]: issue }));
    }
    if (field === 'email') setEmailTaken(false);
  };

  const checkOnBlur = (field: SignupField) => () => {
    // Nothing typed yet is not a mistake. Empty fields are only flagged on submit.
    if (values[field].trim() === '') return;
    setErrors((current) => ({ ...current, [field]: signupFieldIssue(field, values) ?? undefined }));
  };

  const focusFirstError = (issues: Partial<Record<SignupField, string>>) => {
    const first = SIGNUP_FIELDS.find((field) => issues[field]);
    if (first) refs.current[first]?.focus();
  };

  const makeWorkspace = async (company: string): Promise<boolean> => {
    setStage('workspace');
    try {
      const result = await createWorkspaceAction({ company, handoff });
      if (result.ok) {
        // The account and the workspace exist. Nothing is left to keep in the browser.
        clearSignupDraft();
        router.replace(result.next ?? '/signup/plan');
        return true;
      }
      setFormError(result.error ?? 'Your account is ready, but we could not set up your workspace. Try again.');
    } catch {
      setFormError(NO_NETWORK_MESSAGE);
    }
    setCompanyOnly(true);
    return false;
  };

  const finish = () => {
    submitting.current = false;
    setStage('idle');
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current) return;
    setFormError(null);
    setEmailTaken(false);

    if (companyOnly) {
      const issue = companyIssue(values.company);
      setErrors({ company: issue ?? undefined });
      if (issue) {
        refs.current.company?.focus();
        return;
      }
      submitting.current = true;
      if (!(await makeWorkspace(values.company.trim()))) finish();
      return;
    }

    const issues = signupIssues(values);
    // "Email me a code instead": there is no password to check.
    if (noPassword) delete issues.password;
    setErrors(issues);
    if (Object.keys(issues).length > 0) {
      focusFirstError(issues);
      return;
    }

    submitting.current = true;
    setStage('account');
    try {
      const timezone = browserTimeZone();
      // A server action, not a browser call to the auth endpoint: "this email already has an
      // account" is an answer the form shows, not a failed request in the console.
      const result = await signUpAction({
        name: values.name.trim(),
        email: values.email.trim(),
        ...(noPassword ? { noPassword: true } : { password: values.password }),
        ...(timezone ? { timezone } : {}),
      });
      if (result.error) {
        if (isEmailTaken(result.error)) {
          setEmailTaken(true);
          refs.current.email?.focus();
        } else if (result.error.code === 'PASSWORD_POLICY' || result.error.code?.startsWith('PASSWORD_')) {
          setErrors({ password: authErrorMessage(result.error) });
          refs.current.password?.focus();
        } else {
          setFormError(authErrorMessage(result.error));
        }
        finish();
        return;
      }
    } catch {
      setFormError(NO_NETWORK_MESSAGE);
      finish();
      return;
    }

    if (!(await makeWorkspace(values.company.trim()))) finish();
  };

  const busy = stage !== 'idle';

  return (
    <>
      {summary ? <TrialSummaryInline summary={summary} /> : null}
      <AuthHeading
        eyebrow={<StepEyebrow step={1} total={2} label={companyOnly ? 'Your workspace' : 'Your account'} />}
        title={companyOnly ? 'Name your workspace' : 'Start your free trial'}
        subtitle={
          companyOnly ? 'Your account is ready. One more thing and you are in.' : `${CATALOG.trialDays} days free. No card needed.`
        }
      />
      <div className="flex flex-col gap-5">
        {!companyOnly ? (
          <SocialButtons
            providers={providers}
            callbackPath={withHandoff('/signup', parsedHandoff)}
            disabled={busy}
            onError={setFormError}
          />
        ) : null}
        {/* A little tighter on a phone, so the button stays on the first screen of a small one (360 by 740) with a cart on top. */}
        <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4 sm:gap-5" data-testid="signup-form" aria-busy={busy}>
          {formError ? <FormAlert>{formError}</FormAlert> : null}
          {emailTaken ? (
            <FormAlert>
              An account with this email already exists.{' '}
              <Link
                href={`${signInHref}#${encodeHandoffIdentity({ email: values.email })}`}
                className="font-semibold underline underline-offset-2"
              >
                Sign in
              </Link>{' '}
              to keep going.
            </FormAlert>
          ) : null}
          {!companyOnly ? (
            <>
              <Field label="Full name" error={errors.name}>
                {({ inputId, describedBy, invalid }) => (
                  <AuthInput
                    id={inputId}
                    ref={(node) => {
                      refs.current.name = node;
                    }}
                    name="name"
                    data-testid="signup-name"
                    autoComplete="name"
                    autoCapitalize="words"
                    enterKeyHint="next"
                    required
                    value={values.name}
                    onChange={set('name')}
                    onBlur={checkOnBlur('name')}
                    placeholder="Maya Chen"
                    leadingIcon={<UserRound aria-hidden />}
                    aria-describedby={describedBy}
                    invalid={invalid}
                  />
                )}
              </Field>
              <Field
                label="Work email"
                error={errors.email}
                // A likely typo in the mail host ("gmial.com") is offered back. One press fixes it.
                hint={
                  hasEmailHint(values.email) ? (
                    <EmailHintLine
                      email={values.email}
                      onUse={(fixed) => {
                        setValues((current) => ({ ...current, email: fixed }));
                        setEmailTaken(false);
                        refs.current.email?.focus();
                      }}
                    />
                  ) : undefined
                }
              >
                {({ inputId, describedBy, invalid }) => (
                  <AuthInput
                    id={inputId}
                    ref={(node) => {
                      refs.current.email = node;
                    }}
                    name="email"
                    type="email"
                    data-testid="signup-email"
                    autoComplete="email"
                    inputMode="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    enterKeyHint="next"
                    required
                    value={values.email}
                    onChange={set('email')}
                    onBlur={checkOnBlur('email')}
                    placeholder="you@company.com"
                    leadingIcon={<Mail aria-hidden />}
                    aria-describedby={describedBy}
                    invalid={invalid || emailTaken}
                  />
                )}
              </Field>
              {/*
                The second door (review round 3): no password. We mail a 6 digit code, and that one
                code proves the address and signs the person in, now and every time after.
              */}
              {noPassword ? (
                <div className="flex flex-col gap-1 rounded-lg border border-border-default bg-sunken px-4 py-3" data-testid="signup-no-password">
                  <p className="text-sm font-semibold text-fg">No password needed</p>
                  <p className="text-sm text-fg-secondary">We email you a 6 digit code. You use a new code each time you sign in.</p>
                  <button
                    type="button"
                    data-testid="signup-use-password"
                    className="mt-1 inline-flex min-h-11 items-center self-start rounded-sm text-sm font-semibold text-fg-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    onClick={() => {
                      setNoPassword(false);
                      requestAnimationFrame(() => refs.current.password?.focus());
                    }}
                  >
                    Set a password instead
                  </button>
                </div>
              ) : null}
              {/* The checklist under the field states every rule up front and marks what is missing, so the error is not printed twice. */}
              {noPassword ? null : (
              <Field label="Password" error={errors.password} errorHidden={Boolean(errors.password) && isRulesIssue(values.password)}>
                {({ inputId, describedBy, invalid }) => (
                  <div className="flex flex-col gap-2">
                    <PasswordInput
                      id={inputId}
                      ref={(node) => {
                        refs.current.password = node;
                      }}
                      name="password"
                      data-testid="signup-password"
                      autoComplete="new-password"
                      enterKeyHint="next"
                      required
                      value={values.password}
                      onChange={set('password')}
                      onBlur={checkOnBlur('password')}
                      aria-describedby={[describedBy, `${inputId}-rules`].filter(Boolean).join(' ')}
                      invalid={invalid}
                    />
                    <StrengthMeter password={values.password} context={{ email: values.email, company: values.company }} />
                    <PasswordRules
                      password={values.password}
                      id={`${inputId}-rules`}
                      showMissing={Boolean(errors.password)}
                      context={{ email: values.email, company: values.company }}
                    />
                    <button
                      type="button"
                      data-testid="signup-email-code"
                      // 48 px tall to press, one line of text in the layout (`TAP_BUTTON`).
                      className={`${TAP_BUTTON} inline-flex items-center self-start rounded-sm text-sm font-semibold text-fg-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus`}
                      onClick={() => {
                        setNoPassword(true);
                        setErrors((current) => ({ ...current, password: undefined }));
                      }}
                    >
                      Email me a code instead
                    </button>
                  </div>
                )}
              </Field>
              )}
            </>
          ) : null}
          <Field label="Company or team" error={errors.company}>
            {({ inputId, describedBy, invalid }) => (
              <AuthInput
                id={inputId}
                ref={(node) => {
                  refs.current.company = node;
                }}
                name="organization"
                data-testid="signup-company"
                autoComplete="organization"
                autoCapitalize="words"
                enterKeyHint="go"
                required
                value={values.company}
                onChange={set('company')}
                onBlur={checkOnBlur('company')}
                placeholder="Northwind Robotics"
                leadingIcon={<Building2 aria-hidden />}
                aria-describedby={describedBy}
                invalid={invalid}
              />
            )}
          </Field>
          <SubmitButton data-testid="signup-submit" busyLabel={busy ? BUSY_LABEL[stage] : null}>
            {companyOnly ? 'Continue' : 'Create account'}
          </SubmitButton>
          <p className="sr-only" role="status" aria-live="polite">
            {busy ? BUSY_LABEL[stage] : ''}
          </p>
          {/* Quiet facts, nothing invented: no card to start, and who handles cards later. */}
          {!companyOnly ? (
            <p data-testid="signup-trust" className="flex items-start gap-2 text-xs text-fg-muted">
              <ShieldCheck aria-hidden className="mt-px size-3.5 shrink-0" />
              <span>No card needed to start. {BILLING_POLICY.payments}</span>
            </p>
          ) : null}
        </form>
        {!companyOnly ? <LegalLine urls={legal} lead="By creating an account" /> : null}
      </div>
      <p className="mt-7 text-center text-base text-fg-secondary">
        Already have an account?{' '}
        <Link href={signInHref} className="py-3.5 font-semibold text-fg-link hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
