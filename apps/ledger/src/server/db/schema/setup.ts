/** 5.2 Setup tables: settings, roles, chart of accounts, items, mappings, tax, terms, numbering, profiles. */
import { boolean, date, integer, jsonb, numeric, primaryKey, smallint, text, uuid } from 'drizzle-orm/pg-core';
import type { AccountSubtype, AccountType, DocType, LedgerRole, SystemKey, TermsKind } from '@/lib/ledger-enums';
import { base, cents, createdAt, ledgerSchema, price, tstz, updatedAt, version } from './_shared';

export const settings = ledgerSchema.table('settings', {
  orgId: uuid('org_id').primaryKey(),
  currency: text('currency').notNull().default('USD'),
  timezone: text('timezone').notNull(),
  workingDays: smallint('working_days').array().notNull().default([1, 2, 3, 4, 5]),
  fiscalYearStartMonth: smallint('fiscal_year_start_month').notNull().default(1),
  companyName: text('company_name'),
  companyAddress: jsonb('company_address').$type<Record<string, string>>(),
  logoAttachmentId: uuid('logo_attachment_id'),
  remitText: text('remit_text'),
  defaultTermsId: uuid('default_terms_id'),
  defaultMemberRole: text('default_member_role').$type<'none' | 'submitter'>().notNull().default('none'),
  separateApproval: boolean('separate_approval').notNull().default(true),
  autoApproveBelowCents: cents('auto_approve_below_cents'),
  writeOffLimitCents: cents('write_off_limit_cents').notNull().default(BigInt(50000)),
  receiptRequiredAboveCents: cents('receipt_required_above_cents').notNull().default(BigInt(2500)),
  priceToleranceBp: integer('price_tolerance_bp').notNull().default(200),
  agencyHoursTolerance: numeric('agency_hours_tolerance', { precision: 6, scale: 2 }).notNull().default('0.50'),
  promiseGraceDays: smallint('promise_grace_days').notNull().default(2),
  remindersEnabled: boolean('reminders_enabled').notNull().default(true),
  reminderFromName: text('reminder_from_name'),
  wmsAutoDraft: boolean('wms_auto_draft').notNull().default(false),
  wmsShowDetailPage: boolean('wms_show_detail_page').notNull().default(true),
  pdfFooterEnabled: boolean('pdf_footer_enabled').notNull().default(true),
  openingDate: date('opening_date'),
  booksMode: text('books_mode').$type<'sync' | 'books_of_record'>().notNull().default('sync'),
  onboarding: jsonb('onboarding').$type<Record<string, unknown>>().notNull().default({}),
  sampleLoadedAt: tstz('sample_loaded_at'),
  ...version(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const memberRoles = ledgerSchema.table('member_roles', {
  ...base(),
  userId: uuid('user_id').notNull(),
  role: text('role').$type<LedgerRole>().notNull(),
  canApproveBills: boolean('can_approve_bills').notNull().default(false),
  seesBalances: boolean('sees_balances').notNull().default(false),
  updatedBy: uuid('updated_by'),
});

export const accounts = ledgerSchema.table('accounts', {
  ...base(),
  number: text('number').notNull(),
  name: text('name').notNull(),
  type: text('type').$type<AccountType>().notNull(),
  subtype: text('subtype').$type<AccountSubtype>().notNull(),
  systemKey: text('system_key').$type<SystemKey>(),
  parentId: uuid('parent_id'),
  description: text('description'),
  isContra: boolean('is_contra').notNull().default(false),
  pulseCostCategory: text('pulse_cost_category'),
  externalRefs: jsonb('external_refs').$type<Record<string, string>>().notNull().default({}),
  archivedAt: tstz('archived_at'),
  ...version(),
});

export const taxRates = ledgerSchema.table('tax_rates', {
  ...base(),
  name: text('name').notNull(),
  rateMillionths: integer('rate_millionths').notNull(),
  accountId: uuid('account_id').notNull(),
  agency: text('agency'),
  active: boolean('active').notNull().default(true),
  archivedAt: tstz('archived_at'),
  externalRefs: jsonb('external_refs').$type<Record<string, string>>().notNull().default({}),
  ...version(),
});

export const items = ledgerSchema.table('items', {
  ...base(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  unitLabel: text('unit_label'),
  defaultPrice: price('default_price'),
  accountId: uuid('account_id').notNull(),
  taxRateId: uuid('tax_rate_id'),
  active: boolean('active').notNull().default(true),
  externalRefs: jsonb('external_refs').$type<Record<string, string>>().notNull().default({}),
  archivedAt: tstz('archived_at'),
  ...version(),
});

export const sourceMappings = ledgerSchema.table('source_mappings', {
  ...base(),
  source: text('source').$type<'wms_operation' | 'pulse_service' | 'program_fee_kind' | 'pulse_job_type'>().notNull(),
  key: text('key').notNull(),
  itemId: uuid('item_id').notNull(),
});

export const terms = ledgerSchema.table('terms', {
  ...base(),
  name: text('name').notNull(),
  kind: text('kind').$type<TermsKind>().notNull(),
  days: smallint('days'),
  dayOfMonth: smallint('day_of_month'),
  isDefault: boolean('is_default').notNull().default(false),
  active: boolean('active').notNull().default(true),
  externalRefs: jsonb('external_refs').$type<Record<string, string>>().notNull().default({}),
  ...version(),
});

export const numberSequences = ledgerSchema.table(
  'number_sequences',
  {
    orgId: uuid('org_id').notNull(),
    docType: text('doc_type').$type<DocType>().notNull(),
    prefix: text('prefix').notNull().default(''),
    nextValue: cents('next_value').notNull(),
    pad: smallint('pad').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.docType] })],
);

export const customerProfiles = ledgerSchema.table(
  'customer_profiles',
  {
    orgId: uuid('org_id').notNull(),
    customerId: uuid('customer_id').notNull(),
    billingContactName: text('billing_contact_name'),
    billingEmails: text('billing_emails').array().notNull().default([]),
    billingAddress: jsonb('billing_address').$type<Record<string, string>>(),
    termsId: uuid('terms_id'),
    defaultTaxRateId: uuid('default_tax_rate_id'),
    taxExempt: boolean('tax_exempt').notNull().default(false),
    exemptionNote: text('exemption_note'),
    remindersEnabled: boolean('reminders_enabled').notNull().default(true),
    collectionsOwnerId: uuid('collections_owner_id'),
    crmAccountItemId: uuid('crm_account_item_id'),
    externalRefs: jsonb('external_refs').$type<Record<string, string>>().notNull().default({}),
    notes: text('notes'),
    ...version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.customerId] })],
);

export const vendorProfiles = ledgerSchema.table(
  'vendor_profiles',
  {
    orgId: uuid('org_id').notNull(),
    vendorId: uuid('vendor_id').notNull(),
    termsId: uuid('terms_id'),
    defaultAccountId: uuid('default_account_id'),
    defaultApproverId: uuid('default_approver_id'),
    autoApprove: boolean('auto_approve').notNull().default(false),
    tracks1099: boolean('tracks_1099').notNull().default(false),
    w9OnFile: boolean('w9_on_file').notNull().default(false),
    remitAddress: jsonb('remit_address').$type<Record<string, string>>(),
    notes: text('notes'),
    /** Kinds of the core vendor that Ledger added (0001). Ledger never drops another app's kind unasked. */
    ledgerKinds: text('ledger_kinds').array().notNull().default([]),
    ...version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.vendorId] })],
);

export const programBilling = ledgerSchema.table('program_billing', {
  ...base(),
  programId: uuid('program_id').notNull(),
  customerId: uuid('customer_id'),
  cadence: text('cadence').$type<'weekly' | 'monthly'>().notNull(),
  weekday: smallint('weekday'),
  nextPeriodStart: date('next_period_start'),
  active: boolean('active').notNull().default(true),
});
