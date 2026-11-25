/**
 * Billing rules for the shared Better Auth organization endpoints (docs/billing/CONTRACTS.md section
 * 15.2). Every app that mounts Better Auth passes this to `createAuth({ organization: ... })`, so the
 * seat limit, the invite email and the delete guard hold at every door (auth review 2026-11-11: a
 * rule for the shared `core` tables belongs in a package).
 */
import type { OrganizationPluginExtras } from '@kitstak/auth/options';
import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { and, eq } from 'drizzle-orm';
import { billingEmails, billingManagers, billingSubscriptions, invitation as invitationTable, member, user } from '@kitstak/db/schema';
import { isLiveSubscriptionStatus } from '../plan-state';
import type { BillingDb } from './db';
import { sendEmailNow } from '../emails/send';
import { signInviteProof } from './invite-proof';
import { enforceRateLimit } from './rate-limit';
import { hasBillingRole, isActiveRole, isFreeRole, roleParts, usesSeat } from './roles';
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

/** Refused: an invite can only be accepted by the person who owns the invited mailbox (review round 4). */
export const INVITE_NEEDS_PROVEN_MAILBOX_CODE = 'INVITE_NEEDS_PROVEN_MAILBOX';
/** The one sentence a refused person reads, at every door. */
export const INVITE_NEEDS_PROVEN_MAILBOX_MESSAGE = 'Open the link in your invite email to join. That shows the email is yours.';

/* ===== only an owner can add or remove a billing manager (SPEC P15, review round 3) ===== */

/** The one sentence a refused person reads, at every door. */
export const BILLING_ROLE_OWNER_ONLY_MESSAGE = 'Only an owner can add or remove a billing manager.';

function ownerOnlyError(): APIError {
  return new APIError('FORBIDDEN', { code: 'BILLING_ROLE_OWNER_ONLY', message: BILLING_ROLE_OWNER_ONLY_MESSAGE });
}

/** A role as the endpoints take it: 'admin', 'admin,billing' or ['admin', 'billing']. */
function roleText(role: unknown): string {
  if (Array.isArray(role)) return role.filter((part): part is string => typeof part === 'string').join(',');
  return typeof role === 'string' ? role : '';
}

/** True when the role list names the billing role, whatever else it names. */
function namesBillingRole(role: unknown): boolean {
  return hasBillingRole(roleText(role));
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Throws BILLING_ROLE_OWNER_ONLY unless this person is an active owner of this organization. Read
 * fresh from `core.member`, never from a cached session or from anything the request says.
 */
export async function requireOwnerForBillingRole(
  db: Pick<BillingDb, 'select'>,
  input: { orgId: string | null | undefined; actorUserId: string | null | undefined },
): Promise<void> {
  if (!input.orgId || !input.actorUserId || !UUID_SHAPE.test(input.orgId) || !UUID_SHAPE.test(input.actorUserId)) throw ownerOnlyError();
  const [row] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, input.orgId), eq(member.userId, input.actorUserId)));
  if (!row || !isActiveRole(row.role) || !roleParts(row.role).includes('owner')) throw ownerOnlyError();
}

/** The doors of the shared organization API where a billing manager can be added or removed. */
export type BillingRoleDoor =
  | { readonly door: 'invite'; readonly orgId: string | null; readonly role: unknown }
  | { readonly door: 'update_role'; readonly memberId: unknown; readonly role: unknown }
  | { readonly door: 'remove_member'; readonly orgId: string | null; readonly memberIdOrEmail: unknown }
  | { readonly door: 'cancel_invite'; readonly invitationId: unknown };

/**
 * The rule itself, for one request at one door: a change that gives the billing role to someone, or
 * takes it from someone, is refused unless the acting person is an active owner of that
 * organization. Anything that does not touch the billing role passes untouched, so the other
 * rules of the organization API (who may invite, who may change roles) stay as they are.
 *
 * It looks only at the database: the target member, the target invitation and the acting person's
 * own member row. Nothing is written here, so a refusal leaves no trace.
 */
