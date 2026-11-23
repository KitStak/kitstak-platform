'use client';
/**
 * New to KitStak and invited: full name and a password. The email is the invited one, fixed and
 * shown. The account is made in the browser (so password managers offer to save), then the invite
 * is accepted and the person lands on their team's launcher.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Mail, UserRound } from 'lucide-react';
import { Field } from '@/components/ui';
import { nameIssue } from '@/features/signup/fields';
import { passwordIssue } from '@/features/signup/password-rules';
import { signUp } from '@/lib/auth-client';
import { acceptInviteAction } from '@/server/signup-actions';
import {
  AuthInput,
  FormAlert,
  NO_NETWORK_MESSAGE,
  PasswordInput,
  PasswordRules,
  StrengthMeter,
  SubmitButton,
  authErrorMessage,
  isEmailTaken,
} from '../../_components/form-parts';

type Stage = 'idle' | 'account' | 'joining';

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
  /** The account was made but joining failed: the next press only retries the join. */
  const accountMade = useRef(false);
  const submitting = useRef(false);
  const nameInput = useRef<HTMLInputElement | null>(null);
  const passwordInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) nameInput.current?.focus({ preventScroll: true });
  }, []);

  const join = async (): Promise<boolean> => {
    setStage('joining');
    try {
      const result = await acceptInviteAction({ invitationId });
      if (result.ok) {
        router.replace(result.next ?? '/');
        router.refresh();
        return true;
      }
      setFormError(result.error ?? 'This invite is no longer active.');
    } catch {
      setFormError(NO_NETWORK_MESSAGE);
    }
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

    if (accountMade.current) {
      submitting.current = true;
      if (!(await join())) finish();
      return;
    }

    const issues = {
      name: nameIssue(name) ?? undefined,
      password: passwordIssue(password, { email }) ?? undefined,
    };
    setErrors(issues);
    if (issues.name) return nameInput.current?.focus();
    if (issues.password) return passwordInput.current?.focus();

    submitting.current = true;
    setStage('account');
    try {
      const timezone = browserTimeZone();
      const result = await signUp.email({ name: name.trim(), email, password, ...(timezone ? { timezone } : {}) });
      if (result.error) {
        if (isEmailTaken(result.error)) {
          // Someone made this account a moment ago. A reload shows "Sign in to accept".
          router.refresh();
          setFormError('An account with this email already exists. Sign in to accept the invite.');
        } else if (result.error.code?.startsWith('PASSWORD_')) {
          setErrors({ password: authErrorMessage(result.error) });
          passwordInput.current?.focus();
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
    accountMade.current = true;
    if (!(await join())) finish();
  };

  const busy = stage !== 'idle';
  const busyLabel = stage === 'account' ? 'Creating your account…' : stage === 'joining' ? `Joining ${orgName}…` : null;

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
      <Field label="Password" error={errors.password} hint={password ? undefined : 'At least 10 characters.'}>
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
      <SubmitButton data-testid="invite-accept" busyLabel={busyLabel}>
        Join {orgName}
      </SubmitButton>
      <p className="sr-only" role="status" aria-live="polite">
        {busyLabel ?? ''}
      </p>
    </form>
  );
}
