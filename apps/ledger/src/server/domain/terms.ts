/**
 * Payment terms (docs/ledger/SPEC.md 4.5.3, 5.2): due on receipt, net days, or a day of the next
 * month. Names are unique among active terms and one active term is the default. Archiving sets
 * `active` off; the default cannot be archived. Changes need `settings:manage`.
 */
import 'server-only';
import { sql } from 'drizzle-orm';
import { db, type Transaction } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { DomainError, conflict, notFound } from '@/server/errors';
import type { TermsKind } from '@/lib/ledger-enums';
import { requireRight } from './access';
import { logActivity } from './activity';
import { isUuid, type DomainContext } from './_shared';

export interface TermsInput {
  readonly name: string;
  readonly kind: TermsKind;
  readonly days: number | null;
  readonly dayOfMonth: number | null;
}

export interface TermsRow {
  readonly id: string;
  readonly name: string;
  readonly kind: TermsKind;
  readonly days: number | null;
  readonly dayOfMonth: number | null;
  readonly isDefault: boolean;
  readonly active: boolean;
  readonly version: number;
}

type TermsDbRow = {
  id: string;
  name: string;
  kind: TermsKind;
  days: number | null;
  day_of_month: number | null;
  is_default: boolean;
  active: boolean;
  version: number;
}

const toRow = (row: TermsDbRow): TermsRow => ({ id: row.id, name: row.name, kind: row.kind, days: row.days, dayOfMonth: row.day_of_month, isDefault: row.is_default, active: row.active, version: row.version });

/** In plain words: "Due 30 days after the invoice date". */
export function termsWords(terms: Pick<TermsRow, 'kind' | 'days' | 'dayOfMonth'>): string {
  if (terms.kind === 'due_on_receipt') return 'Due on the invoice date';
  if (terms.kind === 'net_days') return `Due ${terms.days ?? 0} days after the invoice date`;
  return `Due on day ${terms.dayOfMonth ?? 1} of the next month`;
}

export const listPaymentTerms = scoped(async function listPaymentTerms(ctx: DomainContext, options: { readonly archived?: boolean } = {}): Promise<readonly TermsRow[]> {
  await requireRight(ctx, 'money:read');
  const result = await db.execute<TermsDbRow>(
    sql`select id, name, kind, days, day_of_month, is_default, active, version from ledger.terms
         where org_id = ${ctx.orgId}::uuid and active = ${!options.archived} order by is_default desc, kind, coalesce(days, day_of_month, 0), lower(name)`,
  );
  return result.rows.map(toRow);
});

function normalize(input: TermsInput): TermsInput {
  const name = input.name.trim();
  if (name === '') throw new DomainError('VALIDATION', 'Give the terms a name.', { name: 'Needed.' });
  if (input.kind === 'net_days' && (input.days === null || !Number.isInteger(input.days) || input.days < 0 || input.days > 365)) {
    throw new DomainError('VALIDATION', 'Net days are 0 to 365.', { days: 'Out of range.' });
  }
  if (input.kind === 'day_of_next_month' && (input.dayOfMonth === null || !Number.isInteger(input.dayOfMonth) || input.dayOfMonth < 1 || input.dayOfMonth > 31)) {
    throw new DomainError('VALIDATION', 'The day of the month is 1 to 31.', { dayOfMonth: 'Out of range.' });
  }
  return {
    name,
    kind: input.kind,
    days: input.kind === 'net_days' ? input.days : null,
    dayOfMonth: input.kind === 'day_of_next_month' ? input.dayOfMonth : null,
  };
}

async function assertNameFree(tx: Transaction, orgId: string, name: string, exceptId: string | null): Promise<void> {
  const clash = await tx.execute<{ name: string }>(
    sql`select name from ledger.terms where org_id = ${orgId}::uuid and active and lower(name) = lower(${name}) and ${exceptId ? sql`id <> ${exceptId}::uuid` : sql`true`} limit 1`,
  );
  if (clash.rows[0]) throw new DomainError('CONFLICT', `Terms named ${clash.rows[0].name} are already in your list.`, { name: 'Already used.' });
}

