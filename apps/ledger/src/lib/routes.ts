/**
 * In app URL builders. Use these instead of string literals so routes stay consistent.
 * Route list: docs/ledger/SPEC.md section 6.
 */
export const routes = {
  home: () => '/',
  invoices: (tab?: string) => (tab ? `/invoices?tab=${encodeURIComponent(tab)}` : '/invoices'),
  newInvoice: () => '/invoices/new',
  invoice: (ref: string) => `/invoices/${encodeURIComponent(ref)}`,
  recurring: () => '/invoices/recurring',
  collections: () => '/collections',
  customers: () => '/customers',
  customer: (id: string) => `/customers/${encodeURIComponent(id)}`,
  payments: () => '/payments',
  newPayment: () => '/payments/new',
  bills: () => '/bills',
  newBill: () => '/bills/new',
  payBills: () => '/bills/pay',
  vendors: () => '/vendors',
  expenses: () => '/expenses',
  newExpense: () => '/expenses/new',
  bank: () => '/bank',
  journal: () => '/journal',
  newJournal: () => '/journal/new',
  reports: () => '/reports',
  report: (slug: string) => `/reports/${encodeURIComponent(slug)}`,
  close: () => '/close',
  closeMonth: (month: string) => `/close/${encodeURIComponent(month)}`,
  settings: (section?: string) => (section ? `/settings/${encodeURIComponent(section)}` : '/settings'),
  importCenter: () => '/import',
  newImport: () => '/import/new',
  exportCenter: () => '/export',
  welcome: () => '/welcome',
  search: () => '/search',
} as const;

/** A `next=` target that stays inside this app and never loops back to sign in. */
export function safeNextPath(next: string | null | undefined, fallback = '/'): string {
  if (!next) return fallback;
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  if (/^\/login(\/|\?|$)/.test(next)) return fallback;
  return next;
}
