'use client';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { Building2, Mail, UserRound } from 'lucide-react';
import { Button, Field, Input } from '@/components/ui';
import { organization, signUp } from '@/lib/auth-client';
import { safeNextPath } from '@/lib/routes';
import { slugWithSuffix, slugify } from '@/lib/slug';
import {
  AuthHeading,
  FormAlert,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PasswordInput,
  StrengthMeter,
  authErrorMessage,
} from '../_components/form-parts';

const ORG_NAME_MAX = 80;

const schema = z.object({
  name: z.string().trim().min(2, 'Enter your full name.').max(100, 'Use 100 characters or fewer.'),
  email: z.email('Enter a valid work email.'),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
    .max(PASSWORD_MAX_LENGTH, `Use ${PASSWORD_MAX_LENGTH} characters or fewer.`),
  company: z
    .string()
    .trim()
    .min(2, 'Enter your company or team name.')
    .max(ORG_NAME_MAX, `Use ${ORG_NAME_MAX} characters or fewer.`),
});

type FieldName = keyof z.infer<typeof schema>;
type Stage = 'idle' | 'account' | 'workspace';

const STAGE_LABEL: Readonly<Record<Stage, string>> = {
  idle: 'Create account',
  account: 'Creating your account…',
  workspace: 'Setting up your organization…',
};

/** Creates the org via Better Auth, retrying once with a suffixed slug on collision. */
async function createOrganization(name: string): Promise<boolean> {
  const base = slugify(name);
  const first = await organization.create({ name, slug: base });
  if (!first.error) {
    if (first.data) await organization.setActive({ organizationId: first.data.id });
    return true;
  }
  const retry = await organization.create({ name, slug: slugWithSuffix(base) });
  if (retry.error) return false;
  if (retry.data) await organization.setActive({ organizationId: retry.data.id });
  return true;
}

export function SignupForm({ next }: { readonly next: string | null }) {
  const router = useRouter();
  const [values, setValues] = useState({ name: '', email: '', password: '', company: '' });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>('idle');

  const set = (key: FieldName) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setValues((current) => ({ ...current, [key]: event.target.value }));

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const parsed = schema.safeParse({ ...values, email: values.email.trim() });
    if (!parsed.success) {
      const flat = z.flattenError(parsed.error).fieldErrors as Partial<Record<FieldName, string[]>>;
      setFieldErrors({
        name: flat.name?.[0],
        email: flat.email?.[0],
        password: flat.password?.[0],
        company: flat.company?.[0],
      });
      return;
    }
    setFieldErrors({});
    setStage('account');
    try {
      const result = await signUp.email({
        name: parsed.data.name,
        email: parsed.data.email,
        password: parsed.data.password,
      });
      if (result.error) {
        setError(authErrorMessage(result.error));
        setStage('idle');
        return;
      }
    } catch {
      setError('We couldn’t reach KitStak. Check your connection and try again.');
      setStage('idle');
      return;
    }

    setStage('workspace');
    try {
      await createOrganization(parsed.data.company);
    } catch {
      // The account exists and the user is signed in; the launcher offers org creation again.
    }
    router.replace(safeNextPath(next, '/'));
    router.refresh();
  };

  const pending = stage !== 'idle';
  return (
    <>
      <AuthHeading
        title="Create your KitStak account"
        subtitle="One account for CRM, WMS and everything next."
      />
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
        {error ? <FormAlert>{error}</FormAlert> : null}
        <Field label="Full name" error={fieldErrors.name}>
          {({ inputId, describedBy, invalid }) => (
            <Input
              id={inputId}
              size="lg"
              autoComplete="name"
              autoFocus
              value={values.name}
              onChange={set('name')}
              placeholder="Jordan Rivera"
              leadingIcon={<UserRound aria-hidden />}
              aria-describedby={describedBy}
              invalid={invalid}
            />
          )}
        </Field>
        <Field label="Work email" error={fieldErrors.email}>
          {({ inputId, describedBy, invalid }) => (
            <Input
              id={inputId}
              type="email"
              size="lg"
              autoComplete="email"
              value={values.email}
              onChange={set('email')}
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
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
        >
          {({ inputId, describedBy, invalid }) => (
            <div className="flex flex-col gap-2">
              <PasswordInput
                id={inputId}
                autoComplete="new-password"
                value={values.password}
                onChange={set('password')}
                aria-describedby={describedBy}
                invalid={invalid}
              />
              <StrengthMeter password={values.password} />
            </div>
          )}
        </Field>
        <Field label="Company or team" error={fieldErrors.company}>
          {({ inputId, describedBy, invalid }) => (
            <Input
              id={inputId}
              size="lg"
              autoComplete="organization"
              value={values.company}
              onChange={set('company')}
              placeholder="Acme Inc."
              leadingIcon={<Building2 aria-hidden />}
              aria-describedby={describedBy}
              invalid={invalid}
            />
          )}
        </Field>
        <Button type="submit" size="lg" fullWidth loading={pending}>
          {STAGE_LABEL[stage]}
        </Button>
      </form>
      <p className="mt-8 text-center text-base text-fg-secondary">
        Already have an account?{' '}
        <Link
          href={next ? `/login?next=${encodeURIComponent(next)}` : '/login'}
          className="font-semibold text-fg-link hover:underline"
        >
          Sign in
        </Link>
      </p>
    </>
  );
}
