import { describe, expect, it } from 'vitest';
import { CLOSE_STEPS, monthLabel, parseMonth, recentMonths } from '@/features/close/months';
import { DEFAULT_CHART, DEFAULT_NUMBERING, DEFAULT_TERMS } from './defaults';
import { SYSTEM_KEYS } from './ledger-enums';
import { chordTargets, navEntryFor, navFor } from './nav';
import { assignableRoles, landingPath, rightsFor } from './permissions';

const ids = (role: Parameters<typeof rightsFor>[0]) => navFor(rightsFor(role)).map((entry) => entry.id);

describe('navigation by role (SPEC 6)', () => {
  it('shows the seven links and the More menu to the money team', () => {
    expect(ids('bookkeeper')).toEqual(['home', 'invoices', 'collections', 'bills', 'expenses', 'bank', 'close', 'customers', 'vendors', 'payments', 'journal', 'reports', 'import', 'settings']);
  });

  it('shows approvers Bills and Expenses only, and lands them on Bills', () => {
    expect(ids('approver')).toEqual(['bills', 'expenses']);
    expect(landingPath('approver')).toBe('/bills');
  });

  it('shows submitters Expenses only, and lands them on Expenses', () => {
    expect(ids('submitter')).toEqual(['expenses']);
    expect(landingPath('submitter')).toBe('/expenses');
  });

  it('shows none nothing', () => {
    expect(ids('none')).toEqual([]);
  });

  it('maps a path to its entry and keeps the g shortcuts of the spec', () => {
    expect(navEntryFor('/invoices/INV-1042')?.id).toBe('invoices');
    expect(navEntryFor('/export')?.id).toBe('import');
    expect(navEntryFor('/')?.id).toBe('home');
    const chords = chordTargets(rightsFor('owner'));
    expect(chords).toMatchObject({ h: '/', i: '/invoices', c: '/collections', b: '/bills' });
  });

  it('never lets an admin make an owner', () => {
    expect(assignableRoles('admin')).not.toContain('owner');
    expect(assignableRoles('owner')).toContain('owner');
    expect(assignableRoles('bookkeeper')).toEqual([]);
  });
});

describe('defaults made on first read (SPEC 4.3, 4.5.2, 4.5.3)', () => {
  it('the chart has every system account once and unique numbers', () => {
    const keys = DEFAULT_CHART.flatMap((account) => (account.systemKey ? [account.systemKey] : []));
    expect([...keys].sort()).toEqual([...SYSTEM_KEYS].sort());
    expect(new Set(DEFAULT_CHART.map((account) => account.number)).size).toBe(DEFAULT_CHART.length);
  });

  it('has one default term, Net 30, and the spec numbering', () => {
    expect(DEFAULT_TERMS.filter((term) => term.isDefault).map((term) => term.name)).toEqual(['Net 30']);
    expect(DEFAULT_NUMBERING.invoice).toEqual({ prefix: 'INV-', next: 1001 });
    expect(DEFAULT_NUMBERING.journal).toEqual({ prefix: 'JE-', next: 1 });
  });
});

describe('months', () => {
  it('parses and names months', () => {
    expect(parseMonth('2026-10')).toEqual({ year: 2026, month: 10 });
    expect(parseMonth('2026-13')).toBeNull();
    expect(monthLabel('2026-10')).toBe('October 2026');
    expect(recentMonths(new Date('2026-01-15T00:00:00Z'), 2).map((month) => month.key)).toEqual(['2025-12', '2025-11']);
    expect(CLOSE_STEPS.map((step) => step.key)).toContain('bank_matched');
  });
});
