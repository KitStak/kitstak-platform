/**
 * Real Stripe sandbox, flow 1: the free trial with no card, adding a card during the trial, and the
 * first real payment when the trial ends. Skipped unless STRIPE_SANDBOX=1 (see ./harness.ts).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getPlanState } from '../../src/server/state';
import { listInvoices } from '../../src/server/invoices';
import { startTrial } from '../../src/server/trial';
import { buyPlan, DAY_MS, HOUR_MS, openTestDb, Sandbox, SANDBOX_ENABLED, stripeApi } from './harness';

const test = SANDBOX_ENABLED ? await openTestDb() : null;
vi.setConfig({ testTimeout: 600_000, hookTimeout: 600_000 });

describe.skipIf(!SANDBOX_ENABLED || !test?.available)('Stripe sandbox: trial with no card, then the first payment', () => {
  let box: Sandbox;
  const selection = { products: ['crm'], seats: 2, warehouses: 1, interval: 'monthly' } as const;

  beforeAll(async () => {
    box = await Sandbox.create(test!, '01 trial and first payment');
  });

  afterAll(async () => {
    await box?.dispose();
    await test?.pool.end();
  });

  it('starts a 14 day trial with no card and no Stripe object', async () => {
    const started = await startTrial(box.rt, { orgId: box.org.orgId, selection, actor: box.actor });
    expect(started.ok).toBe(true);
    const rows = await box.entitlements();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ module: 'crm', status: 'trialing', source: 'trial', seats: 2, stripe_subscription_id: null });
    expect(new Date(rows[0]!.current_period_end).getTime()).toBe(box.now().getTime() + 14 * DAY_MS);
    // No customer was made at Stripe: a trial needs no gateway.
    expect(await box.rows(`select 1 from core.stripe_customers where org_id = $1`, [box.org.orgId])).toHaveLength(0);
    const found = await stripeApi('GET', '/v1/customers/search', { query: `metadata['kitstak_org_id']:'${box.org.orgId}'` });
    expect(found.data).toHaveLength(0);
    expect(await box.emailTemplates()).toEqual(['welcome']);
    expect(await box.auditActions()).toEqual(['trial.started']);
  });

  it('adding a card during the trial makes a real Checkout Session and keeps every trial day', async () => {
    const trialEndsAt = new Date((await box.entitlements())[0]!.current_period_end);
    const bought = await buyPlan(box, selection);
    box.note('checkoutSessionId', bought.sessionId);
    box.note('subscriptionId', bought.subscription.id);

    // The session the app made is a real one, for this organization, on Stripe's pay page.
    const session = await stripeApi('GET', `/v1/checkout/sessions/${bought.sessionId}`);
    expect(session.livemode).toBe(false);
    expect(session.mode).toBe('subscription');
    expect(session.client_reference_id).toBe(box.org.orgId);
    expect(session.metadata.kitstak_org_id).toBe(box.org.orgId);
    expect(session.customer).toBe(box.customerId);
    expect(session.allow_promotion_codes).toBe(true);
    expect(String(session.success_url)).toBe('http://localhost:3300/billing/checkout/success?session_id={CHECKOUT_SESSION_ID}');

    // Stripe: a trialing subscription that ends the trial on the same day our trial ends.
    const subscription = await stripeApi('GET', `/v1/subscriptions/${String(bought.subscription.id)}`);
    expect(subscription.status).toBe('trialing');
    expect(subscription.trial_end * 1000).toBe(trialEndsAt.getTime());
    expect(subscription.items.data[0].price.lookup_key).toBe('kitstak_crm_monthly');
    expect(subscription.items.data[0].quantity).toBe(2);

    // Every event went through the real handler without a failure.
    expect(bought.delivered.filter((event) => event.outcome.status !== 200)).toEqual([]);
    box.note('eventsAtCheckout', bought.delivered.map((event) => `${event.type}:${event.outcome.result}`));

    const row = await box.subscriptionRow();
    expect(row).toMatchObject({
      gateway: 'stripe',
      gateway_subscription_id: subscription.id,
      gateway_customer_id: box.customerId,
      status: 'trialing',
      interval: 'monthly',
      seats: 2,
      recurring_cents: subscription.items.data[0].price.unit_amount * 2,
      pm_brand: 'visa',
      pm_last4: '4242',
    });
    expect(new Date(row!.trial_end).getTime()).toBe(trialEndsAt.getTime());
    // What the first bill will charge is Stripe's own number.
    expect(row!.next_charge_cents).toBe(row!.recurring_cents);

    const rows = await box.entitlements();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ module: 'crm', status: 'active', source: 'stripe', seats: 2, stripe_subscription_id: subscription.id });
    expect(new Date(rows[0]!.current_period_end).getTime()).toBe(trialEndsAt.getTime());

    // The $0.00 invoice of the trial start is stored and is not shown as a bill.
    expect((await box.invoices()).map((invoice) => [invoice.status, invoice.total_cents, invoice.billing_reason])).toEqual([['paid', 0, 'subscription_create']]);
    expect(await listInvoices(box.rt.db, { orgId: box.org.orgId })).toHaveLength(0);

    expect(await box.emailTemplates()).toEqual(['welcome', 'plan_started']);
    const started = (await box.emails())[1]!;
    expect(started.payload).toMatchObject({ dueTodayCents: 0, totalCents: row!.recurring_cents, firstChargeCents: row!.recurring_cents });
    expect(await box.auditActions()).toEqual(['trial.started', 'checkout.started', 'plan.started']);

    // A card is saved and the first charge is still ahead: the plan is active and the trial days are kept.
    const state = await getPlanState(box.rt, box.org.orgId);
    expect(state.phase).toBe('active');
    expect(state.trial?.endsAt.getTime()).toBe(trialEndsAt.getTime());
    expect(state.nextCharge).toMatchObject({ amountCents: row!.recurring_cents });
    expect(state.nextCharge?.at.getTime()).toBe(trialEndsAt.getTime());
  });

  it('charges the card for the first time when the trial ends', async () => {
    const before = await box.subscriptionRow();
    const trialEnd = new Date(before!.trial_end);
    // Stripe makes the invoice at the trial end and charges it about an hour later.
    await box.advanceTo(new Date(trialEnd.getTime() + 2 * HOUR_MS));
    const delivered = await box.sync();
    expect(delivered.filter((event) => event.outcome.status !== 200)).toEqual([]);
    box.note('eventsAtTrialEnd', delivered.map((event) => `${event.type}:${event.outcome.result}`));

    const subscription = await stripeApi('GET', `/v1/subscriptions/${String(before!.gateway_subscription_id)}`);
    expect(subscription.status).toBe('active');
    const invoice = await stripeApi('GET', `/v1/invoices/${String(subscription.latest_invoice)}`);
    expect(invoice.status).toBe('paid');
    expect(invoice.amount_paid).toBe(before!.recurring_cents);
    box.note('firstPaidInvoiceId', invoice.id);

    const row = await box.subscriptionRow();
    expect(row).toMatchObject({ status: 'active', latest_invoice_id: invoice.id, past_due_since: null });
    const periodEnd = subscription.items.data[0].current_period_end * 1000;
    expect(new Date(row!.current_period_end).getTime()).toBe(periodEnd);

    const rows = await box.entitlements();
    expect(rows[0]).toMatchObject({ module: 'crm', status: 'active', source: 'stripe', seats: 2 });
    expect(new Date(rows[0]!.current_period_end).getTime()).toBe(periodEnd);

    const stored = (await box.invoices()).find((entry) => entry.id === invoice.id);
    expect(stored).toMatchObject({
      status: 'paid',
      number: invoice.number,
      total_cents: before!.recurring_cents,
      amount_paid_cents: before!.recurring_cents,
      amount_due_cents: 0,
      pm_last4: '4242',
      billing_reason: 'subscription_cycle',
    });
    const shown = await listInvoices(box.rt.db, { orgId: box.org.orgId });
    expect(shown.map((entry) => entry.id)).toEqual([invoice.id]);
    expect(shown[0]!.lines[0]).toMatchObject({ product: 'crm', quantity: 2, proration: false });

    expect(await box.emailTemplates()).toEqual(['welcome', 'plan_started', 'receipt']);
    const receipt = (await box.emails())[2]!;
    expect(receipt.payload).toMatchObject({ invoiceId: invoice.id, amountPaidCents: before!.recurring_cents, last4: '4242' });
    expect(await box.auditActions()).toContain('payment.succeeded');
    expect((await getPlanState(box.rt, box.org.orgId)).phase).toBe('active');
  });
});
