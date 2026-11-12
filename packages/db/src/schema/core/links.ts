/**
 * crm.customer_links / crm.item_links — cross-app link bridges (BLUEPRINT.md §2.3).
 * Keep each app's native model intact; board/item ids are plain uuids into the CRM's
 * own crm.* tables (no FK — those tables live in apps/crm's schema).
 */
import { primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { crmSchema } from '../_shared';
import { customers } from './customers';
import { items } from './items';

/** CRM account board item <-> core customer. */
export const customerLinks = crmSchema.table(
  'customer_links',
  {
    coreCustomerId: uuid('core_customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id').notNull(),
    /** crm.boards.id (kind='accounts'). */
    boardId: uuid('board_id').notNull(),
    /** crm.items.id (board row, NOT core.items). */
    itemId: uuid('item_id').notNull(),
  },
  (t) => [primaryKey({ name: 'customer_links_pkey', columns: [t.coreCustomerId, t.itemId] })],
);

/** CRM board item <-> core item (deal line / catalog ref). */
export const itemLinks = crmSchema.table(
  'item_links',
  {
    coreItemId: uuid('core_item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    /** crm.items.id (board row). */
    itemId: uuid('item_id').notNull(),
    columnKey: text('column_key'),
  },
  (t) => [primaryKey({ name: 'item_links_pkey', columns: [t.coreItemId, t.itemId] })],
);

export type CustomerLink = typeof customerLinks.$inferSelect;
export type ItemLink = typeof itemLinks.$inferSelect;
