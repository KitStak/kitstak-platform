/**
 * One price to the cent, everywhere (docs/billing/SPEC.md section 16, must have 3). For the nine
 * reference carts of CONTRACTS section 4.3 these three numbers are the same:
 *
 *  1. what every screen shows: `quote().totalCents`,
 *  2. what Stripe would charge: the unit amount of each price in the Stripe mapping (built from the
 *     catalog by lookup key, CONTRACTS 5.2) times its quantity,
 *  3. what the test gateway does charge: the total of the first invoice of a real test checkout.
 *
 * The third part runs against the local dev Postgres and is skipped when it is not reachable.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { type PlanSelection, formatMoney, isBundle, quantityFor } from '../src/catalog';
import { completeTestCheckout } from '../src/gateway/test';
import { quote } from '../src/quote';
import { checkoutPreview, createCheckout } from '../src/server/checkout';
import { listInvoices } from '../src/server/invoices';
import { getPlanState } from '../src/server/state';
import { createTestOrg, openTestDb, removeTestOrg, testRuntime, type TestOrg } from '../src/testing/db';
import { buildStripeSpec } from '../scripts/stripe-setup-lib';

const { pool, db, available } = await openTestDb();
vi.setConfig({ testTimeout: 60_000 });

const CARTS: readonly { name: string; selection: PlanSelection; total: number; shown: string }[] = [
  { name: '1 Pulse', selection: { products: ['pulse'], seats: 1, warehouses: 1, interval: 'monthly' }, total: 2900, shown: '$29.00' },
  { name: '2 CRM 5 seats', selection: { products: ['crm'], seats: 5, warehouses: 1, interval: 'monthly' }, total: 14500, shown: '$145.00' },
  { name: '3 CRM 5 seats, WMS 1 warehouse', selection: { products: ['crm', 'wms'], seats: 5, warehouses: 1, interval: 'monthly' }, total: 39520, shown: '$395.20' },
  { name: '4 CRM 5 seats, WMS 1 warehouse, yearly', selection: { products: ['crm', 'wms'], seats: 5, warehouses: 1, interval: 'yearly' }, total: 403104, shown: '$4,031.04' },
  { name: '5 Pulse, CRM 1 seat, yearly', selection: { products: ['crm', 'pulse'], seats: 1, warehouses: 1, interval: 'yearly' }, total: 47328, shown: '$473.28' },
  { name: '6 CRM and Projects 10 seats, WMS 2, Pulse', selection: { products: ['crm', 'wms', 'projects', 'pulse'], seats: 10, warehouses: 2, interval: 'monthly' }, total: 90960, shown: '$909.60' },
  { name: '7 same as 6, yearly', selection: { products: ['crm', 'wms', 'projects', 'pulse'], seats: 10, warehouses: 2, interval: 'yearly' }, total: 927792, shown: '$9,277.92' },
  { name: '8 Projects 3 seats, yearly', selection: { products: ['projects'], seats: 3, warehouses: 1, interval: 'yearly' }, total: 36720, shown: '$367.20' },
  { name: '9 WMS 3 warehouses', selection: { products: ['wms'], seats: 1, warehouses: 3, interval: 'monthly' }, total: 104700, shown: '$1,047.00' },
];

const spec = buildStripeSpec();
const stripePrice = new Map(spec.prices.map((price) => [price.lookup_key as string, price]));

/** What Stripe charges for a cart: one subscription item per app, unit amount times quantity. */
function stripeTotal(selection: PlanSelection): number {
  const q = quote(selection);
  let total = 0;
  for (const line of q.lines) {
    const price = stripePrice.get(line.priceKey);
    if (!price) throw new Error(`The Stripe mapping has no price for ${line.priceKey}.`);
    total += price.unit_amount * quantityFor(line.product, q.selection);
  }
  return total;
}

const orgs: TestOrg[] = [];
afterAll(async () => {
  for (const org of orgs) await removeTestOrg(pool, org);
  await pool.end();
});

