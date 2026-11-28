/**
 * Items: what a shop invoices for (docs/ledger/SPEC.md 5.2). Each has a code (unique among live
 * items), a default price, a revenue account and an optional tax rate. Archived items keep their
 * history and leave pickers. Reading needs `money:read`; changes need `settings:manage`.
 */
import 'server-only';
import { sql } from 'drizzle-orm';
import { db, type Transaction } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { DomainError, conflict, notFound } from '@/server/errors';
import { requireRight } from './access';
import { logActivity } from './activity';
import { isUuid, textOrNull, type DomainContext } from './_shared';

export interface ItemInput {
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly unitLabel: string | null;
  /** numeric(14,4) text, for example `18.5000`, or null for no default price. */
  readonly defaultPrice: string | null;
  readonly accountId: string;
  readonly taxRateId: string | null;
}

export interface ItemRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly unitLabel: string | null;
  readonly defaultPrice: string | null;
  readonly accountId: string;
  readonly accountLabel: string;
  readonly taxRateId: string | null;
  readonly taxRateName: string | null;
  readonly archivedAt: Date | null;
  readonly version: number;
}

type ItemDbRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  unit_label: string | null;
  default_price: string | null;
  account_id: string;
  account_label: string;
  tax_rate_id: string | null;
  tax_rate_name: string | null;
  archived_at: Date | string | null;
  version: number;
}

const SELECT = sql`select i.id, i.code, i.name, i.description, i.unit_label, i.default_price::text as default_price, i.account_id,
       a.number || ' ' || a.name as account_label, i.tax_rate_id, r.name as tax_rate_name, i.archived_at, i.version
  from ledger.items i
  join ledger.accounts a on a.org_id = i.org_id and a.id = i.account_id
  left join ledger.tax_rates r on r.org_id = i.org_id and r.id = i.tax_rate_id`;

const toRow = (row: ItemDbRow): ItemRow => ({
  id: row.id,
  code: row.code,
  name: row.name,
  description: row.description,
  unitLabel: row.unit_label,
  defaultPrice: row.default_price,
  accountId: row.account_id,
  accountLabel: row.account_label,
  taxRateId: row.tax_rate_id,
  taxRateName: row.tax_rate_name,
  archivedAt: row.archived_at ? new Date(row.archived_at) : null,
  version: row.version,
});

export const listItems = scoped(async function listItems(ctx: DomainContext, options: { readonly archived?: boolean } = {}): Promise<readonly ItemRow[]> {
  await requireRight(ctx, 'money:read');
  const result = await db.execute<ItemDbRow>(
    sql`${SELECT} where i.org_id = ${ctx.orgId}::uuid and ${options.archived ? sql`i.archived_at is not null` : sql`i.archived_at is null`} order by lower(i.code)`,
  );
  return result.rows.map(toRow);
});

function normalize(input: ItemInput): ItemInput {
  const code = input.code.trim();
  const name = input.name.trim();
  if (code === '') throw new DomainError('VALIDATION', 'Give the item a code.', { code: 'Needed.' });
  if (name === '') throw new DomainError('VALIDATION', 'Give the item a name.', { name: 'Needed.' });
  if (!isUuid(input.accountId)) throw new DomainError('VALIDATION', 'Pick the revenue account for this item.', { accountId: 'Needed.' });
  return { ...input, code, name, description: textOrNull(input.description), unitLabel: textOrNull(input.unitLabel), defaultPrice: textOrNull(input.defaultPrice) };
}

async function check(tx: Transaction, orgId: string, input: ItemInput, exceptId: string | null): Promise<void> {
  const clash = await tx.execute<{ code: string }>(
    sql`select code from ledger.items where org_id = ${orgId}::uuid and archived_at is null and lower(code) = lower(${input.code})
           and ${exceptId ? sql`id <> ${exceptId}::uuid` : sql`true`} limit 1`,
  );
  if (clash.rows[0]) throw new DomainError('CONFLICT', `The item code ${clash.rows[0].code} is already used.`, { code: 'Already used.' });
  const account = await tx.execute<{ type: string; archived: boolean }>(
    sql`select type, archived_at is not null as archived from ledger.accounts where org_id = ${orgId}::uuid and id = ${input.accountId}::uuid`,
  );
  const found = account.rows[0];
  if (!found || found.archived) throw new DomainError('VALIDATION', 'Pick an account from your chart of accounts.', { accountId: 'Not found.' });
  if (found.type !== 'revenue') throw new DomainError('VALIDATION', 'An item needs a revenue account.', { accountId: 'Pick a revenue account.' });
  if (input.taxRateId) {
    const rate = await tx.execute<{ id: string }>(sql`select id from ledger.tax_rates where org_id = ${orgId}::uuid and id = ${input.taxRateId}::uuid and archived_at is null`);
    if (!rate.rows[0]) throw new DomainError('VALIDATION', 'Pick a tax rate that is not archived.', { taxRateId: 'Not found.' });
  }
}

