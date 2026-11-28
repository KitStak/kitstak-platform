/**
 * `crew` schema handle + column helpers (conventions of packages/db `_shared.ts` and Pulse):
 * uuid PKs `gen_random_uuid()`, timestamptz timestamps, org scoped rows, soft delete. Dates are
 * `date` columns read as YYYY-MM-DD strings. Constraints, composite foreign keys, indexes,
 * triggers and RLS live in the SQL migration (apps/crew/drizzle); this mirror is for typed queries.
 */
import { sql } from 'drizzle-orm';
import { boolean, integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const crewSchema = pgSchema('crew');

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

export const deletedAt = () => timestamp('deleted_at', { withTimezone: true, mode: 'date' });

export const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** id + org + timestamps, shared by every table that has its own id. */
export const base = () => ({ id: id(), orgId: orgId(), createdAt: createdAt(), updatedAt: updatedAt() });

/** SRC columns (SPEC section 5): where the row came from. */
export const src = () => ({
  source: text('source').notNull().default('manual'),
  sourceRef: text('source_ref'),
  importBatchId: uuid('import_batch_id'),
  isSample: boolean('is_sample').notNull().default(false),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
});

/** V: optimistic version, sent back on every edit. */
export const version = () => integer('version').notNull().default(1);