export const createTerms = scoped(async function createTerms(ctx: DomainContext, raw: TermsInput): Promise<string> {
  await requireRight(ctx, 'settings:manage');
  const input = normalize(raw);
  return db.transaction(async (tx) => {
    await assertNameFree(tx, ctx.orgId, input.name, null);
    const result = await tx.execute<{ id: string }>(
      sql`insert into ledger.terms (org_id, name, kind, days, day_of_month) values (${ctx.orgId}::uuid, ${input.name}, ${input.kind}, ${input.days}, ${input.dayOfMonth}) returning id`,
    );
    const id = result.rows[0]!.id;
    await logActivity(tx, ctx, { verb: 'terms.created', entityType: 'terms', entityId: id, after: { ...input } });
    return id;
  });
});

export const updateTerms = scoped(async function updateTerms(ctx: DomainContext, id: string, raw: TermsInput, version: number): Promise<void> {
  await requireRight(ctx, 'settings:manage');
  if (!isUuid(id)) throw notFound('Those terms');
  const input = normalize(raw);
  await db.transaction(async (tx) => {
    const found = await tx.execute<TermsDbRow>(sql`select id, name, kind, days, day_of_month, is_default, active, version from ledger.terms where org_id = ${ctx.orgId}::uuid and id = ${id}::uuid for update`);
    const current = found.rows[0];
    if (!current) throw notFound('Those terms');
    if (current.version !== version) throw conflict('Someone else changed these terms. Here are the new ones.');
    if (current.active) await assertNameFree(tx, ctx.orgId, input.name, id);
    await tx.execute(sql`update ledger.terms set name = ${input.name}, kind = ${input.kind}, days = ${input.days}, day_of_month = ${input.dayOfMonth},
                                version = version + 1, updated_at = now() where org_id = ${ctx.orgId}::uuid and id = ${id}::uuid`);
    await logActivity(tx, ctx, { verb: 'terms.updated', entityType: 'terms', entityId: id, before: toRow(current), after: { ...input } });
  });
});

/** Makes these terms the default for new customers and invoices (one active default per workspace). */
export const setDefaultTerms = scoped(async function setDefaultTerms(ctx: DomainContext, id: string): Promise<void> {
  await requireRight(ctx, 'settings:manage');
  if (!isUuid(id)) throw notFound('Those terms');
  await db.transaction(async (tx) => {
    const found = await tx.execute<{ active: boolean }>(sql`select active from ledger.terms where org_id = ${ctx.orgId}::uuid and id = ${id}::uuid for update`);
    if (!found.rows[0]) throw notFound('Those terms');
    if (!found.rows[0].active) throw new DomainError('CONFLICT', 'Bring these terms back before making them the default.');
    await tx.execute(sql`update ledger.terms set is_default = false, version = version + 1, updated_at = now() where org_id = ${ctx.orgId}::uuid and is_default and id <> ${id}::uuid`);
    await tx.execute(sql`update ledger.terms set is_default = true, version = version + 1, updated_at = now() where org_id = ${ctx.orgId}::uuid and id = ${id}::uuid`);
    await tx.execute(sql`update ledger.settings set default_terms_id = ${id}::uuid, version = version + 1, updated_at = now() where org_id = ${ctx.orgId}::uuid`);
    await logActivity(tx, ctx, { verb: 'terms.default_set', entityType: 'terms', entityId: id });
  });
});

export const setTermsArchived = scoped(async function setTermsArchived(ctx: DomainContext, id: string, archived: boolean): Promise<void> {
  await requireRight(ctx, 'settings:manage');
  if (!isUuid(id)) throw notFound('Those terms');
  await db.transaction(async (tx) => {
    const found = await tx.execute<{ name: string; active: boolean; is_default: boolean }>(sql`select name, active, is_default from ledger.terms where org_id = ${ctx.orgId}::uuid and id = ${id}::uuid for update`);
    const row = found.rows[0];
    if (!row) throw notFound('Those terms');
    if (row.active === !archived) return;
    if (archived && row.is_default) throw new DomainError('CONFLICT', 'These are your default terms. Make other terms the default first.');
    if (!archived) await assertNameFree(tx, ctx.orgId, row.name, id);
    await tx.execute(sql`update ledger.terms set active = ${!archived}, version = version + 1, updated_at = now() where org_id = ${ctx.orgId}::uuid and id = ${id}::uuid`);
    await logActivity(tx, ctx, { verb: archived ? 'terms.archived' : 'terms.restored', entityType: 'terms', entityId: id, after: { archived } });
  });
});
