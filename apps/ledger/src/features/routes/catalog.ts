/**
 * Every Ledger screen of docs/ledger/SPEC.md section 6 with the words it shows before it has
 * records: the title, one line under it, and an empty state that teaches what goes here and how
 * to start. The screens fill in phase by phase (SPEC 13); their routes, navigation and gates are
 * real from Phase 0. Pure data, scanned by the copy rules test.
 */
import type { NavId } from '@/lib/nav';
import type { LedgerRight } from '@/lib/permissions';
import { routes } from '@/lib/routes';

export type ScreenIllustration = 'board' | 'search' | 'inbox' | 'favorites' | 'workspace' | 'notifications';

export interface ScreenAction {
  readonly label: string;
  readonly href: string;
  /** Shown only to people with this right. */
  readonly needs: LedgerRight;
}

export interface Screen {
  readonly nav: NavId;
  readonly title: string;
  readonly subtitle: string;
  readonly emptyTitle: string;
  readonly emptyText: string;
  readonly illustration: ScreenIllustration;
  readonly actions?: readonly ScreenAction[];
  /** Tabs shown under the title (SPEC 6), carried as `?tab=`. */
  readonly tabs?: readonly string[];
  /** The page is a form or a screen that needs one of these rights, beyond seeing its nav entry. */
  readonly needs?: readonly LedgerRight[];
}

const newInvoice: ScreenAction = { label: 'New invoice', href: routes.newInvoice(), needs: 'invoice:write' };