describe('price parity: the quote and the Stripe mapping', () => {
  it('the Stripe mapping has 4 products and 16 prices, all found by lookup key', () => {
    expect(spec.products.map((product) => product.id)).toEqual(['kitstak_crm', 'kitstak_wms', 'kitstak_projects', 'kitstak_pulse']);
    expect(spec.prices).toHaveLength(16);
    expect(new Set(spec.prices.map((price) => price.lookup_key)).size).toBe(16);
    for (const price of spec.prices) {
      expect(price.lookup_key.startsWith('kitstak_')).toBe(true);
      expect(Number.isInteger(price.unit_amount)).toBe(true);
      expect(price.unit_amount).toBeGreaterThan(0);
      expect(price.currency).toBe('usd');
      expect(price.tax_behavior).toBe('exclusive');
      expect(price.recurring.interval).toBe(price.lookup_key.includes('_yearly') ? 'year' : 'month');
    }
  });

  it('the Stripe mapping holds exactly the amounts of CONTRACTS section 5.2', () => {
    const amounts = Object.fromEntries(spec.prices.map((price) => [price.lookup_key, price.unit_amount]));
    expect(amounts).toEqual({
      kitstak_crm_monthly: 2900,
      kitstak_crm_monthly_bundle: 2320,
      kitstak_crm_yearly: 29580,
      kitstak_crm_yearly_bundle: 23664,
      kitstak_projects_monthly: 1200,
      kitstak_projects_monthly_bundle: 960,
      kitstak_projects_yearly: 12240,
      kitstak_projects_yearly_bundle: 9792,
      kitstak_wms_monthly: 34900,
      kitstak_wms_monthly_bundle: 27920,
      kitstak_wms_yearly: 355980,
      kitstak_wms_yearly_bundle: 284784,
      kitstak_pulse_monthly: 2900,
      kitstak_pulse_monthly_bundle: 2320,
      kitstak_pulse_yearly: 29580,
      kitstak_pulse_yearly_bundle: 23664,
    });
  });

  it.each(CARTS)('$name: the quote, the Stripe total and the reference amount are all $shown', ({ selection, total, shown }) => {
    const q = quote(selection);
    expect(q.totalCents).toBe(total);
    expect(stripeTotal(selection)).toBe(total);
    expect(formatMoney(q.totalCents)).toBe(shown);
    // Every line uses the bundle price exactly when the cart is a bundle.
    for (const line of q.lines) expect(line.priceKey.endsWith('_bundle')).toBe(isBundle(q.selection.products));
  });
});

describe.skipIf(!available)('price parity: the test gateway charges the same', () => {
  it.each(CARTS)('$name: the first invoice is $shown', async ({ selection, total }) => {
    const org = await createTestOrg(pool);
    orgs.push(org);
    const rt = testRuntime(db, { now: () => new Date('2031-02-01T00:00:00.000Z') });
    const actor = { userId: org.owner.id, label: org.owner.name };

    const preview = await checkoutPreview(rt, { orgId: org.orgId, selection });
    expect(preview).toMatchObject({ ok: true, data: { dueTodayCents: total } });

    const checkout = await createCheckout(rt, { orgId: org.orgId, orgName: org.name, selection, actor, actorEmail: org.owner.email });
    if (!checkout.ok) throw new Error(checkout.error.message);
    expect(checkout.data.dueTodayCents).toBe(total);
    const paid = await completeTestCheckout(rt, {
      sessionId: checkout.data.sessionId,
      cardNumber: '4242 4242 4242 4242',
      expMonth: 12,
      expYear: 2035,
      cvc: '123',
      name: org.owner.name,
      postalCode: '60601',
    });
    expect(paid.ok).toBe(true);

    const invoices = await listInvoices(db, { orgId: org.orgId });
    expect(invoices).toHaveLength(1);
    expect(invoices[0]!.totalCents).toBe(total);
    expect(invoices[0]!.amountPaidCents).toBe(total);
    expect(invoices[0]!.taxCents).toBe(0);
    // Each invoice line is the Stripe unit amount times the quantity, with no rounding anywhere.
    const q = quote(selection);
    expect(invoices[0]!.lines.map((line) => line.amountCents)).toEqual(
      q.lines.map((line) => stripePrice.get(line.priceKey)!.unit_amount * line.quantity),
    );
    // And the plan the person now sees costs the same.
    const state = await getPlanState(rt, org.orgId);
    expect(state.phase).toBe('active');
    expect(state.quote.totalCents).toBe(total);
    expect(state.nextCharge?.amountCents).toBe(total);
  });
});
