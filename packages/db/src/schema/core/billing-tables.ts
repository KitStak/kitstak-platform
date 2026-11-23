/**
 * Signup and billing tables added by drizzle/0007_core_billing.sql (docs/billing/CONTRACTS.md
 * section 9): core.billing_accounts, billing_subscriptions, billing_invoices, billing_audit_log,
 * billing_managers, billing_cancel_feedback, billing_emails, billing_test_objects,
 * billing_trial_uses and core.signup_intents.
 *
 * The SQL file is the source of truth (hand written, never `drizzle-kit push`). Foreign keys to
 * core.organization and core."user" exist in SQL only, guarded on the target tables.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { coreSchema, createdAt, id, updatedAt } from '../_shared';
import { BILLING_GATEWAYS } from './billing';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** `{ line1, line2, city, state, postalCode, country }`, all optional; country is an ISO 2 letter code. */
export interface BillingAddressJson {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

/** One per organization: the saved cart, the trial dates and the billing profile. */
export const billingAccounts = coreSchema.table(
  'billing_accounts',
  {
    orgId: uuid('org_id').primaryKey(),
    gateway: text('gateway', { enum: BILLING_GATEWAYS }),
    /** A `PlanSelection`. Always read it through `normalizeSelection`. */
    cart: jsonb('cart').$type<Record<string, unknown>>().notNull().default({}),
    trialStartedAt: timestamptz('trial_started_at'),
    trialEndsAt: timestamptz('trial_ends_at'),
    trialStartedBy: uuid('trial_started_by'),
    billingEmail: text('billing_email'),
    companyName: text('company_name'),
    address: jsonb('address').$type<BillingAddressJson>().notNull().default({}),
    taxIdType: text('tax_id_type'),
    taxIdValue: text('tax_id_value'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('billing_accounts_gateway_check', sql`${t.gateway} IS NULL OR ${t.gateway} IN ('stripe', 'test')`),
    index('billing_accounts_trial_ends_idx').on(t.trialEndsAt).where(sql`${t.trialEndsAt} IS NOT NULL`),
    index('billing_accounts_trial_started_by_idx')
      .on(t.trialStartedBy)
      .where(sql`${t.trialStartedBy} IS NOT NULL`),
  ],
);

export const BILLING_SUBSCRIPTION_STATUSES = [
  'incomplete',
  'trialing',
  'active',
  'past_due',
  'unpaid',
  'canceled',
] as const;
export type BillingSubscriptionStatus = (typeof BILLING_SUBSCRIPTION_STATUSES)[number];

export const BILLING_INTERVAL_VALUES = ['monthly', 'yearly'] as const;

/** One entry of `billing_subscriptions.items`. */
export interface BillingSubscriptionItemJson {
  product: string;
  priceKey: string;
  quantity: number;
  unitCents: number;
  gatewayItemId: string;
}

/** One per organization: the current plan as the gateway sees it. */
export const billingSubscriptions = coreSchema.table(
  'billing_subscriptions',
  {
    orgId: uuid('org_id').primaryKey(),
    gateway: text('gateway', { enum: BILLING_GATEWAYS }).notNull(),
    gatewaySubscriptionId: text('gateway_subscription_id').notNull(),
    gatewayCustomerId: text('gateway_customer_id').notNull(),
    /** The gateway status. "Paused" is not a status; it is the two pause dates being set. */
    status: text('status', { enum: BILLING_SUBSCRIPTION_STATUSES }).notNull(),
    interval: text('interval', { enum: BILLING_INTERVAL_VALUES }).notNull(),
    seats: integer('seats').notNull().default(1),
    warehouses: integer('warehouses').notNull().default(1),
    items: jsonb('items').$type<BillingSubscriptionItemJson[]>().notNull().default([]),
    recurringCents: integer('recurring_cents').notNull().default(0),
    currency: text('currency').notNull().default('usd'),
    currentPeriodStart: timestamptz('current_period_start'),
    currentPeriodEnd: timestamptz('current_period_end'),
    trialEnd: timestamptz('trial_end'),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    cancelAt: timestamptz('cancel_at'),
    canceledAt: timestamptz('canceled_at'),
    endedAt: timestamptz('ended_at'),
    pauseStartsAt: timestamptz('pause_starts_at'),
    pauseResumesAt: timestamptz('pause_resumes_at'),
    pastDueSince: timestamptz('past_due_since'),
    amountDueCents: integer('amount_due_cents'),
    nextPaymentAttempt: timestamptz('next_payment_attempt'),
    lastPaymentError: text('last_payment_error'),
    pmBrand: text('pm_brand'),
    pmLast4: text('pm_last4'),
    pmExpMonth: integer('pm_exp_month'),
    pmExpYear: integer('pm_exp_year'),
    latestInvoiceId: text('latest_invoice_id'),
    gatewaySyncedAt: timestamptz('gateway_synced_at').notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('billing_subscriptions_gateway_subscription_id_unique').on(t.gatewaySubscriptionId),
    check('billing_subscriptions_gateway_check', sql`${t.gateway} IN ('stripe', 'test')`),
    check(
      'billing_subscriptions_status_check',
      sql`${t.status} IN ('incomplete', 'trialing', 'active', 'past_due', 'unpaid', 'canceled')`,
    ),
    check('billing_subscriptions_interval_check', sql`${t.interval} IN ('monthly', 'yearly')`),
  ],
);

export const BILLING_INVOICE_STATUSES = ['draft', 'open', 'paid', 'void', 'uncollectible'] as const;
export type BillingInvoiceStatus = (typeof BILLING_INVOICE_STATUSES)[number];

/** One entry of `billing_invoices.lines`. `product` is null for lines the catalog does not know. */
export interface BillingInvoiceLineJson {
  description: string;
  product: string | null;
  quantity: number;
  unitCents: number;
  amountCents: number;
  proration: boolean;
}

/** A cache of gateway invoices for the invoice list and the receipts. */
export const billingInvoices = coreSchema.table(
  'billing_invoices',
  {
    /** Gateway invoice id (in_..., test gateway in_test_...). */
    id: text('id').primaryKey(),
    orgId: uuid('org_id').notNull(),
    gateway: text('gateway', { enum: BILLING_GATEWAYS }).notNull(),
    number: text('number'),
    status: text('status', { enum: BILLING_INVOICE_STATUSES }).notNull(),
    billingReason: text('billing_reason'),
    currency: text('currency').notNull().default('usd'),
    subtotalCents: integer('subtotal_cents').notNull().default(0),
    discountCents: integer('discount_cents').notNull().default(0),
    taxCents: integer('tax_cents').notNull().default(0),
    totalCents: integer('total_cents').notNull().default(0),
    amountPaidCents: integer('amount_paid_cents').notNull().default(0),
    amountDueCents: integer('amount_due_cents').notNull().default(0),
    lines: jsonb('lines').$type<BillingInvoiceLineJson[]>().notNull().default([]),
    periodStart: timestamptz('period_start'),
    periodEnd: timestamptz('period_end'),
    issuedAt: timestamptz('issued_at').notNull(),
    paidAt: timestamptz('paid_at'),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextPaymentAttempt: timestamptz('next_payment_attempt'),
    pmLast4: text('pm_last4'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('billing_invoices_status_check', sql`${t.status} IN ('draft', 'open', 'paid', 'void', 'uncollectible')`),
    index('billing_invoices_org_issued_idx').on(t.orgId, t.issuedAt.desc()),
  ],
);

/** Every billing write, as a plain sentence a customer can read. Feeds the activity page. */
export const billingAuditLog = coreSchema.table(
  'billing_audit_log',
  {
    id: id(),
    orgId: uuid('org_id').notNull(),
    actorUserId: uuid('actor_user_id'),
    actorLabel: text('actor_label').notNull(),
    action: text('action').notNull(),
    summary: text('summary').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    eventId: text('event_id'),
    createdAt: createdAt(),
  },
  (t) => [index('billing_audit_log_org_created_idx').on(t.orgId, t.createdAt.desc())],
);

/** Who holds the billing manager role (owners hold billing without a row here). */
export const billingManagers = coreSchema.table(
  'billing_managers',
  {
    orgId: uuid('org_id').notNull(),
    userId: uuid('user_id').notNull(),
    addedBy: uuid('added_by'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ name: 'billing_managers_pkey', columns: [t.orgId, t.userId] })],
);

export const BILLING_CANCEL_REASONS = [
  'too_expensive',
  'missing_feature',
  'switching_tool',
  'not_using',
  'seasonal',
  'other',
] as const;
export type BillingCancelReason = (typeof BILLING_CANCEL_REASONS)[number];

export const BILLING_CANCEL_OUTCOMES = ['canceled', 'paused', 'kept'] as const;
export type BillingCancelOutcome = (typeof BILLING_CANCEL_OUTCOMES)[number];

/** The optional "why are you leaving" answers. */
export const billingCancelFeedback = coreSchema.table(
  'billing_cancel_feedback',
  {
    id: id(),
    orgId: uuid('org_id').notNull(),
    userId: uuid('user_id'),
    reason: text('reason', { enum: BILLING_CANCEL_REASONS }),
    detail: text('detail'),
    outcome: text('outcome', { enum: BILLING_CANCEL_OUTCOMES }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'billing_cancel_feedback_reason_check',
      sql`${t.reason} IS NULL OR ${t.reason} IN ('too_expensive', 'missing_feature', 'switching_tool', 'not_using', 'seasonal', 'other')`,
    ),
    check('billing_cancel_feedback_outcome_check', sql`${t.outcome} IN ('canceled', 'paused', 'kept')`),
    index('billing_cancel_feedback_org_idx').on(t.orgId, t.createdAt.desc()),
  ],
);

export const BILLING_EMAIL_STATUSES = ['queued', 'sent', 'failed', 'skipped'] as const;
export type BillingEmailStatus = (typeof BILLING_EMAIL_STATUSES)[number];

/** The email outbox and send log. `html` and `body_text` are stored only by the dev outbox. */
export const billingEmails = coreSchema.table(
  'billing_emails',
  {
    id: id(),
    orgId: uuid('org_id'),
    toEmail: text('to_email').notNull(),
    template: text('template').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    dedupeKey: text('dedupe_key').notNull(),
    status: text('status', { enum: BILLING_EMAIL_STATUSES }).notNull().default('queued'),
    provider: text('provider'),
    providerMessageId: text('provider_message_id'),
    subject: text('subject'),
    html: text('html'),
    bodyText: text('body_text'),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    sendAfter: timestamptz('send_after').notNull().defaultNow(),
    createdAt: createdAt(),
    sentAt: timestamptz('sent_at'),
  },
  (t) => [
    unique('billing_emails_dedupe_key_unique').on(t.dedupeKey),
    check('billing_emails_status_check', sql`${t.status} IN ('queued', 'sent', 'failed', 'skipped')`),
    index('billing_emails_queue_idx').on(t.sendAfter).where(sql`${t.status} = 'queued'`),
  ],
);

export const BILLING_TEST_OBJECT_KINDS = [
  'customer',
  'checkout_session',
  'portal_session',
  'subscription',
  'invoice',
  'payment_method',
] as const;
export type BillingTestObjectKind = (typeof BILLING_TEST_OBJECT_KINDS)[number];

/** The test gateway's own state: one JSON document per object. Never used in production. */
export const billingTestObjects = coreSchema.table(
  'billing_test_objects',
  {
    id: text('id').primaryKey(),
    kind: text('kind', { enum: BILLING_TEST_OBJECT_KINDS }).notNull(),
    orgId: uuid('org_id'),
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'billing_test_objects_kind_check',
      sql`${t.kind} IN ('customer', 'checkout_session', 'portal_session', 'subscription', 'invoice', 'payment_method')`,
    ),
    index('billing_test_objects_org_kind_idx').on(t.orgId, t.kind),
  ],
);

/**
 * One row per person per organization whose free trial they started. No foreign key to the
 * organization on purpose: the row outlives a deleted organization, so "one free trial per person"
 * cannot be reset by deleting an organization.
 */
export const billingTrialUses = coreSchema.table(
  'billing_trial_uses',
  {
    userId: uuid('user_id').notNull(),
    orgId: uuid('org_id').notNull(),
    startedAt: timestamptz('started_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: 'billing_trial_uses_pkey', columns: [t.userId, t.orgId] })],
);

export const SIGNUP_INTENT_STEPS = ['company', 'plan', 'verify', 'welcome', 'done'] as const;
export type SignupIntentStep = (typeof SIGNUP_INTENT_STEPS)[number];

export const SIGNUP_INTENT_SOURCES = ['wizard', 'pricing', 'product', 'app', 'direct', 'invite'] as const;
export type SignupIntentSource = (typeof SIGNUP_INTENT_SOURCES)[number];

/** The cart and answers from the marketing site, and the signup step, per person. */
export const signupIntents = coreSchema.table(
  'signup_intents',
  {
    id: id(),
    userId: uuid('user_id').notNull(),
    orgId: uuid('org_id'),
    /** A `PlanSelection` or null. Always read it through `normalizeSelection`. */
    selection: jsonb('selection').$type<Record<string, unknown> | null>(),
    profile: jsonb('profile').$type<Record<string, unknown>>().notNull().default({}),
    source: text('source', { enum: SIGNUP_INTENT_SOURCES }).notNull().default('direct'),
    step: text('step', { enum: SIGNUP_INTENT_STEPS }).notNull().default('company'),
    verifySkippedAt: timestamptz('verify_skipped_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    completedAt: timestamptz('completed_at'),
  },
  (t) => [
    check('signup_intents_step_check', sql`${t.step} IN ('company', 'plan', 'verify', 'welcome', 'done')`),
    check(
      'signup_intents_source_check',
      sql`${t.source} IN ('wizard', 'pricing', 'product', 'app', 'direct', 'invite')`,
    ),
    uniqueIndex('signup_intents_open_user_unique').on(t.userId).where(sql`${t.completedAt} IS NULL`),
  ],
);

export type BillingAccount = typeof billingAccounts.$inferSelect;
export type NewBillingAccount = typeof billingAccounts.$inferInsert;
export type BillingSubscription = typeof billingSubscriptions.$inferSelect;
export type NewBillingSubscription = typeof billingSubscriptions.$inferInsert;
export type BillingInvoice = typeof billingInvoices.$inferSelect;
export type NewBillingInvoice = typeof billingInvoices.$inferInsert;
export type BillingAuditLogRow = typeof billingAuditLog.$inferSelect;
export type BillingManager = typeof billingManagers.$inferSelect;
export type BillingCancelFeedbackRow = typeof billingCancelFeedback.$inferSelect;
export type BillingEmail = typeof billingEmails.$inferSelect;
export type NewBillingEmail = typeof billingEmails.$inferInsert;
export type BillingTestObject = typeof billingTestObjects.$inferSelect;
export type BillingTrialUse = typeof billingTrialUses.$inferSelect;
export type SignupIntentRow = typeof signupIntents.$inferSelect;
