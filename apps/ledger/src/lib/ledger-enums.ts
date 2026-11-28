/**
 * The text enums of the `ledger` schema, mirrored from the CHECK constraints in
 * drizzle/0000_ledger_init.sql. Pure module, safe in client components.
 */
export type { LedgerRole } from '@kitstak/ledger-bridge/types';

export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_SUBTYPES = [
  'bank',
  'card',
  'undeposited',
  'receivable',
  'unbilled',
  'other_current',
  'fixed',
  'payable',
  'sales_tax',
  'payroll',
  'equity',
  'revenue',
  'cost_of_service',
  'expense',
  'other',
] as const;
export type AccountSubtype = (typeof ACCOUNT_SUBTYPES)[number];

/** Accounts posting needs. A system account can be renamed but never archived or retyped. */
export const SYSTEM_KEYS = [
  'default_bank',
  'undeposited',
  'ar',
  'unbilled',
  'ap',
  'default_card',
  'sales_tax',
  'payroll',
  'reimbursements',
  'customer_credit',
  'retained_earnings',
  'opening_equity',
  'default_revenue',
  'accrued_revenue',
  'bank_fees',
  'bad_debt',
] as const;
export type SystemKey = (typeof SYSTEM_KEYS)[number];

/** Normal side of each account type (4.3): debit for assets and expenses, credit for the rest. */
export const NORMAL_SIDE: Readonly<Record<AccountType, 'debit' | 'credit'>> = {
  asset: 'debit',
  expense: 'debit',
  liability: 'credit',
  equity: 'credit',
  revenue: 'credit',
};

export const TERMS_KINDS = ['due_on_receipt', 'net_days', 'day_of_next_month'] as const;
export type TermsKind = (typeof TERMS_KINDS)[number];

export const DOC_TYPES = ['invoice', 'credit_note', 'journal', 'bill', 'payment', 'expense'] as const;
export type DocType = (typeof DOC_TYPES)[number];

export type InvoiceKind = 'invoice' | 'credit_note';
export type InvoiceStatus = 'draft' | 'sent' | 'partially_paid' | 'paid' | 'void' | 'open' | 'applied';
export type BillStatus = 'draft' | 'approved' | 'scheduled' | 'paid' | 'void';
export type ExpenseStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'paid';

export const JOURNAL_SOURCE_TYPES = [
  'invoice',
  'credit_note',
  'payment',
  'refund',
  'application',
  'write_off',
  'deposit',
  'bill',
  'vendor_credit',
  'bill_payment',
  'expense',
  'reimbursement',
  'reimbursement_payment',
  'transfer',
  'accrual',
  'accrual_reversal',
  'manual',
  'opening',
  'payroll',
] as const;
export type JournalSourceType = (typeof JOURNAL_SOURCE_TYPES)[number];

/** Where an account's spending shows in Pulse (`accounts.pulse_cost_category`); null means never sent to Pulse. */
export const PULSE_COST_CATEGORIES = ['freight', 'packaging', 'equipment', 'outside_service', 'rework', 'supplies', 'storage', 'rent', 'utilities', 'salaried_staff', 'insurance', 'other'] as const;
export type PulseCostCategoryValue = (typeof PULSE_COST_CATEGORIES)[number];
