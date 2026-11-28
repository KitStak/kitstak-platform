/**
 * The five setup streams on the database (docs/ledger/SPEC.md 7): each record of the workspace as
 * canonical CSV text (what the export writes and the import check compares against), the lookups
 * a row may point at, and one planned row written through the same domain writers the screens use.
 * Exports leave out what the reader may not see and write `export.run`.
 */
import 'server-only';
import { sql } from 'drizzle-orm';
import { db, type Executor, type Transaction } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { DomainError } from '@/server/errors';
import { exportFileName, toCsv } from '@/lib/csv/write';
import type { AccountSubtype, AccountType } from '@/lib/ledger-enums';
import { VENDOR_KINDS, type VendorKind } from '@/lib/vendor-kinds';
import type { LedgerRight } from '@/lib/permissions';
import { emailListValues, priceForDb, priceText, ratePctText, readRatePct } from '@/server/csv/cells';
import type { ExistingRecord, PlannedRow } from '@/server/csv/plan';
import { STREAMS, type Canonical, type LookupAccount, type Lookups, type SetupStream } from '@/server/csv/streams';
import { requireRight } from './access';
import { logActivity } from './activity';
import { insertAccount, saveAccount, type PulseCostCategory } from './chart';
import { insertCustomer, saveCustomer, type CustomerInput, type PostalAddress } from './customers';
import { insertItem, saveItem } from './items';
import { insertTaxRate, saveTaxRate } from './tax-rates';
import { insertVendor, saveVendor, type VendorInput } from './vendors';
import type { DomainContext } from './_shared';

/** The right a person needs to bring a stream in (on top of `import:run`). */
export const STREAM_WRITE_RIGHT: Readonly<Record<SetupStream, LedgerRight>> = {
  customers: 'invoice:write',
  vendors: 'bill:enter',
  items: 'settings:manage',
  accounts: 'settings:manage',
  tax_rates: 'settings:manage',
};

/** The right a person needs to see a stream (on top of `export:run`): vendors are payables. */
export const STREAM_READ_RIGHT: Readonly<Record<SetupStream, LedgerRight>> = {
  customers: 'money:read',
  vendors: 'ap:read',
  items: 'money:read',
  accounts: 'money:read',
  tax_rates: 'money:read',
};

/** Lookups with the ids behind each canonical name or number. */
export interface IdLookups extends Lookups {
  readonly termIds: ReadonlyMap<string, string>;
  readonly taxRateIds: ReadonlyMap<string, string>;
  readonly accountIds: ReadonlyMap<string, string>;
}

export const loadLookups = scoped(async function loadLookups(executor: Executor, ctx: DomainContext): Promise<IdLookups> {
  // One after the other: inside a transaction they share one connection.
  const terms = await executor.execute<{ id: string; name: string }>(sql`select id, name from ledger.terms where org_id = ${ctx.orgId}::uuid and active`);
  const rates = await executor.execute<{ id: string; name: string }>(sql`select id, name from ledger.tax_rates where org_id = ${ctx.orgId}::uuid and archived_at is null`);
  const accounts = await executor.execute<{ id: string; number: string; type: AccountType; system_key: string | null }>(
    sql`select id, number, type, system_key from ledger.accounts where org_id = ${ctx.orgId}::uuid and archived_at is null`,
  );
  return {
    terms: new Map(terms.rows.map((row) => [row.name.toLowerCase(), row.name])),
    taxRates: new Map(rates.rows.map((row) => [row.name.toLowerCase(), row.name])),
    accounts: new Map<string, LookupAccount>(accounts.rows.map((row) => [row.number.toLowerCase(), { number: row.number, type: row.type, systemKey: row.system_key }])),
    termIds: new Map(terms.rows.map((row) => [row.name.toLowerCase(), row.id])),
    taxRateIds: new Map(rates.rows.map((row) => [row.name.toLowerCase(), row.id])),
    accountIds: new Map(accounts.rows.map((row) => [row.number.toLowerCase(), row.id])),
  };
}, 1);

