/**
 * The chart of accounts (docs/ledger/SPEC.md 4.3, 5.2). Admins rename, renumber, add and archive
 * accounts. A system account (posting needs it) can be renamed and renumbered but never archived
 * or given another type (trigger KL005). Numbers are unique among live accounts. An account that
 * a live item or tax rate points at is not archived until they move. Changes need `settings:manage`.
 */
import 'server-only';
import { sql } from 'drizzle-orm';
import { db, type Transaction } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { DomainError, conflict, notFound } from '@/server/errors';
import { ACCOUNT_SUBTYPES, ACCOUNT_TYPES, PULSE_COST_CATEGORIES, type AccountSubtype, type AccountType, type PulseCostCategoryValue } from '@/lib/ledger-enums';
import { requireRight } from './access';
import { logActivity } from './activity';
import { isUuid, textOrNull, type DomainContext } from './_shared';

export type PulseCostCategory = PulseCostCategoryValue;

export interface AccountInput {
  readonly number: string;
  readonly name: string;
  readonly type: AccountType;
  readonly subtype: AccountSubtype;
  readonly parentId: string | null;
  readonly description: string | null;
  readonly pulseCostCategory: PulseCostCategory | null;
}

export interface AccountRow {
  readonly id: string;
  readonly number: string;
  readonly name: string;
  readonly type: AccountType;
  readonly subtype: AccountSubtype;
  readonly systemKey: string | null;
  readonly parentId: string | null;
  readonly parentNumber: string | null;
  readonly description: string | null;
  readonly pulseCostCategory: PulseCostCategory | null;
  readonly archivedAt: Date | null;
  readonly version: number;
}

type AccountDbRow = {
  id: string;
  number: string;
  name: string;
  type: AccountType;
  subtype: AccountSubtype;
  system_key: string | null;
  parent_id: string | null;
  parent_number: string | null;
  description: string | null;
  pulse_cost_category: PulseCostCategory | null;
  archived_at: Date | string | null;
  version: number;
}

const SELECT = sql`select a.id, a.number, a.name, a.type, a.subtype, a.system_key, a.parent_id, p.number as parent_number, a.description,
       a.pulse_cost_category, a.archived_at, a.version
  from ledger.accounts a
  left join ledger.accounts p on p.org_id = a.org_id and p.id = a.parent_id`;

const toRow = (row: AccountDbRow): AccountRow => ({
  id: row.id,
  number: row.number,
  name: row.name,
  type: row.type,
  subtype: row.subtype,
  systemKey: row.system_key,
  parentId: row.parent_id,
  parentNumber: row.parent_number,
  description: row.description,
  pulseCostCategory: row.pulse_cost_category,
  archivedAt: row.archived_at ? new Date(row.archived_at) : null,
  version: row.version,
});

export const listChart = scoped(async function listChart(ctx: DomainContext, options: { readonly archived?: boolean } = {}): Promise<readonly AccountRow[]> {
  await requireRight(ctx, 'money:read');
  const result = await db.execute<AccountDbRow>(
    sql`${SELECT} where a.org_id = ${ctx.orgId}::uuid and ${options.archived ? sql`a.archived_at is not null` : sql`a.archived_at is null`} order by a.number`,
  );
  return result.rows.map(toRow);
});

function normalize(input: AccountInput): AccountInput {
  const number = input.number.trim();
  const name = input.name.trim();
  if (number === '' || number.length > 20) throw new DomainError('VALIDATION', 'Give the account a number of up to 20 letters.', { number: 'Needed.' });
  if (name === '') throw new DomainError('VALIDATION', 'Give the account a name.', { name: 'Needed.' });
  if (!(ACCOUNT_TYPES as readonly string[]).includes(input.type)) throw new DomainError('VALIDATION', 'Pick the account type.', { type: 'Needed.' });
  if (!(ACCOUNT_SUBTYPES as readonly string[]).includes(input.subtype)) throw new DomainError('VALIDATION', 'Pick the account subtype.', { subtype: 'Needed.' });
  if (input.pulseCostCategory && !(PULSE_COST_CATEGORIES as readonly string[]).includes(input.pulseCostCategory)) {
    throw new DomainError('VALIDATION', 'Pick a Pulse cost category from the list.', { pulseCostCategory: 'Not in the list.' });
  }
  return { ...input, number, name, description: textOrNull(input.description) };
}

async function check(tx: Transaction, orgId: string, input: AccountInput, exceptId: string | null): Promise<void> {
  const clash = await tx.execute<{ number: string; name: string }>(
    sql`select number, name from ledger.accounts where org_id = ${orgId}::uuid and archived_at is null and lower(number) = lower(${input.number})
           and ${exceptId ? sql`id <> ${exceptId}::uuid` : sql`true`} limit 1`,
  );
  if (clash.rows[0]) throw new DomainError('CONFLICT', `Account ${clash.rows[0].number} is already ${clash.rows[0].name}.`, { number: 'Already used.' });
  if (input.parentId) {
    if (input.parentId === exceptId) throw new DomainError('VALIDATION', 'An account cannot be its own parent.', { parentId: 'Pick another.' });
    const parent = await tx.execute<{ type: string }>(sql`select type from ledger.accounts where org_id = ${orgId}::uuid and id = ${input.parentId}::uuid and archived_at is null`);
    if (!parent.rows[0]) throw new DomainError('VALIDATION', 'Pick a parent account from your chart.', { parentId: 'Not found.' });
    if (parent.rows[0].type !== input.type) throw new DomainError('VALIDATION', 'A parent account has the same type as its child.', { parentId: 'Another type.' });
  }
}

