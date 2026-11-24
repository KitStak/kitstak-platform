/**
 * Who may do what in billing (docs/billing/CONTRACTS.md section 11.3, SPEC P15). Owners and billing
 * managers can do everything. Admins can see billing and start the free trial. The billing manager
 * role lives in `core.billing_managers`; it gives no rights over data.
 */
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { billingManagers, invitation, member, user } from '@kitstak/db/schema';
import { type BillingResult, billingError, billingOk } from '../errors';
import { recordAudit } from './audit';
import type { BillingActor, BillingReadDb, BillingRuntime } from './db';
import { BILLING_ONLY_ROLE, hasBillingRole, isActiveRole, isBillingOnlyRole, roleParts } from './roles';
import { clearPlanCache } from './state';

export interface BillingAccess {
  readonly isOwner: boolean;
  readonly isAdmin: boolean;
  readonly isBillingManager: boolean;
  /** Owner, admin or billing manager. */
  readonly canView: boolean;
  /** Owner or billing manager. */
  readonly canManage: boolean;
  /** Owner, admin or billing manager. */
  readonly canStartTrial: boolean;
  /** Owner. */
  readonly canAssignManagers: boolean;
  readonly ownerName: string | null;
}

const NO_ACCESS = {
  isOwner: false,
  isAdmin: false,
  isBillingManager: false,
  canView: false,
  canManage: false,
  canStartTrial: false,
  canAssignManagers: false,
} as const;

/** The access flags for a raw role string and a "holds the billing manager role" answer. Pure. */
export function billingAccessFor(role: string, isBillingManager: boolean, ownerName: string | null): BillingAccess {
  if (!isActiveRole(role)) return { ...NO_ACCESS, ownerName };
  const parts = roleParts(role);
  const isOwner = parts.includes('owner');
  const isAdmin = parts.includes('admin');
  // The billing role in `core.member.role` is a billing manager by itself (review round 2): the
  // bookkeeper who was invited for billing only and holds no seat.
  const manager = isBillingManager || parts.includes(BILLING_ONLY_ROLE);
  const canView = isOwner || isAdmin || manager;
  return {
    isOwner,
    isAdmin,
    isBillingManager: manager,
    canView,
    canManage: isOwner || manager,
    canStartTrial: canView,
    canAssignManagers: isOwner,
    ownerName,
  };
}

/** The oldest active owner's name: the person a member should ask. */
export async function findOwnerName(db: BillingReadDb, orgId: string): Promise<string | null> {
  const members = await db
    .select({ name: user.name, role: member.role })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, orgId))
    .orderBy(asc(member.createdAt));
  const owner = members.find((row) => isActiveRole(row.role) && roleParts(row.role).includes('owner'));
  return owner?.name ?? null;
}

/** `role` is the raw `core.member.role` string (a comma list; `deactivated:` means no access). */
export async function getBillingAccess(
  db: BillingReadDb,
  input: { orgId: string; userId: string; role: string },
): Promise<BillingAccess> {
  const ownerName = await findOwnerName(db, input.orgId);
  if (!isActiveRole(input.role)) return { ...NO_ACCESS, ownerName };
  const [manager] = await db
    .select({ userId: billingManagers.userId })
    .from(billingManagers)
    .where(and(eq(billingManagers.orgId, input.orgId), eq(billingManagers.userId, input.userId)));
  return billingAccessFor(input.role, manager !== undefined, ownerName);
}

export interface BillingManagerRow {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly kind: 'owner' | 'manager';
  readonly addedAt: Date | null;
  /** True for a person who only manages billing: no seat and no access to the apps. */
  readonly billingOnly: boolean;
}

/** An open invite to manage billing only. */
export interface BillingInviteRow {
  readonly invitationId: string;
  readonly email: string;
  readonly expiresAt: Date;
}

/** Owners first (fixed), then billing managers by the day they were added. */
export async function listBillingHolders(db: BillingReadDb, orgId: string): Promise<readonly BillingManagerRow[]> {
  const members = await db
    .select({ userId: member.userId, role: member.role, name: user.name, email: user.email, createdAt: member.createdAt })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, orgId))
    .orderBy(asc(member.createdAt));
  const active = members.filter((row) => isActiveRole(row.role));
  const owners = active.filter((row) => roleParts(row.role).includes('owner'));
  const ownerIds = new Set(owners.map((row) => row.userId));
  const byId = new Map(active.map((row) => [row.userId, row]));

  const managerRows = await db
    .select({ userId: billingManagers.userId, createdAt: billingManagers.createdAt })
    .from(billingManagers)
    .where(eq(billingManagers.orgId, orgId))
    .orderBy(asc(billingManagers.createdAt));

  const out: BillingManagerRow[] = owners.map((row) => ({
    userId: row.userId,
    name: row.name,
    email: row.email,
    kind: 'owner',
    addedAt: null,
    billingOnly: false,
  }));
  const listed = new Set(ownerIds);
  for (const row of managerRows) {
    const person = byId.get(row.userId);
    // A manager who left the org or who is an owner anyway is not listed twice or at all.
    if (!person || listed.has(row.userId)) continue;
    listed.add(row.userId);
    out.push({
      userId: row.userId,
      name: person.name,
      email: person.email,
      kind: 'manager',
      addedAt: row.createdAt,
      billingOnly: isBillingOnlyRole(person.role),
    });
  }
  // People who hold the billing role itself (invited for billing only).
  for (const row of active) {
    if (listed.has(row.userId) || !hasBillingRole(row.role)) continue;
    listed.add(row.userId);
    out.push({ userId: row.userId, name: row.name, email: row.email, kind: 'manager', addedAt: row.createdAt, billingOnly: isBillingOnlyRole(row.role) });
  }
  return out;
}

