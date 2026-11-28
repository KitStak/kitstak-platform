/**
 * Sales tax rates (docs/ledger/SPEC.md 4.5.5, 5.2): a per workspace table applied per line. A
 * rate is stored in millionths of the amount (8.25% is 82500). Once an invoice line uses a rate,
 * its rate never changes: a new rate is a new row and the old one is archived (trigger KL006 holds
 * this in the database too). Names are unique among live rates. Changes need `settings:manage`.
 */
import 'server-only';
import { sql } from 'drizzle-orm';
import { db, type Transaction } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { DomainError, conflict, notFound } from '@/server/errors';
import { requireRight } from './access';
import { logActivity } from './activity';
import { isUuid, textOrNull, type DomainContext } from './_shared';

export interface TaxRateInput {
  readonly name: string;
  readonly rateMillionths: number;
  /** The liability account the tax is owed on. Null uses the Sales tax to pay system account. */
  readonly accountId: string | null;
  readonly agency: string | null;
}

export interface TaxRateRow {
  readonly id: string;
  readonly name: string;
  readonly rateMillionths: number;
  readonly accountId: string;
  readonly accountLabel: string;
  readonly agency: string | null;
  readonly archivedAt: Date | null;
  /** An invoice line uses it, so the rate is fixed. */
  readonly inUse: boolean;
  readonly version: number;
}

type TaxRateDbRow = {
  id: string;
  name: string;
  rate_millionths: number;
  account_id: string;
  account_label: string;
  agency: string | null;
  archived_at: Date | string | null;
  in_use: boolean;
  version: number;
}

const SELECT = sql`select r.id, r.name, r.rate_millionths, r.account_id, a.number || ' ' || a.name as account_label, r.agency, r.archived_at, r.version,
       (exists (select 1 from ledger.invoice_lines l where l.org_id = r.org_id and l.tax_rate_id = r.id)
        or exists (select 1 from ledger.recurring_invoice_lines l where l.org_id = r.org_id and l.tax_rate_id = r.id)) as in_use
  from ledger.tax_rates r
  join ledger.accounts a on a.org_id = r.org_id and a.id = r.account_id`;

const toRow = (row: TaxRateDbRow): TaxRateRow => ({
  id: row.id,
  name: row.name,
  rateMillionths: row.rate_millionths,
  accountId: row.account_id,
  accountLabel: row.account_label,
  agency: row.agency,
  archivedAt: row.archived_at ? new Date(row.archived_at) : null,
  inUse: row.in_use,
  version: row.version,
});

export const listTaxRates = scoped(async function listTaxRates(ctx: DomainContext, options: { readonly archived?: boolean } = {}): Promise<readonly TaxRateRow[]> {
  await requireRight(ctx, 'money:read');
  const result = await db.execute<TaxRateDbRow>(
    sql`${SELECT} where r.org_id = ${ctx.orgId}::uuid and ${options.archived ? sql`r.archived_at is not null` : sql`r.archived_at is null`} order by lower(r.name)`,
  );
  return result.rows.map(toRow);
});

async function resolveAccount(tx: Transaction, orgId: string, accountId: string | null): Promise<string> {
  const result = accountId
    ? await tx.execute<{ id: string; type: string; archived: boolean }>(sql`select id, type, archived_at is not null as archived from ledger.accounts where org_id = ${orgId}::uuid and id = ${accountId}::uuid`)
    : await tx.execute<{ id: string; type: string; archived: boolean }>(sql`select id, type, false as archived from ledger.accounts where org_id = ${orgId}::uuid and system_key = 'sales_tax'`);
  const row = result.rows[0];
  if (!row || row.archived) throw new DomainError('VALIDATION', 'Pick an account from your chart of accounts.', { accountId: 'Not found.' });
  if (row.type !== 'liability') throw new DomainError('VALIDATION', 'Sales tax is owed, so it needs a liability account.', { accountId: 'Pick a liability account.' });
  return row.id;
}

function normalize(input: TaxRateInput): TaxRateInput {
  const name = input.name.trim();
  if (name === '') throw new DomainError('VALIDATION', 'Give the rate a name.', { name: 'Needed.' });
  if (!Number.isInteger(input.rateMillionths) || input.rateMillionths < 0 || input.rateMillionths > 250_000) {
    throw new DomainError('VALIDATION', 'A rate is 0% to 25%, with up to 4 decimals.', { rate: 'Out of range.' });
  }
  return { ...input, name, agency: textOrNull(input.agency) };
}

