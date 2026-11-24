/**
 * How an invoice reads on screen (SPEC 6.6). The rules live in the billing package, so the invoice
 * page and the test gateway's PDF print the same lines and the same sums.
 */
export { invoiceSeller, invoiceView, type InvoiceAdjustment, type InvoiceSeller, type InvoiceView } from '@kitstak/billing/invoice-view';
