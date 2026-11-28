/** 5.4 Money you owe and 5.5 expenses: bills, vendor credits, bill payments, expenses. */
import { boolean, date, integer, jsonb, text, uuid } from 'drizzle-orm/pg-core';
import type { BillStatus, ExpenseStatus } from '@/lib/ledger-enums';
import { base, cents, deletedAt, hrs, ledgerSchema, posting, price, qty, src, tstz, version } from './_shared';

export const bills = ledgerSchema.table('bills', {
  ...base(),
  kind: text('kind').$type<'bill' | 'vendor_credit'>().notNull().default('bill'),
  number: text('number'),
  vendorId: uuid('vendor_id').notNull(),
  vendorRef: text('vendor_ref'),
  billDate: date('bill_date').notNull(),
  dueDate: date('due_date'),
  termsId: uuid('terms_id'),
  status: text('status').$type<BillStatus>().notNull().default('draft'),
  currency: text('currency').notNull().default('USD'),
  totalCents: cents('total_cents').notNull().default(BigInt(0)),
  paidCents: cents('paid_cents').notNull().default(BigInt(0)),
  creditedCents: cents('credited_cents').notNull().default(BigInt(0)),
  balanceCents: cents('balance_cents').notNull().default(BigInt(0)),
  approverId: uuid('approver_id'),
  approvalRequestedAt: tstz('approval_requested_at'),
  approvedAt: tstz('approved_at'),
  approvedBy: uuid('approved_by'),
  sentBackNote: text('sent_back_note'),
  payOn: date('pay_on'),
  memo: text('memo'),
  agencyWeekStart: date('agency_week_start'),
  billedHours: hrs('billed_hours'),
  checks: jsonb('checks').$type<Record<string, unknown>>().notNull().default({}),
  voidedAt: tstz('voided_at'),
  voidReason: text('void_reason'),
  ...posting(),
  ...deletedAt(),
  ...version(),
  ...src(),
});

export const billLines = ledgerSchema.table('bill_lines', {
  ...base(),
  billId: uuid('bill_id').notNull(),
  position: integer('position').notNull().default(0),
  description: text('description').notNull().default(''),
  accountId: uuid('account_id').notNull(),
  quantity: qty('quantity'),
  unitPrice: price('unit_price'),
  unitLabel: text('unit_label'),
  amountCents: cents('amount_cents').notNull(),
  customerId: uuid('customer_id'),
  pulseJobId: uuid('pulse_job_id'),
  wmsPoCode: text('wms_po_code'),
  wmsPoLineId: uuid('wms_po_line_id'),
});

export const billPayments = ledgerSchema.table('bill_payments', {
  ...base(),
  number: text('number'),
  vendorId: uuid('vendor_id').notNull(),
  paidOn: date('paid_on').notNull(),
  accountId: uuid('account_id').notNull(),
  method: text('method').$type<'check' | 'ach' | 'wire' | 'card' | 'cash'>().notNull().default('check'),
  reference: text('reference'),
  amountCents: cents('amount_cents').notNull(),
  memo: text('memo'),
  ...posting(),
  ...version(),
  ...src(),
});

export const billPaymentApplications = ledgerSchema.table('bill_payment_applications', {
  ...base(),
  billPaymentId: uuid('bill_payment_id'),
  vendorCreditId: uuid('vendor_credit_id'),
  billId: uuid('bill_id').notNull(),
  amountCents: cents('amount_cents').notNull(),
  appliedOn: date('applied_on').notNull(),
  removedAt: tstz('removed_at'),
  removedBy: uuid('removed_by'),
  createdBy: uuid('created_by'),
});

export const reimbursementPayments = ledgerSchema.table('reimbursement_payments', {
  ...base(),
  number: text('number'),
  paidOn: date('paid_on').notNull(),
  accountId: uuid('account_id').notNull(),
  method: text('method').notNull().default('ach'),
  reference: text('reference'),
  amountCents: cents('amount_cents').notNull(),
  memo: text('memo'),
  ...posting(),
  isSample: boolean('is_sample').notNull().default(false),
  createdBy: uuid('created_by'),
});

export const expenses = ledgerSchema.table('expenses', {
  ...base(),
  number: text('number'),
  kind: text('kind').$type<'card' | 'reimbursement'>().notNull(),
  spentOn: date('spent_on').notNull(),
  submittedBy: uuid('submitted_by'),
  paidFromAccountId: uuid('paid_from_account_id'),
  merchant: text('merchant'),
  amountCents: cents('amount_cents').notNull().default(BigInt(0)),
  status: text('status').$type<ExpenseStatus>().notNull().default('draft'),
  approverId: uuid('approver_id'),
  submittedAt: tstz('submitted_at'),
  approvedAt: tstz('approved_at'),
  approvedBy: uuid('approved_by'),
  rejectedNote: text('rejected_note'),
  memo: text('memo'),
  reimbursementPaymentId: uuid('reimbursement_payment_id'),
  ...posting(),
  ...deletedAt(),
  ...version(),
  ...src(),
});

export const expenseLines = ledgerSchema.table('expense_lines', {
  ...base(),
  expenseId: uuid('expense_id').notNull(),
  position: integer('position').notNull().default(0),
  accountId: uuid('account_id').notNull(),
  amountCents: cents('amount_cents').notNull(),
  customerId: uuid('customer_id'),
  pulseJobId: uuid('pulse_job_id'),
  memo: text('memo'),
});
