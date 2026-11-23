'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { acceptInviteAction } from '@/server/signup-actions';
import { FormAlert, NO_NETWORK_MESSAGE, SubmitButton } from '../../_components/form-parts';

/** Signed in with the invited address: one button. */
export function InviteAccept({
  invitationId,
  orgName,
  email,
}: {
  readonly invitationId: string;
  readonly orgName: string;
  readonly email: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);

  const accept = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await acceptInviteAction({ invitationId });
      if (result.ok) {
        router.replace(result.next ?? '/');
        router.refresh();
        return;
      }
      setError(result.error ?? 'This invite is no longer active.');
    } catch {
      setError(NO_NETWORK_MESSAGE);
    }
    working.current = false;
    setBusy(false);
  };

  return (
    <form onSubmit={accept} className="flex flex-col gap-4" aria-busy={busy}>
      {error ? <FormAlert>{error}</FormAlert> : null}
      <p className="text-base text-fg-secondary">
        You are signed in as <span className="font-medium break-all text-fg">{email}</span>.
      </p>
      <SubmitButton data-testid="invite-accept" busyLabel={busy ? `Joining ${orgName}…` : null}>
        Accept invite
      </SubmitButton>
    </form>
  );
}
