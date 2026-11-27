'use client';
/**
 * Settings, API tokens: the form that makes a token (and shows it once), and the revoke button.
 * Both call server actions, so a refused value is an answer on the page, not a failed request.
 */
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Checkbox, Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle, Field, Input, Notice, Select } from '@/components/ui';
import { signOut } from '@/lib/auth-client';
import { createApiTokenAction, revokeApiTokenAction } from '@/server/api-token-actions';
import { DEFAULT_TOKEN_DAYS, TOKEN_APP_LABELS, TOKEN_DAY_CHOICES, type TokenAccess, type TokenApp } from './token-model';

const NO_NETWORK = 'We could not reach KitStak. Check your connection and try again.';
const PAGE = '/settings/api-tokens';

export function CreateTokenForm({ apps }: { readonly apps: readonly TokenApp[] }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<readonly TokenApp[]>(apps);
  const [access, setAccess] = useState<TokenAccess>('read');
  const [days, setDays] = useState(DEFAULT_TOKEN_DAYS);
  const [error, setError] = useState<{ readonly message: string; readonly field?: string } | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [pending, setPending] = useState(false);
  const [made, setMade] = useState<{ readonly token: string; readonly name: string } | null>(null);

  const toggle = (app: TokenApp, on: boolean) => setPicked((now) => (on ? [...now.filter((a) => a !== app), app] : now.filter((a) => a !== app)));

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setNeedsSignIn(false);
    setPending(true);
    try {
      // Only apps the page still offers: a plan change since the page loaded can drop one.
      const result = await createApiTokenAction({ name, apps: picked.filter((app) => apps.includes(app)), access, days });
      if (!result.ok || !result.token) {
        if (result.code === 'sign_in_again') setNeedsSignIn(true);
        else setError({ message: result.error ?? NO_NETWORK, field: result.field });
        return;
      }
      setMade({ token: result.token, name: name.trim() });
      setName('');
      router.refresh();
    } catch {
      setError({ message: NO_NETWORK });
    } finally {
      setPending(false);
    }
  };

  const signInAgain = async () => {
    await signOut();
    router.replace(`/login?next=${encodeURIComponent(PAGE)}`);
    router.refresh();
  };

  if (made) return <NewTokenPanel token={made.token} name={made.name} onDone={() => setMade(null)} />;

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4" data-testid="api-token-form">
      <Field label="Name" error={error?.field === 'name' ? error.message : null} hint="So you know what uses it. For example: Claude migration.">
        {({ inputId, describedBy, invalid }) => (
          <Input id={inputId} size="lg" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-invalid={invalid} aria-describedby={describedBy} data-testid="api-token-name" />
        )}
      </Field>

      <fieldset className="flex flex-col gap-2" aria-describedby="api-token-apps-hint">
        <legend className="text-sm font-medium text-fg">Apps</legend>
        <div className="flex flex-wrap gap-4">
          {apps.map((app) => (
            <Checkbox key={app} label={TOKEN_APP_LABELS[app]} checked={picked.includes(app)} onChange={(e) => toggle(app, e.target.checked)} data-testid={`api-token-app-${app}`} />
          ))}
        </div>
        <p id="api-token-apps-hint" className={error?.field === 'apps' ? 'text-sm text-danger-text' : 'text-sm text-fg-secondary'}>
          {error?.field === 'apps' ? error.message : 'Only the apps your plan includes.'}
        </p>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Access" hint="A token never does more than you can do yourself.">
          {({ inputId, describedBy }) => (
            <Select id={inputId} size="lg" value={access} onChange={(e) => setAccess(e.target.value === 'write' ? 'write' : 'read')} aria-describedby={describedBy} data-testid="api-token-access">
              <option value="read">Read only</option>
              <option value="write">Read and change</option>
            </Select>
          )}
        </Field>
        <Field label="Lasts" error={error?.field === 'days' ? error.message : null}>
          {({ inputId, describedBy, invalid }) => (
            <Select id={inputId} size="lg" value={String(days)} onChange={(e) => setDays(Number(e.target.value))} aria-invalid={invalid} aria-describedby={describedBy} data-testid="api-token-days">
              {TOKEN_DAY_CHOICES.map((choice) => (
                <option key={choice} value={choice}>
                  {choice} days
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      {error && !error.field ? (
        <Notice tone="danger" role="alert" testId="api-token-error">
          {error.message}
        </Notice>
      ) : null}
      {needsSignIn ? (
        <Notice
          tone="warning"
          testId="api-token-sign-in-again"
          action={
            <Button type="button" variant="secondary" size="lg" onClick={() => void signInAgain()}>
              Sign in again
            </Button>
          }
        >
          To keep your account safe, sign in again first. Then make the token.
        </Notice>
      ) : null}

      <div>
        <Button type="submit" variant="primary" size="lg" loading={pending} disabled={name.trim() === '' || picked.length === 0} data-testid="api-token-create">
          Make token
        </Button>
      </div>
    </form>
  );
}

function NewTokenPanel({ token, name, onDone }: { readonly token: string; readonly name: string; readonly onDone: () => void }) {
  const [copy, setCopy] = useState<'idle' | 'copied' | 'blocked'>('idle');
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(token);
      setCopy('copied');
    } catch {
      setCopy('blocked');
    }
  };
  return (
    <div className="flex flex-col gap-3" data-testid="api-token-new">
      <Notice tone="warning" role="status">
        Copy &quot;{name}&quot; now. You will not see it again. Keep it as safe as a password.
      </Notice>
      <div className="flex flex-col gap-2 sm:flex-row">
        {/* Focus moves here when the form is replaced, so keyboard users land on the token. */}
        <Input size="lg" readOnly autoFocus value={token} onFocus={(e) => e.target.select()} aria-label="Your new API token" className="font-mono" data-testid="api-token-value" />
        <Button type="button" variant="secondary" size="lg" onClick={() => void onCopy()} data-testid="api-token-copy">
          {copy === 'copied' ? 'Copied' : 'Copy'}
        </Button>
      </div>
      {copy === 'blocked' ? (
        <p className="text-sm text-fg-secondary" role="status">
          Your browser did not let us copy it. Click the token and press Ctrl+C (Cmd+C on a Mac).
        </p>
      ) : null}
      <div>
        <Button type="button" variant="ghost" size="lg" onClick={onDone} data-testid="api-token-done">
          Done
        </Button>
      </div>
    </div>
  );
}

export function RevokeTokenButton({ tokenId, name }: { readonly tokenId: string; readonly name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const revoke = async () => {
    setPending(true);
    setError(null);
    try {
      const result = await revokeApiTokenAction({ tokenId });
      if (!result.ok) {
        setError(result.error ?? NO_NETWORK);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError(NO_NETWORK);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setError(null);
      }}
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          setError(null);
          setOpen(true);
        }} data-testid={`api-token-revoke-${tokenId}`}>
        Revoke
      </Button>
      <DialogContent size="sm">
        <DialogTitle>Revoke &quot;{name}&quot;?</DialogTitle>
        <DialogDescription>Anything using this token stops working right away. This cannot be undone; make a new token if you need one.</DialogDescription>
        {error ? (
          <Notice tone="danger" role="alert">
            {error}
          </Notice>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="ghost" size="lg" onClick={() => setOpen(false)}>
            Keep it
          </Button>
          <Button type="button" variant="danger" size="lg" loading={pending} onClick={() => void revoke()} data-testid="api-token-revoke-confirm">
            Revoke token
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