export const insertAccount = scoped(async function insertAccount(tx: Transaction, ctx: DomainContext, raw: AccountInput, meta: Record<string, unknown> = {}): Promise<string> {
  const input = normalize(raw);
  await check(tx, ctx.orgId, input, null);
  const result = await tx.execute<{ id: string }>(
    sql`insert into ledger.accounts (org_id, number, name, type, subtype, parent_id, description, pulse_cost_category)
        values (${ctx.orgId}::uuid, ${input.number}, ${input.name}, ${input.type}, ${input.subtype}, ${input.parentId}::uuid, ${input.description}, ${input.pulseCostCategory})
        returning id`,
  );
  const id = result.rows[0]!.id;
  await logActivity(tx, ctx, { verb: 'account.created', entityType: 'account', entityId: id, after: { ...input }, meta });
  return id;
}, 1);

export const saveAccount = scoped(async function saveAccount(tx: Transaction, ctx: DomainContext, id: string, raw: AccountInput, version: number | null, meta: Record<string, unknown> = {}): Promise<void> {
  const input = normalize(raw);
  const found = await tx.execute<AccountDbRow>(sql`${SELECT} where a.org_id = ${ctx.orgId}::uuid and a.id = ${id}::uuid for update of a`);
  const current = found.rows[0];
  if (!current) throw notFound('That account');
  if (version !== null && current.version !== version) throw conflict('Someone else changed this account. Here is the new one.');
  if (current.system_key && current.type !== input.type) {
    throw new DomainError('CONFLICT', `Ledger uses ${current.number} ${current.name}, so its type stays ${current.type}.`, { type: 'Fixed.' });
  }
  await check(tx, ctx.orgId, input, id);
  await tx.execute(sql`update ledger.accounts set number = ${input.number}, name = ${input.name}, type = ${input.type}, subtype = ${input.subtype},
                              parent_id = ${input.parentId}::uuid, description = ${input.description}, pulse_cost_category = ${input.pulseCostCategory},
                              version = version + 1, updated_at = now()
                        where org_id = ${ctx.orgId}::uuid and id = ${id}::uuid`);
  await logActivity(tx, ctx, { verb: 'account.updated', entityType: 'account', entityId: id, before: toRow(current), after: { ...input }, meta });
}, 1);

export const createAccount = scoped(async function createAccount(ctx: DomainContext, input: AccountInput): Promise<string> {
  await requireRight(ctx, 'settings:manage');
  return db.transaction((tx) => insertAccount(tx, ctx, input));
});

export const updateAccount = scoped(async function updateAccount(ctx: DomainContext, id: string, input: AccountInput, version: number): Promise<void> {
  await requireRight(ctx, 'settings:manage');
  if (!isUuid(id)) throw notFound('That account');
  await db.transaction((tx) => saveAccount(tx, ctx, id, input, version));
});

export const setAccountArchived = scoped(async function setAccountArchived(ctx: DomainContext, id: string, archived: boolean): Promise<void> {
  await requireRight(ctx, 'settings:manage');
  if (!isUuid(id)) throw notFound('That account');
  await db.transaction(async (tx) => {
    const found = await tx.execute<{ number: string; name: string; system_key: string | null; archived_at: Date | null }>(
      sql`select number, name, system_key, archived_at from ledger.accounts where org_id = ${ctx.orgId}::uuid and id = ${id}::uuid for update`,
    );
    const row = found.rows[0];
    if (!row) throw notFound('That account');
    if (Boolean(row.archived_at) === archived) return;
    if (archived && row.system_key) throw new DomainError('CONFLICT', `Ledger uses ${row.number} ${row.name}, so it cannot be archived. You can rename it.`);
    if (archived) {
      const used = await tx.execute<{ what: string }>(
        sql`select 'an item' as what from ledger.items where org_id = ${ctx.orgId}::uuid and account_id = ${id}::uuid and archived_at is null
            union all select 'a tax rate' from ledger.tax_rates where org_id = ${ctx.orgId}::uuid and account_id = ${id}::uuid and archived_at is null
            union all select 'a child account' from ledger.accounts where org_id = ${ctx.orgId}::uuid and parent_id = ${id}::uuid and archived_at is null
            limit 1`,
      );
      if (used.rows[0]) throw new DomainError('CONFLICT', `${row.number} ${row.name} is still used by ${used.rows[0].what}. Move it to another account first.`);
    } else {
      const clash = await tx.execute(sql`select 1 from ledger.accounts where org_id = ${ctx.orgId}::uuid and archived_at is null and lower(number) = lower(${row.number})`);
      if (clash.rows[0]) throw new DomainError('CONFLICT', `Another live account uses the number ${row.number}. Renumber that one first.`);
    }
    await tx.execute(sql`update ledger.accounts set archived_at = ${archived ? sql`now()` : sql`null`}, version = version + 1, updated_at = now()
                          where org_id = ${ctx.orgId}::uuid and id = ${id}::uuid`);
    await logActivity(tx, ctx, { verb: archived ? 'account.archived' : 'account.restored', entityType: 'account', entityId: id, after: { archived } });
  });
});