export const SCREENS = {
  invoices: {
    nav: 'invoices',
    title: 'Invoices',
    subtitle: 'Invoices and credit notes you send to customers.',
    emptyTitle: 'No invoices yet',
    emptyText: 'An invoice asks a customer to pay for work. When you send it, it gets its number and counts as money owed to you. A draft counts for nothing.',
    illustration: 'board',
    actions: [newInvoice, { label: 'Recurring invoices', href: routes.recurring(), needs: 'invoice:write' }],
    tabs: ['Open', 'Drafts', 'Paid', 'Credit notes', 'All'],
  },
  'invoices-new': {
    nav: 'invoices',
    title: 'New invoice',
    subtitle: 'Pick a customer, add lines, then save a draft or send it.',
    emptyTitle: 'Add a customer first',
    emptyText: 'An invoice needs a customer with at least one email address for invoices. Customers come from your KitStak customer list, or you can add one here.',
    illustration: 'workspace',
    actions: [{ label: 'Go to Customers', href: routes.customers(), needs: 'money:read' }],
    needs: ['invoice:write'],
  },
  recurring: {
    nav: 'invoices',
    title: 'Recurring invoices',
    subtitle: 'Templates that make a draft on each run date for you to check and send.',
    emptyTitle: 'No recurring invoices yet',
    emptyText: 'A recurring invoice makes a draft on each run date, like a monthly storage minimum. Nothing is sent until a person checks it.',
    illustration: 'favorites',
  },
  collections: {
    nav: 'collections',
    title: 'Collections',
    subtitle: 'Money owed to you by age, and who to follow up with first.',
    emptyTitle: 'Nobody owes you money yet',
    emptyText: 'Once invoices are sent, this page sorts what customers owe by age: current, 1 to 30 days, 31 to 60, 61 to 90 and over 90 days past due.',
    illustration: 'inbox',
    actions: [newInvoice],
  },
  customers: {
    nav: 'customers',
    title: 'Customers',
    subtitle: 'Who you invoice, with balances, terms and invoice emails.',
    emptyTitle: 'No customers in Ledger yet',
    emptyText: 'Ledger uses your KitStak customer list. Give a customer an invoice email and terms here to start invoicing them.',
    illustration: 'workspace',
  },
  payments: {
    nav: 'payments',
    title: 'Payments',
    subtitle: 'Payments received, refunds and deposits.',
    emptyTitle: 'No payments yet',
    emptyText: 'A payment lowers what a customer owes. One payment can pay several invoices, or part of one.',
    illustration: 'inbox',
    actions: [{ label: 'Record payment', href: routes.newPayment(), needs: 'payment:record' }],
    tabs: ['Payments', 'Deposits'],
  },
  'payments-new': {
    nav: 'payments',
    title: 'Record payment',
    subtitle: 'Who paid, how much, and which invoices it pays.',
    emptyTitle: 'No open invoices to pay',
    emptyText: 'A payment is applied to open invoices of one customer. Send an invoice first, then record the payment here.',
    illustration: 'inbox',
    actions: [newInvoice],
    needs: ['payment:record'],
  },
  bills: {
    nav: 'bills',
    title: 'Bills',
    subtitle: 'Bills from vendors: approve them, then pay them.',
    emptyTitle: 'No bills yet',
    emptyText: 'A bill is what a vendor asks you to pay. It counts as money you owe once it is approved.',
    illustration: 'inbox',
    actions: [
      { label: 'New bill', href: routes.newBill(), needs: 'bill:enter' },
      { label: 'Pay bills', href: routes.payBills(), needs: 'bill:pay' },
    ],
    tabs: ['Waiting for approval', 'To pay', 'Drafts', 'Paid', 'All'],
  },
  'bills-new': {
    nav: 'bills',
    title: 'New bill',
    subtitle: 'Drop a photo or PDF of the bill, then fill in the vendor and lines.',
    emptyTitle: 'Add a vendor first',
    emptyText: 'A bill needs a vendor. Vendors are shared with Crew and later the warehouse, so a vendor added once shows everywhere.',
    illustration: 'workspace',
    actions: [{ label: 'Go to Vendors', href: routes.vendors(), needs: 'ap:read' }],
    needs: ['bill:enter'],
  },
  'bills-pay': {
    nav: 'bills',
    title: 'Pay bills',
    subtitle: 'Approved bills by pay date, with a running total against your bank balance.',
    emptyTitle: 'Nothing to pay',
    emptyText: 'Approved and scheduled bills show here by pay date. Ledger records your payments; it does not move money.',
    illustration: 'favorites',
    needs: ['bill:pay'],
  },
  vendors: {
    nav: 'vendors',
    title: 'Vendors',
    subtitle: 'Who bills you: suppliers, carriers, temp agencies, landlords and more.',
    emptyTitle: 'No vendors yet',
    emptyText: 'Add the companies that send you bills. One company can be several kinds, like a supplier that also ships.',
    illustration: 'workspace',
  },
  expenses: {
    nav: 'expenses',
    title: 'Expenses',
    subtitle: 'Card spending and money to pay people back.',
    emptyTitle: 'No expenses yet',
    emptyText: 'An expense is money already spent, on a company card or by a person you will pay back. Snap the receipt, add the amount, pick a category.',
    illustration: 'inbox',
    actions: [{ label: 'New expense', href: routes.newExpense(), needs: 'expense:submit' }],
    tabs: ['Mine', 'Waiting for approval', 'All'],
  },
  'expenses-new': {
    nav: 'expenses',
    title: 'New expense',
    subtitle: 'Receipt first, then the amount, the category and the job.',
    emptyTitle: 'Add a receipt to start',
    emptyText: 'On a phone this opens the camera first. A receipt is needed unless the amount is small.',
    illustration: 'favorites',
    needs: ['expense:submit'],
  },
  bank: {
    nav: 'bank',
    title: 'Bank',
    subtitle: 'Each bank and card account, its last statement, and lines to match.',
    emptyTitle: 'No bank accounts yet',
    emptyText: 'Bring in a bank statement as a CSV or OFX file. Ledger suggests a match for each line and a person confirms it.',
    illustration: 'search',
  },
  journal: {
    nav: 'journal',
    title: 'Journal',
    subtitle: 'Every entry behind every number. Debits and credits live here, for your accountant.',
    emptyTitle: 'No entries yet',
    emptyText: 'Each thing that counts writes an entry where what goes in equals what goes out, to the cent. Entries appear here as invoices are sent and bills approved.',
    illustration: 'board',
    actions: [{ label: 'New entry', href: routes.newJournal(), needs: 'journal:post' }],
  },
  'journal-new': {
    nav: 'journal',
    title: 'New entry',
    subtitle: 'Type the lines. Debits must equal credits before it can be posted.',
    emptyTitle: 'Manual entries open with the Journal screen',
    emptyText: 'Most entries are written for you. A manual entry is for things like depreciation or a correction your accountant asks for.',
    illustration: 'board',
    needs: ['journal:post'],
  },
  reports: {
    nav: 'reports',
    title: 'Reports',
    subtitle: 'Profit and loss, balance sheet, aging and more. Each prints and exports to CSV.',
    emptyTitle: 'Reports fill in as you work',
    emptyText: 'Every report reads the same books, so each number can be walked back to who did what and when.',
    illustration: 'board',
  },
  close: {
    nav: 'close',
    title: 'Close',
    subtitle: 'Check a month, then close it so its numbers stay put.',
    emptyTitle: 'No months closed yet',
    emptyText: 'Closing a month locks it. Nothing dated in it can change unless the owner reopens it and says why. Months close in order.',
    illustration: 'favorites',
  },
  import: {
    nav: 'import',
    title: 'Import and export',
    subtitle: 'Bring in spreadsheets, including QuickBooks exports, and download your data.',
    emptyTitle: 'No imports yet',
    emptyText: 'Import customers, vendors, items, accounts, open invoices and bills. Posted things are never changed by an import.',
    illustration: 'inbox',
    actions: [
      { label: 'Import a file', href: routes.newImport(), needs: 'import:run' },
      { label: 'Export data', href: routes.exportCenter(), needs: 'export:run' },
    ],
  },
  'import-new': {
    nav: 'import',
    title: 'Import a file',
    subtitle: 'Pick what the file holds, match its columns, check the rows, then bring them in.',
    emptyTitle: 'Pick a CSV file to start',
    emptyText: 'The check step shows what is new, changed, unchanged or has a problem before anything is saved. You can undo an import for 7 days.',
    illustration: 'inbox',
    needs: ['import:run'],
  },
  export: {
    nav: 'import',
    title: 'Export data',
    subtitle: 'Download any part of your Ledger data as CSV files.',
    emptyTitle: 'Nothing to export yet',
    emptyText: 'Exports leave out what your role cannot see.',
    illustration: 'inbox',
    needs: ['export:run'],
  },
} as const satisfies Record<string, Screen>;

