/**
 * Real Stripe sandbox, flow 2: a first payment with no trial left. A declined card and a card that
 * needs bank approval (3D Secure) must grant nothing; a good card starts the plan. Skipped unless
 * STRIPE_SANDBOX=1 (see ./harness.ts).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { listInvoices } from '../../src/server/invoices';
import { getPlanState } from '../../src/server/state';
import { type Json, openCheckout, openTestDb, Sandbox, SANDBOX_ENABLED, StripeApiError, stripeApi } from './harness';

const test = SANDBOX_ENABLED ? await openTestDb() : null;
vi.setConfig({ testTimeout: 600_000, hookTimeout: 600_000 });

describe.skipIf(!SANDBOX_ENABLED || !test?.available)('Stripe sandbox: first payment, declined card, 3D Secure', () => {
  let box: Sandbox;
  let subscription: Json;
  let invoiceId = '';
  let intentId = '';
  const selection = { products: ['crm'], seats: 3, warehouses: 1, interval: 'monthly' } as const;

  beforeAll(async () => {
    box = await Sandbox.create(test!, '02 first payment declined and 3ds');
    await box.createCustomerOnClock();
  });

  afterAll(async () => {
    await box?.dispose();
    await test?.pool.end();
  });

  it('a pay page that is open and not paid grants nothing', async () => {
    const checkout = await openCheckout(box, selection);
    expect(checkout.dueTodayCents).toBeGreaterThan(0);
    box.note('checkoutSessionId', checkout.sessionId);
    subscription = await box.subscribeLikeCheckout({ sessionId: checkout.sessionId, trialEnd: null, incomplete: true });
    expect(subscription.status).toBe('incomplete');
    invoiceId = String(subscription.latest_invoice);
    intentId = await box.paymentIntentOf(invoiceId);
    box.note('subscriptionId', subscription.id);
    box.note('firstInvoiceId', invoiceId);
    box.note('paymentIntentId', intentId);

    const delivered = await box.sync();
    expect(delivered.filter((event) => event.outcome.status !== 200)).toEqual([]);
    expect(await box.subscriptionRow()).toMatchObject({ status: 'incomplete', gateway_subscription_id: subscription.id });
    expect(await box.entitlements()).toEqual([]);
    expect(await box.emailTemplates()).toEqual([]);
    expect((await getPlanState(box.rt, box.org.orgId)).phase).toBe('none');
  });

  it('a declined card grants nothing and sends no late payment mail', async () => {
    const declined = await stripeApi('POST', `/v1/payment_intents/${intentId}/confirm`, { payment_method: 'pm_card_chargeDeclined' }).catch((error: unknown) => error);
    expect(declined).toBeInstanceOf(StripeApiError);
    expect((declined as StripeApiError).code).toBe('card_declined');

    const delivered = await box.sync();
    box.note('eventsAfterDecline', delivered.map((event) => `${event.type}:${event.outcome.result}`));
    expect(delivered.filter((event) => event.outcome.status !== 200)).toEqual([]);
    expect(delivered.map((event) => event.type)).toContain('invoice.payment_failed');

    expect((await stripeApi('GET', `/v1/subscriptions/${String(subscription.id)}`)).status).toBe('incomplete');
    expect(await box.subscriptionRow()).toMatchObject({ status: 'incomplete' });
    expect(await box.entitlements()).toEqual([]);
    // A first payment that fails is shown on the pay page. No "your payment is late" mail goes out.
    expect(await box.emailTemplates()).toEqual([]);
    expect((await getPlanState(box.rt, box.org.orgId)).phase).toBe('none');
  });

  it('a card that needs bank approval grants nothing until the bank step is done', async () => {
    const pending = await stripeApi('POST', `/v1/payment_intents/${intentId}/confirm`, {
      payment_method: 'pm_card_authenticationRequired',
      return_url: 'http://localhost:3300/billing',
    });
    expect(pending.status).toBe('requires_action');
    box.note('threeDSecureNextAction', String(pending.next_action?.type));

    const delivered = await box.sync();
    box.note('eventsAfter3ds', delivered.map((event) => `${event.type}:${event.outcome.result}`));
    expect(delivered.filter((event) => event.outcome.status !== 200)).toEqual([]);
    expect(delivered.map((event) => event.type)).toContain('invoice.payment_action_required');

    expect((await stripeApi('GET', `/v1/subscriptions/${String(subscription.id)}`)).status).toBe('incomplete');
    expect(await box.subscriptionRow()).toMatchObject({ status: 'incomplete' });
    expect(await box.entitlements()).toEqual([]);
    // The person is on the pay page and the bank step is in front of them. An email that says
    // "approve a payment" for a plan that has not started would only confuse.
    expect(await box.emailTemplates()).toEqual([]);
  });

  it('a good card pays the first bill and starts the plan', async () => {
    const paid = await stripeApi('POST', `/v1/payment_intents/${intentId}/confirm`, { payment_method: 'pm_card_visa' });
    expect(paid.status).toBe('succeeded');

    const delivered = await box.sync();
    box.note('eventsAfterPayment', delivered.map((event) => `${event.type}:${event.outcome.result}`));
    expect(delivered.filter((event) => event.outcome.status !== 200)).toEqual([]);

    const live = await stripeApi('GET', `/v1/subscriptions/${String(subscription.id)}`);
    expect(live.status).toBe('active');
    const invoice = await stripeApi('GET', `/v1/invoices/${invoiceId}`);
    expect(invoice.status).toBe('paid');
    const total = live.items.data[0].price.unit_amount * 3;
    expect(invoice.amount_paid).toBe(total);

    expect(await box.subscriptionRow()).toMatchObject({ status: 'active', seats: 3, recurring_cents: total, pm_last4: '4242', latest_invoice_id: invoiceId });
    const rows = await box.entitlements();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ module: 'crm', status: 'active', source: 'stripe', seats: 3, stripe_subscription_id: live.id });
    expect(new Date(rows[0]!.current_period_end).getTime()).toBe(live.items.data[0].current_period_end * 1000);

    const shown = await listInvoices(box.rt.db, { orgId: box.org.orgId });
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ id: invoiceId, status: 'paid', totalCents: total, amountPaidCents: total, amountDueCents: 0, paymentMethodLast4: '4242' });

    expect(await box.emailTemplates()).toEqual(['plan_started', 'receipt']);
    const emails = await box.emails();
    expect(emails[0]!.payload).toMatchObject({ dueTodayCents: total, totalCents: total, interval: 'monthly' });
    expect(emails[1]!.payload).toMatchObject({ invoiceId, amountPaidCents: total, last4: '4242' });
    const actions = await box.auditActions();
    expect(actions).toContain('plan.started');
    expect(actions.filter((action) => action === 'payment.succeeded')).toHaveLength(1);
    expect((await getPlanState(box.rt, box.org.orgId)).phase).toBe('active');
  });
});