export async function guardBillingRoleChange(
  db: Pick<BillingDb, 'select'>,
  actorUserId: string | null | undefined,
  request: BillingRoleDoor,
): Promise<void> {
  switch (request.door) {
    case 'invite': {
      if (!namesBillingRole(request.role)) return;
      await requireOwnerForBillingRole(db, { orgId: request.orgId, actorUserId });
      return;
    }
    case 'update_role': {
      if (typeof request.memberId !== 'string' || !UUID_SHAPE.test(request.memberId)) return;
      const [target] = await db
        .select({ orgId: member.organizationId, role: member.role })
        .from(member)
        .where(eq(member.id, request.memberId));
      // An unknown member is the endpoint's own error to give.
      if (!target) return;
      if (hasBillingRole(target.role) === namesBillingRole(request.role)) return;
      await requireOwnerForBillingRole(db, { orgId: target.orgId, actorUserId });
      return;
    }
    case 'remove_member': {
      const key = typeof request.memberIdOrEmail === 'string' ? request.memberIdOrEmail.trim() : '';
      if (key === '' || !request.orgId || !UUID_SHAPE.test(request.orgId)) return;
      const rows = key.includes('@')
        ? await db
            .select({ userId: member.userId, role: member.role })
            .from(member)
            .innerJoin(user, eq(member.userId, user.id))
            .where(and(eq(member.organizationId, request.orgId), eq(user.email, key.toLowerCase())))
        : UUID_SHAPE.test(key)
          ? await db
              .select({ userId: member.userId, role: member.role })
              .from(member)
              .where(and(eq(member.organizationId, request.orgId), eq(member.id, key)))
          : [];
      const target = rows[0];
      if (!target) return;
      let manager = hasBillingRole(target.role);
      if (!manager) {
        const [granted] = await db
          .select({ userId: billingManagers.userId })
          .from(billingManagers)
          .where(and(eq(billingManagers.orgId, request.orgId), eq(billingManagers.userId, target.userId)));
        manager = granted !== undefined;
      }
      if (!manager) return;
      await requireOwnerForBillingRole(db, { orgId: request.orgId, actorUserId });
      return;
    }
    case 'cancel_invite': {
      if (typeof request.invitationId !== 'string' || !UUID_SHAPE.test(request.invitationId)) return;
      const [invite] = await db
        .select({ orgId: invitationTable.organizationId, role: invitationTable.role, status: invitationTable.status })
        .from(invitationTable)
        .where(eq(invitationTable.id, request.invitationId));
      if (!invite || invite.status !== 'pending' || !namesBillingRole(invite.role)) return;
      await requireOwnerForBillingRole(db, { orgId: invite.orgId, actorUserId });
      return;
    }
  }
}

const GUARDED_PATHS = new Set([
  '/organization/invite-member',
  '/organization/update-member-role',
  '/organization/remove-member',
  '/organization/cancel-invitation',
]);

/**
 * Runs `guardBillingRoleChange` before the organization endpoints, on every instance that mounts the
 * shared sign in API (Portal, CRM, WMS, Projects, Pulse). It is a plugin and not an organization
 * hook because the hooks for a role change and for removing a member are not told who is acting.
 * A request with no session is left to the endpoint, which refuses it by itself.
 */
