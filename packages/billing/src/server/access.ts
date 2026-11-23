/**
 * Who may do what in billing (docs/billing/CONTRACTS.md section 11.3, SPEC P15). Owners and billing
 * managers can do everything. Admins can see billing and start the free trial. The billing manager
 * role lives in `core.billing_managers`; it gives no rights over data.
 */
import { and, asc, eq } from 'drizzle-orm';
import { billingManagers, member, user } from '@kitstak/db/schema';
import { type BillingResult, billingError, billingOk } from '../errors';
import { recordAudit } from './audit';
import type { BillingActor, BillingReadDb, BillingRuntime } from './db';
import { isActiveRole, roleParts } from './roles';
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
  const canView = isOwner || isAdmin || isBillingManager;
  return {
    isOwner,
    isAdmin,
    isBillingManager,
    canView,
    canManage: isOwner || isBillingManager,
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
}

/** Owners first (fixed), then billing managers by the day they were added. */
export async function listBillingHolders(db: BillingReadDb, orgId: string): Promise<readonly BillingManagerRow[]> {
  const members = await db
    .select({ userId: member.userId, role: member.role, name: user.name, email: user.email })
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
  }));
  for (const row of managerRows) {
    const person = byId.get(row.userId);
    // A manager who left the org or who is an owner anyway is not listed twice or at all.
    if (!person || ownerIds.has(row.userId)) continue;
    out.push({ userId: row.userId, name: person.name, email: person.email, kind: 'manager', addedAt: row.createdAt });
  }
  return out;
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
  const removed = await rt.db
    .delete(billingManagers)
    .where(and(eq(billingManagers.orgId, input.orgId), eq(billingManagers.userId, input.userId)))
    .returning({ userId: billingManagers.userId });
  if (removed.length === 0) return billingError('not_found', 'That person is not a billing manager.');
  const [person] = await rt.db.select({ name: user.name }).from(user).where(eq(user.id, input.userId));
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
