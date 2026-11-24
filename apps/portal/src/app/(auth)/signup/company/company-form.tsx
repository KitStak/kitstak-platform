'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Building2 } from 'lucide-react';
import { EmailText, Field } from '@/components/ui';
import { companyIssue } from '@/features/signup/fields';
import { signOut } from '@/lib/auth-client';
import { createWorkspaceAction } from '@/server/signup-actions';
import {
  AuthHeading,
  AuthInput,
  FormAlert,
  NO_NETWORK_MESSAGE,
  StepEyebrow,
  SubmitButton,
  TAP_BUTTON,
} from '../../_components/form-parts';

export function CompanyForm({ firstName, email }: { readonly firstName: string; readonly email: string }) {
  const router = useRouter();
  const [company, setCompany] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // Desktop only: on a phone the keyboard would cover the page before it is read.
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) input.current?.focus({ preventScroll: true });
  }, []);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current) return;
    setFormError(null);
    const issue = companyIssue(company);
    setFieldError(issue);
    if (issue) {
      input.current?.focus();
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      const result = await createWorkspaceAction({ company: company.trim(), handoff: {} });
      if (result.ok) {
        router.replace(result.next ?? '/signup/plan');
        return;
      }
      setFormError(result.error ?? 'We could not set up your workspace. Try again.');
    } catch {
      setFormError(NO_NETWORK_MESSAGE);
    }
    submitting.current = false;
    setBusy(false);
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
        eyebrow={<StepEyebrow step={1} total={2} label="Your workspace" />}
        title="Name your workspace"
        subtitle={firstName ? `Good to meet you, ${firstName}. What is your company or team called?` : 'What is your company or team called?'}
      />
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5" data-testid="company-form" aria-busy={busy}>
        {formError ? <FormAlert>{formError}</FormAlert> : null}
        <Field label="Company or team" error={fieldError} hint="You can change this later.">
          {({ inputId, describedBy, invalid }) => (
            <AuthInput
              id={inputId}
              ref={input}
              name="organization"
              data-testid="company-name"
              autoComplete="organization"
              autoCapitalize="words"
              enterKeyHint="go"
              required
              value={company}
              onChange={(event) => {
                setCompany(event.target.value);
                if (fieldError && !companyIssue(event.target.value)) setFieldError(null);
              }}
              placeholder="Northwind Robotics"
              leadingIcon={<Building2 aria-hidden />}
              aria-describedby={describedBy}
              invalid={invalid}
            />
          )}
        </Field>
        <SubmitButton data-testid="company-submit" busyLabel={busy ? 'Setting up your workspace…' : null}>
          Continue
        </SubmitButton>
      </form>
      <p className="mt-7 text-center text-base text-fg-secondary">
        Signed in as <EmailText email={email} className="font-medium text-fg" after="." />{' '}
        <button type="button" onClick={onSignOut} className={`${TAP_BUTTON} font-semibold text-fg-link hover:underline`}>
          Sign out
        </button>
      </p>
    </>
  );
}
