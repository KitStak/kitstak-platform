'use client';
/**
 * The two forms of "My account" (review round 4): the name, and a first password for an account
 * that has none. Both call server actions, so a refused value is an answer the form shows, not a
 * failed request in the console.
 */
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Field, Input, Notice } from '@/components/ui';
import { signOut } from '@/lib/auth-client';
import { passwordIssue } from '@/features/signup/password-rules';
import { setPasswordAction, updateNameAction } from '@/server/account-actions';

const NO_NETWORK = 'We could not reach KitStak. Check your connection and try again.';

export function NameForm({ name }: { readonly name: string }) {
  const router = useRouter();
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setSaved(false);
    setPending(true);
    try {
      const result = await updateNameAction({ name: value });
      if (!result.ok) {
        setError(result.error ?? NO_NETWORK);
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError(NO_NETWORK);
    } finally {
      setPending(false);
    }
  };

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-start" data-testid="account-name-form">
      <div className="min-w-0 flex-1 sm:max-w-md">
        <Field label="Your full name" error={error} hint={saved ? 'Saved.' : 'Shown to your team in every KitStak app.'}>
          {({ inputId, describedBy, invalid }) => (
            <Input
              id={inputId}
              size="lg"
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                setSaved(false);
              }}
              autoComplete="name"
              maxLength={200}
              aria-invalid={invalid}
              aria-describedby={describedBy}
              data-testid="account-name"
            />
          )}
        </Field>
      </div>
      <Button type="submit" variant="secondary" size="lg" loading={pending} disabled={value.trim() === name.trim()} className="sm:mt-[22px]" data-testid="account-name-save">
        Save name
      </Button>
    </form>
  );
}

export function SetPasswordForm({ email }: { readonly email: string }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const issue = passwordIssue(password, { email });
    if (issue) {
      setError(issue);
      return;
    }
    setError(null);
    setNeedsSignIn(false);
    setPending(true);
    try {
      const result = await setPasswordAction({ password });
      if (!result.ok) {
        if (result.code === 'sign_in_again') setNeedsSignIn(true);
        else setError(result.error ?? NO_NETWORK);
        return;
      }
      setDone(true);
      setPassword('');
      router.refresh();
    } catch {
      setError(NO_NETWORK);
    } finally {
      setPending(false);
    }
  };

  const signInAgain = async () => {
    await signOut();
    window.location.assign(`/login?next=${encodeURIComponent('/settings/account#password')}`);
  };

  if (done) {
    return (
      <Notice tone="success" testId="account-password-set">
        Your password is saved. You can sign in with it, or with a code, from now on.
      </Notice>
    );
  }

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-3" data-testid="account-password-form">
      {/* Lets a password manager file the new password under the right account. */}
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1 sm:max-w-md">
          <Field label="New password" error={error} hint="Use 15 characters or more. Or 10 with a capital letter, a number and a symbol.">
            {({ inputId, describedBy, invalid }) => (
              <Input
                id={inputId}
                size="lg"
                type={visible ? 'text' : 'password'}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  if (error) setError(null);
                }}
                autoComplete="new-password"
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
                aria-invalid={invalid}
                aria-describedby={describedBy}
                data-testid="account-password"
              />
            )}
          </Field>
        </div>
        <Button type="submit" size="lg" loading={pending} className="sm:mt-[22px]" data-testid="account-password-save">
          Set a password
        </Button>
      </div>
      <label className="inline-flex min-h-11 w-fit items-center gap-2 text-sm text-fg-secondary">
        <input type="checkbox" checked={visible} onChange={(event) => setVisible(event.target.checked)} className="size-4" data-testid="account-password-show" />
        Show password
      </label>
      {needsSignIn ? (
        <Notice
          tone="warning"
          testId="account-sign-in-again"
          action={
            <Button variant="secondary" size="lg" onClick={() => void signInAgain()} data-testid="account-sign-in-again-button">
              Sign in again
            </Button>
          }
        >
          To keep your account safe, sign in again first. Then set your password.
        </Notice>
      ) : null}
    </form>
  );
}
