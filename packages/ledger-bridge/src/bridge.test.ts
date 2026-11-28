import type { SQL } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  canClaim,
  ledgerAvailability,
  ledgerOpenFor,
  ledgerUrls,
  listLedgerAccess,
  NO_ACCESS,
  parseOrgRole,
  resolveAccess,
  resolveLedgerAccess,
  rightsFor,
  roleHas,
  usesSeat,
  LEDGER_STATUS_LABELS,
  type BridgeExecutor,
  type ResolvedMember,
} from './index';

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';

/** A fake executor that answers every statement with `rows`, or throws `error`. */
function fakeDb(answer: { rows?: unknown[]; error?: Error }): BridgeExecutor {
  const db: BridgeExecutor = {
    execute: async (_query: SQL) => {
      if (answer.error) throw answer.error;
      return { rows: answer.rows ?? [] };
    },
    transaction: async (fn) => fn(db),
  };
  return db;
}

const missingSchema = () => fakeDb({ error: Object.assign(new Error('relation "ledger.member_roles" does not exist'), { code: '42P01' }) });

describe('rights table (SPEC 3.3)', () => {
  it('keeps approving and paying apart', () => {
    expect(roleHas('approver', 'bill:approve')).toBe(true);
    expect(roleHas('approver', 'bill:pay')).toBe(false);
    expect(roleHas('bookkeeper', 'bill:pay')).toBe(true);
    expect(roleHas('bookkeeper', 'bill:approve')).toBe(false);
    expect(roleHas('bookkeeper', 'bill:approve', true)).toBe(true);
  });

  it('gives money owed to you only to owner, admin, bookkeeper and viewer', () => {
    for (const role of ['owner', 'admin', 'bookkeeper', 'viewer'] as const) expect(roleHas(role, 'money:read')).toBe(true);
    for (const role of ['approver', 'submitter', 'none'] as const) expect(roleHas(role, 'money:read')).toBe(false);
  });

  it('keeps reopen and purge for the owner alone', () => {
    expect(roleHas('owner', 'period:reopen')).toBe(true);
    expect(roleHas('admin', 'period:reopen')).toBe(false);
    expect(roleHas('admin', 'period:close')).toBe(true);
    expect(roleHas('admin', 'data:purge')).toBe(false);
  });

  it('lets a submitter only submit expenses, and none nothing', () => {
    expect(rightsFor('submitter')).toEqual(['expense:submit']);
    expect(rightsFor('none')).toEqual([]);
  });

  it('counts seats without submitters', () => {
    expect(usesSeat('submitter')).toBe(false);
    expect(usesSeat('none')).toBe(false);
    expect(usesSeat('approver')).toBe(true);
  });
});

describe('resolveAccess (SPEC 3.2)', () => {
  it('reads the org role when there is no explicit row', () => {
    expect(resolveAccess({ explicit: null, orgRole: 'owner', defaultMemberRole: 'none' }).role).toBe('owner');
    expect(resolveAccess({ explicit: null, orgRole: 'admin', defaultMemberRole: 'none' }).role).toBe('admin');
    expect(resolveAccess({ explicit: null, orgRole: 'member', defaultMemberRole: 'none' }).role).toBe('none');
    expect(resolveAccess({ explicit: null, orgRole: 'member', defaultMemberRole: 'submitter' }).role).toBe('submitter');
  });

  it('never lets the default member role be more than submitter', () => {
    expect(resolveAccess({ explicit: null, orgRole: 'member', defaultMemberRole: 'admin' }).role).toBe('none');
  });

  it('an explicit row wins over the org role', () => {
    const access = resolveAccess({ explicit: { role: 'viewer', canApproveBills: false, seesBalances: false }, orgRole: 'admin', defaultMemberRole: 'none' });
    expect(access).toMatchObject({ role: 'viewer', source: 'explicit' });
  });

  it('a person outside the org has no access, whatever the row says', () => {
    expect(resolveAccess({ explicit: { role: 'owner', canApproveBills: false, seesBalances: false }, orgRole: null, defaultMemberRole: 'none' })).toEqual(NO_ACCESS);
  });

  it('sees balances with money:read or the per person switch', () => {
    expect(resolveAccess({ explicit: null, orgRole: 'member', defaultMemberRole: 'none' }).seesBalances).toBe(false);
    expect(resolveAccess({ explicit: { role: 'none', canApproveBills: false, seesBalances: true }, orgRole: 'member', defaultMemberRole: 'none' }).seesBalances).toBe(true);
    expect(resolveAccess({ explicit: null, orgRole: 'owner', defaultMemberRole: 'none' }).seesBalances).toBe(true);
  });

  it('parses Better Auth role lists and refuses deactivated members', () => {
    expect(parseOrgRole('member,admin')).toBe('admin');
    expect(parseOrgRole('deactivated:admin')).toBeNull();
    expect(parseOrgRole(null)).toBeNull();
  });
});

