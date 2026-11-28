/**
 * Ledger roles in the app (docs/ledger/SPEC.md 3.2): the same resolver the siblings use
 * (`@kitstak/ledger-bridge`), over this app's database handle, plus the claim step and role
 * changes. Every export is scoped to one workspace.
 */
import 'server-only';
import { and, eq } from 'drizzle-orm';
import { canClaim, listLedgerAccess, resolveLedgerAccess, type BridgeExecutor, type ResolvedMember } from '@kitstak/ledger-bridge';
import type { LedgerAccess } from '@kitstak/ledger-bridge/types';
import { db } from '@/server/db';
import { memberRoles } from '@/server/db/schema';
import { scoped } from '@/server/db/scope';
import { DomainError, forbidden } from '@/server/errors';
import { assignableRoles, type LedgerRight, type LedgerRole } from '@/lib/permissions';
import { logActivity } from './activity';
import type { DomainContext } from './_shared';

const bridgeDb = (): BridgeExecutor => db as unknown as BridgeExecutor;

export const ledgerAccessFor = scoped(async function ledgerAccessFor(ctx: DomainContext): Promise<LedgerAccess> {
  return resolveLedgerAccess(bridgeDb(), { orgId: ctx.orgId, userId: ctx.userId });
});

export const listMemberAccess = scoped(async function listMemberAccess(ctx: DomainContext): Promise<readonly ResolvedMember[]> {
  return listLedgerAccess(bridgeDb(), ctx.orgId);
});

/** True when this person may run the claim step ("Run Ledger for this workspace"). */
export const canClaimLedger = scoped(async function canClaimLedger(ctx: DomainContext): Promise<boolean> {
  return canClaim(await listLedgerAccess(bridgeDb(), ctx.orgId), ctx.userId);
});

/** Throws FORBIDDEN unless the person holds one of `rights`. Returns their access. */
export const requireRight = scoped(async function requireRight(ctx: DomainContext, ...rights: LedgerRight[]): Promise<LedgerAccess> {
  const access = await ledgerAccessFor(ctx);
  if (!rights.some((right) => access.rights.includes(right))) throw forbidden("Your Ledger role doesn't include this.");
  return access;
});

async function upsertRole(ctx: DomainContext, userId: string, role: LedgerRole, before: LedgerRole | null): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(memberRoles)
      .values({ orgId: ctx.orgId, userId, role, updatedBy: ctx.userId })
      .onConflictDoUpdate({ target: [memberRoles.orgId, memberRoles.userId], set: { role, updatedBy: ctx.userId, updatedAt: new Date() } });
    await logActivity(tx, ctx, { verb: 'role.changed', entityType: 'member', entityId: userId, before: before ? { role: before } : null, after: { role } });
  });
}

/**
 * The claim step (SPEC 3.2): when nobody resolves to owner, the first admin who opens Ledger may
 * make themselves its owner with an explicit row.
 */
export const claimLedger = scoped(async function claimLedger(ctx: DomainContext): Promise<void> {
  const members = await listLedgerAccess(bridgeDb(), ctx.orgId);
  if (!canClaim(members, ctx.userId)) throw new DomainError('CONFLICT', 'Someone already runs Ledger for this workspace.');
  await upsertRole(ctx, ctx.userId, 'owner', 'admin');
});

/** Gives a member a Ledger role (People and roles, "Who handles money here?"). */
export const setMemberRole = scoped(async function setMemberRole(ctx: DomainContext, userId: string, role: LedgerRole): Promise<void> {
  const access = await requireRight(ctx, 'roles:manage');
  if (!assignableRoles(access.role).includes(role)) throw forbidden('Only the owner can make someone an owner.');
  const members = await listLedgerAccess(bridgeDb(), ctx.orgId);
  const target = members.find((member) => member.userId === userId);
  if (!target) throw new DomainError('NOT_FOUND', 'That person is not in this workspace.');
  if (target.access.role === 'owner' && access.role !== 'owner') throw forbidden('Only the owner can change the owner.');
  await upsertRole(ctx, userId, role, target.access.role);
});

/** For tests and the seed: the explicit row of one person, if any. */
export const explicitRole = scoped(async function explicitRole(ctx: DomainContext, userId: string): Promise<LedgerRole | null> {
  const [row] = await db.select({ role: memberRoles.role }).from(memberRoles).where(and(eq(memberRoles.orgId, ctx.orgId), eq(memberRoles.userId, userId)));
  return row?.role ?? null;
});
