'use client';
/**
 * An invite opened without the link from the invite email (a copied link, a link from the CRM): the
 * page cannot know that the person owns the invited mailbox, so the join would be refused. This is
 * the way through on the same screen (review round 5): "Email me a code" mails a 6 digit code to
 * the invited address, and the code proves the mailbox.
 *
 *  - `mode="join"`: new to KitStak. A full name and the code make the account (no password) and
 *    join the team.
 *  - `mode="accept"`: signed in with the invited address, which was never verified. The code
 *    verifies it and the invite is accepted.
 */
import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { UserRound } from 'lucide-react';
import { EmailText, Field } from '@/components/ui';
import { nameIssue } from '@/features/signup/fields';
import { acceptInviteAction, joinInviteAction, requestInviteCodeAction } from '@/server/signup-actions';
import { CodeInput } from '../../_components/code-input';
import { AuthInput, FormAlert, NO_NETWORK_MESSAGE, OutboxHint, QuietRow, ROW_LINK, SubmitButton } from '../../_components/form-parts';

function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

export function InviteCodeDoor({
  invitationId,
  email,
  orgName,
  mode,
  devOutbox,
}: {
  readonly invitationId: string;
  readonly email: string;
  readonly orgName: string;
  readonly mode: 'join' | 'accept';
  /** Emails land in the dev outbox page (local dev only). */
  readonly devOutbox: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState<'ask' | 'code'>('ask');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<'idle' | 'sending' | 'joining'>('idle');
  const working = useRef(false);
  const nameInput = useRef<HTMLInputElement | null>(null);
  const codeInput = useRef<HTMLInputElement | null>(null);

  const sendCode = async () => {
    if (working.current) return;
    working.current = true;
    setBusy('sending');
    setFormError(null);
    setCodeError(null);
    setNotice(null);
    try {
      const result = await requestInviteCodeAction({ invitationId });
      if (result.ok || result.code === 'code_sent_recently') {
        // 'code_sent_recently': the last code is still fresh and still works. Say so, with the real wait.
        setNotice(result.ok ? null : (result.error ?? null));
        setCode('');
        setStep('code');
        window.setTimeout(() => (mode === 'join' && name.trim() === '' ? nameInput.current : codeInput.current)?.focus(), 0);
      } else {
        setFormError(result.error ?? 'This invite is no longer active.');
        // The page has its own screen for "Sign in to accept".
        if (result.code === 'account_exists') router.refresh();
      }
    } catch {
      setFormError(NO_NETWORK_MESSAGE);
    }
    working.current = false;
    setBusy('idle');
  };

  const join = async (value: string) => {
    if (working.current) return;
    setFormError(null);
    if (mode === 'join') {
      const issue = nameIssue(name) ?? undefined;
      setNameError(issue);
      if (issue) return nameInput.current?.focus();
    }
    if (value.length !== 6) {
      setCodeError('Enter the 6 digit code from your email.');
      return codeInput.current?.focus();
    }
    working.current = true;
    setBusy('joining');
    try {
      const timezone = browserTimeZone();
      const result =
        mode === 'join'
          ? await joinInviteAction({ invitationId, name: name.trim(), code: value, ...(timezone ? { timezone } : {}) })
          : await acceptInviteAction({ invitationId, code: value });
      if (result.ok) {
        router.replace(result.next ?? '/');
        router.refresh();
        return;
      }
      if (result.field === 'name') {
        setNameError(result.error);
        nameInput.current?.focus();
      } else if (result.code === 'account_exists' || result.code === 'no_seat') {
        setFormError(result.error ?? 'This invite is no longer active.');
        router.refresh();
      } else {
        setCodeError(result.error ?? 'That code is not right. Check it and try again.');
        setCode('');
        codeInput.current?.focus();
      }
    } catch {
      setFormError(NO_NETWORK_MESSAGE);
    }
    working.current = false;
    setBusy('idle');
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (step === 'ask') void sendCode();
    else void join(code);
  };

  if (step === 'ask') {
    return (
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4" aria-busy={busy !== 'idle'} data-testid="invite-code-door">
        {formError ? <FormAlert>{formError}</FormAlert> : null}
        <p className="text-base text-fg-secondary">
          First we check that <EmailText email={email} className="font-medium text-fg" /> is yours. We email a 6 digit code to that address.
        </p>
        <SubmitButton data-testid="invite-email-code" busyLabel={busy === 'sending' ? 'Sending your code…' : null}>
          Email me a code
        </SubmitButton>
      </form>
    );
  }

  const joining = busy === 'joining';
  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5" aria-busy={busy !== 'idle'} data-testid="invite-code-form">
      {formError ? <FormAlert>{formError}</FormAlert> : null}
      <p className="text-base text-fg-secondary" role="status" data-testid="invite-code-sent">
        {notice ?? (
          <>
            We sent a 6 digit code to <EmailText email={email} className="font-medium text-fg" after="." /> It works for 10 minutes.
          </>
        )}
      </p>
      {devOutbox ? <OutboxHint testId="invite-code-dev" /> : null}
      {mode === 'join' ? (
        <Field label="Full name" error={nameError}>
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
                if (nameError && !nameIssue(event.target.value)) setNameError(undefined);
              }}
              placeholder="Sam Rivera"
              leadingIcon={<UserRound aria-hidden />}
              aria-describedby={describedBy}
              invalid={invalid}
            />
          )}
        </Field>
      ) : null}
      <div className="flex flex-col gap-2">
        <label htmlFor="invite-code" className="text-xs font-medium text-fg-secondary">
          6 digit code
        </label>
        <CodeInput
          id="invite-code"
          ref={codeInput}
          testId="invite-code"
          value={code}
          onChange={(next) => {
            setCode(next);
            if (codeError) setCodeError(null);
          }}
          invalid={Boolean(codeError)}
          disabled={joining}
          describedBy={codeError ? 'invite-code-error' : undefined}
        />
        {codeError ? (
          <p id="invite-code-error" role="alert" className="text-xs font-medium text-danger-text">
            {codeError}
          </p>
        ) : null}
      </div>
      <SubmitButton data-testid="invite-accept" busyLabel={joining ? `Joining ${orgName}…` : null}>
        Join {orgName}
      </SubmitButton>
      <QuietRow lead="No email yet?">
        <button type="button" className={ROW_LINK} disabled={busy !== 'idle'} onClick={() => void sendCode()} data-testid="invite-code-resend">
          Send a new code
        </button>
      </QuietRow>
    </form>
  );
}