/** Open invites to manage billing only: pending and not expired. Oldest first. */
export async function listBillingInvites(db: BillingReadDb, orgId: string, now: Date = new Date()): Promise<readonly BillingInviteRow[]> {
  const found = await db
    .select({ id: invitation.id, email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt })
    .from(invitation)
    .where(and(eq(invitation.organizationId, orgId), eq(invitation.status, 'pending'), gt(invitation.expiresAt, now)))
    .orderBy(asc(invitation.expiresAt));
  return found
    .filter((row) => isBillingOnlyRole(row.role))
    .map((row) => ({ invitationId: row.id, email: row.email, expiresAt: row.expiresAt }));
}

/**
 * Checks an address before it is invited to manage billing only. `ok` carries the cleaned address.
 * A person who is already on the team is not invited: they are picked from the list instead.
 */
export async function checkBillingInvite(
  db: BillingReadDb,
  input: { orgId: string; email: string },
): Promise<BillingResult<{ email: string }>> {
  const email = input.email.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return billingError('invalid_input', 'Enter an email address, like name@company.com.');
  }
  const members = await db
    .select({ role: member.role })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(and(eq(member.organizationId, input.orgId), sql`lower(${user.email}) = ${email}`));
  if (members.some((row) => isActiveRole(row.role))) {
    return billingError('invalid_input', 'That person is already on your team. Pick them in the list instead.');
  }
  return billingOk({ email });
}

/** A billing manager must be an active member of the org; `not_found` otherwise. */
export async function addBillingManager(
  rt: BillingRuntime,
  input: { orgId: string; userId: string; actor: BillingActor },
): Promise<BillingResult<null>> {
  const [person] = await rt.db
    .select({ name: user.name, role: member.role })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(and(eq(member.organizationId, input.orgId), eq(member.userId, input.userId)));
  if (!person || !isActiveRole(person.role)) {
    return billingError('not_found', 'That person is not on your team. Invite them first.');
  }
  const inserted = await rt.db
    .insert(billingManagers)
    .values({ orgId: input.orgId, userId: input.userId, addedBy: input.actor.userId })
    .onConflictDoNothing()
    .returning({ userId: billingManagers.userId });
  if (inserted.length > 0) {
    await recordAudit(rt.db, {
      orgId: input.orgId,
      actor: input.actor,
      action: 'manager.added',
      summary: `${input.actor.label} made ${person.name} a billing manager.`,
      data: { userId: input.userId },
    });
  }
  clearPlanCache(input.orgId);
  return billingOk(null);
}

export async function removeBillingManager(
  rt: BillingRuntime,
  input: { orgId: string; userId: string; actor: BillingActor },
): Promise<BillingResult<null>> {
  const [person] = await rt.db.select({ name: user.name }).from(user).where(eq(user.id, input.userId));
  const [membership] = await rt.db
    .select({ id: member.id, role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, input.orgId), eq(member.userId, input.userId)));
  if (membership && isBillingOnlyRole(membership.role)) {
    // Billing was all this person had here, so removing it removes them from the organization. They
    // held no seat and no data. A person with another role keeps that role (the branch below).
    await rt.db.transaction(async (tx) => {
      await tx.delete(billingManagers).where(and(eq(billingManagers.orgId, input.orgId), eq(billingManagers.userId, input.userId)));
      await tx.delete(member).where(eq(member.id, membership.id));
      await recordAudit(tx, {
        orgId: input.orgId,
        actor: input.actor,
        action: 'manager.removed',
        summary: `${input.actor.label} removed ${person?.name ?? 'a person'} as a billing manager. They no longer have access to this organization.`,
        data: { userId: input.userId, billingOnly: true },
      });
    });
    clearPlanCache(input.orgId);
    return billingOk(null);
  }
  const removed = await rt.db
    .delete(billingManagers)
    .where(and(eq(billingManagers.orgId, input.orgId), eq(billingManagers.userId, input.userId)))
    .returning({ userId: billingManagers.userId });
  if (removed.length === 0) return billingError('not_found', 'That person is not a billing manager.');
  await recordAudit(rt.db, {
    orgId: input.orgId,
    actor: input.actor,
    action: 'manager.removed',
    summary: `${input.actor.label} removed ${person?.name ?? 'a person'} as a billing manager.`,
    data: { userId: input.userId },
  });
  clearPlanCache(input.orgId);
  return billingOk(null);
}
