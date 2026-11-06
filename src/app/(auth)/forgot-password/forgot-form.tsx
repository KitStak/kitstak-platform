'use client';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { ArrowLeft, Mail, MailCheck } from 'lucide-react';
import { Button, Field, Input } from '@/components/ui';
import { authClient } from '@/lib/auth-client';
import { AuthHeading, FormAlert, authErrorMessage } from '../_components/form-parts';

const emailSchema = z.email('Enter a valid email address.');

export function ForgotForm() {
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const parsed = emailSchema.safeParse(email.trim());
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? 'Enter a valid email address.');
      return;
    }
    setFieldError(null);
    setPending(true);
    try {
      const result = await authClient.requestPasswordReset({
        email: parsed.data,
        redirectTo: '/reset-password',
      });
      if (result.error) {
        setError(
          result.error.code === 'RESET_PASSWORD_DISABLED'
            ? 'Password reset by email isn’t available on this server yet. Ask your KitStak administrator to reset your password.'
            : authErrorMessage(result.error),
        );
      } else {
        // Same response whether or not the account exists (no account enumeration).
        setSentTo(parsed.data);
      }
    } catch {
      setError('We couldn’t reach KitStak. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  };

  if (sentTo) {
    return (
      <div className="flex flex-col gap-6">
        <span className="inline-flex size-12 items-center justify-center rounded-xl bg-success-subtle text-success-text">
          <MailCheck aria-hidden className="size-6" />
        </span>
        <AuthHeading
          title="Check your inbox"
          subtitle={
            <>
              If an account exists for <strong className="font-semibold text-fg">{sentTo}</strong>,
              you&apos;ll get an email with a link to reset your password. The link expires in 1 hour.
            </>
          }
        />
        <div className="flex flex-col gap-3">
          <Button variant="secondary" size="lg" fullWidth onClick={() => setSentTo(null)}>
            Use a different email
          </Button>
          <Link
            href="/login"
            className="inline-flex items-center justify-center gap-1.5 text-base font-semibold text-fg-link hover:underline"
          >
            <ArrowLeft aria-hidden className="size-4" /> Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <AuthHeading
        title="Reset your password"
        subtitle="Enter the email you use for KitStak and we’ll send you a reset link."
      />
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
        {error ? <FormAlert>{error}</FormAlert> : null}
        <Field label="Work email" error={fieldError}>
          {({ inputId, describedBy, invalid }) => (
            <Input
              id={inputId}
              type="email"
              size="lg"
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
              leadingIcon={<Mail aria-hidden />}
              aria-describedby={describedBy}
              invalid={invalid}
            />
          )}
        </Field>
        <Button type="submit" size="lg" fullWidth loading={pending}>
          Send reset link
        </Button>
      </form>
      <p className="mt-8 text-center">
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-base font-semibold text-fg-link hover:underline"
        >
          <ArrowLeft aria-hidden className="size-4" /> Back to sign in
        </Link>
      </p>
    </>
  );
}
