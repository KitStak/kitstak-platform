/**
 * What a new org gets on its first read of Ledger (docs/ledger/SPEC.md 4.3, 4.5.2, 4.5.3, 4.6.2):
 * the default chart of accounts for a kitting and 3PL shop, the payment terms, the numbering and
 * the reminder schedule. Pure data, so it is unit tested and shown on Settings as is.
 */
import type { AccountSubtype, AccountType, DocType, SystemKey, TermsKind } from './ledger-enums';

export type PulseCostCategory = 'freight' | 'packaging' | 'equipment' | 'outside_service' | 'rent' | 'utilities' | 'salaried_staff' | 'insurance' | 'other';

export interface DefaultAccount {
  readonly number: string;
  readonly name: string;
  readonly type: AccountType;
  readonly subtype: AccountSubtype;
  readonly systemKey?: SystemKey;
  readonly isContra?: boolean;
  readonly pulseCostCategory?: PulseCostCategory;
  readonly description?: string;
}

export const DEFAULT_CHART: readonly DefaultAccount[] = [
  // Assets
  { number: '1000', name: 'Checking', type: 'asset', subtype: 'bank', systemKey: 'default_bank' },
  { number: '1050', name: 'Payments not deposited yet', type: 'asset', subtype: 'undeposited', systemKey: 'undeposited' },
  { number: '1100', name: 'Money owed to you', type: 'asset', subtype: 'receivable', systemKey: 'ar' },
  { number: '1150', name: 'Work done, not billed yet', type: 'asset', subtype: 'unbilled', systemKey: 'unbilled' },
  { number: '1300', name: 'Prepaid expenses', type: 'asset', subtype: 'other_current' },
  { number: '1400', name: 'Supplies on hand', type: 'asset', subtype: 'other_current', description: 'Optional. Supplies are normally an expense.' },
  { number: '1500', name: 'Equipment', type: 'asset', subtype: 'fixed' },
  { number: '1510', name: 'Equipment depreciation to date', type: 'asset', subtype: 'fixed', isContra: true },
  // Liabilities
  { number: '2000', name: 'Bills to pay', type: 'liability', subtype: 'payable', systemKey: 'ap' },
  { number: '2100', name: 'Company card', type: 'liability', subtype: 'card', systemKey: 'default_card' },
  { number: '2200', name: 'Sales tax to pay', type: 'liability', subtype: 'sales_tax', systemKey: 'sales_tax' },
  { number: '2300', name: 'Payroll to pay', type: 'liability', subtype: 'payroll', systemKey: 'payroll' },
  { number: '2310', name: 'Payroll taxes to pay', type: 'liability', subtype: 'payroll' },
  { number: '2350', name: 'Owed to people', type: 'liability', subtype: 'other_current', systemKey: 'reimbursements', description: 'Expenses to pay back to your people.' },
  { number: '2400', name: 'Customer credits', type: 'liability', subtype: 'other_current', systemKey: 'customer_credit', description: 'Payments not applied to an invoice yet.' },
  // Equity
  { number: '3000', name: "Owner's equity", type: 'equity', subtype: 'equity' },
  { number: '3100', name: 'Retained earnings', type: 'equity', subtype: 'equity', systemKey: 'retained_earnings' },
  { number: '3900', name: 'Opening balances', type: 'equity', subtype: 'equity', systemKey: 'opening_equity' },
  // Revenue
  { number: '4000', name: 'Kitting and assembly', type: 'revenue', subtype: 'revenue', systemKey: 'default_revenue' },
  { number: '4100', name: 'Storage', type: 'revenue', subtype: 'revenue' },
  { number: '4200', name: 'Receiving', type: 'revenue', subtype: 'revenue' },
  { number: '4300', name: 'Pick and pack', type: 'revenue', subtype: 'revenue' },
  { number: '4400', name: 'Extra services', type: 'revenue', subtype: 'revenue' },
  { number: '4500', name: 'Shipping and freight billed', type: 'revenue', subtype: 'revenue' },
  { number: '4600', name: 'Program fees', type: 'revenue', subtype: 'revenue' },
  { number: '4800', name: 'Other revenue', type: 'revenue', subtype: 'revenue' },
  { number: '4900', name: 'Credits and discounts', type: 'revenue', subtype: 'revenue', isContra: true },
  { number: '4950', name: 'Work done, not billed yet (revenue)', type: 'revenue', subtype: 'revenue', systemKey: 'accrued_revenue' },
  // Cost of service
  { number: '5000', name: 'Floor wages', type: 'expense', subtype: 'cost_of_service' },
  { number: '5100', name: 'Temp agency labor', type: 'expense', subtype: 'cost_of_service' },
  { number: '5200', name: 'Packaging and supplies', type: 'expense', subtype: 'cost_of_service', pulseCostCategory: 'packaging' },
  { number: '5300', name: 'Freight out', type: 'expense', subtype: 'cost_of_service', pulseCostCategory: 'freight' },
  { number: '5400', name: 'Outside services', type: 'expense', subtype: 'cost_of_service', pulseCostCategory: 'outside_service' },
  // Expenses
  { number: '6000', name: 'Rent', type: 'expense', subtype: 'expense', pulseCostCategory: 'rent' },
  { number: '6100', name: 'Utilities', type: 'expense', subtype: 'expense', pulseCostCategory: 'utilities' },
  { number: '6200', name: 'Equipment and repairs', type: 'expense', subtype: 'expense', pulseCostCategory: 'equipment' },
  { number: '6300', name: 'Insurance', type: 'expense', subtype: 'expense', pulseCostCategory: 'insurance' },
  { number: '6400', name: 'Office salaries', type: 'expense', subtype: 'expense', pulseCostCategory: 'salaried_staff' },
  { number: '6410', name: 'Payroll taxes', type: 'expense', subtype: 'expense' },
  { number: '6420', name: 'Benefits', type: 'expense', subtype: 'expense' },
  { number: '6500', name: 'Software and subscriptions', type: 'expense', subtype: 'expense', pulseCostCategory: 'other' },
  { number: '6600', name: 'Office and admin', type: 'expense', subtype: 'expense', pulseCostCategory: 'other' },
  { number: '6700', name: 'Travel and meals', type: 'expense', subtype: 'expense', pulseCostCategory: 'other' },
  { number: '6800', name: 'Bank and card fees', type: 'expense', subtype: 'expense', systemKey: 'bank_fees' },
  { number: '6900', name: 'Bad debt', type: 'expense', subtype: 'expense', systemKey: 'bad_debt' },
  { number: '6950', name: 'Other expenses', type: 'expense', subtype: 'expense', pulseCostCategory: 'other' },
];