const yesNo = (value: boolean | null | undefined, fallback: boolean): string => ((value ?? fallback) ? 'yes' : 'no');

async function customerRecords(executor: Executor, orgId: string): Promise<ExistingRecord[]> {
  const result = await executor.execute<{
    id: string;
    code: string;
    name: string;
    phone: string | null;
    billing_contact_name: string | null;
    billing_emails: string[] | null;
    billing_address: PostalAddress | null;
    terms_name: string | null;
    tax_exempt: boolean | null;
    tax_rate_name: string | null;
    reminders_enabled: boolean | null;
    notes: string | null;
  }>(sql`select c.id, c.code, c.name, c.phone, p.billing_contact_name, p.billing_emails, p.billing_address, t.name as terms_name,
                p.tax_exempt, r.name as tax_rate_name, p.reminders_enabled, p.notes
           from core.customers c
           left join ledger.customer_profiles p on p.org_id = c.org_id and p.customer_id = c.id
           left join ledger.terms t on t.org_id = p.org_id and t.id = p.terms_id
           left join ledger.tax_rates r on r.org_id = p.org_id and r.id = p.default_tax_rate_id
          where c.org_id = ${orgId}::uuid and c.deleted_at is null order by lower(c.code)`);
  return result.rows.map((row) => ({
    id: row.id,
    archived: false,
    record: {
      customer_code: row.code,
      name: row.name,
      billing_contact: row.billing_contact_name ?? '',
      billing_emails: (row.billing_emails ?? []).join(', '),
      phone: row.phone ?? '',
      billing_address_1: row.billing_address?.line1 ?? '',
      city: row.billing_address?.city ?? '',
      state: row.billing_address?.region ?? '',
      postal_code: row.billing_address?.postalCode ?? '',
      country: row.billing_address?.country ?? '',
      terms: row.terms_name ?? '',
      tax_exempt: yesNo(row.tax_exempt, false),
      tax_rate: row.tax_rate_name ?? '',
      reminders: yesNo(row.reminders_enabled, true),
      notes: row.notes ?? '',
    },
  }));
}

async function vendorRecords(executor: Executor, orgId: string): Promise<ExistingRecord[]> {
  const result = await executor.execute<{
    id: string;
    name: string;
    kinds: string[];
    email: string | null;
    phone: string | null;
    address: PostalAddress | null;
    notes: string | null;
    terms_name: string | null;
    account_number: string | null;
    tracks_1099: boolean | null;
    w9_on_file: boolean | null;
    archived: boolean;
  }>(sql`select v.id, v.name, v.kinds, v.email, v.phone, v.address, v.notes, t.name as terms_name, a.number as account_number,
                p.tracks_1099, p.w9_on_file, v.archived_at is not null as archived
           from core.vendors v
           left join ledger.vendor_profiles p on p.org_id = v.org_id and p.vendor_id = v.id
           left join ledger.terms t on t.org_id = p.org_id and t.id = p.terms_id
           left join ledger.accounts a on a.org_id = p.org_id and a.id = p.default_account_id
          where v.org_id = ${orgId}::uuid and v.deleted_at is null order by lower(v.name)`);
  return result.rows.map((row) => ({
    id: row.id,
    archived: row.archived,
    record: {
      name: row.name,
      kinds: VENDOR_KINDS.filter((kind) => row.kinds.includes(kind)).join(', '),
      email: row.email ?? '',
      phone: row.phone ?? '',
      address_1: row.address?.line1 ?? '',
      city: row.address?.city ?? '',
      state: row.address?.region ?? '',
      postal_code: row.address?.postalCode ?? '',
      country: row.address?.country ?? '',
      terms: row.terms_name ?? '',
      default_account: row.account_number ?? '',
      tracks_1099: yesNo(row.tracks_1099, false),
      w9_on_file: yesNo(row.w9_on_file, false),
      notes: row.notes ?? '',
    },
  }));
}