export function billingRoleGuardPlugin(db: Pick<BillingDb, 'select'>): BetterAuthPlugin {
  return {
    id: 'kitstak-billing-role-guard',
    hooks: {
      before: [
        {
          matcher: (ctx) => typeof ctx.path === 'string' && GUARDED_PATHS.has(ctx.path),
          handler: createAuthMiddleware(async (ctx) => {
            const body = (ctx.body ?? {}) as Record<string, unknown>;
            const session = await getSessionFromCtx(ctx).catch(() => null);
            if (!session) return;
            const activeOrgId = (session.session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null;
            const orgId = typeof body.organizationId === 'string' && body.organizationId !== '' ? body.organizationId : activeOrgId;
            const actor = session.user.id;
            switch (ctx.path) {
              case '/organization/invite-member':
                await guardBillingRoleChange(db, actor, { door: 'invite', orgId, role: body.role });
                return;
              case '/organization/update-member-role':
                await guardBillingRoleChange(db, actor, { door: 'update_role', memberId: body.memberId, role: body.role });
                return;
              case '/organization/remove-member':
                await guardBillingRoleChange(db, actor, { door: 'remove_member', orgId, memberIdOrEmail: body.memberIdOrEmail });
                return;
              case '/organization/cancel-invitation':
                await guardBillingRoleChange(db, actor, { door: 'cancel_invite', invitationId: body.invitationId });
                return;
            }
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}

/** The outbox key of an invitation's email. One invitation, one email. */
export function inviteEmailKey(invitationId: string): string {
  return `invite:${invitationId}`;
}

/**
 * Has the invite email left? 'sent' once the mail provider took it, 'queued' while it waits for
 * the job (the provider was down or this app has no mail key), 'failed' when it could not be sent.
 * The page that says "Invite sent" asks this first, so the word is true (review round 4).
 */
export async function inviteEmailStatus(db: Pick<BillingDb, 'select'>, invitationId: string): Promise<'sent' | 'queued' | 'failed' | 'none'> {
  const [row] = await db
    .select({ status: billingEmails.status })
    .from(billingEmails)
    .where(eq(billingEmails.dedupeKey, inviteEmailKey(invitationId)));
  if (!row) return 'none';
  return row.status === 'sent' ? 'sent' : row.status === 'failed' ? 'failed' : 'queued';
}

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
  /**
   * The mail settings the invite email is sent with (`RESEND_API_KEY`, `EMAIL_FROM`, ...). Default:
   * `process.env`. The Portal passes its checked env, so a blank line in an env file never counts
   * as a key.
   */
  emailEnv?: NodeJS.ProcessEnv;
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

  /**
   * Accepting an invite needs a proven mailbox (review round 4). The invitation id is not a secret:
   * owners and admins of the organization can read it. Signing up needs no proof of the mailbox
   * either. So without this rule an admin could read the id of an owner's open billing invite, make
   * an account with the invited address, accept, and hold a billing manager account that can cancel
   * the plan.
   *
   * Proven means `email_verified` on the account, read fresh from the database. A person gets it
   * from the emailed code, or from the link in the invite email itself: the Portal checks the proof
   * in that link (`invite-proof.ts`) and marks the address verified right before it accepts. So the
   * real invited person joins with one click and no code, and nobody else can take the invite. The
   * rule holds for every role, at every app, because every app mounts these hooks.
   */
  async function requireProvenMailbox(userId: string): Promise<void> {
    const [person] = await db.select({ emailVerified: user.emailVerified }).from(user).where(eq(user.id, userId));
    if (person?.emailVerified === true) return;
    throw new APIError('FORBIDDEN', { code: INVITE_NEEDS_PROVEN_MAILBOX_CODE, message: INVITE_NEEDS_PROVEN_MAILBOX_MESSAGE });
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
      // First, so a refused person learns nothing else about the organization.
      await guardBillingRoleChange(db, inviter.id, { door: 'invite', orgId: organization.id, role: invitation.role });
      await requireVerifiedInviter(inviter.id);
      // Inviting the same address again replaces the open invite, so that one is not counted twice.
      await requireSeat(organization.id, invitation.role, { inviteEmail: invitation.email });
      // Last, so a refused invite does not use up the day's count.
      await countInvite(organization.id);
    },

    beforeAddMember: async ({ member: adding, user: person, organization }) => {
      // Adding a member directly is a server only call, and this hook is not told who asked for it.
      // So the billing role can never be handed out this way: it goes through a billing invite or
      // a role change, where the acting owner is checked.
      if (namesBillingRole(adding.role)) throw ownerOnlyError();
      // A person with an open invite who is added directly would be counted twice without this.
      await requireSeat(organization.id, adding.role, { inviteEmail: person.email });
    },

    beforeAcceptInvitation: async ({ invitation, user: person, organization }) => {
      // First: only the person who owns the invited mailbox may accept (review round 4).
      await requireProvenMailbox(person.id);
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
    guardPlugins: [billingRoleGuardPlugin(db)],
    sendInvitationEmail: async (data) => {
      const expiresAt = data.invitation.expiresAt instanceof Date ? data.invitation.expiresAt : new Date(data.invitation.expiresAt);
      // An invite is mail a person is waiting for, like a code (review round 4): it goes out at
      // once, not with the one minute job. `sendEmailNow` writes the outbox row first, so when the
      // mail provider is down, or this app has no mail key of its own, the row stays queued and
      // the job sends it a little later. Nothing is lost either way.
      try {
        const sent = await sendEmailNow(
          db,
          {
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
            dedupeKey: inviteEmailKey(data.id),
          },
          input.emailEnv ? { env: input.emailEnv } : undefined,
        );
        if (!sent.ok) console.error(`[billing] the invite email is not out yet and stays queued: ${sent.error ?? 'no detail'}`);
      } catch (error: unknown) {
        // The invitation exists. A mail problem must not turn the invite into an error.
        console.error('[billing] could not send the invite email right now', error);
      }
    },
  };
}
