/**
 * core.customers — shared company/depositor registry (BLUEPRINT.md §2.3).
 * Canonicalizes wms.clients; CRM account board items link to it via crm.customer_links.
 */
import { sql } from 'drizzle-orm';
import { index, jsonb, text, unique } from 'drizzle-orm/pg-core';
import { auditStamps, coreSchema, id, orgId } from '../_shared';

export const customers = coreSchema.table(
  'customers',
  {
    id: id(),
    orgId: orgId(),
    /** wms clients.code */
    code: text('code').notNull(),
    name: text('name').notNull(),
    officialName: text('official_name'),
    contactName: text('contact_name'),
    contactEmail: text('contact_email'),
    phone: text('phone'),
    taxId: text('tax_id'),
    currency: text('currency').notNull().default('USD'),
    /** wms CLIENT_BILLING_PLANS */
    billingPlan: text('billing_plan'),
    /** wms ACTIVE_STATUSES */
    status: text('status').notNull().default('Active'),
    settings: jsonb('settings')
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
    unique('customers_org_id_code_unique').on(t.orgId, t.code),
    index('customers_org_idx')
      .on(t.orgId)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
