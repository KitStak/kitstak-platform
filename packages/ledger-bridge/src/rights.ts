/**
 * The rights table of SPEC 3.3, as data. Pure, safe in client components. The app's
 * `src/lib/permissions.ts` re-exports this so Ledger and its siblings read one table.
 */
import { LEDGER_RIGHTS, type LedgerRight, type LedgerRole } from './types';

type Holders = readonly Exclude<LedgerRole, 'none'>[];

const MONEY_TEAM: Holders = ['owner', 'admin', 'bookkeeper'];
const LEADS: Holders = ['owner', 'admin'];

const TABLE: Readonly<Record<LedgerRight, Holders>> = {
  'money:read': ['owner', 'admin', 'bookkeeper', 'viewer'],
  'ap:read': ['owner', 'admin', 'bookkeeper', 'viewer'],
  // An approver sees the bills and expenses sent to them, nothing else of payables.
  'ap:queue': ['owner', 'admin', 'bookkeeper', 'approver', 'viewer'],
  'invoice:write': MONEY_TEAM,
  'payment:record': MONEY_TEAM,
  'collections:manage': MONEY_TEAM,
  'writeoff:approve': LEADS,
  'bill:enter': MONEY_TEAM,
  // Bookkeepers approve bills only with the per person switch (`canApproveBills`).
  'bill:approve': ['owner', 'admin', 'approver'],
  'bill:pay': MONEY_TEAM,
  'expense:submit': ['owner', 'admin', 'bookkeeper', 'approver', 'submitter'],
  'expense:approve': ['owner', 'admin', 'bookkeeper', 'approver'],
  'bank:reconcile': MONEY_TEAM,
  'journal:post': MONEY_TEAM,
  'period:close': LEADS,
  'period:reopen': ['owner'],
  'settings:manage': LEADS,
  'roles:manage': LEADS,
  'sync:manage': LEADS,
  'import:run': MONEY_TEAM,
  'export:run': ['owner', 'admin', 'bookkeeper', 'viewer'],
  'data:purge': ['owner'],
};

/** Every right a role holds. `canApproveBills` is the bookkeeper switch for `bill:approve`. */
export function rightsFor(role: LedgerRole, canApproveBills = false): readonly LedgerRight[] {
  if (role === 'none') return [];
  return LEDGER_RIGHTS.filter((right) => (TABLE[right] as readonly string[]).includes(role) || (right === 'bill:approve' && role === 'bookkeeper' && canApproveBills));
}

export function roleHas(role: LedgerRole, right: LedgerRight, canApproveBills = false): boolean {
  return rightsFor(role, canApproveBills).includes(right);
}

/** Roles that use one of the 5 included seats (submitters and none do not, SPEC 3.3). */
export function usesSeat(role: LedgerRole): boolean {
  return role !== 'none' && role !== 'submitter';
}

export const LEDGER_SEATS = 5;