async function itemRecords(executor: Executor, orgId: string): Promise<ExistingRecord[]> {
  const result = await executor.execute<{
    id: string;
    code: string;
    name: string;
    description: string | null;
    unit_label: string | null;
    default_price: string | null;
    account_number: string;
    tax_rate_name: string | null;
    archived: boolean;
  }>(sql`select i.id, i.code, i.name, i.description, i.unit_label, i.default_price::text as default_price, a.number as account_number,
                r.name as tax_rate_name, i.archived_at is not null as archived
           from ledger.items i
           join ledger.accounts a on a.org_id = i.org_id and a.id = i.account_id
           left join ledger.tax_rates r on r.org_id = i.org_id and r.id = i.tax_rate_id
          where i.org_id = ${orgId}::uuid order by lower(i.code)`);
  return result.rows.map((row) => ({
    id: row.id,
    archived: row.archived,
    record: {
      item_code: row.code,
      name: row.name,
      description: row.description ?? '',
      unit_label: row.unit_label ?? '',
      default_price: priceText(row.default_price),
      account_number: row.account_number,
      tax_rate: row.tax_rate_name ?? '',
    },
  }));
}

async function accountRecords(executor: Executor, orgId: string): Promise<ExistingRecord[]> {
  const result = await executor.execute<{
    id: string;
    number: string;
    name: string;
    type: string;
    subtype: string;
    parent_number: string | null;
    description: string | null;
    pulse_cost_category: string | null;
    system_key: string | null;
    archived: boolean;
  }>(sql`select a.id, a.number, a.name, a.type, a.subtype, p.number as parent_number, a.description, a.pulse_cost_category, a.system_key,
                a.archived_at is not null as archived
           from ledger.accounts a left join ledger.accounts p on p.org_id = a.org_id and p.id = a.parent_id
          where a.org_id = ${orgId}::uuid order by a.number`);
  return result.rows.map((row) => ({
    id: row.id,
    archived: row.archived,
    systemKey: row.system_key,
    record: {
      account_number: row.number,
      name: row.name,
      type: row.type,
      subtype: row.subtype,
      parent_number: row.parent_number ?? '',
      description: row.description ?? '',
      pulse_cost_category: row.pulse_cost_category ?? '',
    },
  }));
}

async function taxRateRecords(executor: Executor, orgId: string): Promise<ExistingRecord[]> {
  const result = await executor.execute<{ id: string; name: string; rate_millionths: number; account_number: string; agency: string | null; archived: boolean; in_use: boolean }>(
    sql`select r.id, r.name, r.rate_millionths, a.number as account_number, r.agency, r.archived_at is not null as archived,
               (exists (select 1 from ledger.invoice_lines l where l.org_id = r.org_id and l.tax_rate_id = r.id)
                or exists (select 1 from ledger.recurring_invoice_lines l where l.org_id = r.org_id and l.tax_rate_id = r.id)) as in_use
          from ledger.tax_rates r join ledger.accounts a on a.org_id = r.org_id and a.id = r.account_id
         where r.org_id = ${orgId}::uuid order by lower(r.name)`,
  );
  return result.rows.map((row) => ({
    id: row.id,
    archived: row.archived,
    inUse: row.in_use,
    record: { name: row.name, rate_pct: ratePctText(row.rate_millionths), account_number: row.account_number, agency: row.agency ?? '' },
  }));
}

/** Every record of a stream in the workspace (archived ones flagged), as canonical CSV text. */
export const loadStreamRecords = scoped(async function loadStreamRecords(executor: Executor, ctx: DomainContext, stream: SetupStream): Promise<ExistingRecord[]> {
  switch (stream) {
    case 'customers':
      return customerRecords(executor, ctx.orgId);
    case 'vendors':
      return vendorRecords(executor, ctx.orgId);
    case 'items':
      return itemRecords(executor, ctx.orgId);
    case 'accounts':
      return accountRecords(executor, ctx.orgId);
    case 'tax_rates':
      return taxRateRecords(executor, ctx.orgId);
  }
}, 1);

