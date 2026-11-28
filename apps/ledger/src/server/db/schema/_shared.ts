/**
 * `ledger` schema handle + column helpers (conventions of packages/db `_shared.ts` and Pulse):
 * uuid PKs `gen_random_uuid()`, timestamptz timestamps, org scoped rows, soft delete for drafts.
 * Money columns are `bigint` whole cents (read as JS `bigint`); dates are `date` columns read as
 * YYYY-MM-DD strings; prices and quantities are decimal strings. Constraints, composite foreign
 * keys, indexes, triggers and RLS live in the SQL migration (apps/ledger/drizzle); this mirror
 * exists for typed queries only.
 */
import { sql } from 'drizzle-orm';
import { bigint, boolean, integer, numeric, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const ledgerSchema = pgSchema('ledger');

export const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`);

/** Tenant column (FK core.organization ON DELETE CASCADE, declared in SQL). */
export const orgId = () => uuid('org_id').notNull();

export const createdAt = () => timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** Whole cents (`ledger.cents`, a bigint domain). Read as a JS `bigint`. */
export const cents = (name: string) => bigint(name, { mode: 'bigint' });
/** Quantity, numeric(14,3) (`ledger.qty`). Read as a decimal string. */
export const qty = (name: string) => numeric(name, { precision: 14, scale: 3 });
/** Hours, numeric(10,2). Read as a decimal string. */
export const hrs = (name: string) => numeric(name, { precision: 10, scale: 2 });
/** Unit price in currency units, numeric(14,4) (`ledger.price`). Read as a decimal string. */
export const price = (name: string) => numeric(name, { precision: 14, scale: 4 });

/** id + org + timestamps, shared by every table that has its own id. */
export const base = () => ({ id: id(), orgId: orgId(), createdAt: createdAt(), updatedAt: updatedAt() });

/** V: optimistic version, bumped on every update. */
export const version = () => ({ version: integer('version').notNull().default(1) });

/** SRC columns on documents (SPEC 5): where a document came from. */
export const src = () => ({
  source: text('source').notNull().default('manual'),
  sourceRef: text('source_ref'),
  importBatchId: uuid('import_batch_id'),
  isSample: boolean('is_sample').notNull().default(false),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
});

/** Posting bookkeeping on every document that writes journal entries (posting.ts). */
export const posting = () => ({
  postingSeq: integer('posting_seq').notNull().default(0),
  lastEntryId: uuid('last_entry_id'),
});

/** SD: soft delete, drafts only. */
export const deletedAt = () => ({ deletedAt: tstz('deleted_at') });
