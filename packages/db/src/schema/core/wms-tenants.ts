/**
 * core.wms_tenants — which Postgres schema holds each organization's WMS warehouse
 * (drizzle/0005_core_wms_tenants.sql). One separate warehouse per organization: the
 * platform org keeps the original `wms` schema, every other org gets `wms_<org hex>`.
 */
import { sql } from 'drizzle-orm';
import { check, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { coreSchema, createdAt } from '../_shared';
import { organization } from './auth';

export const WMS_TENANT_STATUSES = ['provisioning', 'active'] as const;
export type WmsTenantStatus = (typeof WMS_TENANT_STATUSES)[number];

export const wmsTenants = coreSchema.table(
  'wms_tenants',
  {
    orgId: uuid('org_id')
      .primaryKey()
      .references(() => organization.id, { onDelete: 'cascade' }),
    schemaName: text('schema_name').notNull(),
    status: text('status', { enum: WMS_TENANT_STATUSES }).notNull().default('provisioning'),
    createdAt: createdAt(),
    provisionedAt: timestamp('provisioned_at', { withTimezone: true, mode: 'date' }),
    provisionedBy: uuid('provisioned_by'),
  },
  (t) => [
    unique('wms_tenants_schema_name_unique').on(t.schemaName),
    check('wms_tenants_schema_name_check', sql`${t.schemaName} ~ '^wms(_[0-9a-f]{32})?$'`),
    check('wms_tenants_status_check', sql`${t.status} IN ('provisioning', 'active')`),
  ],
);

export type WmsTenant = typeof wmsTenants.$inferSelect;