async function assertNameFree(tx: Transaction, orgId: string, name: string, exceptId: string | null): Promise<void> {
  const clash = await tx.execute<{ name: string }>(
    sql`select name from ledger.tax_rates where org_id = ${orgId}::uuid and archived_at is null and lower(name) = lower(${name})
           and ${exceptId ? sql`id <> ${exceptId}::uuid` : sql`true`} limit 1`,
  );
  if (clash.rows[0]) throw new DomainError('CONFLICT', `A tax rate named ${clash.rows[0].name} is already in your list.`, { name: 'Already used.' });
}

export const insertTaxRate = scoped(async function insertTaxRate(tx: Transaction, ctx: DomainContext, raw: TaxRateInput, meta: Record<string, unknown> = {}): Promise<string> {
  const input = normalize(raw);
  await assertNameFree(tx, ctx.orgId, input.name, null);
  const accountId = await resolveAccount(tx, ctx.orgId, input.accountId);
  const result = await tx.execute<{ id: string }>(
    sql`insert into ledger.tax_rates (org_id, name, rate_millionths, account_id, agency)
        values (${ctx.orgId}::uuid, ${input.name}, ${input.rateMillionths}, ${accountId}::uuid, ${input.agency}) returning id`,
  );
  const id = result.rows[0]!.id;
  await logActivity(tx, ctx, { verb: 'tax_rate.created', entityType: 'tax_rate', entityId: id, after: { ...input, accountId }, meta });
  return id;
}, 1);

export const saveTaxRate = scoped(async function saveTaxRate(tx: Transaction, ctx: DomainContext, id: string, raw: TaxRateInput, version: number | null, meta: Record<string, unknown> = {}): Promise<void> {
  const input = normalize(raw);
  const found = await tx.execute<TaxRateDbRow>(sql`${SELECT} where r.org_id = ${ctx.orgId}::uuid and r.id = ${id}::uuid for update of r`);
  const current = found.rows[0];
  if (!current) throw notFound('That tax rate');
  if (version !== null && current.version !== version) throw conflict('Someone else changed this tax rate. Here is the new one.');
  if (current.in_use && current.rate_millionths !== input.rateMillionths) {
    throw new DomainError('CONFLICT', `${current.name} is used on invoices, so its rate cannot change. Add a new rate and archive this one.`, { rate: 'Fixed once used.' });
  }
  if (!current.archived_at) await assertNameFree(tx, ctx.orgId, input.name, id);
  const accountId = await resolveAccount(tx, ctx.orgId, input.accountId);
  await tx.execute(sql`update ledger.tax_rates set name = ${input.name}, rate_millionths = ${input.rateMillionths}, account_id = ${accountId}::uuid,
                              agency = ${input.agency}, version = version + 1, updated_at = now()
                        where org_id = ${ctx.orgId}::uuid and id = ${id}::uuid`);
  await logActivity(tx, ctx, { verb: 'tax_rate.updated', entityType: 'tax_rate', entityId: id, before: toRow(current), after: { ...input, accountId }, meta });
}, 1);

export const createTaxRate = scoped(async function createTaxRate(ctx: DomainContext, input: TaxRateInput): Promise<string> {
  await requireRight(ctx, 'settings:manage');
  return db.transaction((tx) => insertTaxRate(tx, ctx, input));
});

export const updateTaxRate = scoped(async function updateTaxRate(ctx: DomainContext, id: string, input: TaxRateInput, version: number): Promise<void> {
  await requireRight(ctx, 'settings:manage');
  if (!isUuid(id)) throw notFound('That tax rate');
  await db.transaction((tx) => saveTaxRate(tx, ctx, id, input, version));
});

export const setTaxRateArchived = scoped(async function setTaxRateArchived(ctx: DomainContext, id: string, archived: boolean): Promise<void> {
  await requireRight(ctx, 'settings:manage');
  if (!isUuid(id)) throw notFound('That tax rate');
  await db.transaction(async (tx) => {
    const found = await tx.execute<{ name: string; archived_at: Date | null }>(sql`select name, archived_at from ledger.tax_rates where org_id = ${ctx.orgId}::uuid and id = ${id}::uuid for update`);
    const row = found.rows[0];
    if (!row) throw notFound('That tax rate');
    if (Boolean(row.archived_at) === archived) return;
    if (!archived) await assertNameFree(tx, ctx.orgId, row.name, id);
    await tx.execute(sql`update ledger.tax_rates set archived_at = ${archived ? sql`now()` : sql`null`}, active = ${!archived}, version = version + 1, updated_at = now()
                          where org_id = ${ctx.orgId}::uuid and id = ${id}::uuid`);
    await logActivity(tx, ctx, { verb: archived ? 'tax_rate.archived' : 'tax_rate.restored', entityType: 'tax_rate', entityId: id, after: { archived } });
  });
});
