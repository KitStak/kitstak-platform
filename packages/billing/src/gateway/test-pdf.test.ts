import { describe, expect, it } from 'vitest';
import { invoiceSeller, renderInvoicePdf } from './test-pdf';
import type { GatewayInvoice, GatewayInvoiceLine } from './types';

const line = (description: string, product: GatewayInvoiceLine['product'], quantity: number, unitCents: number, amountCents: number, proration = false): GatewayInvoiceLine => ({
  description,
  product,
  quantity,
  unitCents,
  amountCents,
  proration,
});

/** TEST-0001 from review round 1: CRM for 5 and 1 warehouse at the bundle price, with TEST10. */
const PROMO_INVOICE: GatewayInvoice = {
  id: 'in_test_1',
  customerId: 'cus_test_1',
  subscriptionId: 'sub_test_1',
  number: 'TEST-0001',
  status: 'paid',
  billingReason: 'subscription_create',
  subtotalCents: 39520,
  discountCents: 3952,
  taxCents: 0,
  totalCents: 35568,
  amountPaidCents: 35568,
  amountDueCents: 0,
  lines: [
    line('KitStak CRM (5 users)', 'crm', 5, 2320, 11600),
    line('KitStak WMS (1 warehouse)', 'wms', 1, 27920, 27920),
    line('Promo code TEST10 (10% off)', null, 1, -3952, -3952),
  ],
  periodStart: new Date('2026-12-07T00:00:00Z'),
  periodEnd: new Date('2027-01-07T00:00:00Z'),
  issuedAt: new Date('2026-12-07T00:00:00Z'),
  paidAt: new Date('2026-12-07T00:00:00Z'),
  attemptCount: 1,
  nextPaymentAttempt: null,
  lastErrorCode: null,
  paymentMethodLast4: '4242',
  creditAppliedCents: 0,
  refundedCents: 0,
};

const SELLER = { name: 'KitStak LLC', address: ['1 Example Way', 'Austin, TX 78701'], taxId: '98-7654321', site: 'kitstak.com' };

/** Every piece of text on the page, in drawing order. */
function textOf(bytes: Uint8Array): string[] {
  const body = Buffer.from(bytes).toString('latin1');
  return [...body.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map((match) => (match[1] ?? '').replace(/\\([\\()])/g, '$1'));
}
const count = (texts: readonly string[], needle: string) => texts.filter((entry) => entry.includes(needle)).length;

describe('the test gateway invoice PDF', () => {
  it('repeats the picker lines, lists the promo code once, and every total is the rows above it', () => {
    const texts = textOf(renderInvoicePdf({ invoice: PROMO_INVOICE, orgName: 'Fixer Freight', billTo: ['maya@fixer.example'], seller: SELLER }));
    expect(texts).toContain('CRM: 5 users x $29 = $145 per month');
    expect(texts).toContain('WMS: 1 warehouse x $349 = $349 per month');
    // In order: list price, bundle discount, subtotal, promo code, tax, total, paid.
    const order = ['List price', '$494.00', 'Bundle discount (20%)', '-$98.80', 'Subtotal', '$395.20', 'Promo code TEST10 (10% off)', '-$39.52', 'Sales tax', '$0.00', 'Total', '$355.68', 'Paid', '$355.68'];
    let at = -1;
    for (const want of order) {
      const next = texts.indexOf(want, at + 1);
      expect(next, `"${want}" after position ${at}`).toBeGreaterThan(at);
      at = next;
    }
    expect(count(texts, 'TEST10')).toBe(1);
    expect(count(texts, '-$39.52')).toBe(1);
    // The old page printed the discounted unit prices and a second "Discount" row.
    expect(texts).not.toContain('Discount');
    expect(texts).not.toContain('$116.00');
    expect(texts).not.toContain('Still due');
    expect(texts).toContain('Paid on Dec 7, 2026 with the card ending 4242.');
  });

  it('carries the mark, a seller block and a buyer block with address and tax ID', () => {
    const bytes = renderInvoicePdf({
      invoice: PROMO_INVOICE,
      orgName: 'Fixer Freight',
      billTo: ['maya@fixer.example', '100 Dock Street', 'Austin, TX, 78701', 'US', 'Tax ID: 12-3456789'],
      seller: SELLER,
    });
    const texts = textOf(bytes);
    expect(texts[0]).toBe('KITSTAK');
    expect(texts).toContain('Invoice TEST-0001');
    expect(texts).toContain('Test mode. No real money moved.');
    for (const want of ['FROM', 'KitStak LLC', '1 Example Way', 'Austin, TX 78701', 'Tax ID: 98-7654321', 'kitstak.com']) expect(texts).toContain(want);
    for (const want of ['BILLED TO', 'Fixer Freight', '100 Dock Street', 'Tax ID: 12-3456789']) expect(texts).toContain(want);
    expect(texts).toContain('Monthly plan, first payment');
    // The two bars of the mark are drawn, not typed: two filled boxes before any text.
    const body = Buffer.from(bytes).toString('latin1');
    const stream = body.slice(body.indexOf('stream\n') + 7);
    expect(stream.slice(0, stream.indexOf('BT')).match(/ re f/g)).toHaveLength(2);
    expect(body.startsWith('%PDF-1.4')).toBe(true);
    expect(body.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('falls back to the gateway lines for a plan change, and says what is still due', () => {
    const change: GatewayInvoice = {
      ...PROMO_INVOICE,
      number: 'TEST-0002',
      status: 'open',
      billingReason: 'subscription_update',
      paidAt: null,
      subtotalCents: 2243,
      discountCents: 0,
      totalCents: 2243,
      amountPaidCents: 0,
      amountDueCents: 2243,
      lines: [line('1 more CRM seat for the 29 days left', 'crm', 1, 2243, 2243, true)],
    };
    const texts = textOf(renderInvoicePdf({ invoice: change, orgName: 'Fixer Freight', seller: SELLER }));
    expect(texts).toContain('Plan change');
    expect(texts).toContain('1 more CRM seat for the 29 days left');
    expect(texts).not.toContain('List price');
    expect(texts.indexOf('Still due')).toBeGreaterThan(texts.indexOf('Total'));
    expect(texts).toContain('Due');
  });

  it('long names wrap or are cut, and text outside Latin 1 never breaks the file', () => {
    const texts = textOf(
      renderInvoicePdf({
        invoice: PROMO_INVOICE,
        orgName: 'Northwind Robotics International Holdings and Partners of the Greater Midwest Region (Main)',
        billTo: ['北风机器人'],
        seller: SELLER,
      }),
    );
    expect(texts).toContain('Northwind Robotics International Holdings');
    expect(texts.every((entry) => entry.length <= 90)).toBe(true);
    expect(texts).toContain('?????');
  });

  it('prints only the seller facts that are set', () => {
    expect(invoiceSeller({ NODE_ENV: 'test' })).toEqual({ name: 'KitStak LLC', address: [], taxId: null, site: 'kitstak.com' });
    expect(
      invoiceSeller({ NODE_ENV: 'test', BILLING_SELLER_NAME: ' Acme Tools Inc ', BILLING_SELLER_ADDRESS: '1 Main St | Austin, TX', BILLING_SELLER_TAX_ID: '12-345', NEXT_PUBLIC_SITE_URL: 'https://acme.example/' }),
    ).toEqual({ name: 'Acme Tools Inc', address: ['1 Main St', 'Austin, TX'], taxId: '12-345', site: 'acme.example' });
  });
});