/** One stream as a CSV file (live records only), in the same columns the import reads (SPEC 7.1). */
export const exportSetupStream = scoped(async function exportSetupStream(ctx: DomainContext, stream: SetupStream): Promise<{ fileName: string; csv: string; rows: number }> {
  await requireRight(ctx, 'export:run');
  await requireRight(ctx, STREAM_READ_RIGHT[stream]);
  const records = (await loadStreamRecords(db, ctx, stream)).filter((row) => !row.archived);
  const columns = STREAMS[stream].columns.map((column) => column.key);
  const csv = toCsv(
    columns,
    records.map((row) => columns.map((column) => row.record[column] ?? '')),
  );
  await logActivity(db, ctx, { verb: 'export.run', entityType: 'export', meta: { stream, rows: records.length } });
  return { fileName: exportFileName(stream, ctx.orgSlug), csv, rows: records.length };
});

/* ------------------------------------------------------------------ writing one planned row */

const lower = (text: string | undefined): string => (text ?? '').toLowerCase();
const orNull = (text: string | undefined): string | null => (text && text.trim() !== '' ? text : null);

function idOf(map: ReadonlyMap<string, string>, name: string | undefined, what: string): string | null {
  if (!name) return null;
  const id = map.get(lower(name));
  if (!id) throw new DomainError('VALIDATION', `${name} is not one of your ${what} anymore.`);
  return id;
}

function address(record: Canonical, line1Key: string): PostalAddress | null {
  const out = { line1: record[line1Key] ?? '', city: record.city ?? '', region: record.state ?? '', postalCode: record.postal_code ?? '', country: record.country ?? '' };
  return Object.values(out).some((value) => value !== '') ? out : null;
}

function customerInput(record: Canonical, lookups: IdLookups): CustomerInput {
  return {
    code: record.customer_code ?? '',
    name: record.name ?? '',
    phone: orNull(record.phone),
    billingContactName: orNull(record.billing_contact),
    billingEmails: emailListValues(record.billing_emails ?? ''),
    billingAddress: address(record, 'billing_address_1'),
    termsId: idOf(lookups.termIds, record.terms, 'payment terms'),
    defaultTaxRateId: idOf(lookups.taxRateIds, record.tax_rate, 'tax rates'),
    taxExempt: record.tax_exempt === 'yes',
    exemptionNote: null,
    remindersEnabled: record.reminders !== 'no',
    notes: orNull(record.notes),
  };
}

function vendorInput(record: Canonical, lookups: IdLookups): VendorInput {
  const kinds = (record.kinds ?? '').split(',').map((kind) => kind.trim()).filter(Boolean) as VendorKind[];
  return {
    name: record.name ?? '',
    kinds,
    email: orNull(record.email),
    phone: orNull(record.phone),
    address: address(record, 'address_1'),
    notes: orNull(record.notes),
    termsId: idOf(lookups.termIds, record.terms, 'payment terms'),
    defaultAccountId: idOf(lookups.accountIds, record.default_account, 'accounts'),
    tracks1099: record.tracks_1099 === 'yes',
    w9OnFile: record.w9_on_file === 'yes',
  };
}

/** The customer of a planned customer row keeps its profile notes on exemption: the CSV has no column for it. */
async function keepExemptionNote(tx: Transaction, orgId: string, id: string): Promise<string | null> {
  const result = await tx.execute<{ note: string | null }>(sql`select exemption_note as note from ledger.customer_profiles where org_id = ${orgId}::uuid and customer_id = ${id}::uuid`);
  return result.rows[0]?.note ?? null;
}

/**
 * Writes one planned row (create or update) inside `tx` and returns the record id. Accounts are
 * written without their parent here when the parent is new in the same file; `linkParents` sets it.
 */
