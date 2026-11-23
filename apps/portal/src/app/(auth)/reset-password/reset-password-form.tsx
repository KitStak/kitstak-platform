'use client';
import Link from 'next/link';
import { useId, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { CircleAlert, Mail } from 'lucide-react';
import { encodeHandoffIdentity } from '@kitstak/billing/handoff';
import { Badge, Field } from '@/components/ui';
import { emailIssue } from '@/features/signup/fields';
import { passwordIssue } from '@/features/signup/password-rules';
import { requestPasswordResetAction, resetPasswordAction } from '@/server/signup-actions';
import { CodeInput } from '../_components/code-input';
import { prefersAutoFocus, useHashIdentity } from '../_components/use-hash-identity';
import {
  AuthHeading,
  AuthInput,
  FormAlert,
  NO_NETWORK_MESSAGE,
  PasswordInput,
  PasswordRules,
  StrengthMeter,
  SubmitButton,
  TAP_BUTTON,
  TAP_LINK,
} from '../_components/form-parts';

type FieldName = 'email' | 'code' | 'password';

export interface ResetPasswordFormProps {
  /** True right after "Send code": show the neutral "we sent a code" line. */
  readonly justSent: boolean;
  readonly minutes: number;
  readonly devOutbox: boolean;
}

export function ResetPasswordForm({ justSent, minutes, devOutbox }: ResetPasswordFormProps) {
  const router = useRouter();
  const codeId = useId();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(
    justSent ? 'If that email has an account, we sent a 6 digit code.' : null,
  );
  const [busy, setBusy] = useState<'idle' | 'saving' | 'sending'>('idle');
  const submitting = useRef(false);
  const emailInput = useRef<HTMLInputElement | null>(null);
  const codeInput = useRef<HTMLInputElement | null>(null);
  const passwordInput = useRef<HTMLInputElement | null>(null);

  // The address rides after the "#" from the step before. It stays there, so a reload keeps it.
  useHashIdentity(
    (identity) => {
      if (identity.email) setEmail((current) => current || identity.email || '');
      if (prefersAutoFocus()) {
        (identity.email ? codeInput.current : emailInput.current)?.focus({ preventScroll: true });
      }
    },
    { strip: false },
  );

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current) return;
    setFormError(null);
    const issues: Partial<Record<FieldName, string>> = {};
    const emailProblem = emailIssue(email, 'Enter a valid email.');
    if (emailProblem) issues.email = emailProblem;
    if (code.length !== 6) issues.code = 'Enter the 6 digit code from your email.';
    const passwordProblem = passwordIssue(password, { email });
    if (passwordProblem) issues.password = passwordProblem;
    setErrors(issues);
    if (issues.email) return emailInput.current?.focus();
    if (issues.code) return codeInput.current?.focus();
    if (issues.password) return passwordInput.current?.focus();

    submitting.current = true;
    setBusy('saving');
    try {
      const result = await resetPasswordAction({ email: email.trim(), code, password });
      if (result.ok) {
        router.replace(result.next ?? '/login?notice=password-reset');
        router.refresh();
        return;
      }
      const message = result.error ?? 'Something went wrong. Please try again.';
      if (/code/i.test(message)) {
        setErrors({ code: message });
        codeInput.current?.focus();
        codeInput.current?.select();
      } else {
        setFormError(message);
      }
    } catch {
      setFormError(NO_NETWORK_MESSAGE);
    }
    submitting.current = false;
    setBusy('idle');
  };

  const sendAgain = async () => {
    if (submitting.current) return;
    const emailProblem = emailIssue(email, 'Enter a valid email.');
    if (emailProblem) {
      setErrors({ email: emailProblem });
      emailInput.current?.focus();
      return;
    }
    submitting.current = true;
    setBusy('sending');
    setFormError(null);
    try {
      const result = await requestPasswordResetAction({ email: email.trim() });
      if (result.ok) {
        setNotice('If that email has an account, we sent a new 6 digit code.');
        setCode('');
        setErrors({});
        codeInput.current?.focus();
      } else {
        setFormError(result.error ?? 'Something went wrong. Please try again.');
      }
    } catch {
      setFormError(NO_NETWORK_MESSAGE);
    }
    submitting.current = false;
    setBusy('idle');
  };

  return (
    <>
      <AuthHeading
        title="Choose a new password"
        subtitle={`Enter the code from your email, then your new password. The code works for ${minutes} minutes.`}
      />
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5" aria-busy={busy === 'saving'}>
        {notice ? <FormAlert tone="success">{notice}</FormAlert> : null}
        {formError ? <FormAlert>{formError}</FormAlert> : null}
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
        <Field label="Work email" error={errors.email}>
          {({ inputId, describedBy, invalid }) => (
            <AuthInput
              id={inputId}
              ref={emailInput}
              name="email"
              type="email"
              // Sits before the new password, so password managers save the pair together.
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
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <label htmlFor={codeId} className="text-xs font-medium text-fg-secondary">
              6 digit code
            </label>
            <button
              type="button"
              onClick={() => void sendAgain()}
              disabled={busy !== 'idle'}
              className={`${TAP_BUTTON} rounded-sm text-xs font-semibold text-fg-link hover:underline disabled:text-fg-muted disabled:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus`}
            >
              {busy === 'sending' ? 'Sending…' : 'Send a new code'}
            </button>
          </div>
          <CodeInput
            ref={codeInput}
            id={codeId}
            value={code}
            onChange={(value) => {
              setCode(value);
              if (errors.code) setErrors((current) => ({ ...current, code: undefined }));
            }}
            onComplete={() => passwordInput.current?.focus()}
            invalid={Boolean(errors.code)}
            describedBy={errors.code ? `${codeId}-error` : undefined}
          />
          {errors.code ? (
            <p id={`${codeId}-error`} role="alert" className="flex items-center gap-1 text-xs font-medium text-danger-text">
              <CircleAlert aria-hidden className="size-3.5 shrink-0" />
              {errors.code}
            </p>
          ) : null}
        </div>
        <Field label="New password" error={errors.password} hint={password ? undefined : 'At least 10 characters.'}>
          {({ inputId, describedBy, invalid }) => (
            <div className="flex flex-col gap-2">
              <PasswordInput
                id={inputId}
                ref={passwordInput}
                name="new-password"
                autoComplete="new-password"
                enterKeyHint="done"
                required
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  if (errors.password && !passwordIssue(event.target.value, { email })) {
                    setErrors((current) => ({ ...current, password: undefined }));
                  }
                }}
                aria-describedby={[describedBy, `${inputId}-rules`].filter(Boolean).join(' ')}
                invalid={invalid}
              />
              <StrengthMeter password={password} />
              <PasswordRules password={password} id={`${inputId}-rules`} />
            </div>
          )}
        </Field>
        <SubmitButton disabled={busy === 'sending'} busyLabel={busy === 'saving' ? 'Saving your new password…' : null}>
          Save new password
        </SubmitButton>
      </form>
      <p className="mt-7 text-center text-base text-fg-secondary">
        Remembered it?{' '}
        <Link
          href={email ? `/login#${encodeHandoffIdentity({ email })}` : '/login'}
          className="py-3.5 font-semibold text-fg-link hover:underline"
        >
          Sign in
        </Link>
      </p>
    </>
  );
}
