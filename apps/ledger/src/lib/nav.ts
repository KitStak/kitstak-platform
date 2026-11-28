/**
 * The Ledger navigation, in one place (docs/ledger/SPEC.md section 6): seven links and one menu.
 * The top nav, the phone menu, the command palette, the shortcut sheet and the page gate all read
 * this list. An entry shows when the person holds any of its rights, so approvers see Bills and
 * Expenses, and submitters see Expenses only. Pure module: icons live in the shell.
 */
import type { LedgerRight } from './permissions';
import { routes } from './routes';

export type NavId =
  | 'home'
  | 'invoices'
  | 'collections'
  | 'bills'
  | 'expenses'
  | 'bank'
  | 'close'
  | 'customers'
  | 'vendors'
  | 'payments'
  | 'journal'
  | 'reports'
  | 'import'
  | 'settings';

export type NavGroup = 'main' | 'more';
export type BadgeKey = 'overdue' | 'billsWaiting' | 'unmatched';

export interface NavEntry {
  readonly id: NavId;
  readonly group: NavGroup;
  readonly label: string;
  /** One plain sentence: what the page is for (palette row, search page). */
  readonly description: string;
  readonly href: string;
  /** Path prefixes that keep this entry highlighted. `/` matches only itself. */
  readonly prefixes: readonly string[];
  readonly keywords: readonly string[];
  /** Second key of the `g` then letter shortcut. */
  readonly chord?: string;
  /** The person needs any one of these rights. */
  readonly needs: readonly LedgerRight[];
  readonly badge?: BadgeKey;
}

const MONEY: readonly LedgerRight[] = ['money:read'];

export const NAV: readonly NavEntry[] = [
  { id: 'home', group: 'main', label: 'Home', description: 'What customers owe you, what you owe, and what needs you.', href: routes.home(), prefixes: ['/'], keywords: ['dashboard', 'overview', 'today', 'money'], chord: 'H', needs: MONEY },
  { id: 'invoices', group: 'main', label: 'Invoices', description: 'Invoices and credit notes you send to customers.', href: routes.invoices(), prefixes: ['/invoices'], keywords: ['invoice', 'credit note', 'recurring', 'send'], chord: 'I', needs: MONEY },
  { id: 'collections', group: 'main', label: 'Collections', description: 'Money owed to you by age, with who to follow up with.', href: routes.collections(), prefixes: ['/collections'], keywords: ['aging', 'past due', 'overdue', 'reminders', 'promise to pay'], chord: 'C', needs: MONEY, badge: 'overdue' },
  { id: 'bills', group: 'main', label: 'Bills', description: 'Bills from vendors: approve them and pay them.', href: routes.bills(), prefixes: ['/bills'], keywords: ['bills to pay', 'vendor bill', 'approve', 'pay run'], chord: 'B', needs: ['ap:queue', 'bill:approve'], badge: 'billsWaiting' },
  { id: 'expenses', group: 'main', label: 'Expenses', description: 'Card spending and money to pay people back.', href: routes.expenses(), prefixes: ['/expenses'], keywords: ['receipt', 'card', 'reimbursement', 'pay back'], chord: 'X', needs: ['expense:submit', 'expense:approve', 'ap:read'] },
  { id: 'bank', group: 'main', label: 'Bank', description: 'Bank and card accounts, statements and matching to the bank.', href: routes.bank(), prefixes: ['/bank'], keywords: ['statement', 'match to the bank', 'reconcile', 'deposit'], chord: 'K', needs: MONEY, badge: 'unmatched' },
  { id: 'close', group: 'main', label: 'Close', description: 'Check a month, then close it so its numbers stay put.', href: routes.close(), prefixes: ['/close'], keywords: ['month end', 'close the month', 'lock', 'checklist'], chord: 'M', needs: MONEY },
  { id: 'customers', group: 'more', label: 'Customers', description: 'Who you invoice, with balances, terms and invoice emails.', href: routes.customers(), prefixes: ['/customers'], keywords: ['clients', 'accounts', 'statement', 'balance'], chord: 'U', needs: MONEY },
  { id: 'vendors', group: 'more', label: 'Vendors', description: 'Who bills you: suppliers, carriers, temp agencies and more.', href: routes.vendors(), prefixes: ['/vendors'], keywords: ['suppliers', 'temp agency', '1099', 'carriers'], chord: 'V', needs: ['ap:read'] },
  { id: 'payments', group: 'more', label: 'Payments', description: 'Payments received, refunds and deposits.', href: routes.payments(), prefixes: ['/payments'], keywords: ['payment received', 'deposit', 'refund', 'check'], chord: 'P', needs: MONEY },
  { id: 'journal', group: 'more', label: 'Journal', description: 'Every entry behind every number, for your accountant.', href: routes.journal(), prefixes: ['/journal'], keywords: ['entries', 'debit', 'credit', 'general ledger'], chord: 'J', needs: MONEY },
  { id: 'reports', group: 'more', label: 'Reports', description: 'Profit and loss, balance sheet, aging and more.', href: routes.reports(), prefixes: ['/reports'], keywords: ['profit and loss', 'balance sheet', 'trial balance', 'aging', 'sales tax'], chord: 'E', needs: MONEY },
  { id: 'import', group: 'more', label: 'Import and export', description: 'Bring in spreadsheets and download your data as CSV files.', href: routes.importCenter(), prefixes: ['/import', '/export'], keywords: ['csv', 'spreadsheet', 'upload', 'download', 'quickbooks export'], chord: 'O', needs: ['import:run', 'export:run'] },
  { id: 'settings', group: 'more', label: 'Settings', description: 'Company, people and roles, chart of accounts, tax, terms and more.', href: routes.settings(), prefixes: ['/settings'], keywords: ['preferences', 'roles', 'chart of accounts', 'tax rates', 'numbering', 'quickbooks'], chord: 'S', needs: MONEY },
];

/** True when `pathname` belongs to the entry (exact for `/`, prefix with a boundary otherwise). */
export function navMatches(entry: NavEntry, pathname: string): boolean {
  return entry.prefixes.some((prefix) => (prefix === '/' ? pathname === '/' : pathname === prefix || pathname.startsWith(`${prefix}/`)));
}

export function canSee(entry: NavEntry, rights: readonly LedgerRight[]): boolean {
  return entry.needs.some((right) => rights.includes(right));
}

/** The entries a person may see, in order. No rights: nothing. */
export function navFor(rights: readonly LedgerRight[]): readonly NavEntry[] {
  return NAV.filter((entry) => canSee(entry, rights));
}

/** The nav entry a path belongs to (the page gate), or undefined for pages outside the list. */
export function navEntryFor(pathname: string): NavEntry | undefined {
  const path = pathname.split('?')[0] ?? pathname;
  if (path === '/export') return NAV.find((entry) => entry.id === 'import');
  return NAV.find((entry) => entry.id !== 'home' && navMatches(entry, path)) ?? (path === '/' ? NAV[0] : undefined);
}

/** Go to shortcuts (`g` then the letter) as a map of lowercase letter to path. */
export function chordTargets(rights: readonly LedgerRight[]): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of navFor(rights)) if (entry.chord) out[entry.chord.toLowerCase()] = entry.href;
  return out;
}
