/** Plain words for an invoice row: what it was for and where it stands. PURE. */
import type { InvoiceRow } from '@kitstak/billing/server';

const DAY_MS = 24 * 60 * 60 * 1000;

/** 'Monthly plan', 'Yearly plan', 'Plan change' or 'First payment'. */
export function invoiceTitle(invoice: Pick<InvoiceRow, 'billingReason' | 'periodStart' | 'periodEnd' | 'lines'>): string {
  const reason = invoice.billingReason ?? '';
  if (reason === 'subscription_update' || invoice.lines.some((line) => line.proration)) return 'Plan change';
  const days =
    invoice.periodStart && invoice.periodEnd ? (invoice.periodEnd.getTime() - invoice.periodStart.getTime()) / DAY_MS : null;
  const plan = days !== null && days > 200 ? 'Yearly plan' : 'Monthly plan';
  if (reason === 'subscription_create') return `${plan}, first payment`;
  return plan;
}

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
