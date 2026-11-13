'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { Button, Field } from '@/components/ui';
import { changePassword, signOut } from '@/lib/auth-client';
import {
  AuthHeading,
  FormAlert,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PasswordInput,
  StrengthMeter,
  authErrorMessage,
} from '../_components/form-parts';

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Enter the password you were given.'),
    newPassword: z
      .string()
      .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
      .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters.`),
    confirmPassword: z.string(),
  })
  .refine((value) => value.newPassword !== value.currentPassword, {
    path: ['newPassword'],
    message: 'Choose a password that is different from the one you were given.',
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ['confirmPassword'],
    message: 'The two passwords do not match.',
  });

type FieldName = 'currentPassword' | 'newPassword' | 'confirmPassword';
type FieldErrors = Partial<Record<FieldName, string>>;

/** Friendly copy for the change-password errors the shared auth layer returns. */
function changeErrorMessage(error: { readonly code?: string; readonly message?: string; readonly status?: number }): string {
  if (error.code === 'INVALID_PASSWORD') return 'That is not the password you were given. Check it and try again.';
  return authErrorMessage(error);
}

export function ChangePasswordForm({
  email,
  returnTo,
}: {
  readonly email: string;
  /** Already validated on the server: a portal path or a sibling KitStak app URL. */
  readonly returnTo: string;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<FieldName, string>>({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const setField = (field: FieldName, value: string) => setValues((current) => ({ ...current, [field]: value }));

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      const flat = z.flattenError(parsed.error).fieldErrors;
      setFieldErrors({
        currentPassword: flat.currentPassword?.[0],
        newPassword: flat.newPassword?.[0],
        confirmPassword: flat.confirmPassword?.[0],
      });
      return;
    }
    setFieldErrors({});
    setPending(true);
    try {
      const result = await changePassword({
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword,
        // The password someone else knew must not leave any other session signed in.
        revokeOtherSessions: true,
      });
      if (result.error) {
        setError(changeErrorMessage(result.error));
        setPending(false);
        return;
      }
      // A full navigation: the destination may be another KitStak app.
      window.location.assign(returnTo);
    } catch {
      setError('We couldn’t reach KitStak. Check your connection and try again.');
      setPending(false);
    }
  };

  const onSignOut = async () => {
    try {
      await signOut();
    } finally {
      router.replace('/login?notice=signed-out');
      router.refresh();
    }
  };

  return (
    <>
      <AuthHeading
        title="Choose a new password"
        subtitle={
          <>
            Your account <span className="font-semibold text-fg">{email}</span> was set up with a temporary
            password. Replace it with one only you know to continue.
          </>
        }
      />
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
        {error ? <FormAlert>{error}</FormAlert> : null}
        <Field label="Temporary password" error={fieldErrors.currentPassword}>
          {({ inputId, describedBy, invalid }) => (
            <PasswordInput
              id={inputId}
              autoComplete="current-password"
              autoFocus
              value={values.currentPassword}
              onChange={(event) => setField('currentPassword', event.target.value)}
              aria-describedby={describedBy}
              invalid={invalid}
            />
          )}
        </Field>
        <Field
          label="New password"
          error={fieldErrors.newPassword}
          hint={`At least ${PASSWORD_MIN_LENGTH} characters, with an uppercase letter, a number and a symbol.`}
        >
          {({ inputId, describedBy, invalid }) => (
            <>
              <PasswordInput
                id={inputId}
                autoComplete="new-password"
                value={values.newPassword}
                onChange={(event) => setField('newPassword', event.target.value)}
                aria-describedby={describedBy}
                invalid={invalid}
              />
              <StrengthMeter password={values.newPassword} />
            </>
          )}
        </Field>
        <Field label="Confirm new password" error={fieldErrors.confirmPassword}>
          {({ inputId, describedBy, invalid }) => (
            <PasswordInput
              id={inputId}
              autoComplete="new-password"
              value={values.confirmPassword}
              onChange={(event) => setField('confirmPassword', event.target.value)}
              aria-describedby={describedBy}
              invalid={invalid}
            />
          )}
        </Field>
        <Button type="submit" size="lg" fullWidth loading={pending}>
          Save and continue
        </Button>
      </form>
      <p className="mt-8 text-center text-base text-fg-secondary">
        Not you?{' '}
        <button type="button" onClick={onSignOut} className="font-semibold text-fg-link hover:underline">
          Sign out
        </button>
      </p>
    </>
  );
}