export const applyPlannedRow = scoped(async function applyPlannedRow(tx: Transaction, ctx: DomainContext, stream: SetupStream, row: PlannedRow, lookups: IdLookups, meta: Record<string, unknown>): Promise<string> {
  const record = row.after;
  switch (stream) {
    case 'customers': {
      const input = customerInput(record, lookups);
      if (!row.entityId) return insertCustomer(tx, ctx, input, meta);
      await saveCustomer(tx, ctx, row.entityId, { ...input, exemptionNote: await keepExemptionNote(tx, ctx.orgId, row.entityId) }, null, meta);
      return row.entityId;
    }
    case 'vendors': {
      const input = vendorInput(record, lookups);
      if (!row.entityId) return insertVendor(tx, ctx, input, meta);
      await saveVendor(tx, ctx, row.entityId, input, { version: null, mode: 'import', meta });
      return row.entityId;
    }
    case 'items': {
      const input = {
        code: record.item_code ?? '',
        name: record.name ?? '',
        description: orNull(record.description),
        unitLabel: orNull(record.unit_label),
        defaultPrice: record.default_price ? priceForDb(record.default_price) : null,
        accountId: idOf(lookups.accountIds, record.account_number, 'accounts') ?? '',
        taxRateId: idOf(lookups.taxRateIds, record.tax_rate, 'tax rates'),
      };
      if (!row.entityId) return insertItem(tx, ctx, input, meta);
      await saveItem(tx, ctx, row.entityId, input, null, meta);
      return row.entityId;
    }
    case 'accounts': {
      const parent = record.parent_number ? lookups.accountIds.get(lower(record.parent_number)) ?? null : null;
      const input = {
        number: record.account_number ?? '',
        name: record.name ?? '',
        type: record.type as AccountType,
        subtype: record.subtype as AccountSubtype,
        parentId: parent,
        description: orNull(record.description),
        pulseCostCategory: (orNull(record.pulse_cost_category) as PulseCostCategory | null) ?? null,
      };
      if (!row.entityId) return insertAccount(tx, ctx, input, meta);
      await saveAccount(tx, ctx, row.entityId, input, null, meta);
      return row.entityId;
    }
    case 'tax_rates': {
      const rate = readRatePct(record.rate_pct ?? '');
      if (!rate.ok) throw new DomainError('VALIDATION', rate.message);
      const input = { name: record.name ?? '', rateMillionths: rate.value, accountId: idOf(lookups.accountIds, record.account_number, 'accounts'), agency: orNull(record.agency) };
      if (!row.entityId) return insertTaxRate(tx, ctx, input, meta);
      await saveTaxRate(tx, ctx, row.entityId, input, null, meta);
      return row.entityId;
    }
  }
}, 1);

/** Accounts whose parent is new in the same file get it after every row is in. */
export const linkParents = scoped(async function linkParents(tx: Transaction, ctx: DomainContext, rows: readonly { readonly number: string; readonly parentNumber: string }[]): Promise<void> {
  for (const row of rows) {
    const result = await tx.execute<{ child_type: string; parent_type: string | null; parent_id: string | null }>(
      sql`select c.type as child_type, p.type as parent_type, p.id as parent_id
            from ledger.accounts c
            left join ledger.accounts p on p.org_id = c.org_id and lower(p.number) = lower(${row.parentNumber}) and p.archived_at is null
           where c.org_id = ${ctx.orgId}::uuid and lower(c.number) = lower(${row.number}) and c.archived_at is null`,
    );
    const found = result.rows[0];
    if (!found?.parent_id) throw new DomainError('VALIDATION', `Account ${row.parentNumber}, the parent of ${row.number}, is not in your chart.`);
    if (found.parent_type !== found.child_type) throw new DomainError('VALIDATION', `Account ${row.parentNumber} has another type than ${row.number}, so it cannot be its parent.`);
    await tx.execute(sql`update ledger.accounts set parent_id = ${found.parent_id}::uuid, version = version + 1, updated_at = now()
                          where org_id = ${ctx.orgId}::uuid and lower(number) = lower(${row.number}) and archived_at is null`);
  }
}, 1);
