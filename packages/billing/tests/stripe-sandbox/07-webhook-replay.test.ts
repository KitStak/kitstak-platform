/**
 * Real Stripe sandbox, flow 7: the webhook door under stress. Every real event delivered a second
 * time changes nothing. Real events delivered newest first end in the same state as Stripe has. A
 * second paid subscription for one organization is canceled and refunded. Skipped unless
 * STRIPE_SANDBOX=1 (see ./harness.ts).
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { CATALOG } from '../../src/catalog';
import { scheduleCancel } from '../../src/server/cancel';
import { buyPlan, CANCEL_NEEDS_APPROVAL, changePlan, failures, itemKeys, type Json, openCheckout, openTestDb, Sandbox, SANDBOX_ENABLED, stripeApi, stripeSubscription } from './harness';

const test = SANDBOX_ENABLED ? await openTestDb() : null;
vi.setConfig({ testTimeout: 900_000, hookTimeout: 900_000 });
const CRM = CATALOG.products.crm.cents;
const boxes: Sandbox[] = [];

/** Everything billing stores for an organization, without the columns that only say when a row was touched. */
async function snapshot(box: Sandbox): Promise<Json> {
  const strip = (row: Json | undefined): Json | undefined => {
    if (!row) return row;
    const { updated_at: _u, gateway_synced_at: _g, created_at: _c, ...rest } = row;
    return rest;
  };
  return {
    subscription: strip(await box.subscriptionRow()),
    entitlements: await box.entitlements(),
    invoices: (await box.invoices()).map(strip),
    emails: (await box.emails()).map((email) => `${String(email.template)} ${String(email.dedupe_key)}`),
    audit: (await box.audit()).map((entry) => `${String(entry.action)} ${String(entry.summary)}`),
    ledger: (await box.ledger()).map((entry) => `${String(entry.id)} ${String(entry.status)} ${String(entry.attempts)}`),
  };
}

