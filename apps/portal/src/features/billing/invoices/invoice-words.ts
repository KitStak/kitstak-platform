/** Plain words for an invoice row: what it was for and where it stands. PURE. */
import type { InvoiceRow } from '@kitstak/billing/server';

/** 'Monthly plan', 'Yearly plan', 'Plan change' or 'Monthly plan, first payment'. Shared with the PDF. */
export { invoiceTitle } from '@kitstak/billing/invoice-view';

export interface InvoiceStatusWords {
  readonly label: 'Paid' | 'Due' | 'Void' | 'Not collected' | 'Credit';
  readonly tone: 'success' | 'warning' | 'neutral';
}

/**
 * True for an invoice that hands money back instead of asking for it: its total is below zero.
 * Stripe makes one when a plan gets smaller (seats or an app taken off). Nothing is charged for it.
 * The amount goes on the customer's credit and comes off the next bills.
 */
export function isCreditInvoice(invoice: Pick<InvoiceRow, 'totalCents'>): boolean {
  return invoice.totalCents < 0;
}

export function invoiceStatus(invoice: Pick<InvoiceRow, 'status'> & Partial<Pick<InvoiceRow, 'totalCents'>>): InvoiceStatusWords {
  switch (invoice.status) {
    case 'paid':
      // "Paid" would say a card was charged. A credit charges nothing.
      if ((invoice.totalCents ?? 0) < 0) return { label: 'Credit', tone: 'success' };
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

/**
 * The sentence under an invoice: what happened to the money. For a credit it says that nothing was
 * charged and where the amount went, never "paid with the card".
 */
export function invoiceOutcomeLine(
  invoice: Pick<InvoiceRow, 'status' | 'totalCents' | 'paidAt' | 'paymentMethodLast4'>,
  words: { day: (date: Date) => string; money: (cents: number) => string },
): string {
  if (invoice.status === 'paid' && isCreditInvoice(invoice)) {
    return `This is a credit of ${words.money(-invoice.totalCents)} for a plan change. Nothing was charged. It comes off your next bills.`;
  }
  if (invoice.status === 'paid' && invoice.paidAt) {
    return `Paid on ${words.day(invoice.paidAt)}${invoice.paymentMethodLast4 ? ` with the card ending ${invoice.paymentMethodLast4}` : ''}.`;
  }
  if (invoice.status === 'open') return 'This invoice is not paid yet. Go to Billing to pay it or to update your card.';
  if (invoice.status === 'void') return 'This invoice was canceled. Nothing is owed on it.';
  return 'This invoice is closed.';
}
