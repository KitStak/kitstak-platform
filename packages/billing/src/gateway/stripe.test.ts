/**
 * The Stripe adapter against a mocked SDK. No network: the fake client throws on any call that a
 * test did not expect.
 */
import type Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import { allPriceKeys, type PlanSelection } from '../catalog';
import type { BillingConfig } from '../server/config';
import { createStripeGateway } from './stripe';
import { GatewayCardError, WebhookSignatureError } from './types';

const NOW = new Date('2026-11-23T12:00:00.000Z');
const unix = (date: Date) => Math.floor(date.getTime() / 1000);
const DAY = 24 * 60 * 60;
const ORG = '22222222-2222-4222-8222-222222222222';

const CONFIG: BillingConfig = {
  mode: 'stripe_test',
  stripeSecretKey: 'sk_test_not_a_real_key',
  stripeWebhookSecret: 'whsec_test',
  stripePortalConfigurationId: 'bpc_123',
  automaticTax: false,
  testWebhookSecret: 'unused',
};

const priceId = (key: string) => `price_${key}`;

function price(key: string, amount: number, interval: 'month' | 'year' = 'month') {
  return { id: priceId(key), lookup_key: key, unit_amount: amount, recurring: { interval }, metadata: {} };
}

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub_1',
    object: 'subscription',
    customer: 'cus_1',
    status: 'active',
    metadata: { kitstak_org_id: ORG },
    trial_end: null,
    cancel_at: null,
    cancel_at_period_end: false,
    canceled_at: null,
    ended_at: null,
    pause_collection: null,
    pending_update: null,
    default_payment_method: { id: 'pm_1', card: { brand: 'visa', last4: '4242', exp_month: 8, exp_year: 2028 } },
    latest_invoice: 'in_1',
    created: unix(NOW) - 40 * DAY,
    items: {
      data: [
        { id: 'si_crm', quantity: 5, price: price('kitstak_crm_monthly', 2900), current_period_start: unix(NOW) - 10 * DAY, current_period_end: unix(NOW) + 20 * DAY },
      ],
    },
    ...overrides,
  };
}

