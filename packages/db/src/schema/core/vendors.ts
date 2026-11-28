/**
 * core.vendors: the shared vendor list (drizzle/0012_core_vendors.sql). Temp agencies for Crew,
 * suppliers, carriers and the rest for Ledger, and later WMS suppliers and carriers. One company
 * can be several kinds.
 */
import { sql } from 'drizzle-orm';
import { index, jsonb, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { auditStamps, coreSchema, id, orgId } from '../_shared';

/** What a vendor is to the shop. Kept in step with the vendors_kinds_check constraint. */
export const VENDOR_KINDS = ['supplier', 'carrier', 'temp_agency', 'landlord', 'utility', 'service', 'other'] as const;
export type VendorKind = (typeof VENDOR_KINDS)[number];

export interface VendorAddress {
  readonly line1?: string;
  readonly line2?: string;
  readonly city?: string;
  readonly region?: string;
  readonly postalCode?: string;
  readonly country?: string;
}

export const vendors = coreSchema.table(
  'vendors',
  {
    id: id(),
    orgId: orgId(),
    name: text('name').notNull(),
    kinds: text('kinds').array().$type<VendorKind[]>().notNull().default(sql`'{}'`),
    email: text('email'),
    phone: text('phone'),
    address: jsonb('address').$type<VendorAddress>(),
    notes: text('notes'),
    /** Ids in other systems, e.g. { qbo_vendor_id: '58' }. */
    externalRefs: jsonb('external_refs')
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    ...auditStamps(),
  },
  (t) => [
    uniqueIndex('vendors_org_name_unique')
      .on(t.orgId, sql`lower(${t.name})`)
      .where(sql`${t.archivedAt} IS NULL AND ${t.deletedAt} IS NULL`),
    index('vendors_org_idx')
      .on(t.orgId)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type Vendor = typeof vendors.$inferSelect;
export type NewVendor = typeof vendors.$inferInsert;

export function isVendorKind(value: string): value is VendorKind {
  return (VENDOR_KINDS as readonly string[]).includes(value);
}
