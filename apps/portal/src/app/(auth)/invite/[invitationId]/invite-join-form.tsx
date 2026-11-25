'use client';
/**
 * New to KitStak and invited: full name and a password. The email is the invited one, fixed and
 * shown. One server action makes the account and joins the team. It checks for a free seat first,
 * so a join that would be refused never leaves an account behind, and a person who came from the
 * invite email is not asked to verify that same address again. The form is a normal form with
 * `autocomplete="new-password"`, so password managers still offer to save.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Mail, UserRound } from 'lucide-react';
import { Field } from '@/components/ui';
import { nameIssue } from '@/features/signup/fields';
import { passwordIssue } from '@/features/signup/password-rules';
import { joinInviteAction } from '@/server/signup-actions';
import {
  AuthInput,
  FormAlert,
  NO_NETWORK_MESSAGE,
  PasswordInput,
  PasswordRules,
  StrengthMeter,
  SubmitButton,
  passwordFieldError,
} from '../../_components/form-parts';

type Stage = 'idle' | 'joining';

function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

export function InviteJoinForm({
  invitationId,
  email,
  orgName,
}: {
  readonly invitationId: string;
  readonly email: string;
  readonly orgName: string;
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ name?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const submitting = useRef(false);
  const nameInput = useRef<HTMLInputElement | null>(null);
  const passwordInput = useRef<HTMLInputElement | null>(null);
  // The password must not be built on the invited address or on the name of the team being joined.
  const passwordContext = { email, company: orgName };

  useEffect(() => {
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) nameInput.current?.focus({ preventScroll: true });
  }, []);

  const finish = () => {
    submitting.current = false;
    setStage('idle');
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current) return;
    setFormError(null);

    const issues = {
      name: nameIssue(name) ?? undefined,
      password: passwordIssue(password, passwordContext) ?? undefined,
    };
    setErrors(issues);
    if (issues.name) return nameInput.current?.focus();
    if (issues.password) return passwordInput.current?.focus();

    submitting.current = true;
    setStage('joining');
    try {
      const timezone = browserTimeZone();
      const result = await joinInviteAction({ invitationId, name: name.trim(), password, ...(timezone ? { timezone } : {}) });
      if (result.ok) {
        router.replace(result.next ?? '/');
        router.refresh();
        return;
      }
      if (result.field === 'name') {
        setErrors({ name: result.error });
        nameInput.current?.focus();
      } else if (result.field === 'password') {
        setErrors({ password: result.error });
        passwordInput.current?.focus();
      } else {
        setFormError(result.error ?? 'This invite is no longer active.');
        // The page itself has the right screen for these: "Sign in to accept", "no free seat" and
        // "open the link in your invite email".
        if (result.code === 'account_exists' || result.code === 'no_seat' || result.code === 'needs_invite_link') router.refresh();
      }
    } catch {
      setFormError(NO_NETWORK_MESSAGE);
    }
    finish();
  };

  const busy = stage !== 'idle';
  const busyLabel = stage === 'joining' ? `Joining ${orgName}…` : null;

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5" aria-busy={busy}>
      {formError ? <FormAlert>{formError}</FormAlert> : null}
      <Field label="Work email" hint="This is the address that was invited.">
        {({ inputId, describedBy }) => (
          <AuthInput
            id={inputId}
            name="email"
            type="email"
            autoComplete="email"
            readOnly
            value={email}
            leadingIcon={<Mail aria-hidden />}
            aria-describedby={describedBy}
            containerClassName="bg-muted"
            className="text-fg-secondary"
          />
        )}
      </Field>
      <Field label="Full name" error={errors.name}>
        {({ inputId, describedBy, invalid }) => (
          <AuthInput
            id={inputId}
            ref={nameInput}
            name="name"
            data-testid="invite-name"
            autoComplete="name"
            autoCapitalize="words"
            enterKeyHint="next"
            required
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (errors.name && !nameIssue(event.target.value)) setErrors((current) => ({ ...current, name: undefined }));
            }}
            placeholder="Sam Rivera"
            leadingIcon={<UserRound aria-hidden />}
            aria-describedby={describedBy}
            invalid={invalid}
          />
        )}
      </Field>
      {/* The same order as signup: the field, its meter, the red line, then the rules. */}
      <Field label="Password" error={errors.password} errorHidden>
        {({ inputId, describedBy, invalid }) => (
          <div className="flex flex-col gap-2">
            <PasswordInput
              id={inputId}
              ref={passwordInput}
              name="password"
              data-testid="invite-password"
              autoComplete="new-password"
              enterKeyHint="go"
              required
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                // After a refusal the sentence follows what is typed, so it is never about an older try.
                if (errors.password) {
                  const issue = passwordIssue(event.target.value, passwordContext) ?? undefined;
                  setErrors((current) => ({ ...current, password: issue }));
                }
              }}
              aria-describedby={[describedBy, `${inputId}-rules`].filter(Boolean).join(' ')}
              invalid={invalid}
            />
            <StrengthMeter password={password} context={passwordContext} />
            <PasswordRules
              password={password}
              id={`${inputId}-rules`}
              showMissing={Boolean(errors.password)}
              error={passwordFieldError(password, errors.password)}
              context={passwordContext}
            />
          </div>
        )}
      </Field>
      <SubmitButton data-testid="invite-accept" busyLabel={busyLabel}>
        Join {orgName}
      </SubmitButton>
      <p className="sr-only" role="status" aria-live="polite">
        {busyLabel ?? ''}
      </p>
    </form>
  );
}
