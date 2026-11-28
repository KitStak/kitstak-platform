/**
 * Who a person is in Ledger. One rule, shared by the app and every sibling (SPEC 3.2). A person's
 * Ledger role is the first of these that applies:
 *   1. their row in `ledger.member_roles` (set by an admin, or by the claim step),
 *   2. their organization role: owner gives owner, admin gives admin, everyone else gives
 *      `ledger.settings.default_member_role` (`none` or `submitter`).
 * Money is never inherited from another app: a WMS manager or a Pulse supervisor gets none.
 * `resolveAccess` is the pure half; `resolveLedgerAccess` is one SQL statement plus that function.
 */
import { sql } from 'drizzle-orm';
import { isUuid, query, queryOne, type BridgeExecutor } from './executor';
import { rightsFor } from './rights';
import { isLedgerRole, type LedgerAccess, type LedgerReader, type LedgerRole } from './types';

export type OrgRole = 'owner' | 'admin' | 'member' | 'viewer' | 'guest';
const ORG_RANK: Readonly<Record<OrgRole, number>> = { owner: 5, admin: 4, member: 3, viewer: 2, guest: 1 };

/** Better Auth stores roles as a comma list ("admin,member"); CRM prefixes deactivated members. */
export function parseOrgRole(raw: string | null | undefined): OrgRole | null {
  if (!raw || raw.startsWith('deactivated:')) return null;
  let best: OrgRole | null = null;
  for (const part of raw.split(',')) {
    const role = part.trim() as OrgRole;
    if (!(role in ORG_RANK)) continue;
    if (!best || ORG_RANK[role] > ORG_RANK[best]) best = role;
  }
  return best;
}

export interface AccessInputs {
  /** The person's `ledger.member_roles` row, or null. */
  readonly explicit: { readonly role: string; readonly canApproveBills: boolean; readonly seesBalances: boolean } | null;
  /** Null when the person is not an active member of the org. */
  readonly orgRole: OrgRole | null;
  readonly defaultMemberRole: string | null;
}

export const NO_ACCESS: LedgerAccess = { role: 'none', source: 'org', rights: [], seesBalances: false };

/** Step 2 alone: the organization role. */
export function ledgerRoleFromOrgRole(orgRole: OrgRole | null, defaultMemberRole: string | null): LedgerRole {
  if (orgRole === 'owner') return 'owner';
  if (orgRole === 'admin') return 'admin';
  if (orgRole === null) return 'none';
  return defaultMemberRole === 'submitter' ? 'submitter' : 'none';
}

/** The whole resolver as one pure function. */
export function resolveAccess(input: AccessInputs): LedgerAccess {
  if (input.orgRole === null) return NO_ACCESS;
  const explicitRole = input.explicit && isLedgerRole(input.explicit.role) ? input.explicit.role : null;
  const role = explicitRole ?? ledgerRoleFromOrgRole(input.orgRole, input.defaultMemberRole);
  const rights = rightsFor(role, Boolean(explicitRole && input.explicit?.canApproveBills));
  return {
    role,
    source: explicitRole ? 'explicit' : 'org',
    rights,
    seesBalances: rights.includes('money:read') || Boolean(input.explicit?.seesBalances),
  };
}

interface AccessRow {
  readonly user_id: string;
  readonly org_role: string | null;
  readonly ledger_role: string | null;
  readonly can_approve_bills: boolean | null;
  readonly sees_balances: boolean | null;
  readonly default_member_role: string | null;
}

const inputsOf = (row: AccessRow): AccessInputs => ({
  explicit: row.ledger_role ? { role: row.ledger_role, canApproveBills: Boolean(row.can_approve_bills), seesBalances: Boolean(row.sees_balances) } : null,
  orgRole: parseOrgRole(row.org_role),
  defaultMemberRole: row.default_member_role,
});

/**
 * The person's Ledger access in this organization. A person who is not a member has no access.
 * Never throws: any error (or a database without the ledger schema) reads as "no access".
 */
export async function resolveLedgerAccess(db: BridgeExecutor, who: LedgerReader): Promise<LedgerAccess> {
  if (!isUuid(who.orgId) || !isUuid(who.userId)) return NO_ACCESS;
  try {
    const row = await queryOne<AccessRow>(
      db,
      sql`select m.user_id, m.role as org_role, mr.role as ledger_role, mr.can_approve_bills, mr.sees_balances, s.default_member_role
            from core.member m
            left join ledger.member_roles mr on mr.org_id = m.organization_id and mr.user_id = m.user_id
            left join ledger.settings s on s.org_id = m.organization_id
           where m.organization_id = ${who.orgId}::uuid and m.user_id = ${who.userId}::uuid
           limit 1`,
    );
    return row ? resolveAccess(inputsOf(row)) : NO_ACCESS;
  } catch {
    return NO_ACCESS;
  }
}

export interface ResolvedMember {
  readonly userId: string;
  readonly access: LedgerAccess;
}

/** Every member of the org with their Ledger access (People and roles, the claim step). Never throws. */
export async function listLedgerAccess(db: BridgeExecutor, orgId: string): Promise<readonly ResolvedMember[]> {
  if (!isUuid(orgId)) return [];
  try {
    const rows = await query<AccessRow>(
      db,
      sql`select m.user_id, m.role as org_role, mr.role as ledger_role, mr.can_approve_bills, mr.sees_balances, s.default_member_role
            from core.member m
            left join ledger.member_roles mr on mr.org_id = m.organization_id and mr.user_id = m.user_id
            left join ledger.settings s on s.org_id = m.organization_id
           where m.organization_id = ${orgId}::uuid`,
    );
    return rows.map((row) => ({ userId: row.user_id, access: resolveAccess(inputsOf(row)) }));
  } catch {
    return [];
  }
}

/**
 * The claim step (SPEC 3.2): when nobody resolves to owner, an admin who opens Ledger is offered
 * "Run Ledger for this workspace". Pure, over the resolved members.
 */
export function canClaim(members: readonly ResolvedMember[], userId: string): boolean {
  if (members.some((member) => member.access.role === 'owner')) return false;
  return members.find((member) => member.userId === userId)?.access.role === 'admin';
}
