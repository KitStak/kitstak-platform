'use client';
/**
 * Invite link landing card (/welcome/invite/:id): join the organization, or a clear explanation
 * when the link can't be used (revoked, expired, sent to another address).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CircleAlert, Clock, Link2Off, LogOut, UserCheck, Users } from 'lucide-react';
import { Avatar, Button } from '@/components/ui';
import { organization, signOut } from '@/lib/auth-client';
import type { InviteAcceptState } from './model/invite-accept';
import { InlineError } from './components/primitives';

export interface InviteAcceptProps {
  readonly state: InviteAcceptState;
  readonly invitationId: string | null;
  readonly sessionEmail: string;
  readonly invitedEmailMasked?: string;
  readonly org?: { readonly name: string; readonly slug: string };
  readonly inviterName?: string;
  readonly roleLabel?: string;
}

const PROBLEMS: Readonly<Record<Exclude<InviteAcceptState, 'ready' | 'member'>, { title: string; body: string }>> = {
  invalid: { title: 'This invite link isn’t valid', body: 'Check that you copied the whole link, or ask your teammate to send a new one.' },
  revoked: { title: 'This invitation was withdrawn', body: 'Ask the person who invited you to send a new invitation.' },
  accepted: { title: 'This invitation was already used', body: 'If that was you, open KitStak to find your team.' },
  expired: { title: 'This invitation has expired', body: 'Invitations last 7 days. Ask the person who invited you for a new one.' },
  mismatch: { title: 'This invitation is for another address', body: '' },
};

export function InviteAccept({
  state,
  invitationId,
  sessionEmail,
  invitedEmailMasked,
  org,
  inviterName,
  roleLabel,
}: InviteAcceptProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<'join' | 'decline' | 'switch' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const switchAccount = async () => {
    setBusy('switch');
    try {
      await signOut();
    } finally {
      router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    }
  };

  if (state !== 'ready' || !invitationId || !org) {
    const problem = PROBLEMS[state === 'ready' || state === 'member' ? 'invalid' : state];
    const Icon = state === 'expired' ? Clock : state === 'mismatch' ? CircleAlert : Link2Off;
    return (
      <section className="flex flex-col gap-5" data-testid="invite-accept" data-state={state}>
        <span className="inline-flex size-12 items-center justify-center rounded-full bg-muted text-icon-strong">
          <Icon aria-hidden className="size-6" />
        </span>
        <div className="flex flex-col gap-2">
          <h1 className="font-heading text-2xl font-semibold text-fg [text-wrap:balance]">{problem.title}</h1>
          <p className="text-md text-fg-secondary [text-wrap:pretty]">
            {state === 'mismatch'
              ? `It was sent to ${invitedEmailMasked ?? 'a different email'}, but you’re signed in as ${sessionEmail}. Sign in with the invited address to join.`
              : problem.body}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {state === 'mismatch' ? (
            <Button size="lg" leadingIcon={<LogOut aria-hidden />} loading={busy === 'switch'} onClick={() => void switchAccount()}>
              Use a different account
            </Button>
          ) : null}
          <Button size="lg" variant={state === 'mismatch' ? 'secondary' : 'primary'} onClick={() => router.push('/')}>
            Open KitStak
          </Button>
        </div>
      </section>
    );
  }

  const join = async () => {
    setBusy('join');
    setError(null);
    const result = await organization.acceptInvitation({ invitationId });
    if (result.error) {
      setBusy(null);
      setError(result.error.message ?? 'We couldn’t accept the invitation. Please try again.');
      return;
    }
    await organization.setActive({ organizationSlug: org.slug }).catch(() => undefined);
    router.replace(`/${org.slug}`);
    router.refresh();
  };

  const decline = async () => {
    setBusy('decline');
    setError(null);
    const result = await organization.rejectInvitation({ invitationId });
    if (result.error) {
      setBusy(null);
      setError(result.error.message ?? 'We couldn’t decline the invitation. Please try again.');
      return;
    }
    router.replace('/welcome');
  };

  return (
    <section className="flex flex-col gap-6" data-testid="invite-accept" data-state="ready">
      <div className="flex items-center gap-3">
        <Avatar name={org.name} shape="square" size="xl" />
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-subtle px-2.5 py-1 text-sm font-medium text-primary-text">
          <Users aria-hidden className="size-3.5" />
          Team invitation
        </span>
      </div>
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-2xl font-semibold text-fg [text-wrap:balance]">Join {org.name} on KitStak</h1>
        <p className="text-md text-fg-secondary [text-wrap:pretty]">
          {inviterName ? `${inviterName} invited you` : 'You’ve been invited'} to join as {roleLabel?.toLowerCase().startsWith('a') ? 'an' : 'a'}{' '}
          <strong className="font-semibold text-fg">{roleLabel ?? 'Member'}</strong>. You’re signed in as {sessionEmail}.
        </p>
      </div>
      {error ? <InlineError onRetry={() => void join()}>{error}</InlineError> : null}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          size="lg"
          fullWidth
          leadingIcon={<UserCheck aria-hidden />}
          loading={busy === 'join'}
          disabled={busy !== null && busy !== 'join'}
          onClick={() => void join()}
          data-testid="invite-accept-join"
        >
          Join {org.name}
        </Button>
        <Button
          size="lg"
          variant="ghost"
          loading={busy === 'decline'}
          disabled={busy !== null && busy !== 'decline'}
          onClick={() => void decline()}
        >
          Decline
        </Button>
      </div>
    </section>
  );
}
