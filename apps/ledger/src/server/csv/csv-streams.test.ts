/**
 * The setup streams without a database (docs/ledger/SPEC.md 7): reading cells into canonical text,
 * header aliases (QuickBooks export columns), and the check step's plan for each kind of row.
 */
import { describe, expect, it } from 'vitest';
import { mapHeaders } from '@/lib/csv/headers';
import { parseCsv } from '@/lib/csv/parse';
import { toCsv, unguardFormula } from '@/lib/csv/write';
import { priceForDb, priceText, ratePctText, readEmailList, readPrice, readRatePct, readYesNo } from './cells';
import { planRows, type ExistingRecord } from './plan';
import { STREAMS, blankRecord, readRow, type Lookups } from './streams';

const lookups: Lookups = {
  terms: new Map([
    ['net 30', 'Net 30'],
    ['due on receipt', 'Due on receipt'],
  ]),
  taxRates: new Map([['texas: austin 8.25%', 'Texas: Austin 8.25%']]),
  accounts: new Map([
    ['4100', { number: '4100', type: 'revenue', systemKey: null }],
    ['4000', { number: '4000', type: 'revenue', systemKey: 'default_revenue' }],
    ['2200', { number: '2200', type: 'liability', systemKey: 'sales_tax' }],
    ['6000', { number: '6000', type: 'expense', systemKey: null }],
  ]),
};

describe('cells', () => {
  it('reads prices with 2 to 4 decimals and writes them back for the database', () => {
    expect(readPrice('$18.5')).toEqual({ ok: true, value: '18.50' });
    expect(readPrice('0.035')).toEqual({ ok: true, value: '0.035' });
    expect(readPrice('1,234.5')).toEqual({ ok: true, value: '1234.50' });
    expect(readPrice('0.12345').ok).toBe(false);
    expect(readPrice('-1').ok).toBe(false);
    expect(readPrice('1000000').ok).toBe(false);
    expect(priceForDb('18.50')).toBe('18.5000');
    expect(priceText('18.5000')).toBe('18.50');
    expect(priceText('0.0350')).toBe('0.035');
  });

  it('reads a rate percent into millionths and back (8.25% is 82500)', () => {
    expect(readRatePct('8.25')).toEqual({ ok: true, value: 82500 });
    expect(readRatePct('7.125%')).toEqual({ ok: true, value: 71250 });
    expect(readRatePct('25')).toEqual({ ok: true, value: 250000 });
    expect(readRatePct('25.0001').ok).toBe(false);
    expect(readRatePct('8.12345').ok).toBe(false);
    expect(ratePctText(82500)).toBe('8.25');
    expect(ratePctText(71250)).toBe('7.125');
    expect(ratePctText(0)).toBe('0');
  });

  it('reads yes or no and email lists', () => {
    expect(readYesNo('TRUE')).toEqual({ ok: true, value: 'yes' });
    expect(readYesNo('off')).toEqual({ ok: true, value: 'no' });
    expect(readYesNo('maybe').ok).toBe(false);
    expect(readEmailList('AP@Harbor.example; ap@harbor.example, owen@harbor.example')).toEqual({ ok: true, value: 'ap@harbor.example, owen@harbor.example' });
    expect(readEmailList('not an email').ok).toBe(false);
  });

  it('keeps a formula guarded cell exact through write and read', () => {
    const csv = toCsv(['name', 'notes'], [['=SUM(A1)', '- call first']]);
    const parsed = parseCsv(csv);
    expect(parsed.headers).toEqual(['name', 'notes']);
    expect(parsed.rows[0]?.map(unguardFormula)).toEqual(['=SUM(A1)', '- call first']);
  });
});

describe('headers', () => {
  it('maps QuickBooks customer export headers to the customer columns', () => {
    const mapping = mapHeaders(['Customer', 'Customer ID', 'Email', 'Phone', 'Billing Street', 'Billing City', 'Billing State', 'Billing ZIP', 'Terms'], STREAMS.customers.columns);
    expect(mapping.columns).toEqual(['name', 'customer_code', 'billing_emails', 'phone', 'billing_address_1', 'city', 'state', 'postal_code', 'terms']);
    expect(mapping.missingRequired).toEqual([]);
  });

  it('says which needed columns a file lacks', () => {
    expect(mapHeaders(['name', 'rate'], STREAMS.tax_rates.columns).missingRequired).toEqual([]);
    expect(mapHeaders(['Account', 'Type'], STREAMS.accounts.columns).missingRequired).toEqual(['account_number']);
  });
});

describe('readRow', () => {
  it('reads a customer row into canonical text', () => {
    const { record, issues } = readRow('customers', { customer_code: ' HRB ', name: 'Harbor Roast', billing_emails: 'AP@harbor.example', terms: 'net 30', tax_exempt: 'no', tax_rate: 'Texas: Austin 8.25%', reminders: '' }, lookups);
    expect(issues).toEqual([]);
    expect(record).toMatchObject({ customer_code: 'HRB', name: 'Harbor Roast', billing_emails: 'ap@harbor.example', terms: 'Net 30', tax_exempt: 'no', tax_rate: 'Texas: Austin 8.25%', reminders: 'yes' });
  });

  it('names each bad cell of a row', () => {
    const { issues } = readRow('items', { item_code: '', name: 'Storage', default_price: 'abc', account_number: '6000', tax_rate: 'Nowhere 1%' }, lookups);
    expect(issues.map((issue) => issue.column)).toEqual(['item_code', 'default_price', 'account_number', 'tax_rate']);
    expect(issues.find((issue) => issue.column === 'account_number')?.message).toBe('Account 6000 is not a revenue account.');
  });

  it('reads QuickBooks account types and vendor kind words', () => {
    expect(readRow('accounts', { account_number: '1010', name: 'Savings', type: 'Bank', subtype: '' }, lookups).record).toMatchObject({ type: 'asset', subtype: 'bank' });
    expect(readRow('accounts', { account_number: '5900', name: 'Boxes', type: 'Cost of Goods Sold' }, lookups).record).toMatchObject({ type: 'expense', subtype: 'cost_of_service' });
    expect(readRow('vendors', { name: 'Northstar', kinds: 'Staffing; supplier' }, lookups).record.kinds).toBe('supplier, temp_agency');
  });
});

