'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { Mail } from 'lucide-react';
import { HandoffScreen } from '@kitstak/ui/handoff';
import { Button, Checkbox, Field, Input } from '@/components/ui';
import { signIn } from '@/lib/auth-client';
import { safeNextPath } from '@/lib/routes';
import { AuthHeading, FormAlert, PasswordInput, authErrorMessage } from '../_components/form-parts';

const schema = z.object({
  email: z.email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

type FieldErrors = Partial<Record<'email' | 'password', string>>;

export function LoginForm({
  next,
  notice,
  portalUrl,
  resetUrl,
}: {
  readonly next: string | null;
  readonly notice: string | null;
  readonly portalUrl: string;
  readonly resetUrl: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const parsed = schema.safeParse({ email: email.trim(), password });
    if (!parsed.success) {
      const flat = z.flattenError(parsed.error).fieldErrors;
      setFieldErrors({ email: flat.email?.[0], password: flat.password?.[0] });
      return;
    }
    setFieldErrors({});
    setPending(true);
    try {
      const result = await signIn.email({ email: parsed.data.email, password: parsed.data.password, rememberMe: remember });
      if (result.error) {
        setError(authErrorMessage(result.error));
        setPending(false);
        return;
      }
      router.replace(safeNextPath(next, '/'));
      router.refresh();
    } catch {
      setError('We couldn’t reach KitStak. Check your connection and try again.');
      setPending(false);
    }
  };

  return (
    <>
      {pending ? <HandoffScreen title="Signing you in" detail="Opening your projects and tasks" /> : null}
      <AuthHeading title="Welcome back" subtitle="Sign in to see your projects and tasks." />
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
        {notice ? <FormAlert tone="success">{notice}</FormAlert> : null}
        {error ? <FormAlert>{error}</FormAlert> : null}
        <Field label="Work email" error={fieldErrors.email}>
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
        <Field
          label="Password"
          error={fieldErrors.password}
          labelAside={
            <a href={resetUrl} className="text-sm font-medium text-fg-link hover:underline">
              Forgot password?
            </a>
          }
        >
          {({ inputId, describedBy, invalid }) => (
            <PasswordInput
              id={inputId}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-describedby={describedBy}
              invalid={invalid}
            />
          )}
        </Field>
        <Checkbox label="Keep me signed in" checked={remember} onCheckedChange={(value) => setRemember(value === true)} />
        <Button type="submit" size="lg" fullWidth loading={pending}>
          Sign in
        </Button>
      </form>
      <p className="mt-8 text-center text-base text-fg-secondary">
        New to KitStak?{' '}
        <a href={`${portalUrl}/signup`} className="font-semibold text-fg-link hover:underline">
          Create an account
        </a>
      </p>
    </>
  );
}