export type ScreenId = keyof typeof SCREENS;

/** The reports of SPEC 4.13, by slug. */
export const REPORTS: readonly { readonly slug: string; readonly title: string; readonly description: string }[] = [
  { slug: 'profit-and-loss', title: 'Profit and loss', description: 'Revenue and expenses for a month, quarter or year.' },
  { slug: 'balance-sheet', title: 'Balance sheet', description: 'What you own and owe as of a date.' },
  { slug: 'trial-balance', title: 'Trial balance', description: 'Every account with its debits and credits.' },
  { slug: 'general-ledger', title: 'General ledger detail', description: 'Every line behind each account.' },
  { slug: 'ar-aging', title: 'Money owed to you by age', description: 'Summary and detail by customer.' },
  { slug: 'ap-aging', title: 'Bills to pay by age', description: 'Summary and detail by vendor.' },
  { slug: 'customer-statement', title: 'Customer statement', description: 'One customer, as a PDF to send.' },
  { slug: 'sales-tax', title: 'Sales tax collected', description: 'By rate and by month.' },
  { slug: 'vendor-1099', title: 'Vendor totals for 1099', description: 'Payments by calendar year to vendors you track.' },
  { slug: 'cash', title: 'Cash in and out', description: 'Money in and out of your bank accounts by week.' },
  { slug: 'earned-vs-billed', title: 'Earned vs billed', description: 'Work done against what was invoiced, with Pulse.' },
  { slug: 'unmatched-bank', title: 'Unmatched bank lines', description: 'Lines still waiting for a match.' },
  { slug: 'close-pack', title: 'Close pack', description: 'The saved snapshot of a closed month.' },
  { slug: 'audit-log', title: 'Audit log', description: 'Who changed what, and when.' },
];

/** The sections of Settings (SPEC 6), by slug. */
export const SETTINGS_SECTIONS: readonly { readonly slug: string; readonly title: string; readonly description: string }[] = [
  { slug: 'general', title: 'General', description: 'Company name, address, logo, time zone, working days and payment instructions.' },
  { slug: 'people', title: 'People and roles', description: 'Who uses Ledger and what each person may do.' },
  { slug: 'accounts', title: 'Chart of accounts', description: 'The accounts behind every number.' },
  { slug: 'items', title: 'Items', description: 'What you invoice for, with a default price and account.' },
  { slug: 'tax', title: 'Tax rates', description: 'Sales tax rates you charge, by place.' },
  { slug: 'terms', title: 'Payment terms', description: 'When invoices are due.' },
  { slug: 'numbering', title: 'Numbering', description: 'How invoices, bills, payments and entries are numbered.' },
  { slug: 'reminders', title: 'Reminders', description: 'When Ledger reminds customers about invoices, and what it says.' },
  { slug: 'approvals', title: 'Approvals', description: 'Who approves bills, auto approval, the write off limit and tolerances.' },
  { slug: 'close', title: 'Close checklist', description: 'Your own month end tasks, with owners and due days.' },
  { slug: 'accounting', title: 'Accounting tool', description: 'Connect QuickBooks Online and see what was sent.' },
  { slug: 'apps', title: 'Connected apps', description: 'What flows in from WMS, Pulse, Projects, CRM, Crew and Portal.' },
  { slug: 'sample', title: 'Sample data', description: 'Load a small sample to try Ledger, then clear it.' },
  { slug: 'audit', title: 'Audit log', description: 'Who changed what, and when.' },
  { slug: 'math', title: 'How Ledger does the math', description: 'Every rule in plain words.' },
];
