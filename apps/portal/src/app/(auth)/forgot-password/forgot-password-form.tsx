'use client';
import Link from 'next/link';
import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Mail } from 'lucide-react';
import { encodeHandoffIdentity } from '@kitstak/billing/handoff';
import { Field } from '@/components/ui';
import { emailIssue } from '@/features/signup/fields';
import { requestPasswordResetAction } from '@/server/signup-actions';
import { AuthHeading, AuthInput, FormAlert, NO_NETWORK_MESSAGE, SubmitButton } from '../_components/form-parts';
import { prefersAutoFocus, useHashIdentity } from '../_components/use-hash-identity';

export function ForgotPasswordForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const input = useRef<HTMLInputElement | null>(null);

  // The sign in page passes along the address the person already typed, after the "#".
  useHashIdentity((identity) => {
    if (identity.email) setEmail((current) => current || identity.email || '');
    if (prefersAutoFocus()) input.current?.focus({ preventScroll: true });
  });

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current) return;
    setFormError(null);
    const issue = emailIssue(email, 'Enter a valid email.');
    setFieldError(issue);
    if (issue) {
      input.current?.focus();
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      const result = await requestPasswordResetAction({ email: email.trim() });
      if (result.ok) {
        // The address rides after the "#": it never reaches a server log.
        router.push(`/reset-password?sent=1#${encodeHandoffIdentity({ email: email.trim() })}`);
        return;
      }
      setFormError(result.error ?? 'Something went wrong. Please try again.');
    } catch {
      setFormError(NO_NETWORK_MESSAGE);
    }
    submitting.current = false;
    setBusy(false);
  };

  return (
    <>
      <AuthHeading title="Reset your password" subtitle="Enter your email. We will send you a 6 digit code." />
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5" aria-busy={busy}>
        {formError ? <FormAlert>{formError}</FormAlert> : null}
        <Field label="Work email" error={fieldError}>
          {({ inputId, describedBy, invalid }) => (
            <AuthInput
              id={inputId}
              ref={input}
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="send"
              required
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                if (fieldError && !emailIssue(event.target.value)) setFieldError(null);
              }}
              placeholder="you@company.com"
              leadingIcon={<Mail aria-hidden />}
              aria-describedby={describedBy}
              invalid={invalid}
            />
          )}
        </Field>
        <SubmitButton busyLabel={busy ? 'Sending your code…' : null}>Send code</SubmitButton>
      </form>
      <p className="mt-7 text-center text-base text-fg-secondary">
        <Link href="/login" className="-my-3.5 inline-flex items-center gap-1.5 py-3.5 font-semibold text-fg-link hover:underline">
          <ArrowLeft aria-hidden className="size-4" />
          Back to sign in
        </Link>
      </p>
    </>
  );
}
