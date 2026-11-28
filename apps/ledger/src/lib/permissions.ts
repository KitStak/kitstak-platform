/**
 * Ledger roles and rights (docs/ledger/SPEC.md 3.2 and 3.3). The table itself lives in
 * `@kitstak/ledger-bridge/rights`, so Ledger and the sibling apps can never disagree. Pure module,
 * safe in client components; the server re-checks every read and write.
 */
import { rightsFor, roleHas, usesSeat, LEDGER_SEATS } from '@kitstak/ledger-bridge/rights';
import { LEDGER_RIGHTS, LEDGER_ROLES, LEDGER_ROLE_LABELS, isLedgerRole, type LedgerRight, type LedgerRole } from '@kitstak/ledger-bridge/types';

export { rightsFor, roleHas, usesSeat, LEDGER_SEATS, LEDGER_RIGHTS, LEDGER_ROLES, LEDGER_ROLE_LABELS, isLedgerRole };
export type { LedgerRight, LedgerRole };

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

/** What a role may give to others on the People screen: an admin never makes an owner. */
export function assignableRoles(actor: LedgerRole): readonly LedgerRole[] {
  if (actor === 'owner') return LEDGER_ROLES;
  if (actor === 'admin') return LEDGER_ROLES.filter((role) => role !== 'owner');
  return [];
}

/** One plain sentence per role for the People screen and the "Who handles money here?" step. */
export const LEDGER_ROLE_DESCRIPTIONS: Readonly<Record<LedgerRole, string>> = {
  owner: 'Everything, including reopening a closed month.',
  admin: 'Everything except reopening a month and removing all data.',
  bookkeeper: 'Invoices, payments, bills, expenses, bank matching and entries.',
  approver: 'Approves or sends back the bills and expenses sent to them.',
  viewer: 'Reads every screen and exports. Changes nothing.',
  submitter: 'Adds and sees their own expenses only.',
  none: 'No access to Ledger.',
};

/** Where a role lands after sign in (SPEC 6): approvers on Bills, submitters on Expenses. */
export function landingPath(role: LedgerRole): string {
  if (role === 'approver') return '/bills';
  if (role === 'submitter') return '/expenses';
  return '/';
}
