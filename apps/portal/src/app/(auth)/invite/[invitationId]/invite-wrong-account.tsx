'use client';
import { useState } from 'react';
import { Button, EmailText } from '@/components/ui';
import { signOut } from '@/lib/auth-client';
import { FormAlert } from '../../_components/form-parts';

/** Signed in with a different address than the one invited. Says so, and offers the way out. */
export function InviteWrongAccount({
  invitedEmail,
  signedInEmail,
  invitePath,
}: {
  readonly invitedEmail: string;
  readonly signedInEmail: string;
  readonly invitePath: string;
}) {
  const [busy, setBusy] = useState(false);
  const signOutAndReturn = async () => {
    setBusy(true);
    try {
      await signOut();
    } finally {
      // A full page load: the invite page is then read with no session at all.
      window.location.assign(invitePath);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <FormAlert tone="info">
        This invite is for <EmailText email={invitedEmail} className="font-semibold" after="." /> Sign out and open the
        link again.
      </FormAlert>
      <p className="text-sm text-fg-muted">
        You are signed in as <EmailText email={signedInEmail} className="font-medium text-fg-secondary" after="." />
      </p>
      <Button size="lg" fullWidth className="h-12 sm:h-11" loading={busy} onClick={() => void signOutAndReturn()}>
        Sign out and open the invite
      </Button>
    </div>
  );
}
