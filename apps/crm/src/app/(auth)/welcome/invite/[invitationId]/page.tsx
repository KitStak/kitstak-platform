import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { requirePageSession } from '@/server/auth/session';
import { db } from '@/server/db';
import { invitation, member, organization, user } from '@/server/db/schema';
import { InviteAccept } from '@/features/wizards/invite-accept';
import { inviteAcceptState, maskEmail } from '@/features/wizards/model/invite-accept';
import { roleLabel } from '@/features/wizards/model/invites';

export const metadata: Metadata = { title: 'Join your team' };

const idSchema = z.uuid();

/**
 * Invite link landing (copied from Invite members → Pending). Requires a session, keeping the
 * full path in `next=` so sign-in / sign-up comes straight back here, then accepts through
 * Better Auth's organization plugin. The org name is only shown to the invited address.
 */
export default async function InviteAcceptPage({ params }: { readonly params: Promise<{ invitationId: string }> }) {
  const { invitationId: rawId } = await params;
  const parsed = idSchema.safeParse(rawId);
  const session = await requirePageSession(`/welcome/invite/${encodeURIComponent(rawId)}`);
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