function existing(stream: 'customers' | 'vendors' | 'items' | 'accounts' | 'tax_rates', id: string, record: Record<string, string>, extra: Partial<ExistingRecord> = {}): ExistingRecord {
  return { id, archived: false, record: { ...blankRecord(stream), ...record }, ...extra };
}

describe('planRows', () => {
  it('reads an export back as unchanged, row by row', () => {
    const rows = [existing('tax_rates', 't1', { name: 'Texas: Austin 8.25%', rate_pct: '8.25', account_number: '2200', agency: 'Texas Comptroller' })];
    const csv = toCsv(
      STREAMS.tax_rates.columns.map((column) => column.key),
      rows.map((row) => STREAMS.tax_rates.columns.map((column) => row.record[column.key] ?? '')),
    );
    const parsed = parseCsv(csv);
    const cells = parsed.rows.map((cellsOfRow, index) => ({ rowNumber: index + 2, cells: Object.fromEntries(parsed.headers.map((header, at) => [header, cellsOfRow[at] ?? ''])) }));
    expect(planRows('tax_rates', cells, rows, lookups).map((row) => row.action)).toEqual(['unchanged']);
  });

  it('plans new, changed and problem rows, and catches a key used twice', () => {
    const rows = [existing('items', 'i1', { item_code: 'STOR', name: 'Storage', default_price: '18.50', account_number: '4100' })];
    const plan = planRows(
      'items',
      [
        { rowNumber: 2, cells: { item_code: 'stor', name: 'Storage', default_price: '19', account_number: '4100' } },
        { rowNumber: 3, cells: { item_code: 'KIT', name: 'Kit assembly', default_price: '2.75', account_number: '4000' } },
        { rowNumber: 4, cells: { item_code: 'KIT', name: 'Kit again', default_price: '2.75', account_number: '4000' } },
      ],
      rows,
      lookups,
    );
    expect(plan.map((row) => row.action)).toEqual(['update', 'create', 'error']);
    expect(plan[0]?.changes).toEqual(['default_price']);
    expect(plan[0]?.entityId).toBe('i1');
    expect(plan[2]?.issues[0]?.message).toBe('Row 3 has the same item code. Each record goes in one row.');
  });

  it('never clears a column the file does not have', () => {
    const rows = [existing('vendors', 'v1', { name: 'Ridgeway Packaging', email: 'ar@ridgeway.example', tracks_1099: 'yes' })];
    const plan = planRows('vendors', [{ rowNumber: 2, cells: { name: 'Ridgeway Packaging' } }], rows, lookups);
    expect(plan[0]?.action).toBe('unchanged');
    expect(plan[0]?.after.email).toBe('ar@ridgeway.example');
  });

  it('adds vendor kinds from a file and never removes one (Crew owns temp_agency)', () => {
    const rows = [existing('vendors', 'v1', { name: 'Northstar Staffing', kinds: 'temp_agency' })];
    const plan = planRows('vendors', [{ rowNumber: 2, cells: { name: 'northstar staffing', kinds: 'supplier' } }], rows, lookups);
    expect(plan[0]).toMatchObject({ action: 'update', changes: ['kinds'] });
    expect(plan[0]?.after.kinds).toBe('supplier, temp_agency');
  });

  it('keeps the type of an account Ledger uses, and the rate of a rate invoices use', () => {
    const accounts = planRows('accounts', [{ rowNumber: 2, cells: { account_number: '4000', name: 'Kitting', type: 'expense' } }], [existing('accounts', 'a1', { account_number: '4000', name: 'Kitting and assembly', type: 'revenue', subtype: 'revenue' }, { systemKey: 'default_revenue' })], lookups);
    expect(accounts[0]?.action).toBe('error');
    expect(accounts[0]?.issues[0]?.column).toBe('type');
    const rates = planRows('tax_rates', [{ rowNumber: 2, cells: { name: 'Texas: Austin 8.25%', rate_pct: '8.5' } }], [existing('tax_rates', 't1', { name: 'Texas: Austin 8.25%', rate_pct: '8.25', account_number: '2200' }, { inUse: true })], lookups);
    expect(rates[0]?.action).toBe('error');
    expect(rates[0]?.issues[0]?.message).toContain('used on invoices');
  });

  it('matches a customer by name when the code is new, and refuses a second code for it', () => {
    const rows = [existing('customers', 'c1', { customer_code: 'PXP', name: 'Pixel & Pine' })];
    const plan = planRows('customers', [{ rowNumber: 2, cells: { customer_code: 'PIX', name: 'pixel & pine' } }], rows, lookups);
    expect(plan[0]?.action).toBe('error');
    expect(plan[0]?.issues[0]?.message).toBe('Pixel & Pine already has the code PXP. Use that code, or another name.');
  });

  it('refuses a row for an archived record instead of making a second one', () => {
    const plan = planRows('vendors', [{ rowNumber: 2, cells: { name: 'Old Freight' } }], [{ ...existing('vendors', 'v9', { name: 'Old Freight' }), archived: true }], lookups);
    expect(plan[0]?.action).toBe('error');
    expect(plan[0]?.issues[0]?.message).toContain('is archived');
  });
});