describe('claim step', () => {
  const member = (userId: string, role: ResolvedMember['access']['role']): ResolvedMember => ({ userId, access: { ...NO_ACCESS, role } });

  it('offers the claim to an admin when nobody is owner', () => {
    expect(canClaim([member('a', 'admin'), member('b', 'none')], 'a')).toBe(true);
    expect(canClaim([member('a', 'admin'), member('b', 'none')], 'b')).toBe(false);
  });

  it('never offers it once someone is owner', () => {
    expect(canClaim([member('a', 'admin'), member('b', 'owner')], 'a')).toBe(false);
  });
});

describe('reads never throw', () => {
  it('resolveLedgerAccess answers no access when the ledger schema is absent', async () => {
    await expect(resolveLedgerAccess(missingSchema(), { orgId: ORG, userId: USER })).resolves.toEqual(NO_ACCESS);
  });

  it('resolveLedgerAccess refuses ids that are not uuids without a query', async () => {
    await expect(resolveLedgerAccess(fakeDb({ error: new Error('should not run') }), { orgId: 'x', userId: USER })).resolves.toEqual(NO_ACCESS);
  });

  it('listLedgerAccess answers an empty list on error', async () => {
    await expect(listLedgerAccess(missingSchema(), ORG)).resolves.toEqual([]);
  });

  it('ledgerAvailability answers not installed when to_regclass is null', async () => {
    await expect(ledgerAvailability(fakeDb({ rows: [{ installed: false }] }))).resolves.toEqual({ available: false, reason: 'not_installed' });
    await expect(ledgerAvailability(fakeDb({ rows: [{ installed: true }] }))).resolves.toEqual({ available: true });
    await expect(ledgerAvailability(missingSchema())).resolves.toEqual({ available: false, reason: 'error' });
  });

  it('ledgerOpenFor stays closed without Ledger and follows the gate with it', async () => {
    const gate = (slug: string | null): 'full' | 'locked' => (slug === 'kitstak' ? 'full' : 'locked');
    await expect(ledgerOpenFor(fakeDb({ rows: [{ installed: false }] }), ORG, gate)).resolves.toEqual({ open: false, reason: 'not_installed' });
    await expect(ledgerOpenFor(missingSchema(), ORG, gate)).resolves.toMatchObject({ open: false });
    await expect(ledgerOpenFor(fakeDb({ rows: [{ installed: true, slug: 'kitstak' }] }), ORG, gate)).resolves.toEqual({ open: true, reason: 'open' });
    await expect(ledgerOpenFor(fakeDb({ rows: [{ installed: true, slug: 'northwind-robotics' }] }), ORG, gate)).resolves.toEqual({ open: false, reason: 'locked' });
  });
});

describe('links and words', () => {
  it('builds deep links from a base', () => {
    const urls = ledgerUrls('https://ledger.kitstak.app/');
    expect(urls.invoice('INV-1042')).toBe('https://ledger.kitstak.app/invoices/INV-1042');
    expect(urls.newInvoiceFrom({ source: 'wms', id: 'b1' })).toBe('https://ledger.kitstak.app/invoices/new?from=wms&bill=b1');
    expect(urls.close('2026-10')).toBe('https://ledger.kitstak.app/close/2026-10');
    expect(ledgerUrls().collections()).toBe('/collections');
  });

  it('uses the shared status words', () => {
    expect(LEDGER_STATUS_LABELS.partially_paid).toBe('Part paid');
  });
});