export const insertItem = scoped(async function insertItem(tx: Transaction, ctx: DomainContext, raw: ItemInput, meta: Record<string, unknown> = {}): Promise<string> {
  const input = normalize(raw);
  await check(tx, ctx.orgId, input, null);
  const result = await tx.execute<{ id: string }>(
    sql`insert into ledger.items (org_id, code, name, description, unit_label, default_price, account_id, tax_rate_id)
        values (${ctx.orgId}::uuid, ${input.code}, ${input.name}, ${input.description}, ${input.unitLabel}, ${input.defaultPrice}::numeric,
                ${input.accountId}::uuid, ${input.taxRateId}::uuid)
        returning id`,
  );
  const id = result.rows[0]!.id;
  await logActivity(tx, ctx, { verb: 'item.created', entityType: 'item', entityId: id, after: { ...input }, meta });
  return id;
}, 1);

export const saveItem = scoped(async function saveItem(tx: Transaction, ctx: DomainContext, id: string, raw: ItemInput, version: number | null, meta: Record<string, unknown> = {}): Promise<void> {
  const input = normalize(raw);
  const found = await tx.execute<ItemDbRow>(sql`${SELECT} where i.org_id = ${ctx.orgId}::uuid and i.id = ${id}::uuid for update of i`);
  const current = found.rows[0];
  if (!current) throw notFound('That item');
  if (version !== null && current.version !== version) throw conflict('Someone else changed this item. Here is the new one.');
  await check(tx, ctx.orgId, input, id);
  await tx.execute(sql`update ledger.items set code = ${input.code}, name = ${input.name}, description = ${input.description}, unit_label = ${input.unitLabel},
                              default_price = ${input.defaultPrice}::numeric, account_id = ${input.accountId}::uuid, tax_rate_id = ${input.taxRateId}::uuid,
                              version = version + 1, updated_at = now()
                        where org_id = ${ctx.orgId}::uuid and id = ${id}::uuid`);
  await logActivity(tx, ctx, { verb: 'item.updated', entityType: 'item', entityId: id, before: toRow(current), after: { ...input }, meta });
}, 1);

export const createItem = scoped(async function createItem(ctx: DomainContext, input: ItemInput): Promise<string> {
  await requireRight(ctx, 'settings:manage');
  return db.transaction((tx) => insertItem(tx, ctx, input));
});

export const updateItem = scoped(async function updateItem(ctx: DomainContext, id: string, input: ItemInput, version: number): Promise<void> {
  await requireRight(ctx, 'settings:manage');
  if (!isUuid(id)) throw notFound('That item');
  await db.transaction((tx) => saveItem(tx, ctx, id, input, version));
});

/** Archives or brings back an item. A code freed by an archived item can be used again. */
export const setItemArchived = scoped(async function setItemArchived(ctx: DomainContext, id: string, archived: boolean): Promise<void> {
  await requireRight(ctx, 'settings:manage');
  if (!isUuid(id)) throw notFound('That item');
  await db.transaction(async (tx) => {
    const found = await tx.execute<{ code: string; archived_at: Date | null }>(
      sql`select code, archived_at from ledger.items where org_id = ${ctx.orgId}::uuid and id = ${id}::uuid for update`,
    );
    const row = found.rows[0];
    if (!row) throw notFound('That item');
    if (Boolean(row.archived_at) === archived) return;
    if (!archived) {
      const clash = await tx.execute(sql`select 1 from ledger.items where org_id = ${ctx.orgId}::uuid and archived_at is null and lower(code) = lower(${row.code})`);
      if (clash.rows[0]) throw new DomainError('CONFLICT', `Another live item uses the code ${row.code}. Change that one first.`);
    }
    await tx.execute(sql`update ledger.items set archived_at = ${archived ? sql`now()` : sql`null`}, active = ${!archived}, version = version + 1, updated_at = now()
                          where org_id = ${ctx.orgId}::uuid and id = ${id}::uuid`);
    await logActivity(tx, ctx, { verb: archived ? 'item.archived' : 'item.restored', entityType: 'item', entityId: id, after: { archived } });
  });
});
