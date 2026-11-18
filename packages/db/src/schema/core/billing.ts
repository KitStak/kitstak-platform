/**
 * core.stripe_customers / core.entitlements / core.billing_events —
 * billing & per-module entitlements (BLUEPRINT.md §2.3, §3).
 */
import { sql } from 'drizzle-orm';
import { check, integer, jsonb, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { coreSchema, createdAt, id, orgId, updatedAt } from '../_shared';

export const ENTITLEMENT_MODULES = ['crm', 'wms', 'projects', 'pulse'] as const;
export type EntitlementModule = (typeof ENTITLEMENT_MODULES)[number];

export const ENTITLEMENT_STATUSES = ['active', 'trialing', 'past_due', 'canceled'] as const;
export type EntitlementStatus = (typeof ENTITLEMENT_STATUSES)[number];

export const ENTITLEMENT_SOURCES = ['stripe', 'manual', 'trial'] as const;
export type EntitlementSource = (typeof ENTITLEMENT_SOURCES)[number];

export const stripeCustomers = coreSchema.table('stripe_customers', {
  /**
   * One Stripe customer per org. TODO(Phase 3): add the drizzle FK
   * `.references(() => organization.id, { onDelete: 'cascade' })` once Better Auth
   * core.organization relocates; SQL FK deferred in drizzle/0001_core_fks.sql.
   */
  orgId: uuid('org_id').primaryKey(),
  stripeCustomerId: text('stripe_customer_id').notNull().unique(),
  createdAt: createdAt(),
});

export const entitlements = coreSchema.table(
  'entitlements',
  {
    id: id(),
    orgId: orgId(),
    module: text('module', { enum: ENTITLEMENT_MODULES }).notNull(),
    status: text('status', { enum: ENTITLEMENT_STATUSES }).notNull(),
    source: text('source', { enum: ENTITLEMENT_SOURCES }).notNull().default('stripe'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    stripePriceId: text('stripe_price_id'),
    seats: integer('seats'),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('entitlements_org_id_module_unique').on(t.orgId, t.module),
    check('entitlements_module_check', sql`${t.module} IN ('crm', 'wms', 'projects')`),
    check(
      'entitlements_status_check',
      sql`${t.status} IN ('active', 'trialing', 'past_due', 'canceled')`,
    ),
    check('entitlements_source_check', sql`${t.source} IN ('stripe', 'manual', 'trial')`),
  ],
);

/** Webhook idempotency ledger. */
export const billingEvents = coreSchema.table('billing_events', {
  /** Stripe event id (evt_...). */
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

export type StripeCustomer = typeof stripeCustomers.$inferSelect;
export type Entitlement = typeof entitlements.$inferSelect;
export type NewEntitlement = typeof entitlements.$inferInsert;
export type BillingEvent = typeof billingEvents.$inferSelect;
