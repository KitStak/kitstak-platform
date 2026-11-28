'use client';
/**
 * Invitations waiting for the person who is signed in. A workspace that only has Ledger has no
 * other screen to accept one on, so joining happens right here.
 */
import { useState } from 'react';
import { Button } from '@/components/ui';
import { organization } from '@/lib/auth-client';

export interface PendingInvitation {
  readonly id: string;
  readonly orgName: string;
  readonly inviterName: string | null;
}

export function JoinInvitations({ invitations }: { readonly invitations: readonly PendingInvitation[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const join = async (invitation: PendingInvitation): Promise<void> => {
    setBusy(invitation.id);
    setError(null);
    try {
      const result = await organization.acceptInvitation({ invitationId: invitation.id });
      if (result.error) {
        setError(result.error.message ?? `We could not add you to ${invitation.orgName}. Ask for a new invitation.`);
        setBusy(null);
        return;
      }
      // A full reload: the session now has an organization, and this page sends a member on to Home.
      window.location.reload();
    } catch {
      setError('We could not reach KitStak. Check your connection and try again.');
      setBusy(null);
    }
  };

  return (
    <ul className="mt-6 flex flex-col gap-3 text-left" data-testid="join-invitations">
      {invitations.map((invitation) => (
        <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-subtle bg-sunken px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-fg">{invitation.orgName}</p>
            <p className="text-sm text-fg-secondary">{invitation.inviterName ? `${invitation.inviterName} invited you.` : 'You were invited.'}</p>
          </div>
          <Button loading={busy === invitation.id} disabled={busy !== null && busy !== invitation.id} onClick={() => void join(invitation)} data-testid={`join-${invitation.id}`}>
            Join
          </Button>
        </li>
      ))}
      {error ? (
        <li role="alert" className="rounded-lg border border-danger/40 bg-danger-subtle px-3 py-2.5 text-sm text-danger-text">
          {error}
        </li>
      ) : null}
    </ul>
  );
}