describe.skipIf(!SANDBOX_ENABLED || !test?.available)('Stripe sandbox: webhook replay, order and a second payment', () => {
  afterAll(async () => {
    for (const box of boxes) await box.dispose();
    await test?.pool.end();
  });

  it('every real event delivered a second time is a duplicate and changes nothing', async () => {
    const box = await Sandbox.create(test!, '07a replay twice');
    boxes.push(box);
    const bought = await buyPlan(box, { products: ['crm'], seats: 2, warehouses: 1, interval: 'monthly' });
    expect(failures(bought.delivered)).toEqual([]);
    const changed = await changePlan(box, { products: ['crm'], seats: 4, warehouses: 1, interval: 'monthly' });
    expect(failures(changed.delivered)).toEqual([]);
    expect((await scheduleCancel(box.rt, { orgId: box.org.orgId, reason: null, detail: null, actor: box.actor })).ok).toBe(true);
    expect(failures(await box.sync())).toEqual([]);

    const before = await snapshot(box);
    expect(box.history.length).toBeGreaterThan(15);
    box.note('eventsReplayed', box.history.length);

    const again = await box.deliver(box.history);
    expect(again.map((event) => event.outcome.status)).toEqual(box.history.map(() => 200));
    expect(new Set(again.map((event) => event.outcome.result))).toEqual(new Set(['duplicate']));
    expect(await snapshot(box)).toEqual(before);

    // And a third time, newest first.
    const third = await box.deliver([...box.history].reverse());
    expect(new Set(third.map((event) => event.outcome.result))).toEqual(new Set(['duplicate']));
    expect(await snapshot(box)).toEqual(before);
    // One row per event in the ledger, each tried once.
    expect((await box.ledger()).every((entry) => entry.attempts === 1)).toBe(true);
    expect(await box.ledger()).toHaveLength(box.history.length);
  });

  it('a bad signature is refused and writes nothing', async () => {
    const box = boxes[0]!;
    const event = box.history[0]!;
    const { processWebhook } = await import('../../src/server/webhook');
    const { signStripePayload } = await import('../../scripts/stripe-events-lib');
    const rawBody = JSON.stringify({ ...event, id: `${event.id}_forged` });
    const wrongSecret = await processWebhook(box.rt, { rawBody, signature: signStripePayload(rawBody, 'whsec_someone_else', Math.floor(Date.now() / 1000)) });
    expect(wrongSecret).toEqual({ status: 400, result: 'bad_signature' });
    const oldStamp = await processWebhook(box.rt, { rawBody, signature: signStripePayload(rawBody, box.webhookSecret, Math.floor(Date.now() / 1000) - 3600) });
    expect(oldStamp).toEqual({ status: 400, result: 'bad_signature' });
    expect(await processWebhook(box.rt, { rawBody, signature: null })).toEqual({ status: 400, result: 'bad_signature' });
    expect(await box.rows(`select 1 from core.billing_events where id = $1`, [`${event.id}_forged`])).toEqual([]);
  });

  it('real events delivered newest first end in the state Stripe has', async () => {
    const box = await Sandbox.create(test!, '07b out of order');
    boxes.push(box);
    await box.createCustomerOnClock();
    const checkout = await openCheckout(box, { products: ['crm'], seats: 2, warehouses: 1, interval: 'monthly' });
    // Everything below happens at Stripe only. Our tables hear of it through the events, in the wrong order.
    const made = await box.subscribeLikeCheckout({ sessionId: checkout.sessionId, trialEnd: null, card: 'pm_card_visa' });
    await stripeApi('POST', `/v1/checkout/sessions/${checkout.sessionId}/expire`);
    const subscriptionId = String(made.id);
    box.note('subscriptionId', subscriptionId);
    const item = String(made.items.data[0].id);
    await stripeApi('POST', `/v1/subscriptions/${subscriptionId}`, { items: [{ id: item, quantity: 5 }], proration_behavior: 'always_invoice' });
    const mastercard = await box.attachCard('pm_card_mastercard');
    await stripeApi('POST', `/v1/customers/${box.customerId}`, { invoice_settings: { default_payment_method: mastercard } });
    await stripeApi('POST', `/v1/subscriptions/${subscriptionId}`, { cancel_at_period_end: true });

    const events = await box.pullEvents();
    expect(events.length).toBeGreaterThan(12);
    box.note('eventsInOrder', events.map((event) => event.type));
    const reversed = await box.deliver([...events].reverse());
    expect(failures(reversed)).toEqual([]);
    box.note('eventsNewestFirst', reversed.map((event) => `${event.type}:${event.outcome.result}`));

    const subscription = await stripeSubscription(subscriptionId);
    expect(itemKeys(subscription)).toEqual(['kitstak_crm_monthly:5']);
    const row = await box.subscriptionRow();
    expect(row).toMatchObject({
      gateway_subscription_id: subscriptionId,
      status: 'active',
      seats: 5,
      recurring_cents: 5 * CRM.monthly,
      latest_invoice_id: subscription.latest_invoice,
      pm_brand: 'mastercard',
      pm_last4: '4444',
    });
    expect(row!.cancel_at_period_end || row!.cancel_at !== null).toBe(true);
    // The adapter moved the new card onto the plan, whatever order the events came in.
    expect((await stripeSubscription(subscriptionId)).default_payment_method).toBe(mastercard);
    expect(await box.entitlements()).toMatchObject([{ module: 'crm', status: 'active', source: 'stripe', seats: 5 }]);

    const atStripe = (await stripeApi('GET', '/v1/invoices', { customer: box.customerId, limit: 20 })).data as Json[];
    const stored = await box.invoices();
    expect(stored.map((invoice) => invoice.id).sort()).toEqual(atStripe.map((invoice) => String(invoice.id)).sort());
    for (const invoice of atStripe) {
      expect(stored.find((entry) => entry.id === invoice.id)).toMatchObject({ status: invoice.status, total_cents: invoice.total, amount_paid_cents: invoice.amount_paid });
    }
    // Each thing was said once: one "plan started", one receipt and one payment line per paid bill.
    const templates = await box.emailTemplates();
    expect(templates.filter((template) => template === 'plan_started')).toHaveLength(1);
    expect(templates.filter((template) => template === 'receipt')).toHaveLength(2);
    expect(templates.filter((template) => template === 'payment_failed' || template === 'payment_action_required')).toEqual([]);
    const actions = await box.auditActions();
    expect(actions.filter((action) => action === 'plan.started')).toHaveLength(1);
    expect(actions.filter((action) => action === 'payment.succeeded')).toHaveLength(2);
    expect(actions.filter((action) => action === 'checkout.expired')).toEqual([]);

    // The same events again, now in the right order: all duplicates, nothing moves.
    const before = await snapshot(box);
    const inOrder = await box.deliver(events);
    expect(new Set(inOrder.map((event) => event.outcome.result))).toEqual(new Set(['duplicate']));
    expect(await snapshot(box)).toEqual(before);
  });

  it.skipIf(CANCEL_NEEDS_APPROVAL)('a second paid subscription for the same organization is canceled and its payment sent back', async () => {
    const box = await Sandbox.create(test!, '07c second payment refunded');
    boxes.push(box);
    const bought = await buyPlan(box, { products: ['crm'], seats: 2, warehouses: 1, interval: 'monthly' });
    expect(failures(bought.delivered)).toEqual([]);
    const first = String(bought.subscription.id);
    const price = String(bought.subscription.items.data[0].price.id);
    // A second pay page was paid too (two tabs). Stripe now has two live subscriptions for one organization.
    const second = await stripeApi('POST', '/v1/subscriptions', {
      customer: box.customerId,
      items: [{ price, quantity: 3 }],
      metadata: { kitstak_org_id: box.org.orgId },
      default_payment_method: String(bought.subscription.default_payment_method),
    });
    expect(second.status).toBe('active');
    const delivered = await box.sync();
    expect(failures(delivered)).toEqual([]);
    expect(failures(await box.sync())).toEqual([]);
    box.note('secondSubscriptionId', second.id);

    expect((await stripeSubscription(String(second.id))).status).toBe('canceled');
    expect((await stripeSubscription(first)).status).toBe('active');
    const invoice = await stripeApi('GET', `/v1/invoices/${String(second.latest_invoice)}`);
    expect(invoice.post_payment_credit_notes_amount).toBe(3 * CRM.monthly);
    const refunds = await stripeApi('GET', '/v1/refunds', { limit: 5 });
    expect((refunds.data as Json[]).some((refund) => refund.amount === 3 * CRM.monthly && refund.status === 'succeeded')).toBe(true);

    // Our plan is still the first one, untouched.
    expect(await box.subscriptionRow()).toMatchObject({ gateway_subscription_id: first, status: 'active', seats: 2 });
    expect(await box.entitlements()).toMatchObject([{ module: 'crm', status: 'active', seats: 2 }]);
    const line = (await box.audit()).filter((entry) => entry.action === 'checkout.duplicate_refunded');
    expect(line).toHaveLength(1);
    expect(String(line[0]!.summary)).toContain('A second payment of $87.00 came in for a plan you already have. We canceled it and sent the money back.');
    expect((await box.invoices()).find((entry) => entry.id === invoice.id)).toMatchObject({ refunded_cents: 3 * CRM.monthly });
    // No receipt for the payment that was sent back.
    const receipts = (await box.emails()).filter((email) => email.template === 'receipt').map((email) => email.payload.invoiceId);
    expect(receipts).not.toContain(invoice.id);
  });
});
