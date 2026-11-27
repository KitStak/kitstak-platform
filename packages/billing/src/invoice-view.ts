/**
 * How an invoice reads, on the invoice page and in the test gateway's PDF (SPEC 6.6). PURE.
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
import { CATALOG, normalizeSelection, type BillingInterval, type ProductId } from './catalog';
import { quote, type Quote } from './quote';

/** One invoice line as a gateway reports it. `GatewayInvoiceLine` and a stored invoice row both fit. */
export interface InvoiceViewLine {
  readonly description: string;
  readonly product: ProductId | null;
  readonly quantity: number;
  readonly unitCents: number;
  readonly amountCents: number;
  readonly proration: boolean;
}

/** What `invoiceView` reads. A `GatewayInvoice` and a stored invoice row both fit. */
export interface InvoiceViewInput {
  readonly lines: readonly InvoiceViewLine[];
  readonly periodStart: Date | null;
  readonly periodEnd: Date | null;
  readonly discountCents: number;
  readonly creditAppliedCents: number;
}

type Line = InvoiceViewLine;

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

function intervalOf(invoice: Pick<InvoiceViewInput, 'periodStart' | 'periodEnd'>): BillingInterval {
  if (!invoice.periodStart || !invoice.periodEnd) return 'monthly';
  return (invoice.periodEnd.getTime() - invoice.periodStart.getTime()) / DAY_MS > 200 ? 'yearly' : 'monthly';
}

export function invoiceView(invoice: InvoiceViewInput): InvoiceView {
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

/** 'Monthly plan', 'Yearly plan', 'Plan change' or 'Monthly plan, first payment'. */
export function invoiceTitle(invoice: Pick<InvoiceViewInput, 'periodStart' | 'periodEnd' | 'lines'> & { readonly billingReason: string | null }): string {
  const reason = invoice.billingReason ?? '';
  if (reason === 'subscription_update' || invoice.lines.some((line) => line.proration)) return 'Plan change';
  const plan = intervalOf(invoice) === 'yearly' ? 'Yearly plan' : 'Monthly plan';
  if (reason === 'subscription_create') return `${plan}, first payment`;
  return plan;
}

/** Who sends the invoice. The invoice page in the Portal and the test PDF both build it with `invoiceSeller`. */
export interface InvoiceSeller {
  readonly name: string;
  /** Street, city and country, one entry per printed line. */
  readonly address: readonly string[];
  readonly taxId: string | null;
  /** 'kitstak.com' */
  readonly site: string;
}

/**
 * The seller block from the settings the caller hands in (this file reads no environment itself):
 * BILLING_SELLER_NAME, BILLING_SELLER_ADDRESS (lines split
 * by "|"), BILLING_SELLER_TAX_ID and NEXT_PUBLIC_SITE_URL. Nothing is made up: an address or tax ID
 * that is not set is not printed.
 */
export function invoiceSeller(env: Readonly<Record<string, string | undefined>>): InvoiceSeller {
  const clean = (value: string | undefined) => (value && value.trim() ? value.trim() : null);
  return {
    name: clean(env.BILLING_SELLER_NAME) ?? 'KitStak LLC',
    address: (clean(env.BILLING_SELLER_ADDRESS) ?? '')
      .split('|')
      .map((part) => part.trim())
      .filter(Boolean),
    taxId: clean(env.BILLING_SELLER_TAX_ID),
    site: (clean(env.NEXT_PUBLIC_SITE_URL) ?? 'https://kitstak.com').replace(/^https?:\/\//, '').replace(/\/+$/, ''),
  };
}
