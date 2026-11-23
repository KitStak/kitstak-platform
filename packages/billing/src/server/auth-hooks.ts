/**
 * Billing rules for the shared Better Auth organization endpoints (docs/billing/CONTRACTS.md section
 * 15.2). Every app that mounts Better Auth passes this to `createAuth({ organization: ... })`, so the
 * seat limit, the invite email and the delete guard hold at every door (auth review 2026-11-11: a
 * rule for the shared `core` tables belongs in a package).
 */
import type { OrganizationPluginExtras } from '@kitstak/auth/options';
import { APIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import { billingSubscriptions, user } from '@kitstak/db/schema';
import { isLiveSubscriptionStatus } from '../plan-state';
import type { BillingDb } from './db';
import { signInviteProof } from './invite-proof';
import { enqueueEmail } from './outbox';
import { enforceRateLimit } from './rate-limit';
import { isFreeRole, usesSeat } from './roles';
import { checkSeatAvailable } from './usage';

type Hooks = NonNullable<OrganizationPluginExtras['organizationHooks']>;

function seatError(message: string): APIError {
  return new APIError('FORBIDDEN', { code: 'SEAT_LIMIT_REACHED', message });
}

/**
 * Inviting needs a verified email (SPEC 5.4), and the rule sits here so it holds at every door, not
 * only in the Portal form. Without it anyone could make an account with a made up address and have
 * KitStak send branded mail to strangers.
 *
 * Decision for older accounts: people who joined before email codes existed were never asked to
 * verify, and the CRM has no screen for it. Accounts made before this day may keep inviting. Every
 * account made on or after it must verify first. If the launch is later than this day, move the
 * date to the launch day (docs/billing/GO-LIVE.md).
 */
export const INVITE_NEEDS_VERIFIED_EMAIL_SINCE = new Date('2026-11-23T00:00:00.000Z');

/** Invite emails one organization may send in a day. A paid plan is also held by its seat count. */
export const INVITES_PER_DAY = { withoutPlan: 50, withPlan: 500 } as const;

export function billingOrganizationOptions(input: {
  db: BillingDb;
  portalUrl: string;
  allowAll: () => boolean;
  /**
   * The shared auth secret (`BETTER_AUTH_SECRET`). With it, the invite link carries a proof that
   * only the invited mailbox has, and accepting from that link marks the email verified. Without it
   * invites still work; the person verifies with a code like anyone else.
   */
  inviteSecret?: string;
  /** Overrides `INVITE_NEEDS_VERIFIED_EMAIL_SINCE` (tests). */
  verifiedEmailSince?: Date;
}): OrganizationPluginExtras {
  const { db } = input;
  const portalUrl = input.portalUrl.replace(/\/+$/, '');
  const verifiedSince = input.verifiedEmailSince ?? INVITE_NEEDS_VERIFIED_EMAIL_SINCE;

  /** Throws EMAIL_NOT_VERIFIED when the inviter must verify first. Read fresh, never from a cached session. */
  async function requireVerifiedInviter(inviterId: string): Promise<void> {
    const [person] = await db
      .select({ emailVerified: user.emailVerified, createdAt: user.createdAt })
      .from(user)
      .where(eq(user.id, inviterId));
    if (!person) throw new APIError('FORBIDDEN', { code: 'EMAIL_NOT_VERIFIED', message: 'Verify your email first. Then you can invite people.' });
    if (person.emailVerified) return;
    if (person.createdAt.getTime() < verifiedSince.getTime()) return;
    throw new APIError('FORBIDDEN', {
      code: 'EMAIL_NOT_VERIFIED',
      message: 'Verify your email first. Then you can invite people. Open the KitStak Portal to enter your code.',
    });
  }

  /** Throws INVITE_LIMIT_REACHED when the organization sent too many invites today. */
  async function countInvite(orgId: string): Promise<void> {
    const max = (await hasPaidPlan(orgId)) ? INVITES_PER_DAY.withPlan : INVITES_PER_DAY.withoutPlan;
    const allowed = await enforceRateLimit(db, { key: `billing:invite-day:${orgId}`, windowSeconds: 86_400, max });
    if (!allowed) {
      throw new APIError('TOO_MANY_REQUESTS', {
        code: 'INVITE_LIMIT_REACHED',
        message: `Your team sent ${max} invites today. That is the most for one day. Try again tomorrow, or talk to us if you need more.`,
      });
    }
  }

  async function hasPaidPlan(orgId: string): Promise<boolean> {
    const [row] = await db
      .select({ status: billingSubscriptions.status })
      .from(billingSubscriptions)
      .where(eq(billingSubscriptions.orgId, orgId));
    return row !== undefined && isLiveSubscriptionStatus(row.status);
  }

  /** Throws SEAT_LIMIT_REACHED when the plan has no room. No limits without a paid plan. */
  async function requireSeat(
    orgId: string,
    role: string,
    ignore?: { invitationId?: string; inviteEmail?: string },
  ): Promise<void> {
    if (isFreeRole(role)) return;
    if (!(await hasPaidPlan(orgId))) return;
    const check = await checkSeatAvailable(db, {
      orgId,
      adding: 1,
      role,
      ...(ignore?.invitationId ? { ignoreInvitationId: ignore.invitationId } : {}),
      ...(ignore?.inviteEmail ? { ignoreInviteEmail: ignore.inviteEmail } : {}),
    });
    if (!check.ok) throw seatError(check.message);
  }

  const organizationHooks: Hooks = {
    beforeCreateInvitation: async ({ invitation, inviter, organization }) => {
      await requireVerifiedInviter(inviter.id);
      // Inviting the same address again replaces the open invite, so that one is not counted twice.
      await requireSeat(organization.id, invitation.role, { inviteEmail: invitation.email });
      // Last, so a refused invite does not use up the day's count.
      await countInvite(organization.id);
    },

    beforeAddMember: async ({ member: adding, user: person, organization }) => {
      // A person with an open invite who is added directly would be counted twice without this.
      await requireSeat(organization.id, adding.role, { inviteEmail: person.email });
    },

    beforeAcceptInvitation: async ({ invitation, organization }) => {
      // The seat was held by the invite itself. Accepting only fails if the plan shrank since.
      await requireSeat(organization.id, invitation.role ?? 'member', { invitationId: invitation.id });
    },

    beforeUpdateMemberRole: async ({ member: current, newRole, organization }) => {
      // Only a move from a free or deactivated role to a paid one needs a new seat.
      if (usesSeat(current.role) || !usesSeat(newRole)) return;
      await requireSeat(organization.id, newRole);
    },

    beforeDeleteOrganization: async ({ organization }) => {
      if (await hasPaidPlan(organization.id)) {
        throw new APIError('FORBIDDEN', {
          code: 'PLAN_ACTIVE',
          message: 'Cancel your plan before you delete this organization.',
        });
      }
    },
  };

  return {
    organizationHooks,
    sendInvitationEmail: async (data) => {
      const expiresAt = data.invitation.expiresAt instanceof Date ? data.invitation.expiresAt : new Date(data.invitation.expiresAt);
      await enqueueEmail(db, {
        orgId: data.organization.id,
        to: data.email,
        template: 'invitation',
        payload: {
          orgName: data.organization.name,
          portalUrl,
          inviterName: data.inviter.user.name,
          acceptUrl: input.inviteSecret
            ? `${portalUrl}/invite/${data.id}?t=${signInviteProof(input.inviteSecret, data.id, data.email)}`
            : `${portalUrl}/invite/${data.id}`,
          expiresAt: expiresAt.toISOString(),
        },
        dedupeKey: `invite:${data.id}`,
      });
    },
  };
}
