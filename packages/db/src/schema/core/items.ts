/**
 * core.items — shared item/SKU registry, identity only (BLUEPRINT.md §2.3).
 * WMS keeps the operational detail in wms.products; depositor-scoped like
 * wms.products.client_id. Naming hazard: CRM crm.items (board rows) ≠ core.items (SKUs).
 */
import { sql } from 'drizzle-orm';
import { boolean, index, jsonb, text, unique, uuid } from 'drizzle-orm/pg-core';
import { auditStamps, coreSchema, id, orgId } from '../_shared';
import { customers } from './customers';

export const items = coreSchema.table(
  'items',
  {
    id: id(),
    orgId: orgId(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    sku: text('sku').notNull(),
    name: text('name').notNull(),
    barcode: text('barcode'),
    uom: text('uom').notNull().default('Each'),
    isKit: boolean('is_kit').notNull().default(false),
    status: text('status').notNull().default('Active'),
    category: text('category'),
    attrs: jsonb('attrs')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    customFields: jsonb('custom_fields')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    ...auditStamps(),
  },
  (t) => [
    unique('items_org_id_customer_id_sku_unique').on(t.orgId, t.customerId, t.sku),
    index('items_barcode_idx').on(t.barcode),
  ],
);

export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