export interface DefaultTerms {
  readonly name: string;
  readonly kind: TermsKind;
  readonly days?: number;
  readonly dayOfMonth?: number;
  readonly isDefault?: boolean;
}

export const DEFAULT_TERMS: readonly DefaultTerms[] = [
  { name: 'Due on receipt', kind: 'due_on_receipt' },
  { name: 'Net 15', kind: 'net_days', days: 15 },
  { name: 'Net 30', kind: 'net_days', days: 30, isDefault: true },
  { name: 'Net 45', kind: 'net_days', days: 45 },
  { name: 'Net 60', kind: 'net_days', days: 60 },
  { name: '1st of next month', kind: 'day_of_next_month', dayOfMonth: 1 },
];

export const DEFAULT_NUMBERING: Readonly<Record<DocType, { readonly prefix: string; readonly next: number }>> = {
  invoice: { prefix: 'INV-', next: 1001 },
  credit_note: { prefix: 'CN-', next: 1001 },
  journal: { prefix: 'JE-', next: 1 },
  bill: { prefix: 'BILL-', next: 1001 },
  payment: { prefix: 'PMT-', next: 1001 },
  expense: { prefix: 'EXP-', next: 1001 },
};

export interface DefaultReminder {
  readonly offsetDays: number;
  readonly repeatEveryDays?: number;
  readonly maxCount?: number;
  readonly subject: string;
  readonly body: string;
}

const BODY = 'Hello {customer},\n\n{invoices}\n\nYou can see each invoice and download a PDF here: {link}\n\nThank you.';

/** 4.6.2: a heads up 3 days before, then 7, 14 and 30 days after, then every 30 days, at most 6. */
export const DEFAULT_REMINDERS: readonly DefaultReminder[] = [
  { offsetDays: -3, subject: 'A friendly heads up: an invoice is due soon', body: BODY },
  { offsetDays: 7, subject: 'An invoice is past due', body: BODY },
  { offsetDays: 14, subject: 'Reminder: an invoice is 14 days past due', body: BODY },
  { offsetDays: 30, repeatEveryDays: 30, maxCount: 6, subject: 'Reminder: an invoice is past due', body: BODY },
];

/** A safe default time zone until the welcome screen or the WMS default warehouse sets one. */
export const FALLBACK_TIMEZONE = 'America/Chicago';
