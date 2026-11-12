/**
 * Shared pgSchema handles and column helpers for the core platform tables
 * (docs/integration/BLUEPRINT.md §2.2 conventions): uuid PK `gen_random_uuid()`,
 * timestamptz timestamps, created_by/updated_by + version (WMS style), soft delete
 * `deleted_at`, enums as text + CHECK.
 */
import { sql } from 'drizzle-orm';
import { integer, pgSchema, timestamp, uuid } from 'drizzle-orm/pg-core';

export const coreSchema = pgSchema('core');
export const crmSchema = pgSchema('crm');
export const wmsSchema = pgSchema('wms');

export const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`);

/**
 * Tenant column. TODO(Phase 3): add the drizzle FK
 * `.references(() => organization.id, { onDelete: 'cascade' })` once the Better Auth
 * `core.organization` table relocates into this package; the SQL FK ships deferred in
 * drizzle/0001_core_fks.sql (not yet in the journal).
 */
export const orgId = () => uuid('org_id').notNull();

/**
 * Audit attribution column (nullable, survives user deletion). TODO(Phase 3): add the
 * drizzle FK `.references(() => user.id, { onDelete: 'set null' })` once Better Auth
 * `core."user"` relocates; SQL FK deferred in drizzle/0001_core_fks.sql.
 */
export const auditUserRef = (name: string) => uuid(name);

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const deletedAt = () => timestamp('deleted_at', { withTimezone: true, mode: 'date' });

export const version = () => integer('version').notNull().default(1);

/** created_at/updated_at + created_by/updated_by + version + deleted_at (§2.2 block). */
export const auditStamps = () => ({
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  createdBy: auditUserRef('created_by'),
  updatedBy: auditUserRef('updated_by'),
  version: version(),
  deletedAt: deletedAt(),
});
