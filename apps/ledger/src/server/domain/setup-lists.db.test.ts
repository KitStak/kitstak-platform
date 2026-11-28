/**
 * Phase 1 on the real database (docs/ledger/SPEC.md 13, "1. Customers and vendors"), as the plain
 * role with the guard on. A throwaway org; the org cascade removes it at the end.
 *
 * Proves:
 *   - the five setup streams round trip: export, then import reads every row unchanged; an import
 *     with one bad row is all or nothing, or skips that row when asked;
 *   - unique names and codes for customers, vendors, items, tax rates, terms and accounts;
 *   - archive keeps history (the vendor is still there by id, leaves the list, frees its name);
 *   - a vendor added in Ledger is visible to a Crew style reader of core.vendors, and Ledger never
 *     drops the temp_agency kind Crew added unless the person confirms; archiving a temp agency
 *     needs the Crew confirmation;
 *   - a tax rate an invoice line uses keeps its rate (domain and trigger KL006);
 *   - rights per role on each setup screen and stream.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { dbGuardStatus } from '@/server/db/system';
import { ensureLedgerSetup } from '@/server/domain/setup';
import { createAccount, listChart, setAccountArchived, updateAccount } from '@/server/domain/chart';
import { createCustomer, getCustomer, listCustomers, updateCustomer } from '@/server/domain/customers';
import { createItem, listItems, setItemArchived } from '@/server/domain/items';
import { setMapping } from '@/server/domain/mappings';
import { exportSetupStream } from '@/server/domain/setup-csv';
import { checkSetupImport, commitSetupImport, getImportBatch, importErrorReport } from '@/server/domain/setup-import';
import { createTaxRate, listTaxRates, updateTaxRate } from '@/server/domain/tax-rates';
import { createTerms, setTermsArchived } from '@/server/domain/terms';
import { archiveVendor, createVendor, getVendor, listVendors, restoreVendor, updateVendor } from '@/server/domain/vendors';
import { isDomainError } from '@/server/errors';
import { SETUP_STREAMS, type SetupStream } from '@/server/csv/streams';
import type { LedgerRole } from '@/lib/permissions';
import type { VendorKind } from '@/lib/vendor-kinds';
import type { DomainContext } from './_shared';
import { createTestOrg, databaseReady, TEST_DATABASE_URL, type TestOrg } from '@/test/db';

const ready = (await databaseReady()) && (await dbGuardStatus()).ready;

async function codeOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    if (isDomainError(error)) return error.code;
    throw error;
  }
}

const vendorInput = (name: string, kinds: VendorKind[] = ['supplier']) => ({
  name,
  kinds,
  email: null,
  phone: null,
  address: null,
  notes: null,
  termsId: null,
  defaultAccountId: null,
  tracks1099: false,
  w9OnFile: false,
});

const customerInput = (code: string, name: string) => ({
  code,
  name,
  phone: null,
  billingContactName: null,
  billingEmails: [`ap@${code.toLowerCase()}.example`],
  billingAddress: { line1: '1 Dock St', city: 'Austin', region: 'TX', postalCode: '78701', country: 'US' },
  termsId: null,
  defaultTaxRateId: null,
  taxExempt: false,
  exemptionNote: null,
  remindersEnabled: true,
  notes: 'Pays by ACH, comma, and "quotes"',
});

describe.skipIf(!ready)('customers, vendors and the setup lists on the database', () => {
  let org: TestOrg;
  let owner: DomainContext;
  const roles = {} as Record<Exclude<LedgerRole, 'owner'>, DomainContext>;
  let revenueId: string;
  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 2 });

  beforeAll(async () => {
    vi.stubEnv('LEDGER_DB_GUARD', '1');
    org = await createTestOrg('ledger-setup');
    owner = await org.member('owner', 'Setup Owner');
    await ensureLedgerSetup(org.orgId);
    for (const role of ['admin', 'bookkeeper', 'approver', 'viewer', 'submitter', 'none'] as const) {
      const ctx = await org.member('member', `Setup ${role}`);
      if (role !== 'none') await org.query('insert into ledger.member_roles (org_id, user_id, role) values ($1, $2, $3)', [org.orgId, ctx.userId, role]);
      roles[role] = ctx;
    }
    const [revenue] = await org.query<{ id: string }>(`select id from ledger.accounts where org_id = $1 and number = '4100'`, [org.orgId]);
    revenueId = revenue!.id;
    // A few records so every stream has rows to export.
    await createCustomer(owner, customerInput('HRB', 'Harbor Roast Collective'));
    await createVendor(owner, { ...vendorInput('Ridgeway Packaging'), email: 'ar@ridgeway.example', tracks1099: true });
    const rate = await createTaxRate(owner, { name: 'Texas: Austin 8.25%', rateMillionths: 82500, accountId: null, agency: 'Texas Comptroller' });
    await createItem(owner, { code: 'STOR', name: 'Storage, pallet months', description: null, unitLabel: 'pallet month', defaultPrice: '18.5000', accountId: revenueId, taxRateId: null });
    await createItem(owner, { code: 'LABEL', name: 'Labels', description: 'Printed, applied', unitLabel: 'label', defaultPrice: '0.0350', accountId: revenueId, taxRateId: rate });
  });

  afterAll(async () => {
    await org?.destroy();
    await pool.end();
  });

  it.each(SETUP_STREAMS)('round trips the %s stream: the export reads back unchanged', async (stream: SetupStream) => {
    const file = await exportSetupStream(owner, stream);
    expect(file.rows).toBeGreaterThan(0);
    expect(file.fileName).toBe(`ledger-${stream.replace('_', '-')}-${org.slug}.csv`);
    const { batchId, counts } = await checkSetupImport(owner, { stream, fileName: file.fileName, text: file.csv });
    expect(counts).toEqual({ create: 0, update: 0, unchanged: file.rows, error: 0, total: file.rows });
    const committed = await commitSetupImport(owner, batchId, { skipBadRows: false });
    expect(committed.unchanged).toBe(file.rows);
  });

  it('imports each stream with one bad row: all or nothing, then skipping the bad row', async () => {
    const files: Record<SetupStream, string> = {
      customers: 'customer_code,name,billing_emails,terms,tax_exempt\nNVF,NovaForge Electronics,ap@novaforge.example,Net 30,no\nBAD,Bad Row,not an email,Net 30,no\n',
      vendors: 'Vendor,Kinds,Email,Track payments for 1099\nBluewater Freight,carrier,ap@bluewater.example,no\nWrong Kind Co,spaceship,,no\n',
      items: 'item_code,name,default_price,account_number,tax_rate\nKIT,Kit assembly,2.75,4000,\nBADITEM,Bad item,1.00,9999,\n',
      accounts: 'account_number,name,type,parent_number\n6810,Card fees,expense,6800\n6811,Odd,spaceship,\n',
      tax_rates: 'name,rate_pct,agency\nTexas: Travis 6.25%,6.25,Texas Comptroller\nToo high,30,\n',
    };
    for (const stream of SETUP_STREAMS) {
      const { batchId, counts } = await checkSetupImport(owner, { stream, fileName: `${stream}.csv`, text: files[stream] });
      expect(counts, stream).toMatchObject({ create: 1, error: 1, total: 2 });
      expect(await codeOf(commitSetupImport(owner, batchId, { skipBadRows: false })), stream).toBe('VALIDATION');
      const report = await importErrorReport(owner, batchId);
      expect(report.csv.split('\r\n')[1], stream).toMatch(/^3,/);
      const done = await commitSetupImport(owner, batchId, { skipBadRows: true });
      expect(done, stream).toMatchObject({ create: 1, error: 1 });
      const view = await getImportBatch(owner, batchId);
      expect(view.batch.status).toBe('committed');
      expect(view.rows.map((row) => row.action).sort()).toEqual(['create', 'skip']);
    }
    expect((await listCustomers(owner)).map((row) => row.code)).toContain('NVF');
    expect((await listVendors(owner)).map((row) => row.name)).toContain('Bluewater Freight');
    const chart = await listChart(owner);
    expect(chart.find((row) => row.number === '6810')?.parentNumber).toBe('6800');
    expect((await listTaxRates(owner)).find((row) => row.name === 'Texas: Travis 6.25%')?.rateMillionths).toBe(62500);
  });

  it('refuses a second commit of the same import', async () => {
    const file = await exportSetupStream(owner, 'items');
    const { batchId } = await checkSetupImport(owner, { stream: 'items', fileName: null, text: file.csv });
    await commitSetupImport(owner, batchId, { skipBadRows: false });
    expect(await codeOf(commitSetupImport(owner, batchId, { skipBadRows: false }))).toBe('CONFLICT');
  });

  it('enforces unique names and codes', async () => {
    expect(await codeOf(createCustomer(owner, customerInput('hrb', 'Another Harbor')))).toBe('CONFLICT');
    expect(await codeOf(createCustomer(owner, customerInput('HRC', 'harbor roast collective')))).toBe('CONFLICT');
    expect(await codeOf(createVendor(owner, vendorInput('RIDGEWAY packaging')))).toBe('CONFLICT');
    expect(await codeOf(createItem(owner, { code: 'stor', name: 'Dup', description: null, unitLabel: null, defaultPrice: null, accountId: revenueId, taxRateId: null }))).toBe('CONFLICT');
    expect(await codeOf(createTaxRate(owner, { name: 'TEXAS: AUSTIN 8.25%', rateMillionths: 82500, accountId: null, agency: null }))).toBe('CONFLICT');
    expect(await codeOf(createTerms(owner, { name: 'net 30', kind: 'net_days', days: 30, dayOfMonth: null }))).toBe('CONFLICT');
    expect(await codeOf(createAccount(owner, { number: '4100', name: 'Dup', type: 'revenue', subtype: 'revenue', parentId: null, description: null, pulseCostCategory: null }))).toBe('CONFLICT');
    // The database holds the live unique keys too, past the domain.
    const [item] = await org.query<{ id: string }>(`select id from ledger.items where org_id = $1 and code = 'STOR'`, [org.orgId]);
    await expect(pool.query(`insert into ledger.items (org_id, code, name, account_id) values ($1, 'Stor', 'Dup', $2)`, [org.orgId, revenueId])).rejects.toMatchObject({ code: '23505' });
    await expect(pool.query(`insert into ledger.tax_rates (org_id, name, rate_millionths, account_id) select org_id, 'texas: austin 8.25%', 1, account_id from ledger.tax_rates where org_id = $1 limit 1`, [org.orgId])).rejects.toMatchObject({ code: '23505' });
    expect(item).toBeTruthy();
  });

  it('keeps a customer code and refuses a stale save', async () => {
    const [customer] = (await listCustomers(owner)).filter((row) => row.code === 'HRB');
    const detail = await getCustomer(owner, customer!.id);
    await updateCustomer(owner, detail.id, { ...customerInput('HRB', 'Harbor Roast Collective'), termsId: null, billingEmails: ['ap@harborroast.example', 'owen@harborroast.example'] }, detail.version);
    expect((await getCustomer(owner, detail.id)).billingEmails).toEqual(['ap@harborroast.example', 'owen@harborroast.example']);
    expect(await codeOf(updateCustomer(owner, detail.id, customerInput('HRB', 'Harbor Roast Collective'), detail.version))).toBe('CONFLICT');
    expect(await codeOf(updateCustomer(owner, detail.id, customerInput('HRX', 'Harbor Roast Collective'), detail.version + 1))).toBe('VALIDATION');
  });

  it('shows a vendor added in Ledger to a Crew style reader of core.vendors', async () => {
    const id = await createVendor(owner, vendorInput('Northstar Staffing', ['temp_agency']));
    // Crew reads core.vendors directly (its own bridge), by kind, live only.
    const crew = await pool.query<{ id: string; name: string; kinds: string[] }>(
      `select id, name, kinds from core.vendors where org_id = $1 and 'temp_agency' = any(kinds) and archived_at is null and deleted_at is null`,
      [org.orgId],
    );
    expect(crew.rows).toEqual([{ id, name: 'Northstar Staffing', kinds: ['temp_agency'] }]);
  });

  it('never drops a kind another app added without a yes, and an import only adds kinds', async () => {
    const id = await createVendor(owner, vendorInput('Maple Industrial Properties', ['landlord']));
    // Crew adds temp_agency on its own (core.vendors is shared).
    await pool.query(`update core.vendors set kinds = array_append(kinds, 'temp_agency'), version = version + 1 where id = $1`, [id]);
    let vendor = await getVendor(owner, id);
    expect(vendor.kinds).toEqual(['temp_agency', 'landlord']);
    expect(vendor.ledgerKinds).toEqual(['landlord']);
    // An import naming only landlord and utility keeps temp_agency.
    const { batchId } = await checkSetupImport(owner, { stream: 'vendors', fileName: null, text: 'name,kinds\nMaple Industrial Properties,"landlord, utility"\n' });
    await commitSetupImport(owner, batchId, { skipBadRows: false });
    vendor = await getVendor(owner, id);
    expect(vendor.kinds).toEqual(['temp_agency', 'landlord', 'utility']);
    // The screen without temp_agency is refused until the person confirms.
    expect(await codeOf(updateVendor(owner, id, vendorInput('Maple Industrial Properties', ['supplier']), { version: vendor.version }))).toBe('CONFLICT');
    expect((await getVendor(owner, id)).kinds).toContain('temp_agency');
    // Ledger's own kinds come off with no question.
    await updateVendor(owner, id, { ...vendorInput('Maple Industrial Properties', []), kinds: ['temp_agency', 'landlord'] }, { version: vendor.version });
    vendor = await getVendor(owner, id);
    expect(vendor.kinds).toEqual(['temp_agency', 'landlord']);
    await updateVendor(owner, id, { ...vendorInput('Maple Industrial Properties', []), kinds: ['landlord'] }, { version: vendor.version, confirmRemoveKinds: ['temp_agency'] });
    expect((await getVendor(owner, id)).kinds).toEqual(['landlord']);
  });

  it('archives a vendor and keeps its history; a temp agency needs the Crew yes', async () => {
    const id = await createVendor(owner, vendorInput('City Power and Light', ['supplier']));
    await archiveVendor(owner, id);
    expect((await listVendors(owner)).some((row) => row.id === id)).toBe(false);
    expect((await listVendors(owner, { archived: true })).some((row) => row.id === id)).toBe(true);
    expect((await getVendor(owner, id)).archivedAt).not.toBeNull();
    const [still] = await org.query<{ n: number }>(`select count(*)::int as n from core.vendors where id = $1`, [id]);
    expect(still!.n).toBe(1);
    // The name is free again; bringing the old one back is refused while it is taken.
    const second = await createVendor(owner, vendorInput('City Power and Light'));
    expect(await codeOf(restoreVendor(owner, id))).toBe('CONFLICT');
    await archiveVendor(owner, second);
    await restoreVendor(owner, id);
    expect((await getVendor(owner, id)).archivedAt).toBeNull();

    const [agency] = (await listVendors(owner)).filter((row) => row.name === 'Northstar Staffing');
    expect(await codeOf(archiveVendor(owner, agency!.id))).toBe('CONFLICT');
    await archiveVendor(owner, agency!.id, { confirmCrew: true });
    expect((await getVendor(owner, agency!.id)).archivedAt).not.toBeNull();
  });

  it('archives items, terms and accounts, but never a system account or one still in use', async () => {
    const [item] = (await listItems(owner)).filter((row) => row.code === 'KIT');
    await setItemArchived(owner, item!.id, true);
    expect((await listItems(owner)).some((row) => row.code === 'KIT')).toBe(false);
    const [ar] = (await listChart(owner)).filter((row) => row.systemKey === 'ar');
    expect(await codeOf(setAccountArchived(owner, ar!.id, true))).toBe('CONFLICT');
    expect(await codeOf(updateAccount(owner, ar!.id, { number: ar!.number, name: 'Receivables', type: 'expense', subtype: 'receivable', parentId: null, description: null, pulseCostCategory: null }, ar!.version))).toBe('CONFLICT');
    await updateAccount(owner, ar!.id, { number: ar!.number, name: 'Money customers owe', type: 'asset', subtype: 'receivable', parentId: null, description: null, pulseCostCategory: null }, ar!.version);
    expect(await codeOf(setAccountArchived(owner, revenueId, true))).toBe('CONFLICT');
    const terms = await createTerms(owner, { name: 'Net 20', kind: 'net_days', days: 20, dayOfMonth: null });
    await setTermsArchived(owner, terms, true);
    const [def] = await org.query<{ id: string }>(`select id from ledger.terms where org_id = $1 and is_default`, [org.orgId]);
    expect(await codeOf(setTermsArchived(owner, def!.id, true))).toBe('CONFLICT');
  });

  it('keeps the rate of a tax rate an invoice line uses', async () => {
    const [rate] = (await listTaxRates(owner)).filter((row) => row.name === 'Texas: Austin 8.25%');
    const [customer] = await org.query<{ id: string }>(`select id from core.customers where org_id = $1 and code = 'HRB'`, [org.orgId]);
    const invoiceId = randomUUID();
    await pool.query(`insert into ledger.invoices (id, org_id, customer_id, issue_date) values ($1, $2, $3, '2026-11-20')`, [invoiceId, org.orgId, customer!.id]);
    await pool.query(
      `insert into ledger.invoice_lines (org_id, invoice_id, description, quantity, unit_price, amount_cents, account_id, tax_rate_id, rate_millionths, tax_cents)
       values ($1, $2, 'Labels', 3000, 0.035, 10500, $3, $4, 82500, 866)`,
      [org.orgId, invoiceId, revenueId, rate!.id],
    );
    const used = (await listTaxRates(owner)).find((row) => row.id === rate!.id)!;
    expect(used.inUse).toBe(true);
    expect(await codeOf(updateTaxRate(owner, used.id, { name: used.name, rateMillionths: 85000, accountId: used.accountId, agency: used.agency }, used.version))).toBe('CONFLICT');
    await updateTaxRate(owner, used.id, { name: 'Austin 8.25%', rateMillionths: 82500, accountId: used.accountId, agency: used.agency }, used.version);
    await expect(pool.query(`update ledger.tax_rates set rate_millionths = 90000 where id = $1`, [used.id])).rejects.toMatchObject({ code: 'KL006' });
    const { counts } = await checkSetupImport(owner, { stream: 'tax_rates', fileName: null, text: 'name,rate_pct\nAustin 8.25%,9\n' });
    expect(counts.error).toBe(1);
  });

  it('gives each role only its rights on the setup screens and streams', async () => {
    const tryAll = (ctx: DomainContext) => ({
      settings: codeOf(createItem(ctx, { code: `R${randomUUID().slice(0, 6)}`, name: 'Role item', description: null, unitLabel: null, defaultPrice: null, accountId: revenueId, taxRateId: null })),
      tax: codeOf(createTaxRate(ctx, { name: `Rate ${randomUUID().slice(0, 6)}`, rateMillionths: 1000, accountId: null, agency: null })),
      mapping: codeOf(setMapping(ctx, 'wms_operation', 'Storage', null)),
      customer: codeOf(createCustomer(ctx, customerInput(`C${randomUUID().slice(0, 6)}`, `Customer ${randomUUID().slice(0, 6)}`))),
      vendor: codeOf(createVendor(ctx, vendorInput(`Vendor ${randomUUID().slice(0, 6)}`))),
      readCustomers: codeOf(listCustomers(ctx)),
      readVendors: codeOf(listVendors(ctx)),
      exportItems: codeOf(exportSetupStream(ctx, 'items')),
      importItems: codeOf(checkSetupImport(ctx, { stream: 'items', fileName: null, text: 'item_code,name,account_number\nX1,X,4100\n' })),
    });
    const answer = async (ctx: DomainContext) => Object.fromEntries(await Promise.all(Object.entries(tryAll(ctx)).map(async ([key, value]) => [key, await value] as const)));
    const ok = null;
    const no = 'FORBIDDEN';
    expect(await answer(roles.admin)).toEqual({ settings: ok, tax: ok, mapping: ok, customer: ok, vendor: ok, readCustomers: ok, readVendors: ok, exportItems: ok, importItems: ok });
    expect(await answer(roles.bookkeeper)).toEqual({ settings: no, tax: no, mapping: no, customer: ok, vendor: ok, readCustomers: ok, readVendors: ok, exportItems: ok, importItems: no });
    expect(await answer(roles.viewer)).toEqual({ settings: no, tax: no, mapping: no, customer: no, vendor: no, readCustomers: ok, readVendors: ok, exportItems: ok, importItems: no });
    for (const role of ['approver', 'submitter', 'none'] as const) {
      expect(await answer(roles[role]), role).toEqual({ settings: no, tax: no, mapping: no, customer: no, vendor: no, readCustomers: no, readVendors: no, exportItems: no, importItems: no });
    }
    // A bookkeeper may bring customers and vendors in, not the chart or tax rates.
    expect(await codeOf(checkSetupImport(roles.bookkeeper, { stream: 'vendors', fileName: null, text: 'name\nBookkeeper Vendor\n' }))).toBe(null);
    expect(await codeOf(checkSetupImport(roles.bookkeeper, { stream: 'accounts', fileName: null, text: 'account_number,name,type\n7000,X,expense\n' }))).toBe('FORBIDDEN');
  });
});
