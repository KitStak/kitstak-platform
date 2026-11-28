/**
 * Deep links into Ledger (SPEC 9.9). Pure string builders, safe in client components. The host
 * passes the Ledger origin (NEXT_PUBLIC_LEDGER_URL); stored links keep only the path.
 */
export type InvoiceSource = 'wms' | 'pulse' | 'program';

export interface LedgerUrls {
  home(): string;
  /** `ref` is an invoice number (INV-1042) or id. */
  invoice(ref: string): string;
  newInvoiceFrom(from: { readonly source: InvoiceSource; readonly id: string; readonly period?: string }): string;
  customer(coreCustomerId: string): string;
  bill(ref: string): string;
  /** `month` is YYYY-MM. */
  close(month: string): string;
  collections(): string;
}

function withQuery(path: string, params: Readonly<Record<string, string | undefined>>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const text = search.toString();
  return text ? `${path}?${text}` : path;
}

const SOURCE_PARAM: Readonly<Record<InvoiceSource, string>> = { wms: 'bill', pulse: 'customer', program: 'program' };

export function ledgerUrls(base = ''): LedgerUrls {
  const root = base.replace(/\/+$/, '');
  const at = (path: string): string => `${root}${path}`;
  return {
    home: () => at('/'),
    invoice: (ref) => at(`/invoices/${encodeURIComponent(ref)}`),
    newInvoiceFrom: ({ source, id, period }) => at(withQuery('/invoices/new', { from: source, [SOURCE_PARAM[source]]: id, period })),
    customer: (coreCustomerId) => at(withQuery('/customers/by-link', { coreCustomerId })),
    bill: (ref) => at(`/bills/${encodeURIComponent(ref)}`),
    close: (month) => at(`/close/${encodeURIComponent(month)}`),
    collections: () => at('/collections'),
  };
}
