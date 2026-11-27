/**
 * Copy for /ledger. Ledger is a planned app with no code yet, so every line here comes from
 * docs/ledger/REFERENCE.md and is written as what Ledger will do, never as a screen that exists.
 * Open questions in the reference (section 9) are left out or said to be still being decided.
 * Ledger is the shop's own books. It is never KitStak's subscription billing, and the copy keeps
 * the words apart: "invoices" for the shop's customers, "billing" only for KitStak's plan.
 */
import type { Feature } from '../product/chapter';
import type { FaqItem } from '../product/cta';
import type { HeroFact } from '../product/product-hero';
import type { SubNavSection } from '../product/sub-nav';

export const META = {
  title: 'KitStak Ledger - invoices, collections, bills and month-end close (coming soon)',
  description:
    'KitStak Ledger is coming soon: invoices from your WMS bill lines, collections, vendor bills, expenses, bank reconciliation and one month-end close.',
  socialTitle: 'KitStak Ledger. Bill it. Pay it. Close it.',
  socialDescription: 'The money app for kitting, 3PL and contract packaging shops, on the same stack as the WMS and Pulse. Coming soon.',
  url: 'https://kitstak.com/ledger',
} as const;

export const HERO = {
  product: 'KitStak Ledger',
  lines: ['Bill it.', 'Pay it.', 'Close it.'],
  lead: 'Ledger is the money app for kitting, 3PL and contract packaging shops. Your WMS bill lines become real invoices, invoices get paid, payments land in the bank, and the month closes once for every app.',
  howLabel: 'See how it works',
} as const;

export const HERO_FACTS: readonly HeroFact[] = [
  { value: '6', label: 'parts: invoices, collections, bills, expenses, bank, close' },
  { value: '5', label: 'aging buckets, from current to over 90 days' },
  { value: '0', label: 'bill lines retyped from the WMS' },
  { value: '1', label: 'month-end close, shared with Pulse' },
];

export const SECTIONS: readonly SubNavSection[] = [
  { id: 'invoices', label: 'Invoices' },
  { id: 'collections', label: 'Collections' },
  { id: 'bills', label: 'Bills' },
  { id: 'expenses', label: 'Expenses' },
  { id: 'bank', label: 'Bank' },
  { id: 'close', label: 'Close' },
  { id: 'stack', label: 'On the stack' },
  { id: 'pricing', label: 'Pricing' },
  { id: 'faq', label: 'FAQ' },
];

export const CHAPTERS = {
  problem: {
    id: 'problem',
    index: '01',
    label: 'The problem',
    title: 'You know what you earned. The money is somewhere else.',
    lead: 'The WMS builds the bill lines and Pulse knows the profit. Then someone retypes it all into an accounting tool. Ledger closes that loop.',
  },
  invoices: {
    id: 'invoices',
    index: '02',
    label: 'Invoices',
    title: 'The bill lines are already written. Send them.',
    lead: 'Draft an invoice straight from approved WMS bill lines, from Pulse work not billed yet, from a program’s price card, or by hand. Then send it as a PDF by email.',
  },
  collections: {
    id: 'collections',
    index: '03',
    label: 'Collections',
    title: 'Know who owes you, and since when.',
    lead: 'Aging by bucket, reminders on a schedule, promises to pay with a date, and disputes on a single line, so one wrong charge does not hold up the whole invoice.',
  },
  bills: {
    id: 'bills',
    index: '04',
    label: 'Bills',
    title: 'Boxes, film, freight, temps. Approve, then pay.',
    lead: 'Vendor bills from suppliers, carriers, temp agencies, rent and utilities, each approved, scheduled and recorded. A temp agency bill is checked against the hours Crew recorded.',
  },
  expenses: {
    id: 'expenses',
    index: '05',
    label: 'Expenses',
    title: 'A receipt photo, a category, and the job it was for.',
    lead: 'Card spend and reimbursements come in with a photo of the receipt. Tag one to a job or a client and it counts as cost in Pulse.',
  },
  bank: {
    id: 'bank',
    index: '06',
    label: 'Bank',
    title: 'Every deposit matched to the invoice it paid.',
    lead: 'Bank and card feeds come in. Ledger matches payments and deposits to invoices and bills, and flags what does not match.',
  },
  close: {
    id: 'close',
    index: '07',
    label: 'Month-end close',
    title: 'Close the month once. For every app.',
    lead: 'A close checklist, accruals for work done and not billed yet, and a lock on the month. When you run Pulse too, the plan is for the Ledger close to run the Pulse checks and lock both in one step.',
  },
  stack: {
    id: 'stack',
    index: '08',
    label: 'On the stack',
    title: 'Earned in Pulse. Billed and collected in Ledger.',
    lead: 'Pulse keeps profit on earned revenue, and invoices never change it. Ledger is where billed and collected live. The two sit side by side, and the gap is the accrual.',
  },
} as const;

export const PROBLEM_TILES: readonly Feature[] = [
  { name: 'Bill lines retyped', note: 'The WMS exports approved invoice lines. Someone types them into an accounting tool again.' },
  { name: 'Ready to bill ends in a CSV', note: 'Pulse knows the work not billed yet, then hands accounting a file.' },
  { name: 'Who has paid?', note: 'The CRM knows the account and the terms, but not whether the customer paid.' },
  { name: 'Temp bills on trust', note: 'The agency bills 412 hours. Nobody can easily check that against who clocked in.' },
  { name: 'Two month-end closes', note: 'One in the cost model, one in the books, and they do not always agree.' },
  { name: 'Receipts in a drawer', note: 'Card spend for a job never reaches the job’s cost.' },
];

