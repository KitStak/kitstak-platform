/**
 * `pulse` schema handle + column helpers (conventions of packages/db `_shared.ts`):
 * uuid PKs `gen_random_uuid()`, timestamptz timestamps, org-scoped rows, soft delete.
 * Money columns are `bigint` cents; dates are `date` columns read as YYYY-MM-DD strings.
 * Constraints, composite foreign keys, indexes, triggers and RLS live in the SQL migration
 * (apps/pulse/drizzle); this mirror exists for typed queries only.
 */
import { sql } from 'drizzle-orm';
import { bigint, boolean, integer, jsonb, numeric, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const pulseSchema = pgSchema('pulse');

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

/** Whole cents (`bigint`). Read as a JS `bigint`. */
export const cents = (name: string) => bigint(name, { mode: 'bigint' });
/** Quantity, numeric(14,3). Read as a decimal string. */
export const qty = (name: string) => numeric(name, { precision: 14, scale: 3 });
/** Hours, numeric(10,2). Read as a decimal string. */
export const hrs = (name: string) => numeric(name, { precision: 10, scale: 2 });
/** Per unit price or cost in currency units, numeric(14,4). Read as a decimal string. */
export const price = (name: string) => numeric(name, { precision: 14, scale: 4 });
/** Units per labor hour, numeric(12,3). */
export const pace = (name: string) => numeric(name, { precision: 12, scale: 3 });
/** Headcount, numeric(6,2). */
export const heads = (name: string) => numeric(name, { precision: 6, scale: 2 });

/** id + org + timestamps, shared by every table that has its own id. */
export const base = () => ({ id: id(), orgId: orgId(), createdAt: createdAt(), updatedAt: updatedAt() });

/** STREAM columns (SPEC section 5): where the row came from, version and soft delete. */
export const stream = () => ({
  version: integer('version').notNull().default(1),
  source: text('source').notNull().default('manual'),
  sourceRef: text('source_ref'),
  importBatchId: uuid('import_batch_id'),
  isSample: boolean('is_sample').notNull().default(false),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
  deletedAt: deletedAt(),
});
