import type { Metadata } from 'next';
import { and, eq } from 'drizzle-orm';
import { MailX, UsersRound } from 'lucide-react';
import { formatDay } from '@kitstak/billing/catalog';
import { member } from '@kitstak/db/schema';
import { EmailText, LinkButton } from '@/components/ui';
import { db } from '@/server/db';
import { getSession } from '@/server/session';
import { devOutboxOn, getInviteViewOnce, inviteProofValid } from '@/server/signup';
import { AuthHeading } from '../../_components/heading';
import { InviteAccept } from './invite-accept';
import { InviteCodeDoor } from './invite-code-door';
import { InviteJoinForm } from './invite-join-form';
import { InviteWrongAccount } from './invite-wrong-account';

export const metadata: Metadata = { title: 'Join your team' };

function Icon({ tone }: { readonly tone: 'info' | 'muted' }) {
  return tone === 'info' ? (
    <span className="mb-5 flex size-11 items-center justify-center rounded-full bg-info-subtle text-info-text">
      <UsersRound aria-hidden className="size-5" />
    </span>
  ) : (
    <span className="mb-5 flex size-11 items-center justify-center rounded-full bg-sunken text-fg-muted">
      <MailX aria-hidden className="size-5" />
    </span>
  );
}

async function isMember(orgId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)))
    .limit(1);
  return rows[0] !== undefined && !rows[0].role.startsWith('deactivated:');
}

/**
 * Accept an invitation (docs/billing/SPEC.md section 5.5). Shows the team, who invited you and your
 * role. Invited people never see the app picker or a price: after accepting they land on the
 * launcher of the team they joined.
 */
export default async function InvitePage({
  params,
}: {
  readonly params: Promise<{ invitationId: string }>;
}) {
  const { invitationId } = await params;
  const [view, session] = await Promise.all([getInviteViewOnce(invitationId), getSession()]);

  if (!view) {
    return (
      <>
        <Icon tone="muted" />
        <AuthHeading
          title="This invite link does not work"
          subtitle="The link may be cut short. Open it again from your email, or ask your team to send a new invite."
        />
        <LinkButton href={session ? '/' : '/login'} size="lg" fullWidth className="h-12 sm:h-11">
          {session ? 'Open KitStak' : 'Go to sign in'}
        </LinkButton>
      </>
    );
  }

  if (view.status !== 'pending') {
    // A used invite that this very person accepted: they are in. Take them home.
    const joined = session ? await isMember(view.orgId, session.user.id) : false;
    return (
      <>
        <Icon tone={joined ? 'info' : 'muted'} />
        <AuthHeading
          title={joined ? `You are already on ${view.orgName}` : 'This invite is no longer active'}
          subtitle={
            joined ? 'This invite was used. You are all set.' : `Ask ${view.inviterName} to send a new one.`
          }
        />
        <LinkButton href={session ? '/' : '/login'} size="lg" fullWidth className="h-12 sm:h-11">
          {session ? 'Open KitStak' : 'Go to sign in'}
        </LinkButton>
      </>
    );
  }

  // The team's plan has no room for this person. Say so before anyone types a name or a password,
  // so nobody makes an account they cannot use. Nothing is created on this screen.
  if (!view.seatAvailable) {
    const alreadyIn = session ? await isMember(view.orgId, session.user.id) : false;
    if (!alreadyIn) {
      return (
        <>
          <Icon tone="muted" />
          <AuthHeading
            title={`${view.orgName} has no free seat right now`}
            subtitle={`Ask ${view.inviterName} to add a seat. Then open this link again. Your invite works until ${formatDay(view.expiresAt)}.`}
          />
          <p className="text-base text-fg-secondary" data-testid="invite-no-seat">
            Nothing was created and nothing was charged.
          </p>
          <LinkButton href={session ? '/' : '/login'} size="lg" fullWidth className="mt-5 h-12 sm:h-11" variant="secondary">
            {session ? 'Open KitStak' : 'Go to sign in'}
          </LinkButton>
        </>
      );
    }
  }

  const heading = (
    <>
      <Icon tone="info" />
      <AuthHeading
        title={`Join ${view.orgName} on KitStak`}
        subtitle={
          <>
            {view.inviterName} invited you to{' '}
            <span className="font-semibold text-fg" data-testid="invite-org-name">
              {view.orgName}
            </span>{' '}
            as {/^[aeiou]/i.test(view.roleLabel) ? 'an' : 'a'} {view.roleLabel.toLowerCase()}.
          </>
        }
      />
    </>
  );
  const expires = (
    <p className="mt-5 text-center text-xs text-fg-muted">This invite works until {formatDay(view.expiresAt)}.</p>
  );
  const invitePath = `/invite/${view.id}`;

  // Did this browser come from the link in the invite email? Only that link proves the mailbox.
  // Without it the join would be refused, so no form is drawn (review round 5): nobody types a
  // name and a password for nothing. A person who already has an account can still sign in, and
  // one whose email is verified needs no proof.
  const needsProof = session ? session.user.emailVerified !== true && session.user.email.trim().toLowerCase() === view.email : !view.accountExists;
  if (needsProof && !(await inviteProofValid(view.id, view.email))) {
    // The way through on this same screen (review round 5): a code mailed to the invited address
    // proves the mailbox just as the emailed link does. A copied link and a link from the CRM
    // carry no proof, and the people who open them must still be able to join.
    return (
      <div data-testid="invite-needs-link">
        {heading}
        <InviteCodeDoor
          invitationId={view.id}
          email={view.email}
          orgName={view.orgName}
          mode={session ? 'accept' : 'join'}
          devOutbox={devOutboxOn()}
        />
        {expires}
      </div>
    );
  }

  if (!session) {
    return (
      <>
        {heading}
        {view.accountExists ? (
          <div className="flex flex-col gap-4">
            <p className="text-base text-fg-secondary">
              You already have a KitStak account for <EmailText email={view.email} className="font-medium text-fg" after="." />{' '}
              Sign in to accept.
            </p>
            <LinkButton
              href={`/login?next=${encodeURIComponent(invitePath)}#email=${encodeURIComponent(view.email)}`}
              size="lg"
              fullWidth
              className="h-12 sm:h-11"
              data-testid="invite-accept"
            >
              Sign in to accept
            </LinkButton>
          </div>
        ) : (
          <InviteJoinForm invitationId={view.id} email={view.email} orgName={view.orgName} />
        )}
        {expires}
      </>
    );
  }

  if (session.user.email.trim().toLowerCase() !== view.email) {
    return (
      <>
        {heading}
        <InviteWrongAccount invitedEmail={view.email} signedInEmail={session.user.email} invitePath={invitePath} />
      </>
    );
  }

  return (
    <>
      {heading}
      <InviteAccept invitationId={view.id} orgName={view.orgName} email={view.email} />
      {expires}
    </>
  );
}
