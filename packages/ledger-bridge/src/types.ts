/**
 * Plain JSON shapes and shared constants of KitStak Ledger. Safe to import from client components
 * (`@kitstak/ledger-bridge/types`): no server code is reachable from this file.
 *
 * Money leaves the bridge as whole cents in decimal strings ("1598566"), as Ledger's API does
 * (docs/ledger/SPEC.md 2). A money field the reader may not see is `null` and the result carries
 * `moneyHidden: true`.
 */

/** Ledger roles, most to least powerful (SPEC 3.2). `none` means no access to Ledger. */
export const LEDGER_ROLES = ['owner', 'admin', 'bookkeeper', 'approver', 'viewer', 'submitter', 'none'] as const;
export type LedgerRole = (typeof LEDGER_ROLES)[number];

export function isLedgerRole(value: unknown): value is LedgerRole {
  return typeof value === 'string' && (LEDGER_ROLES as readonly string[]).includes(value);
}

export const LEDGER_ROLE_LABELS: Readonly<Record<LedgerRole, string>> = {
  owner: 'Owner',
  admin: 'Admin',
  bookkeeper: 'Bookkeeper',
  approver: 'Approver',
  viewer: 'Viewer',
  submitter: 'Expense submitter',
  none: 'No access',
};

/** Rights are a table, not ranks, because approving and paying are kept apart (SPEC 3.3). */
export const LEDGER_RIGHTS = [
  'money:read',
  'ap:read',
  'ap:queue',
  'invoice:write',
  'payment:record',
  'collections:manage',
  'writeoff:approve',
  'bill:enter',
  'bill:approve',
  'bill:pay',
  'expense:submit',
  'expense:approve',
  'bank:reconcile',
  'journal:post',
  'period:close',
  'period:reopen',
  'settings:manage',
  'roles:manage',
  'sync:manage',
  'import:run',
  'export:run',
  'data:purge',
] as const;
export type LedgerRight = (typeof LEDGER_RIGHTS)[number];

/** Who a person is in Ledger. */
export interface LedgerAccess {
  readonly role: LedgerRole;
  /** `explicit`: a `ledger.member_roles` row. `org`: the organization role. */
  readonly source: 'explicit' | 'org';
  readonly rights: readonly LedgerRight[];
  /** May see a customer's balance outside Ledger (CRM, Portal): `money:read` or the per person switch. */
  readonly seesBalances: boolean;
}

export interface LedgerReader {
  readonly orgId: string;
  readonly userId: string;
}

export type LedgerAvailability = { readonly available: true } | { readonly available: false; readonly reason: 'not_installed' | 'error' };

/** The one list of status words, used by Ledger, CRM, Pulse and Portal (SPEC section 0). */
export const LEDGER_STATUS_LABELS = {
  draft: 'Draft',
  sent: 'Sent',
  partially_paid: 'Part paid',
  paid: 'Paid',
  void: 'Void',
  overdue: 'Overdue',
  in_dispute: 'In dispute',
  open: 'Open',
  applied: 'Applied',
  approved: 'Approved',
  scheduled: 'Scheduled',
} as const;
export type LedgerStatus = keyof typeof LEDGER_STATUS_LABELS;

/** Words the siblings show for a preview org that is not let in (SPEC 3.1). */
export const LEDGER_PREVIEW_LOCKED = 'Ledger is in early preview. Ask KitStak to add your workspace.';