function fakeStripe() {
  const calls = {
    pricesList: vi.fn(async (params: { lookup_keys: string[] }) => ({
      data: params.lookup_keys.map((key) => ({ id: priceId(key), lookup_key: key })),
    })),
    checkoutCreate: vi.fn(async (_params: Record<string, unknown>) => ({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' })),
    checkoutRetrieve: vi.fn(),
    checkoutList: vi.fn(async (_params: Record<string, unknown>) => ({ data: [] as { id: string }[] })),
    checkoutExpire: vi.fn(async (_id: string) => ({})),
    subCancel: vi.fn(async (_id: string, _params: Record<string, unknown>) => ({})),
    creditNoteCreate: vi.fn(async (_params: Record<string, unknown>) => ({ id: 'cn_1' })),
    portalCreate: vi.fn(async (_params: Record<string, unknown>) => ({ url: 'https://billing.stripe.test/session' })),
    subRetrieve: vi.fn(async (_id: string, _params?: unknown) => subscription()),
    subUpdate: vi.fn(async (_id: string, _params: Record<string, unknown>) => subscription()),
    subList: vi.fn(),
    invoicePreview: vi.fn(),
    invoiceRetrieve: vi.fn(),
    invoicePay: vi.fn(),
    invoiceVoid: vi.fn(async (_id: string) => ({})),
    invoiceList: vi.fn(),
    customerCreate: vi.fn(async (_params: Record<string, unknown>) => ({ id: 'cus_new' })),
    customerRetrieve: vi.fn(),
    customerUpdate: vi.fn(async () => ({})),
    listTaxIds: vi.fn(async () => ({ data: [] as { id: string; type: string; value: string }[] })),
    createTaxId: vi.fn(async () => ({})),
    deleteTaxId: vi.fn(async () => ({})),
    constructEvent: vi.fn(),
  };
  const client = {
    prices: { list: calls.pricesList },
    checkout: {
      sessions: { create: calls.checkoutCreate, retrieve: calls.checkoutRetrieve, list: calls.checkoutList, expire: calls.checkoutExpire },
    },
    billingPortal: { sessions: { create: calls.portalCreate } },
    subscriptions: { retrieve: calls.subRetrieve, update: calls.subUpdate, list: calls.subList, cancel: calls.subCancel },
    creditNotes: { create: calls.creditNoteCreate },
    invoices: {
      createPreview: calls.invoicePreview,
      retrieve: calls.invoiceRetrieve,
      pay: calls.invoicePay,
      voidInvoice: calls.invoiceVoid,
      list: calls.invoiceList,
    },
    customers: {
      create: calls.customerCreate,
      retrieve: calls.customerRetrieve,
      update: calls.customerUpdate,
      listTaxIds: calls.listTaxIds,
      createTaxId: calls.createTaxId,
      deleteTaxId: calls.deleteTaxId,
    },
    webhooks: { constructEvent: calls.constructEvent },
  };
  const gateway = createStripeGateway(CONFIG, { client: client as unknown as Stripe, now: () => NOW });
  return { gateway, calls };
}

const CRM5: PlanSelection = { products: ['crm'], seats: 5, warehouses: 1, interval: 'monthly' };
const CRM_WMS: PlanSelection = { products: ['crm', 'wms'], seats: 5, warehouses: 2, interval: 'monthly' };
const URLS = { successUrl: 'https://kitstak.app/billing/checkout/success?session_id={CHECKOUT_SESSION_ID}', cancelUrl: 'https://kitstak.app/billing/checkout/canceled' };

describe('Stripe adapter: Checkout', () => {
  it('builds a subscription session with lookup key prices, quantities and no coupon', async () => {
    const { gateway, calls } = fakeStripe();
    const session = await gateway.createCheckoutSession({ orgId: ORG, customerId: 'cus_1', selection: CRM_WMS, trialEnd: null, ...URLS });
    expect(session).toEqual({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' });
    const params = calls.checkoutCreate.mock.calls[0]![0];
    expect(params).toEqual({
      mode: 'subscription',
      customer: 'cus_1',
      client_reference_id: ORG,
      line_items: [
        { price: 'price_kitstak_crm_monthly_bundle', quantity: 5 },
        { price: 'price_kitstak_wms_monthly_bundle', quantity: 2 },
      ],
      subscription_data: { metadata: { kitstak_org_id: ORG } },
      allow_promotion_codes: true,
      payment_method_collection: 'always',
      billing_address_collection: 'auto',
      automatic_tax: { enabled: false },
      tax_id_collection: { enabled: true },
      customer_update: { name: 'auto', address: 'auto' },
      custom_text: { submit: { message: 'These prices already include your bundle discount. Cancel any time in Billing. Your data stays yours.' } },
      metadata: { kitstak_org_id: ORG },
      success_url: URLS.successUrl,
      cancel_url: URLS.cancelUrl,
    });
    // The promo code slot stays free, and nobody can change a quantity on the pay page.
    expect(params).not.toHaveProperty('discounts');
    expect(JSON.stringify(params)).not.toContain('adjustable_quantity');
  });

  it('finds prices by lookup key only, at most 10 keys per call, and caches them', async () => {
    const { gateway, calls } = fakeStripe();
    await gateway.createCheckoutSession({ orgId: ORG, customerId: 'cus_1', selection: CRM5, trialEnd: null, ...URLS });
    await gateway.createCheckoutSession({ orgId: ORG, customerId: 'cus_1', selection: CRM_WMS, trialEnd: null, ...URLS });
    expect(calls.pricesList).toHaveBeenCalledTimes(2);
    const asked = calls.pricesList.mock.calls.flatMap((call) => call[0].lookup_keys);
    expect([...asked].sort()).toEqual([...allPriceKeys()].sort());
    for (const call of calls.pricesList.mock.calls) {
      expect(call[0].lookup_keys.length).toBeLessThanOrEqual(10);
      expect(call[0]).toMatchObject({ active: true });
    }
  });

  it('a missing lookup key is an error that names the key, never a guess', async () => {
    const { gateway, calls } = fakeStripe();
    calls.pricesList.mockImplementation(async (params) => ({
      data: params.lookup_keys.filter((key) => key !== 'kitstak_crm_monthly').map((key) => ({ id: priceId(key), lookup_key: key })),
    }));
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await expect(gateway.createCheckoutSession({ orgId: ORG, customerId: 'cus_1', selection: CRM5, trialEnd: null, ...URLS })).rejects.toThrow(
      'Missing Stripe price: kitstak_crm_monthly',
    );
    expect(write.mock.calls.join(' ')).toContain('kitstak_crm_monthly');
    expect(calls.checkoutCreate).not.toHaveBeenCalled();
  });

  it('passes the trial end only when it is at least 48 hours ahead', async () => {
    const { gateway, calls } = fakeStripe();
    const far = new Date(NOW.getTime() + 9 * DAY * 1000);
    await gateway.createCheckoutSession({ orgId: ORG, customerId: 'cus_1', selection: CRM5, trialEnd: far, ...URLS });
    expect(calls.checkoutCreate.mock.calls[0]![0].subscription_data).toEqual({ trial_end: unix(far), metadata: { kitstak_org_id: ORG } });

    const near = new Date(NOW.getTime() + 47 * 60 * 60 * 1000);
    await gateway.createCheckoutSession({ orgId: ORG, customerId: 'cus_1', selection: CRM5, trialEnd: near, ...URLS });
    expect(calls.checkoutCreate.mock.calls[1]![0].subscription_data).toEqual({ metadata: { kitstak_org_id: ORG } });
  });

  it('says which discounts are already in the prices', async () => {
    const { gateway, calls } = fakeStripe();
    const message = async (selection: PlanSelection) => {
      await gateway.createCheckoutSession({ orgId: ORG, customerId: 'cus_1', selection, trialEnd: null, ...URLS });
      return (calls.checkoutCreate.mock.calls.at(-1)![0].custom_text as { submit: { message: string } }).submit.message;
    };
    expect(await message(CRM5)).toBe('Cancel any time in Billing. Your data stays yours.');
    expect(await message({ ...CRM5, interval: 'yearly' })).toBe('These prices already include your yearly discount. Cancel any time in Billing. Your data stays yours.');
    expect(await message({ ...CRM_WMS, interval: 'yearly' })).toBe(
      'These prices already include your yearly and bundle discounts. Cancel any time in Billing. Your data stays yours.',
    );
    expect(calls.checkoutCreate.mock.calls.at(-1)![0].line_items).toEqual([
      { price: 'price_kitstak_crm_yearly_bundle', quantity: 5 },
      { price: 'price_kitstak_wms_yearly_bundle', quantity: 2 },
    ]);
  });

  it('turns automatic tax on only when the config says so', async () => {
    const calls = fakeStripe().calls;
    const client = { prices: { list: calls.pricesList }, checkout: { sessions: { create: calls.checkoutCreate } } };
    const gateway = createStripeGateway({ ...CONFIG, automaticTax: true }, { client: client as unknown as Stripe, now: () => NOW });
    await gateway.createCheckoutSession({ orgId: ORG, customerId: 'cus_1', selection: CRM5, trialEnd: null, ...URLS });
    expect(calls.checkoutCreate.mock.calls[0]![0].automatic_tax).toEqual({ enabled: true });
  });

  it('reads a session back, with the org from metadata', async () => {
    const { gateway, calls } = fakeStripe();
    calls.checkoutRetrieve.mockResolvedValue({ id: 'cs_1', status: 'complete', customer: 'cus_1', subscription: { id: 'sub_1' }, url: null, metadata: { kitstak_org_id: ORG } });
    await expect(gateway.getCheckoutSession('cs_1')).resolves.toEqual({ id: 'cs_1', orgId: ORG, status: 'complete', customerId: 'cus_1', subscriptionId: 'sub_1', url: null });
    calls.checkoutRetrieve.mockRejectedValue({ code: 'resource_missing' });
    await expect(gateway.getCheckoutSession('cs_gone')).resolves.toBeNull();
  });
});

describe('Stripe adapter: reading a subscription', () => {
  it('reads the period from the items, the card, and the org from metadata', async () => {
    const { gateway } = fakeStripe();
    const read = await gateway.getSubscription('sub_1');
    expect(read).toEqual({
      id: 'sub_1',
      customerId: 'cus_1',
      orgId: ORG,
      status: 'active',
      interval: 'monthly',
      items: [{ id: 'si_crm', priceKey: 'kitstak_crm_monthly', priceId: 'price_kitstak_crm_monthly', product: 'crm', quantity: 5, unitCents: 2900 }],
      currentPeriodStart: new Date((unix(NOW) - 10 * DAY) * 1000),
      currentPeriodEnd: new Date((unix(NOW) + 20 * DAY) * 1000),
      trialEnd: null,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      canceledAt: null,
      endedAt: null,
      pauseResumesAt: null,
      paymentMethod: { brand: 'visa', last4: '4242', expMonth: 8, expYear: 2028 },
      latestInvoiceId: 'in_1',
      // Stripe gave no preview of the next invoice here: no credit known, no next bill claimed.
      creditBalanceCents: 0,
      upcoming: null,
    });
  });

  it('reads the credit and the real next charge from the preview of the next invoice', async () => {
    const { gateway, calls } = fakeStripe();
    // $50.00 of customer balance, and $14.50 of unused time still waiting as a line on the next invoice.
    calls.subRetrieve.mockResolvedValue(subscription({ customer: { id: 'cus_1', balance: -5000, invoice_settings: {} } }));
    calls.invoicePreview.mockResolvedValue({
      id: 'upcoming',
      customer: 'cus_1',
      status: 'draft',
      subtotal: 13050,
      total: 13050,
      amount_due: 8050,
      starting_balance: -5000,
      lines: {
        data: [
          { description: 'Unused time on KitStak CRM', amount: -1450, quantity: 1, proration: true },
          { description: '5 x KitStak CRM', amount: 14500, quantity: 5 },
        ],
      },
    });
    const read = await gateway.getSubscription('sub_1');
    expect(read?.creditBalanceCents).toBe(6450);
    // The card is charged $80.50: the $145.00 plan less all $64.50 of credit.
    expect(read?.upcoming).toEqual({ amountDueCents: 8050, discountCents: 0, discountLabel: null, creditAppliedCents: 6450 });
    expect(calls.invoicePreview.mock.calls[0]![0]).toEqual({ customer: 'cus_1', subscription: 'sub_1' });
  });

  it('a promo code on the next invoice shows as a discount, so the first charge shown is the first charge made', async () => {
    const { gateway, calls } = fakeStripe();
    calls.subRetrieve.mockResolvedValue(subscription({ status: 'trialing', trial_end: unix(NOW) + 10 * DAY }));
    calls.invoicePreview.mockResolvedValue({
      customer: 'cus_1',
      subtotal: 39520,
      total: 35568,
      amount_due: 35568,
      total_discount_amounts: [{ amount: 3952 }],
      lines: { data: [{ description: 'KitStak CRM', amount: 39520, quantity: 5 }] },
    });
    const read = await gateway.getSubscription('sub_1');
    expect(read?.upcoming).toEqual({ amountDueCents: 35568, discountCents: 3952, discountLabel: 'Promo code', creditAppliedCents: 0 });
  });

  it('claims no next bill for a plan that is set to end, is paused, or when Stripe cannot say', async () => {
    const { gateway, calls } = fakeStripe();
    calls.invoicePreview.mockResolvedValue({ total: 14500, amount_due: 14500, lines: { data: [] } });
    calls.subRetrieve.mockResolvedValue(subscription({ cancel_at_period_end: true }));
    expect((await gateway.getSubscription('sub_1'))?.upcoming).toBeNull();
    calls.subRetrieve.mockResolvedValue(subscription({ pause_collection: { behavior: 'void', resumes_at: unix(NOW) + 40 * DAY } }));
    expect((await gateway.getSubscription('sub_1'))?.upcoming).toBeNull();
    expect(calls.invoicePreview).not.toHaveBeenCalled();
    calls.subRetrieve.mockResolvedValue(subscription());
    calls.invoicePreview.mockRejectedValue({ code: 'invoice_upcoming_none' });
    expect((await gateway.getSubscription('sub_1'))?.upcoming).toBeNull();
  });

  it('still reads top level period fields when an older API version sends them', async () => {
    const { gateway, calls } = fakeStripe();
    calls.subRetrieve.mockResolvedValue(subscription({ current_period_start: 100, current_period_end: 200 }));
    const read = await gateway.getSubscription('sub_1');
    expect(read?.currentPeriodStart).toEqual(new Date(100_000));
    expect(read?.currentPeriodEnd).toEqual(new Date(200_000));
  });

  it('maps statuses, yearly prices, pauses and the customer default card', async () => {
    const { gateway, calls } = fakeStripe();
    calls.subRetrieve.mockResolvedValue(
      subscription({
        status: 'incomplete_expired',
        default_payment_method: null,
        customer: { id: 'cus_1', invoice_settings: { default_payment_method: { id: 'pm_2', card: { brand: 'mastercard', last4: '4444', exp_month: 1, exp_year: 2030 } } } },
        pause_collection: { behavior: 'void', resumes_at: 1_900_000_000 },
        cancel_at_period_end: true,
        trial_end: 1_800_000_000,
        items: { data: [{ id: 'si_wms', quantity: 2, price: price('kitstak_wms_yearly_bundle', 284784, 'year'), current_period_start: 1, current_period_end: 2 }] },
      }),
    );
    const read = await gateway.getSubscription('sub_1');
    expect(read).toMatchObject({
      status: 'canceled',
      interval: 'yearly',
      customerId: 'cus_1',
      cancelAtPeriodEnd: true,
      trialEnd: new Date(1_800_000_000_000),
      pauseResumesAt: new Date(1_900_000_000_000),
      paymentMethod: { brand: 'mastercard', last4: '4444', expMonth: 1, expYear: 2030 },
    });
    expect(read?.items).toEqual([
      { id: 'si_wms', priceKey: 'kitstak_wms_yearly_bundle', priceId: 'price_kitstak_wms_yearly_bundle', product: 'wms', quantity: 2, unitCents: 284784 },
    ]);
    for (const [stripeStatus, ours] of [['trialing', 'trialing'], ['past_due', 'past_due'], ['unpaid', 'unpaid'], ['paused', 'unpaid'], ['incomplete', 'incomplete']] as const) {
      calls.subRetrieve.mockResolvedValue(subscription({ status: stripeStatus }));
      expect((await gateway.getSubscription('sub_1'))?.status).toBe(ours);
    }
  });

  it('a card saved in the Billing Portal becomes the card the plan is charged on', async () => {
    const { gateway, calls } = fakeStripe();
    const newCard = { id: 'pm_new', card: { brand: 'mastercard', last4: '4444', exp_month: 1, exp_year: 2030 } };
    calls.subRetrieve.mockResolvedValue(subscription({ customer: { id: 'cus_1', invoice_settings: { default_payment_method: newCard } } }));
    calls.subUpdate.mockResolvedValue(subscription({ default_payment_method: newCard, customer: { id: 'cus_1', invoice_settings: { default_payment_method: newCard } } }));
    const read = await gateway.getSubscription('sub_1');
    expect(calls.subUpdate).toHaveBeenCalledTimes(1);
    expect(calls.subUpdate.mock.calls[0]![0]).toBe('sub_1');
    expect(calls.subUpdate.mock.calls[0]![1]).toMatchObject({ default_payment_method: 'pm_new' });
    expect(read?.paymentMethod).toEqual({ brand: 'mastercard', last4: '4444', expMonth: 1, expYear: 2030 });

    // Once they match, a read is only a read.
    calls.subRetrieve.mockResolvedValue(subscription({ default_payment_method: newCard, customer: { id: 'cus_1', invoice_settings: { default_payment_method: newCard } } }));
    await gateway.getSubscription('sub_1');
    expect(calls.subUpdate).toHaveBeenCalledTimes(1);

    // If Stripe refuses, the read still answers with the card that will really be charged.
    calls.subRetrieve.mockResolvedValue(subscription({ customer: { id: 'cus_1', invoice_settings: { default_payment_method: newCard } } }));
    calls.subUpdate.mockRejectedValue(new Error('nope'));
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect((await gateway.getSubscription('sub_1'))?.paymentMethod?.last4).toBe('4242');
    expect(write).toHaveBeenCalled();
  });

  it('never matches the old tier products, and knows a replaced price by its metadata', async () => {
    const { gateway, calls } = fakeStripe();
    calls.subRetrieve.mockResolvedValue(
      subscription({
        metadata: { org_id: ORG, plan_key: 'starter' },
        items: {
          data: [
            { id: 'si_old', quantity: 1, price: { id: 'price_starter', lookup_key: null, unit_amount: 80000, recurring: { interval: 'month' }, metadata: {} }, current_period_start: 1, current_period_end: 2 },
            { id: 'si_named', quantity: 1, price: { id: 'price_x', lookup_key: 'starter_monthly', unit_amount: 80000, recurring: { interval: 'month' }, metadata: {} }, current_period_start: 1, current_period_end: 2 },
            {
              id: 'si_replaced',
              quantity: 3,
              price: { id: 'price_old_crm', lookup_key: null, unit_amount: 2500, recurring: { interval: 'month' }, metadata: { kitstak_module: 'crm', kitstak_interval: 'monthly', kitstak_bundle: 'false' } },
              current_period_start: 1,
              current_period_end: 2,
            },
          ],
        },
      }),
    );
    const read = await gateway.getSubscription('sub_1');
    // The old test subscription carries `org_id`, not `kitstak_org_id`: it has no org for us.
    expect(read?.orgId).toBeNull();
    expect(read?.items).toEqual([{ id: 'si_replaced', priceKey: 'kitstak_crm_monthly', priceId: 'price_old_crm', product: 'crm', quantity: 3, unitCents: 2500 }]);
  });

  it('a subscription Stripe does not know is null; findSubscriptionForCustomer returns only ours', async () => {
    const { gateway, calls } = fakeStripe();
    calls.subRetrieve.mockRejectedValue({ code: 'resource_missing' });
    await expect(gateway.getSubscription('sub_gone')).resolves.toBeNull();
    calls.subList.mockResolvedValue({
      data: [subscription({ id: 'sub_old_tier', metadata: { org_id: ORG } }), subscription({ id: 'sub_done', status: 'canceled' }), subscription({ id: 'sub_live' })],
    });
    expect((await gateway.findSubscriptionForCustomer('cus_1'))?.id).toBe('sub_live');
    expect(calls.subList.mock.calls[0]![0]).toMatchObject({ customer: 'cus_1', status: 'all' });
  });
});

function previewInvoice(total: number, lines: { amount: number; description: string; product?: string; proration?: boolean; quantity?: number }[] = []) {
  return {
    id: 'upcoming',
    customer: 'cus_1',
    status: 'draft',
    total,
    amount_due: Math.max(0, total),
    subtotal: total,
    total_taxes: [],
    total_discount_amounts: [],
    status_transitions: {},
    created: unix(NOW),
    lines: {
      data: lines.map((line) => ({
        amount: line.amount,
        description: line.description,
        quantity: line.quantity ?? 1,
        period: { start: unix(NOW), end: unix(NOW) + 20 * DAY },
        pricing: { price_details: { product: line.product ?? 'kitstak_crm', price: 'price_x' }, unit_amount_decimal: null },
        parent: { subscription_item_details: { proration: line.proration ?? true } },
      })),
    },
  };
}

describe('Stripe adapter: plan changes', () => {
  it('previews with the full item list: bundle swap, new item, and the same proration date', async () => {
    const { gateway, calls } = fakeStripe();
    calls.invoicePreview.mockResolvedValue(
      previewInvoice(12510, [
        { amount: -7250, description: 'Unused time on KitStak CRM' },
        { amount: 5800, description: 'Remaining time on KitStak CRM' },
        { amount: 13960, description: 'Remaining time on KitStak WMS', product: 'kitstak_wms' },
      ]),
    );
    const preview = await gateway.previewChange({ subscriptionId: 'sub_1', selection: { ...CRM_WMS, warehouses: 1 }, prorationDate: NOW });
    expect(calls.invoicePreview.mock.calls[0]![0]).toEqual({
      customer: 'cus_1',
      subscription: 'sub_1',
      subscription_details: {
        items: [
          { id: 'si_crm', price: 'price_kitstak_crm_monthly_bundle', quantity: 5 },
          { price: 'price_kitstak_wms_monthly_bundle', quantity: 1 },
        ],
        proration_date: unix(NOW),
        proration_behavior: 'always_invoice',
      },
    });
    expect(preview).toMatchObject({
      dueTodayCents: 12510,
      creditCents: 0,
      newRecurringCents: 39520,
      recurringDeltaCents: 25020,
      nextChargeAt: new Date((unix(NOW) + 20 * DAY) * 1000),
      prorationDate: NOW,
      taxCents: 0,
    });
    expect(preview.lines.map((line) => [line.product, line.amountCents, line.proration])).toEqual([
      ['crm', -7250, true],
      ['crm', 5800, true],
      ['wms', 13960, true],
    ]);
  });

  it('a decrease is credit, not a charge', async () => {
    const { gateway, calls } = fakeStripe();
    calls.invoicePreview.mockResolvedValue(previewInvoice(-1450, [{ amount: -1450, description: 'Unused time' }]));
    const preview = await gateway.previewChange({ subscriptionId: 'sub_1', selection: { ...CRM5, seats: 4 }, prorationDate: NOW });
    expect(preview).toMatchObject({ dueTodayCents: 0, creditCents: 1450, recurringDeltaCents: -2900 });
  });

  it('applies an increase with an invoice now, and so that a declined card changes nothing', async () => {
    const { gateway, calls } = fakeStripe();
    calls.invoicePreview.mockResolvedValue(previewInvoice(1450));
    await gateway.applyChange({ subscriptionId: 'sub_1', selection: { ...CRM5, seats: 6 }, prorationDate: NOW });
    expect(calls.subUpdate.mock.calls[0]).toEqual([
      'sub_1',
      {
        items: [{ id: 'si_crm', price: 'price_kitstak_crm_monthly', quantity: 6 }],
        proration_date: unix(NOW),
        proration_behavior: 'always_invoice',
        payment_behavior: 'pending_if_incomplete',
        expand: ['default_payment_method', 'customer.invoice_settings.default_payment_method'],
      },
    ]);
  });

  it('applies a decrease as prorations for the next bill', async () => {
    const { gateway, calls } = fakeStripe();
    calls.invoicePreview.mockResolvedValue(previewInvoice(-1450));
    await gateway.applyChange({ subscriptionId: 'sub_1', selection: { ...CRM5, seats: 4 }, prorationDate: NOW });
    const params = calls.subUpdate.mock.calls[0]![1];
    expect(params.proration_behavior).toBe('create_prorations');
    expect(params).not.toHaveProperty('payment_behavior');
  });

  it('removes an app with `deleted: true` and moves the rest back to list prices', async () => {
    const { gateway, calls } = fakeStripe();
    calls.subRetrieve.mockResolvedValue(
      subscription({
        items: {
          data: [
            { id: 'si_crm', quantity: 5, price: price('kitstak_crm_monthly_bundle', 2320), current_period_start: 1, current_period_end: 2 },
            { id: 'si_wms', quantity: 1, price: price('kitstak_wms_monthly_bundle', 27920), current_period_start: 1, current_period_end: 2 },
          ],
        },
      }),
    );
    calls.invoicePreview.mockResolvedValue(previewInvoice(-9000));
    await gateway.applyChange({ subscriptionId: 'sub_1', selection: CRM5, prorationDate: NOW });
    expect(calls.subUpdate.mock.calls[0]![1].items).toEqual([
      { id: 'si_crm', price: 'price_kitstak_crm_monthly', quantity: 5 },
      { id: 'si_wms', deleted: true },
    ]);
  });

  it('a card that Stripe declines throws GatewayCardError', async () => {
    const { gateway, calls } = fakeStripe();
    calls.invoicePreview.mockResolvedValue(previewInvoice(1450));
    calls.subUpdate.mockRejectedValue({ type: 'StripeCardError', code: 'card_declined', decline_code: 'insufficient_funds' });
    const attempt = gateway.applyChange({ subscriptionId: 'sub_1', selection: { ...CRM5, seats: 6 }, prorationDate: NOW });
    await expect(attempt).rejects.toBeInstanceOf(GatewayCardError);
    await expect(attempt).rejects.toMatchObject({ declineCode: 'insufficient_funds' });
  });

  it('a payment that is left waiting is voided and reported as a declined card', async () => {
    const { gateway, calls } = fakeStripe();
    calls.invoicePreview.mockResolvedValue(previewInvoice(1450));
    calls.subUpdate.mockResolvedValue(subscription({ pending_update: { expires_at: 1 }, latest_invoice: 'in_pending' }));
    await expect(gateway.applyChange({ subscriptionId: 'sub_1', selection: { ...CRM5, seats: 6 }, prorationDate: NOW })).rejects.toBeInstanceOf(GatewayCardError);
    expect(calls.invoiceVoid).toHaveBeenCalledWith('in_pending');
  });

  it('other Stripe errors are not hidden as card errors', async () => {
    const { gateway, calls } = fakeStripe();
    calls.invoicePreview.mockResolvedValue(previewInvoice(1450));
    calls.subUpdate.mockRejectedValue(new Error('rate limited'));
    await expect(gateway.applyChange({ subscriptionId: 'sub_1', selection: { ...CRM5, seats: 6 }, prorationDate: NOW })).rejects.toThrow('rate limited');
  });
});

describe('Stripe adapter: cancel, pause, cards and invoices', () => {
  it('cancel at period end, and undo', async () => {
    const { gateway, calls } = fakeStripe();
    await gateway.setCancelAtPeriodEnd('sub_1', true);
    await gateway.setCancelAtPeriodEnd('sub_1', false);
    expect(calls.subUpdate.mock.calls.map((call) => call[1].cancel_at_period_end)).toEqual([true, false]);
  });

  it('pause voids invoices until the resume date; resume clears it and can bill today', async () => {
    const { gateway, calls } = fakeStripe();
    const resumesAt = new Date('2027-01-31T23:00:00.000Z');
    await gateway.pause('sub_1', resumesAt);
    expect(calls.subUpdate.mock.calls[0]![1].pause_collection).toEqual({ behavior: 'void', resumes_at: unix(resumesAt) });
    await gateway.resume('sub_1');
    expect(calls.subUpdate.mock.calls[1]![1]).toMatchObject({ pause_collection: '' });
    expect(calls.subUpdate.mock.calls[1]![1]).not.toHaveProperty('billing_cycle_anchor');
    await gateway.resume('sub_1', { billNow: true });
    expect(calls.subUpdate.mock.calls[2]![1]).toMatchObject({ pause_collection: '', billing_cycle_anchor: { type: 'now' }, proration_behavior: 'none' });
  });

  it('opens the Billing Portal on "update payment method" and comes back to billing home', async () => {
    const { gateway, calls } = fakeStripe();
    const session = await gateway.createPaymentUpdateSession({ customerId: 'cus_1', returnUrl: 'https://kitstak.app/billing?updated=card' });
    expect(session).toEqual({ url: 'https://billing.stripe.test/session' });
    expect(calls.portalCreate.mock.calls[0]![0]).toEqual({
      customer: 'cus_1',
      return_url: 'https://kitstak.app/billing?updated=card',
      configuration: 'bpc_123',
      flow_data: { type: 'payment_method_update', after_completion: { type: 'redirect', redirect: { return_url: 'https://kitstak.app/billing?updated=card' } } },
    });
  });

  it('pays the open invoice with the customer default card and makes it the subscription card', async () => {
    const { gateway, calls } = fakeStripe();
    calls.subRetrieve.mockResolvedValue(
      subscription({ default_payment_method: 'pm_old', customer: { id: 'cus_1', invoice_settings: { default_payment_method: { id: 'pm_new', card: { last4: '1111' } } } } }),
    );
    calls.invoiceRetrieve.mockResolvedValue({ id: 'in_1', status: 'open', customer: 'cus_1', total: 14500, amount_remaining: 14500 });
    calls.invoicePay.mockResolvedValue({ id: 'in_1', status: 'paid', customer: 'cus_1', total: 14500, amount_paid: 14500, amount_remaining: 0, status_transitions: { paid_at: unix(NOW) } });
    const paid = await gateway.payLatestInvoice('sub_1');
    expect(calls.invoicePay).toHaveBeenCalledWith('in_1', { payment_method: 'pm_new' });
    expect(calls.subUpdate).toHaveBeenCalledWith('sub_1', { default_payment_method: 'pm_new' });
    expect(paid).toMatchObject({ status: 'paid', amountPaidCents: 14500, amountDueCents: 0, paidAt: NOW });

    calls.invoicePay.mockRejectedValue({ type: 'StripeCardError', decline_code: 'generic_decline' });
    await expect(gateway.payLatestInvoice('sub_1')).rejects.toBeInstanceOf(GatewayCardError);
  });

  it('reads an invoice: subscription id from the parent, tax and discount as their own amounts', async () => {
    const { gateway, calls } = fakeStripe();
    calls.invoiceRetrieve.mockResolvedValue({
      id: 'in_1',
      customer: { id: 'cus_1' },
      number: 'KS-0001',
      status: 'paid',
      billing_reason: 'subscription_cycle',
      subtotal: 39520,
      total: 38732,
      amount_paid: 38732,
      amount_remaining: 0,
      total_taxes: [{ amount: 2000 }, { amount: 1164 }],
      total_discount_amounts: [{ amount: 3952 }],
      attempt_count: 1,
      next_payment_attempt: null,
      created: unix(NOW) - 60,
      status_transitions: { finalized_at: unix(NOW) - 30, paid_at: unix(NOW) },
      parent: { subscription_details: { subscription: 'sub_1', metadata: { kitstak_org_id: ORG } } },
      invoice_pdf: 'https://pay.stripe.test/invoice.pdf',
      lines: {
        data: [
          {
            amount: 11600,
            description: '5 x KitStak CRM',
            quantity: 5,
            period: { start: unix(NOW), end: unix(NOW) + 30 * DAY },
            pricing: { price_details: { product: 'kitstak_crm', price: 'price_1' }, unit_amount_decimal: '2320' },
            parent: { subscription_item_details: { proration: false } },
          },
          { amount: 500, description: 'Something by hand', quantity: 1, period: { start: 1, end: 2 }, pricing: { price_details: { product: 'prod_starter' } }, parent: {} },
        ],
      },
    });
    const invoice = await gateway.getInvoice('in_1');
    expect(invoice).toMatchObject({
      id: 'in_1',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      number: 'KS-0001',
      status: 'paid',
      subtotalCents: 39520,
      discountCents: 3952,
      taxCents: 3164,
      totalCents: 38732,
      amountPaidCents: 38732,
      amountDueCents: 0,
      issuedAt: new Date((unix(NOW) - 30) * 1000),
      paidAt: NOW,
      periodStart: NOW,
    });
    expect(invoice?.lines).toEqual([
      { description: '5 x KitStak CRM', product: 'crm', quantity: 5, unitCents: 2320, amountCents: 11600, proration: false },
      { description: 'Something by hand', product: null, quantity: 1, unitCents: 500, amountCents: 500, proration: false },
    ]);
    await expect(gateway.getInvoicePdf('in_1')).resolves.toEqual({ kind: 'redirect', url: 'https://pay.stripe.test/invoice.pdf' });
  });

  it('makes a customer with the org id, and reuses one only when it is that org\'s', async () => {
    const { gateway, calls } = fakeStripe();
    const profile = { email: 'billing@northwind.example', name: 'Northwind Robotics', address: { line1: '1 Main St', city: 'Chicago', state: 'IL', postalCode: '60601', country: 'US' }, taxId: null };
    await expect(gateway.ensureCustomer({ orgId: ORG, existingCustomerId: null, profile })).resolves.toEqual({ customerId: 'cus_new' });
    expect(calls.customerCreate.mock.calls[0]![0]).toEqual({
      name: 'Northwind Robotics',
      email: 'billing@northwind.example',
      address: { line1: '1 Main St', line2: '', city: 'Chicago', state: 'IL', postal_code: '60601', country: 'US' },
      metadata: { kitstak_org_id: ORG },
    });

    calls.customerRetrieve.mockResolvedValue({ id: 'cus_1', metadata: { kitstak_org_id: ORG } });
    await expect(gateway.ensureCustomer({ orgId: ORG, existingCustomerId: 'cus_1', profile })).resolves.toEqual({ customerId: 'cus_1' });
    expect(calls.customerUpdate).toHaveBeenCalledTimes(1);

    calls.customerRetrieve.mockResolvedValue({ id: 'cus_other', metadata: { kitstak_org_id: '33333333-3333-4333-8333-333333333333' } });
    await expect(gateway.ensureCustomer({ orgId: ORG, existingCustomerId: 'cus_other', profile })).resolves.toEqual({ customerId: 'cus_new' });
    calls.customerRetrieve.mockResolvedValue({ id: 'cus_gone', deleted: true });
    await expect(gateway.ensureCustomer({ orgId: ORG, existingCustomerId: 'cus_gone', profile })).resolves.toEqual({ customerId: 'cus_new' });
  });
});

describe('Stripe adapter: webhooks', () => {
  it('a bad or missing signature throws WebhookSignatureError and never returns an event', () => {
    const { gateway, calls } = fakeStripe();
    calls.constructEvent.mockImplementation(() => {
      throw new Error('No signatures found matching the expected signature for payload.');
    });
    expect(() => gateway.verifyWebhook('{}', 't=1,v1=bad')).toThrow(WebhookSignatureError);
    expect(() => gateway.verifyWebhook('{}', null)).toThrow(WebhookSignatureError);
    expect(calls.constructEvent).toHaveBeenCalledTimes(1);
    expect(calls.constructEvent).toHaveBeenCalledWith('{}', 't=1,v1=bad', 'whsec_test');
  });

  it('refuses everything when the webhook secret is not set', () => {
    const { calls } = fakeStripe();
    const gateway = createStripeGateway({ ...CONFIG, stripeWebhookSecret: null }, { client: { webhooks: { constructEvent: calls.constructEvent } } as unknown as Stripe });
    expect(() => gateway.verifyWebhook('{}', 't=1,v1=x')).toThrow(WebhookSignatureError);
    expect(calls.constructEvent).not.toHaveBeenCalled();
  });

  it('reads the ids an event is about, whatever the object', () => {
    const { gateway, calls } = fakeStripe();
    const event = (type: string, object: Record<string, unknown>) => {
      calls.constructEvent.mockReturnValueOnce({ id: `evt_${type}`, type, created: unix(NOW), data: { object } });
      return gateway.verifyWebhook('raw', 'sig');
    };
    expect(event('checkout.session.completed', { id: 'cs_1', object: 'checkout.session', customer: 'cus_1', subscription: 'sub_1', client_reference_id: ORG, metadata: {} })).toMatchObject({
      id: 'evt_checkout.session.completed',
      orgId: ORG,
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      checkoutSessionId: 'cs_1',
      invoiceId: null,
      createdAt: NOW,
    });
    expect(event('customer.subscription.updated', { id: 'sub_1', object: 'subscription', customer: 'cus_1', metadata: { kitstak_org_id: ORG } })).toMatchObject({
      orgId: ORG,
      subscriptionId: 'sub_1',
      customerId: 'cus_1',
    });
    expect(
      event('invoice.paid', { id: 'in_1', object: 'invoice', customer: 'cus_1', metadata: null, parent: { subscription_details: { subscription: 'sub_1', metadata: { kitstak_org_id: ORG } } } }),
    ).toMatchObject({ orgId: ORG, invoiceId: 'in_1', subscriptionId: 'sub_1', customerId: 'cus_1' });
    expect(event('customer.updated', { id: 'cus_1', object: 'customer', metadata: {} })).toMatchObject({ orgId: null, customerId: 'cus_1', subscriptionId: null });
    // The old test subscription has `org_id`, never `kitstak_org_id`: no org, so it will be ignored.
    expect(event('customer.subscription.updated', { id: 'sub_old', object: 'subscription', customer: 'cus_old', metadata: { org_id: ORG, plan_key: 'starter' } }).orgId).toBeNull();
  });
});

describe('Stripe adapter: one plan per organization', () => {
  it('closes every open checkout page of the customer before a new one is made', async () => {
    const { gateway, calls } = fakeStripe();
    calls.checkoutList.mockResolvedValue({ data: [{ id: 'cs_old_1' }, { id: 'cs_old_2' }] });
    // One of them was paid a moment ago: Stripe refuses to expire it. That must not stop the rest.
    calls.checkoutExpire.mockImplementation(async (id: string) => {
      if (id === 'cs_old_1') throw new Error('This session is complete.');
      return {};
    });
    await expect(gateway.expireOpenCheckoutSessions('cus_1')).resolves.toBe(1);
    expect(calls.checkoutList.mock.calls[0]![0]).toEqual({ customer: 'cus_1', status: 'open', limit: 100 });
    expect(calls.checkoutExpire.mock.calls.map((call) => call[0])).toEqual(['cs_old_1', 'cs_old_2']);
  });

  it('cancels a second subscription with no final invoice and sends its payment back', async () => {
    const { gateway, calls } = fakeStripe();
    calls.subRetrieve.mockResolvedValue(subscription({ id: 'sub_2', latest_invoice: 'in_2' }));
    calls.invoiceRetrieve.mockResolvedValue({ id: 'in_2', status: 'paid', amount_paid: 2900, post_payment_credit_notes_amount: 0 });
    await expect(gateway.cancelAndRefund('sub_2')).resolves.toEqual({ refundedCents: 2900 });
    expect(calls.subCancel.mock.calls[0]).toEqual(['sub_2', { invoice_now: false, prorate: false }]);
    expect(calls.creditNoteCreate.mock.calls[0]![0]).toEqual({ invoice: 'in_2', amount: 2900, refund_amount: 2900, reason: 'duplicate' });
  });

  it('never refunds the same invoice twice, and voids one that was not paid yet', async () => {
    const { gateway, calls } = fakeStripe();
    calls.subRetrieve.mockResolvedValue(subscription({ id: 'sub_2', status: 'canceled', latest_invoice: 'in_2' }));
    calls.invoiceRetrieve.mockResolvedValue({ id: 'in_2', status: 'paid', amount_paid: 2900, post_payment_credit_notes_amount: 2900 });
    await expect(gateway.cancelAndRefund('sub_2')).resolves.toEqual({ refundedCents: 0 });
    expect(calls.subCancel).not.toHaveBeenCalled();
    expect(calls.creditNoteCreate).not.toHaveBeenCalled();

    calls.subRetrieve.mockResolvedValue(subscription({ id: 'sub_3', status: 'incomplete', latest_invoice: 'in_3' }));
    calls.invoiceRetrieve.mockResolvedValue({ id: 'in_3', status: 'open', amount_paid: 0 });
    await expect(gateway.cancelAndRefund('sub_3')).resolves.toEqual({ refundedCents: 0 });
    expect(calls.invoiceVoid).toHaveBeenCalledWith('in_3');
    expect(calls.creditNoteCreate).not.toHaveBeenCalled();
  });
});

describe('Stripe adapter: cancel with a bill open ends the plan now and drops the bill (review round 3)', () => {
  it('cancels with no final invoice and no proration, then voids every open invoice of the subscription', async () => {
    const { gateway, calls } = fakeStripe();
    calls.subRetrieve
      .mockResolvedValueOnce(subscription({ id: 'sub_1', status: 'past_due', latest_invoice: 'in_9' }))
      .mockResolvedValue(subscription({ id: 'sub_1', status: 'canceled', latest_invoice: 'in_9' }));
    calls.invoiceList.mockResolvedValue({ data: [{ id: 'in_9', status: 'open', amount_remaining: 34880, amount_due: 34880 }] });
    const result = await gateway.cancelNow('sub_1');
    expect(calls.subCancel.mock.calls).toEqual([['sub_1', { invoice_now: false, prorate: false }]]);
    expect(calls.invoiceList.mock.calls[0]![0]).toEqual({ subscription: 'sub_1', status: 'open', limit: 20 });
    expect(calls.invoiceVoid.mock.calls).toEqual([['in_9']]);
    expect(result.voidedCents).toBe(34880);
    expect(result.subscription.status).toBe('canceled');
    // Nothing is paid, nothing is refunded, no card is tried.
    expect(calls.invoicePay).not.toHaveBeenCalled();
    expect(calls.creditNoteCreate).not.toHaveBeenCalled();
  });

  it('is safe to call again: an ended subscription is not canceled twice, and a bill left open is still dropped', async () => {
    const { gateway, calls } = fakeStripe();
    calls.subRetrieve.mockResolvedValue(subscription({ id: 'sub_1', status: 'canceled', latest_invoice: 'in_9' }));
    calls.invoiceList.mockResolvedValue({ data: [{ id: 'in_9', status: 'open', amount_remaining: 5800 }, { id: 'in_8', status: 'open', amount_due: 1200 }] });
    await expect(gateway.cancelNow('sub_1')).resolves.toMatchObject({ voidedCents: 7000 });
    expect(calls.subCancel).not.toHaveBeenCalled();
    expect(calls.invoiceVoid.mock.calls.map((call) => call[0])).toEqual(['in_9', 'in_8']);

    calls.invoiceList.mockResolvedValue({ data: [] });
    calls.invoiceVoid.mockClear();
    await expect(gateway.cancelNow('sub_1')).resolves.toMatchObject({ voidedCents: 0 });
    expect(calls.invoiceVoid).not.toHaveBeenCalled();
  });
});

describe('Stripe adapter: the proration date comes from the server', () => {
  const previewInvoice = { total: -1000, amount_due: 0, lines: { data: [{ description: 'Unused time', amount: -1000, quantity: 1, proration: true }] } };

  it('uses a date up to a day ahead for a credit as it is', async () => {
    const { gateway, calls } = fakeStripe();
    calls.invoicePreview.mockResolvedValue(previewInvoice);
    const ahead = new Date(NOW.getTime() + 5 * 60 * 60 * 1000);
    const preview = await gateway.previewChange({ subscriptionId: 'sub_1', selection: { ...CRM5, seats: 4 }, prorationDate: ahead });
    expect(preview.prorationDate).toEqual(ahead);
    expect(preview).toMatchObject({ dueTodayCents: 0, creditCents: 1000, proratedCents: 0, creditAppliedCents: 0 });
    const details = calls.invoicePreview.mock.calls[0]![0].subscription_details;
    expect(details.proration_date).toBe(unix(ahead));
  });

  it('falls back to a date in the past when Stripe refuses a date ahead, and never before the whole day date', async () => {
    const { gateway, calls } = fakeStripe();
    const refused = { type: 'StripeInvalidRequestError', param: 'subscription_details[proration_date]', message: 'Invalid proration_date' };
    calls.invoicePreview.mockRejectedValueOnce(refused).mockResolvedValue(previewInvoice);
    const hour = 60 * 60 * 1000;
    const ahead = new Date(NOW.getTime() + 5 * hour);
    const preview = await gateway.previewChange({ subscriptionId: 'sub_1', selection: { ...CRM5, seats: 4 }, prorationDate: ahead });
    const startOfHour = Math.floor(NOW.getTime() / hour) * hour;
    expect(preview.prorationDate.getTime()).toBe(Math.max(startOfHour, ahead.getTime() - 24 * hour));
    expect(preview.prorationDate.getTime()).toBeLessThanOrEqual(NOW.getTime());
    // It remembers: the next call does not try the refused date again.
    await gateway.previewChange({ subscriptionId: 'sub_1', selection: { ...CRM5, seats: 4 }, prorationDate: ahead });
    expect(calls.invoicePreview).toHaveBeenCalledTimes(3);
    // Any other error is not swallowed.
    calls.invoicePreview.mockRejectedValue(new Error('Stripe is down'));
    await expect(gateway.previewChange({ subscriptionId: 'sub_1', selection: { ...CRM5, seats: 4 }, prorationDate: ahead })).rejects.toThrow('Stripe is down');
  });

  it('the change itself uses the very date its preview used', async () => {
    const { gateway, calls } = fakeStripe();
    calls.invoicePreview.mockResolvedValue({ total: 2900, amount_due: 2900, lines: { data: [{ description: '1 more', amount: 2900, quantity: 1, proration: true }] } });
    const day = new Date((unix(NOW) - 10 * DAY) * 1000);
    await gateway.applyChange({ subscriptionId: 'sub_1', selection: { ...CRM5, seats: 6 }, prorationDate: day });
    expect(calls.subUpdate.mock.calls[0]![1]).toMatchObject({ proration_date: unix(day), proration_behavior: 'always_invoice' });
  });
});
