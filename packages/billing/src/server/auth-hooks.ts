/**
 * Billing rules for the shared Better Auth organization endpoints (docs/billing/CONTRACTS.md section
 * 15.2). Every app that mounts Better Auth passes this to `createAuth({ organization: ... })`, so the
 * seat limit, the invite email and the delete guard hold at every door (auth review 2026-11-11: a
 * rule for the shared `core` tables belongs in a package).
 */
import type { OrganizationPluginExtras } from '@kitstak/auth/options';
import { APIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import { billingSubscriptions } from '@kitstak/db/schema';
import { isLiveSubscriptionStatus } from '../plan-state';
import type { BillingDb } from './db';
import { enqueueEmail } from './outbox';
import { isFreeRole, usesSeat } from './roles';
import { checkSeatAvailable } from './usage';

type Hooks = NonNullable<OrganizationPluginExtras['organizationHooks']>;

function seatError(message: string): APIError {
  return new APIError('FORBIDDEN', { code: 'SEAT_LIMIT_REACHED', message });
}

export function billingOrganizationOptions(input: {
  db: BillingDb;
  portalUrl: string;
  allowAll: () => boolean;
}): OrganizationPluginExtras {
  const { db } = input;
  const portalUrl = input.portalUrl.replace(/\/+$/, '');

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
    beforeCreateInvitation: async ({ invitation, organization }) => {
      // Inviting the same address again replaces the open invite, so that one is not counted twice.
      await requireSeat(organization.id, invitation.role, { inviteEmail: invitation.email });
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
          acceptUrl: `${portalUrl}/invite/${data.id}`,
          expiresAt: expiresAt.toISOString(),
        },
        dedupeKey: `invite:${data.id}`,
      });
    },
  };
}
