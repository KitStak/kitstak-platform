/** Plain words for an invoice row: what it was for and where it stands. PURE. */
import type { InvoiceRow } from '@kitstak/billing/server';

/** 'Monthly plan', 'Yearly plan', 'Plan change' or 'Monthly plan, first payment'. Shared with the PDF. */
export { invoiceTitle } from '@kitstak/billing/invoice-view';

export interface InvoiceStatusWords {
  readonly label: 'Paid' | 'Due' | 'Void' | 'Not collected';
  readonly tone: 'success' | 'warning' | 'neutral';
}

export function invoiceStatus(invoice: Pick<InvoiceRow, 'status'>): InvoiceStatusWords {
  switch (invoice.status) {
    case 'paid':
      return { label: 'Paid', tone: 'success' };
    case 'open':
    case 'draft':
      return { label: 'Due', tone: 'warning' };
    case 'uncollectible':
      return { label: 'Not collected', tone: 'neutral' };
    case 'void':
      return { label: 'Void', tone: 'neutral' };
  }
}
