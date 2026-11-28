/** 5.3 Money owed to you: invoices, credit notes, payments, collections. */
import { boolean, date, integer, jsonb, smallint, text, uuid } from 'drizzle-orm/pg-core';
import type { InvoiceKind, InvoiceStatus } from '@/lib/ledger-enums';
import { base, cents, deletedAt, ledgerSchema, posting, price, qty, src, tstz, version } from './_shared';

export const invoices = ledgerSchema.table('invoices', {
  ...base(),
  kind: text('kind').$type<InvoiceKind>().notNull().default('invoice'),
  number: text('number'),
  status: text('status').$type<InvoiceStatus>().notNull().default('draft'),
  customerId: uuid('customer_id').notNull(),
  issueDate: date('issue_date').notNull(),
  dueDate: date('due_date'),
  termsId: uuid('terms_id'),
  poNumber: text('po_number'),
  memo: text('memo'),
  internalNote: text('internal_note'),
  currency: text('currency').notNull().default('USD'),
  subtotalCents: cents('subtotal_cents').notNull().default(BigInt(0)),
  taxCents: cents('tax_cents').notNull().default(BigInt(0)),
  totalCents: cents('total_cents').notNull().default(BigInt(0)),
  appliedCents: cents('applied_cents').notNull().default(BigInt(0)),
  creditedCents: cents('credited_cents').notNull().default(BigInt(0)),
  writtenOffCents: cents('written_off_cents').notNull().default(BigInt(0)),
  balanceCents: cents('balance_cents').notNull().default(BigInt(0)),
  creditForInvoiceId: uuid('credit_for_invoice_id'),
  recurringInvoiceId: uuid('recurring_invoice_id'),
  remindersEnabled: boolean('reminders_enabled').notNull().default(true),
  sentAt: tstz('sent_at'),
  sentBy: uuid('sent_by'),
  sendCount: integer('send_count').notNull().default(0),
  voidedAt: tstz('voided_at'),
  voidedBy: uuid('voided_by'),
  voidReason: text('void_reason'),
  ...posting(),
  ...deletedAt(),
  ...version(),
  ...src(),
});

const lineColumns = () => ({
  position: integer('position').notNull().default(0),
  itemId: uuid('item_id'),
  description: text('description').notNull().default(''),
  quantity: qty('quantity').notNull().default('1'),
  unitPrice: price('unit_price').notNull().default('0'),
  amountCents: cents('amount_cents').notNull(),
  accountId: uuid('account_id').notNull(),
  taxRateId: uuid('tax_rate_id'),
  rateMillionths: integer('rate_millionths'),
  taxCents: cents('tax_cents').notNull().default(BigInt(0)),
  pulseJobId: uuid('pulse_job_id'),
});

export const invoiceLines = ledgerSchema.table('invoice_lines', {
  ...base(),
  invoiceId: uuid('invoice_id').notNull(),
  ...lineColumns(),
  serviceDate: date('service_date'),
  amountFromSource: boolean('amount_from_source').notNull().default(false),
});

export const invoiceSources = ledgerSchema.table('invoice_sources', {
  ...base(),
  invoiceId: uuid('invoice_id').notNull(),
  invoiceLineId: uuid('invoice_line_id'),
  sourceType: text('source_type').notNull(),
  sourceRef: text('source_ref').notNull(),
  meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
  active: boolean('active').notNull().default(true),
});

export const recurringInvoices = ledgerSchema.table('recurring_invoices', {
  ...base(),
  customerId: uuid('customer_id').notNull(),
  name: text('name').notNull(),
  cadence: text('cadence').$type<'weekly' | 'monthly' | 'quarterly'>().notNull(),
  weekday: smallint('weekday'),
  dayOfMonth: smallint('day_of_month'),
  lastDay: boolean('last_day').notNull().default(false),
  monthOfQuarter: smallint('month_of_quarter'),
  nextRunDate: date('next_run_date').notNull(),
  endDate: date('end_date'),
  termsId: uuid('terms_id'),
  memo: text('memo'),
  active: boolean('active').notNull().default(true),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  isSample: boolean('is_sample').notNull().default(false),
  ...version(),
});

export const recurringInvoiceLines = ledgerSchema.table('recurring_invoice_lines', {
  ...base(),
  recurringInvoiceId: uuid('recurring_invoice_id').notNull(),
  ...lineColumns(),
});

export const payments = ledgerSchema.table('payments', {
  ...base(),
  kind: text('kind').$type<'received' | 'refund'>().notNull().default('received'),
  number: text('number'),
  customerId: uuid('customer_id').notNull(),
  receivedOn: date('received_on').notNull(),
  method: text('method').$type<'check' | 'ach' | 'wire' | 'card' | 'cash' | 'other'>().notNull().default('check'),
  reference: text('reference'),
  amountCents: cents('amount_cents').notNull(),
  depositToAccountId: uuid('deposit_to_account_id').notNull(),
  unappliedCents: cents('unapplied_cents').notNull().default(BigInt(0)),
  depositId: uuid('deposit_id'),
  externalRef: text('external_ref'),
  memo: text('memo'),
  ...posting(),
  ...version(),
  ...src(),
});

