/**
 * How an invoice reads on screen (SPEC 6.6). PURE.
 *
 * An invoice for a plan shows the same lines as the picker and the review step: one math line per
 * app at its list price ("CRM: 5 users x $29 = $145 per month"), the bundle and yearly discounts
 * as their own dollar lines, then a subtotal that is the sum of what is printed above it. A promo
 * code or credit is listed once, under the subtotal. Nothing is counted twice.
 *
 * The plan lines are rebuilt with `quote()`, the one price function. If the rebuilt total is not
 * exactly what the gateway charged for those lines (an old price, a part period), the invoice
 * falls back to the gateway's own lines, so the page can never show math that does not add up.
 */
import { CATALOG, normalizeSelection, type BillingInterval, type ProductId } from '@kitstak/billing/catalog';
import { quote, type Quote } from '@kitstak/billing/quote';
import type { InvoiceRow } from '@kitstak/billing/server';

type Line = InvoiceRow['lines'][number];

const DAY_MS = 24 * 60 * 60 * 1000;

export interface InvoiceAdjustment {
  /** 'Promo code TEST10 (10% off)', 'Credit from your account'. */
  readonly label: string;
  /** Negative: it takes money off. */
  readonly amountCents: number;
}

export interface InvoiceView {
  /** Set when the plan lines match the catalog: show the picker's lines. null: show `rawLines`. */
  readonly quote: Quote | null;
  /** The gateway's own lines that are charges (not a promo code, not credit). */
  readonly rawLines: readonly Line[];
  /** The sum of the lines printed above the subtotal. */
  readonly subtotalCents: number;
  /** Promo codes, discounts and credit, each listed once. */
  readonly adjustments: readonly InvoiceAdjustment[];
}

/** A line that takes money off the whole invoice: a promo code or credit, not a product. */
function isAdjustment(line: Line): boolean {
  return line.amountCents < 0 && line.product === null && !line.proration;
}

function intervalOf(invoice: Pick<InvoiceRow, 'periodStart' | 'periodEnd'>): BillingInterval {
  if (!invoice.periodStart || !invoice.periodEnd) return 'monthly';
  return (invoice.periodEnd.getTime() - invoice.periodStart.getTime()) / DAY_MS > 200 ? 'yearly' : 'monthly';
}

export function invoiceView(invoice: Pick<InvoiceRow, 'lines' | 'periodStart' | 'periodEnd' | 'discountCents' | 'creditAppliedCents'>): InvoiceView {
  const rawLines = invoice.lines.filter((line) => !isAdjustment(line));
  const subtotalCents = rawLines.reduce((sum, line) => sum + line.amountCents, 0);

  const adjustments: InvoiceAdjustment[] = invoice.lines
    .filter(isAdjustment)
    .map((line) => ({ label: line.description, amountCents: line.amountCents }));
  const listed = -adjustments.reduce((sum, entry) => sum + entry.amountCents, 0);
  // A discount or credit the gateway reports only as a total (no line of its own) is still shown, once.
  const known = Math.max(0, invoice.discountCents) + Math.max(0, invoice.creditAppliedCents);
  if (known > listed) {
    const credit = Math.max(0, invoice.creditAppliedCents);
    const discount = known - listed - Math.min(credit, known - listed);
    if (discount > 0) adjustments.push({ label: 'Discount', amountCents: -discount });
    const creditLeft = known - listed - discount;
    if (creditLeft > 0) adjustments.push({ label: 'Credit from your account', amountCents: -creditLeft });
  }

  // Rebuild the picker's lines when every charge is a whole period of one app.
  let rebuilt: Quote | null = null;
  const plain = rawLines.length > 0 && rawLines.every((line) => line.product !== null && !line.proration && line.amountCents >= 0);
  const products = rawLines.map((line) => line.product).filter((id): id is ProductId => id !== null);
  if (plain && new Set(products).size === products.length) {
    const seatLine = rawLines.find((line) => line.product !== null && CATALOG.products[line.product].quantityFrom === 'seats');
    const warehouseLine = rawLines.find((line) => line.product === 'wms');
    const candidate = quote(
      normalizeSelection({
        products,
        seats: seatLine?.quantity ?? 1,
        warehouses: warehouseLine?.quantity ?? 1,
        interval: intervalOf(invoice),
      }),
    );
    const sameSeats = rawLines.every(
      (line) => line.product === null || CATALOG.products[line.product].quantityFrom !== 'seats' || line.quantity === (seatLine?.quantity ?? 1),
    );
    if (sameSeats && candidate.totalCents === subtotalCents && candidate.lines.length === rawLines.length) rebuilt = candidate;
  }

  return { quote: rebuilt, rawLines, subtotalCents, adjustments };
}