export const INVOICE_FEATURES: readonly Feature[] = [
  { name: 'From WMS bill lines', note: 'Approved receiving, storage, pick and pack, shipment and work order lines become a draft.' },
  { name: 'From Pulse', note: 'Ready to bill becomes Create invoice, instead of a CSV.' },
  { name: 'From a program', note: 'Program runs can invoice on a weekly or monthly cadence.' },
  { name: 'Terms, taxes and credits', note: 'Line items, payment terms, a sales tax rate table, credits and recurring invoices.' },
  { name: 'PDF and email', note: 'Sent from the same mail service as the rest of KitStak.' },
];

export const COLLECTION_FEATURES: readonly Feature[] = [
  { name: 'Aging', note: 'Current, 1 to 30, 31 to 60, 61 to 90 and over 90 days.' },
  { name: 'Reminders on a schedule', note: 'Sent before and after the due date, without anyone remembering.' },
  { name: 'Promise to pay', note: 'Record the date a customer promised, and see when it passes.' },
  { name: 'Disputes on a line', note: 'Hold one line. The rest of the invoice stays due.' },
  { name: 'Partial payments and write offs', note: 'Applied to the right invoice and line.' },
  { name: 'Pay links', note: 'Card and ACH links through your own Stripe account. When they arrive is still being decided.' },
];

export const BILL_FEATURES: readonly Feature[] = [
  { name: 'Every kind of vendor', note: 'Packaging suppliers, carriers, temp agencies, rent and utilities.' },
  { name: 'Approve and schedule', note: 'A bill is approved, then scheduled, then recorded as paid.' },
  { name: 'Match to what arrived', note: 'Check a supplier bill against what was received, where that applies.' },
  { name: 'Temp agency check', note: 'Agency billed 412 hours. Crew recorded 396.' },
];

export const EXPENSE_FEATURES: readonly Feature[] = [
  { name: 'Receipt photos', note: 'Snap it at the counter, not at month end.' },
  { name: 'Categories', note: 'So spend lands in the right account.' },
  { name: 'Tagged to a job or client', note: 'And it counts as cost in Pulse at job, client or company level.' },
  { name: 'Reimbursements', note: 'Money a person spent, paid back and recorded.' },
];

export const BANK_FEATURES: readonly Feature[] = [
  { name: 'Bank and card feeds', note: 'Transactions come in on their own.' },
  { name: 'Matched to invoices and bills', note: 'A deposit is tied to the invoice it paid.' },
  { name: 'What does not match', note: 'Flagged, so it gets looked at before the month closes.' },
];

export const CLOSE_FEATURES: readonly Feature[] = [
  { name: 'Close checklist', note: 'The same steps every month, with an owner for each.' },
  { name: 'Accruals', note: 'Work done and not billed yet, booked at month end.' },
  { name: 'Lock the month', note: 'No silent edits after it closes. Reopening needs a reason and is logged.' },
  { name: 'One close with Pulse', note: 'Pulse’s checks run as one step of the Ledger close.' },
];

export const STACK_FEATURES: readonly Feature[] = [
  { name: 'WMS', note: 'Approved 3PL bill lines per client and period become draft invoices.' },
  { name: 'Pulse', note: 'Invoices replace typed billed amounts. Bills and expenses tagged to a job become its cost.' },
  { name: 'CRM', note: 'Balance, oldest open invoice and days past due show on the account.' },
  { name: 'Crew', note: 'Approved hours per agency and week, to check temp agency bills.' },
  { name: 'Projects', note: 'Collection follow ups and close checklist items become tasks with an owner and a date.' },
];

export const PRICE_INCLUDED: readonly string[] = [
  'Invoices from WMS bill lines, Pulse and programs',
  'Collections, aging, reminders and disputes',
  'Vendor bills, approvals and payments',
  'Expenses with receipt photos',
  'Bank reconciliation',
  'Month-end close shared with Pulse',
  'An audit trail on every posted entry',
];

export const FAQ_TITLE = 'Before you ask.';

export const FAQ: readonly FaqItem[] = [
  {
    question: 'When can I use Ledger?',
    answer:
      'Ledger is coming soon and cannot be bought yet. Ask to be told when it is ready and we will email you once, when you can start.',
  },
  {
    question: 'Does Ledger replace QuickBooks or Xero?',
    answer:
      'Not at first. The plan is for Ledger to handle invoices, collections, bills and expenses and sync the entries to the accounting tool you already use. Which tool comes first is still being decided.',
  },
  {
    question: 'Is this how KitStak bills me?',
    answer:
      'No. Ledger is your own books, for your customers and your vendors. Your KitStak plan is billed separately and never shares a screen with Ledger.',
  },
  {
    question: 'Does Ledger run payroll or file taxes?',
    answer:
      'No. Crew exports hours to your payroll provider, and Ledger books the payroll journal that comes back. Ledger gives you the sales tax and vendor reports. Filing stays with your accountant.',
  },
  {
    question: 'Does it value the stock in my warehouse?',
    answer:
      'No. Stock your clients own is not your asset. Supplies you buy are an expense, not a perpetual inventory ledger.',
  },
  {
    question: 'Who can see the money?',
    answer:
      'Only people you give money access to. A floor lead in the WMS never sees payables.',
  },
  {
    question: 'Can I use Ledger without the other apps?',
    answer:
      'Yes. On its own you get invoices, collections, bills, expenses and reconciliation. Add the WMS later to fill invoices from bill lines, or Pulse to see job profit beside what was billed and collected.',
  },
];

export const CLOSING = {
  title: 'The last bar is the money.',
  note: 'Ledger is coming soon. It will run on its own, or alongside the WMS, Pulse and the CRM with one sign-in.',
} as const;