export const paymentApplications = ledgerSchema.table('payment_applications', {
  ...base(),
  paymentId: uuid('payment_id'),
  creditNoteId: uuid('credit_note_id'),
  invoiceId: uuid('invoice_id').notNull(),
  amountCents: cents('amount_cents').notNull(),
  appliedOn: date('applied_on').notNull(),
  removedAt: tstz('removed_at'),
  removedBy: uuid('removed_by'),
  createdBy: uuid('created_by'),
});

export const deposits = ledgerSchema.table('deposits', {
  ...base(),
  bankAccountId: uuid('bank_account_id').notNull(),
  depositedOn: date('deposited_on').notNull(),
  totalCents: cents('total_cents').notNull(),
  feeCents: cents('fee_cents').notNull().default(BigInt(0)),
  feeAccountId: uuid('fee_account_id'),
  bankLineId: uuid('bank_line_id'),
  memo: text('memo'),
  ...posting(),
  isSample: boolean('is_sample').notNull().default(false),
  createdBy: uuid('created_by'),
});

export const writeOffs = ledgerSchema.table('write_offs', {
  ...base(),
  invoiceId: uuid('invoice_id').notNull(),
  writeOffDate: date('write_off_date').notNull(),
  amountCents: cents('amount_cents').notNull(),
  accountId: uuid('account_id').notNull(),
  reason: text('reason').notNull(),
  status: text('status').$type<'waiting_approval' | 'posted' | 'reversed'>().notNull().default('posted'),
  approvedBy: uuid('approved_by'),
  reversedAt: tstz('reversed_at'),
  reversedBy: uuid('reversed_by'),
  ...posting(),
  isSample: boolean('is_sample').notNull().default(false),
  createdBy: uuid('created_by'),
});

export const disputes = ledgerSchema.table('disputes', {
  ...base(),
  invoiceId: uuid('invoice_id').notNull(),
  invoiceLineId: uuid('invoice_line_id').notNull(),
  openedOn: date('opened_on').notNull(),
  amountCents: cents('amount_cents').notNull(),
  reason: text('reason').notNull(),
  status: text('status').$type<'open' | 'resolved_credited' | 'resolved_dropped'>().notNull().default('open'),
  resolvedOn: date('resolved_on'),
  resolvedBy: uuid('resolved_by'),
  creditNoteId: uuid('credit_note_id'),
  isSample: boolean('is_sample').notNull().default(false),
  createdBy: uuid('created_by'),
});

export const promises = ledgerSchema.table('promises', {
  ...base(),
  customerId: uuid('customer_id').notNull(),
  invoiceIds: uuid('invoice_ids').array().notNull().default([]),
  promisedDate: date('promised_date').notNull(),
  amountCents: cents('amount_cents'),
  note: text('note'),
  status: text('status').$type<'pending' | 'kept' | 'missed' | 'cancelled'>().notNull().default('pending'),
  resolvedAt: tstz('resolved_at'),
  isSample: boolean('is_sample').notNull().default(false),
  createdBy: uuid('created_by'),
});

export const reminderRules = ledgerSchema.table('reminder_rules', {
  ...base(),
  offsetDays: integer('offset_days').notNull(),
  repeatEveryDays: integer('repeat_every_days'),
  maxCount: smallint('max_count'),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  active: boolean('active').notNull().default(true),
});

export const reminderSends = ledgerSchema.table('reminder_sends', {
  ...base(),
  invoiceId: uuid('invoice_id').notNull(),
  ruleOffset: integer('rule_offset').notNull(),
  sentOn: date('sent_on').notNull(),
  emailId: uuid('email_id'),
});

export const publicLinks = ledgerSchema.table('public_links', {
  ...base(),
  invoiceId: uuid('invoice_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  tokenPrefix: text('token_prefix').notNull(),
  expiresAt: tstz('expires_at').notNull(),
  lastViewedAt: tstz('last_viewed_at'),
  revokedAt: tstz('revoked_at'),
});

export const emails = ledgerSchema.table('emails', {
  ...base(),
  kind: text('kind').$type<'invoice' | 'reminder' | 'statement' | 'other'>().notNull(),
  to: text('to').array().notNull().default([]),
  subject: text('subject').notNull(),
  entityType: text('entity_type'),
  entityId: uuid('entity_id'),
  dedupeKey: text('dedupe_key').notNull(),
  providerId: text('provider_id'),
  status: text('status').$type<'queued' | 'sent' | 'failed'>().notNull().default('queued'),
  error: text('error'),
  sentAt: tstz('sent_at'),
});
