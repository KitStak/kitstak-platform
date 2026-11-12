'use client';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Field } from '@/components/ui';
import { authClient } from '@/lib/auth-client';
import {
  AuthHeading,
  FormAlert,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PasswordInput,
  StrengthMeter,
  authErrorMessage,
} from '../_components/form-parts';

export function ResetForm({
  token,
  linkError,
}: {
  readonly token: string | null;
  readonly linkError: boolean;
}) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!token || linkError) {
    return (
      <>
        <AuthHeading
          title="This link has expired"
          subtitle="Reset links work once and expire after an hour. Request a fresh one."
        />
        <Link
          href="/forgot-password"
          className="inline-flex h-10 w-full items-center justify-center rounded-sm bg-primary px-4 text-md font-medium text-primary-fg hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          Request a new link
        </Link>
      </>
    );
  }

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const next: { password?: string; confirm?: string } = {};
    if (password.length < PASSWORD_MIN_LENGTH)
      next.password = `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
    else if (password.length > PASSWORD_MAX_LENGTH)
      next.password = `Use ${PASSWORD_MAX_LENGTH} characters or fewer.`;
    if (confirm !== password) next.confirm = 'Passwords don’t match.';
    setErrors(next);
    if (next.password || next.confirm) return;
    setPending(true);
    try {
      const result = await authClient.resetPassword({ newPassword: password, token });
      if (result.error) {
        setError(authErrorMessage(result.error));
        setPending(false);
        return;
      }
      router.replace('/login?notice=password-reset');
    } catch {
      setError('We couldn’t reach KitStak. Check your connection and try again.');
      setPending(false);
    }
  };

  return (
    <>
      <AuthHeading
        title="Choose a new password"
        subtitle="You’ll be signed out of other devices for your security."
      />
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
        {error ? <FormAlert>{error}</FormAlert> : null}
        <Field
          label="New password"
          error={errors.password}
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
        >
          {({ inputId, describedBy, invalid }) => (
            <div className="flex flex-col gap-2">
              <PasswordInput
                id={inputId}
                autoFocus
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-describedby={describedBy}
                invalid={invalid}
              />
              <StrengthMeter password={password} />
            </div>
          )}
        </Field>
        <Field label="Confirm password" error={errors.confirm}>
          {({ inputId, describedBy, invalid }) => (
            <PasswordInput
              id={inputId}
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              aria-describedby={describedBy}
              invalid={invalid}
            />
          )}
        </Field>
        <Button type="submit" size="lg" fullWidth loading={pending}>
          Update password
        </Button>
      </form>
    </>
  );
}
