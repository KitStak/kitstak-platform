/**
 * Seat limit of the organization's paid plan (docs/billing/SPEC.md P6, section 6.9). The CRM writes
 * invitations and member roles straight to the shared `core` tables, so it asks the same question
 * the Better Auth hooks ask (`billingOrganizationOptions`): is there a free seat? During a free
 * trial, with no paid plan, and for guests the answer is always yes. Nothing here changes a charge.
 */
import { sql } from 'drizzle-orm';
import {
  BILLING_ONLY_ROLE,
  BILLING_ROLE_OWNER_ONLY_MESSAGE,
  checkSeatAvailable,
  getBillingAccess,
  hasBillingRole,
  rows,
} from '@kitstak/billing/server';
import { ForbiddenError } from '@/server/http/errors';
import type { ServiceContext } from './context';

/** Error detail the client reads to show the "Add a seat" link. */
export const SEAT_LIMIT_REASON = 'seat_limit';

let billingTablesSeen = false;

/**
 * True when this database has the core billing tables (migration 0007 of `@kitstak/db`). A CRM
 * running on its own database without them has no plans, so there is no limit to check. Asked
 * with `to_regclass`, which never fails, because a failed statement would abort the caller's open
 * transaction. A yes is remembered for the life of the process.
 */
async function hasBillingTables(ctx: ServiceContext): Promise<boolean> {
  if (billingTablesSeen) return true;
  const result = await ctx.db.execute(sql`SELECT to_regclass('core.billing_subscriptions') IS NOT NULL AS "ok"`);
  billingTablesSeen = rows<{ ok: boolean }>(result)[0]?.ok === true;
  return billingTablesSeen;
}

/**
 * Throws a 403 with the plain seat sentence when adding one more person with `role` would pass the
 * plan's seat limit. People who cannot manage billing are told who to ask instead.
 */
export async function assertSeatAvailable(
  ctx: ServiceContext,
  input: { readonly role: string; readonly ignoreInviteEmail?: string },
): Promise<void> {
  if (!(await hasBillingTables(ctx))) return;
  const check = await checkSeatAvailable(ctx.db, {
    orgId: ctx.orgId,
    adding: 1,
    role: input.role,
    ...(input.ignoreInviteEmail ? { ignoreInviteEmail: input.ignoreInviteEmail } : {}),
  });
  if (check.ok) return;
  let message = check.message;
  let canManage = false;
  if (ctx.userId) {
    const access = await getBillingAccess(ctx.db, { orgId: ctx.orgId, userId: ctx.userId, role: ctx.roles.join(',') });
    canManage = access.canManage;
    if (!canManage && !check.pulseOnly) {
      const seats = check.limit === 1 ? 'seat is' : 'seats are';
      message = `All ${check.limit} ${seats} in use. Ask ${access.ownerName ?? 'your organization owner'} to add one.`;
    }
  }
  throw new ForbiddenError(message, {
    reason: SEAT_LIMIT_REASON,
    code: 'SEAT_LIMIT_REACHED',
    limit: check.limit,
    used: check.used,
    pulseOnly: check.pulseOnly,
    canManage,
  });
}

/**
 * Only an owner can add or remove a billing manager (docs/billing/SPEC.md P15). The CRM writes member
 * roles straight to the shared `core.member` table, so it asks the question the shared sign in API
 * asks (`guardBillingRoleChange` in `@kitstak/billing/server`): is the person being changed, removed
 * or deactivated a billing manager? If so, only an owner may go on.
 */
export async function assertMayChangeBillingManager(
  ctx: ServiceContext,
  target: { readonly userId: string; readonly role: string },
): Promise<void> {
  if (ctx.roles.includes('owner')) return;
  let manager = hasBillingRole(target.role);
  if (!manager && (await hasBillingTables(ctx))) {
    const found = await ctx.db.execute(
      sql`SELECT 1 FROM "core"."billing_managers" WHERE "org_id" = ${ctx.orgId} AND "user_id" = ${target.userId} LIMIT 1`,
    );
    manager = rows(found).length > 0;
  }
  if (manager) throw new ForbiddenError(BILLING_ROLE_OWNER_ONLY_MESSAGE);
}

/**
 * The role string to store when the CRM sets a member's role. A person who holds the billing role
 * keeps it next to the new role: the CRM role list has no billing entry, so a role change made here
 * must never take billing rights away as a side effect.
 */
export function keepBillingRole(previousRole: string, nextRole: string): string {
  return hasBillingRole(previousRole) && !hasBillingRole(nextRole) ? `${nextRole},${BILLING_ONLY_ROLE}` : nextRole;
}
