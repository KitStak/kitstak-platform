/**
 * `pm` schema handle + column helpers (conventions of packages/db `_shared.ts`):
 * uuid PKs `gen_random_uuid()`, timestamptz timestamps, org-scoped rows, soft delete.
 */
import { sql } from 'drizzle-orm';
import { customType, pgSchema, timestamp, uuid } from 'drizzle-orm/pg-core';

export const pmSchema = pgSchema('pm');

export const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`);

/** Tenant column (FK core.organization ON DELETE CASCADE, declared in SQL). */
export const orgId = () => uuid('org_id').notNull();

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const deletedAt = () => timestamp('deleted_at', { withTimezone: true, mode: 'date' });

export const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** Raw bytes (attachments stored in the database when no blob store is configured). */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});
