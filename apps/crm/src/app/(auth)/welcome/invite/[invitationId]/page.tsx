import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getSession } from '@/server/auth/session';
import { db } from '@/server/db';
import { invitation, member, organization, user } from '@/server/db/schema';
import { InviteAccept } from '@/features/wizards/invite-accept';
import { inviteAcceptState, maskEmail } from '@/features/wizards/model/invite-accept';
import { roleLabel } from '@/features/wizards/model/invites';

export const metadata: Metadata = { title: 'Join your team' };

const idSchema = z.uuid();

/** The Portal's invite page for this invitation, or null when no Portal address is set (the CRM alone). */
function portalInvitePage(invitationId: string): string | null {
  const portal = process.env.NEXT_PUBLIC_PORTAL_URL?.trim().replace(/\/+$/, '') ?? '';
  return portal === '' ? null : `${portal}/invite/${encodeURIComponent(invitationId)}`;
}

/**
 * Invite link landing (older copied links, and the CRM running alone). A signed in person whose
 * email is proven accepts here, through Better Auth's organization plugin. The org name is only
 * shown to the invited address.
 *
 * Everyone else goes to the Portal's invite page (billing review round 5): a signed out person, and
 * a person whose email nobody has verified. Joining needs a proven mailbox, the CRM has no email
 * codes, and this page used to show such a person a "Join" button that could only be refused. The
 * Portal page lets them prove the mailbox with an emailed code and join, with or without an account.
 */
export default async function InviteAcceptPage({ params }: { readonly params: Promise<{ invitationId: string }> }) {
  const { invitationId: rawId } = await params;
  const parsed = idSchema.safeParse(rawId);
  const portalPage = parsed.success ? portalInvitePage(parsed.data) : null;
  const session = await getSession();
  if (!session) redirect(portalPage ?? `/login?next=${encodeURIComponent(`/welcome/invite/${encodeURIComponent(rawId)}`)}`);
  if (!parsed.success) return <InviteAccept state="invalid" invitationId={null} sessionEmail={session.user.email} />;

  const [row] = await db
    .select({
      id: invitation.id,
      email: invitation.email,
      status: invitation.status,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      organizationId: invitation.organizationId,
      orgName: organization.name,
      orgSlug: organization.slug,
      inviterName: user.name,
    })
    .from(invitation)
    .innerJoin(organization, eq(invitation.organizationId, organization.id))
    .leftJoin(user, eq(invitation.inviterId, user.id))
    .where(eq(invitation.id, parsed.data))
    .limit(1);

  const [membership] = row
    ? await db
        .select({ id: member.id })
        .from(member)
        .where(and(eq(member.organizationId, row.organizationId), eq(member.userId, session.user.id)))
        .limit(1)
    : [];

  const state = inviteAcceptState(
    row
      ? {
          status: row.status,
          expiresAt: row.expiresAt,
          invitedEmail: row.email,
          sessionEmail: session.user.email,
          isMember: Boolean(membership),
        }
      : null,
  );
  if (state === 'member' && row) redirect(`/${row.orgSlug}`);

  const isInvitee = Boolean(row && row.email.trim().toLowerCase() === session.user.email.trim().toLowerCase());
  if (isInvitee && state === 'ready' && portalPage) {
    // Read fresh: the shared rule that guards the join reads the database too.
    const [me] = await db.select({ emailVerified: user.emailVerified }).from(user).where(eq(user.id, session.user.id)).limit(1);
    if (me?.emailVerified !== true) redirect(portalPage);
  }
  const forInvitee = isInvitee && (state === 'ready' || state === 'expired');
  return (
    <InviteAccept
      state={state}
      invitationId={row?.id ?? null}
      sessionEmail={session.user.email}
      invitedEmailMasked={row ? maskEmail(row.email) : undefined}
      org={forInvitee && row ? { name: row.orgName, slug: row.orgSlug } : undefined}
      inviterName={forInvitee ? (row?.inviterName ?? undefined) : undefined}
      roleLabel={forInvitee && row ? roleLabel(row.role) : undefined}
    />
  );
}
