/**
 * Real Stripe sandbox, flow 4: pausing a monthly plan. The pause is set, taken back, set again, runs
 * past the end of the paid month (apps turn view only, nothing is charged), and is then ended early
 * with "Start again now", which must bill a new month today. Skipped unless STRIPE_SANDBOX=1.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CATALOG } from '../../src/catalog';
import { pausePlan, undoPause } from '../../src/server/cancel';
import { getPlanState } from '../../src/server/state';
import { buyPlan, failures, HOUR_MS, type Json, openTestDb, Sandbox, SANDBOX_ENABLED, stripeApi, stripeSubscription } from './harness';

const test = SANDBOX_ENABLED ? await openTestDb() : null;
vi.setConfig({ testTimeout: 900_000, hookTimeout: 900_000 });
const CRM = CATALOG.products.crm.cents;

describe.skipIf(!SANDBOX_ENABLED || !test?.available)('Stripe sandbox: pause and start again', () => {
  let box: Sandbox;
  let subscriptionId = '';
  let periodEnd = 0;

  beforeAll(async () => {
    box = await Sandbox.create(test!, '04 pause');
    const bought = await buyPlan(box, { products: ['crm'], seats: 2, warehouses: 1, interval: 'monthly' });
    expect(failures(bought.delivered)).toEqual([]);
    subscriptionId = String(bought.subscription.id);
    box.note('subscriptionId', subscriptionId);
    periodEnd = new Date((await box.subscriptionRow())!.current_period_end).getTime();
  });

  afterAll(async () => {
    await box?.dispose();
  });

  it('a pause is set for the end of the paid month and can be taken back', async () => {
    const paused = await pausePlan(box.rt, { orgId: box.org.orgId, months: 1, reason: 'seasonal', actor: box.actor });
    expect(paused.ok).toBe(true);
    if (paused.ok) expect(paused.data.phase).toBe('pause_scheduled');
    let subscription = await stripeSubscription(subscriptionId);
    expect(subscription.status).toBe('active');
    expect(subscription.pause_collection).toMatchObject({ behavior: 'void' });
    const resumesAt = subscription.pause_collection.resumes_at * 1000;
    box.note('pauseResumesAt', new Date(resumesAt).toISOString());

    let row = await box.subscriptionRow();
    expect(new Date(row!.pause_starts_at).getTime()).toBe(periodEnd);
    expect(new Date(row!.pause_resumes_at).getTime()).toBe(resumesAt);
    // Until the paid month ends, nothing changes for the people who use the apps: the row says the
    // plan will not renew, and its end date is still ahead, so access stays full.
    const scheduled = await box.entitlements();
    expect(scheduled).toMatchObject([{ module: 'crm', status: 'canceled', source: 'stripe' }]);
    expect(new Date(scheduled[0]!.current_period_end).getTime()).toBe(periodEnd);
    if (paused.ok) expect(paused.data.modules.crm.access).toBe('full');
    expect(await box.emailTemplates()).toContain('paused');
    expect(await box.auditActions()).toContain('pause.scheduled');
    expect(failures(await box.sync())).toEqual([]);

    const undone = await undoPause(box.rt, { orgId: box.org.orgId, actor: box.actor });
    expect(undone.ok).toBe(true);
    if (undone.ok) expect(undone.data.phase).toBe('active');
    subscription = await stripeSubscription(subscriptionId);
    expect(subscription.pause_collection).toBeNull();
    row = await box.subscriptionRow();
    expect(row!.pause_resumes_at).toBeNull();
    expect(await box.entitlements()).toMatchObject([{ module: 'crm', status: 'active', source: 'stripe' }]);
    expect(await box.auditActions()).toContain('pause.undone');
    expect(failures(await box.sync())).toEqual([]);
  });

  it('when the paid month ends, a paused plan charges nothing and the apps are view only', async () => {
    const paused = await pausePlan(box.rt, { orgId: box.org.orgId, months: 1, reason: null, actor: box.actor });
    expect(paused.ok).toBe(true);
    const paidBefore = (await stripeApi('GET', '/v1/charges', { customer: box.customerId, limit: 20 })).data.length;

    await box.advanceTo(new Date(periodEnd + 2 * HOUR_MS));
    const delivered = await box.sync();
    expect(failures(delivered)).toEqual([]);
    box.note('eventsWhenPauseBegan', delivered.map((event) => `${event.type}:${event.outcome.result}`));

    const subscription = await stripeSubscription(subscriptionId);
    expect(subscription.status).toBe('active');
    expect(subscription.pause_collection).not.toBeNull();
    // Stripe made the invoice of the new month and dropped it. No charge was tried.
    const invoice = await stripeApi('GET', `/v1/invoices/${String(subscription.latest_invoice)}`);
    expect(invoice.status).toBe('void');
    expect(invoice.amount_paid).toBe(0);
    expect((await stripeApi('GET', '/v1/charges', { customer: box.customerId, limit: 20 })).data.length).toBe(paidBefore);
    box.note('voidedInvoiceDuringPause', invoice.id);

    const row = await box.subscriptionRow();
    expect(row).toMatchObject({ status: 'active' });
    expect(new Date(row!.pause_starts_at).getTime()).toBe(periodEnd);
    const rows = await box.entitlements();
    expect(rows).toMatchObject([{ module: 'crm', status: 'canceled', source: 'stripe' }]);
    expect(new Date(rows[0]!.current_period_end).getTime()).toBe(periodEnd);
    expect(await box.auditActions()).toContain('plan.paused');
    const state = await getPlanState(box.rt, box.org.orgId);
    expect(state.phase).toBe('paused');
    expect(state.modules.crm.access).toBe('read_only');
    // The dropped invoice is kept, as void, and no receipt and no "payment failed" mail went out for it.
    expect((await box.invoices()).find((entry) => entry.id === invoice.id)).toMatchObject({ status: 'void' });
    expect((await box.emailTemplates()).filter((template) => template === 'payment_failed')).toEqual([]);
  });

  it('"Start again now" with a card that fails charges nothing and leaves the plan paused', async () => {
    const good = String((await stripeSubscription(subscriptionId)).default_payment_method);
    const bad = await box.attachCard('pm_card_chargeCustomerFail');
    await stripeApi('POST', `/v1/subscriptions/${subscriptionId}`, { default_payment_method: bad });
    const openBefore = (await stripeApi('GET', '/v1/invoices', { customer: box.customerId, status: 'open', limit: 10 })).data.length;

    const refused = await undoPause(box.rt, { orgId: box.org.orgId, actor: box.actor });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe('card_declined');

    const subscription = await stripeSubscription(subscriptionId);
    expect(subscription.pause_collection).not.toBeNull();
    // Nothing is left that could be charged later.
    expect((await stripeApi('GET', '/v1/invoices', { customer: box.customerId, status: 'open', limit: 10 })).data.length).toBe(openBefore);
    expect((await stripeApi('GET', '/v1/invoiceitems', { customer: box.customerId, pending: true, limit: 10 })).data).toEqual([]);
    expect(failures(await box.sync())).toEqual([]);
    expect((await getPlanState(box.rt, box.org.orgId)).phase).toBe('paused');
    expect(await box.entitlements()).toMatchObject([{ module: 'crm', status: 'canceled' }]);
    // A failed try to start again is not a late payment: no "payment failed" mail.
    expect((await box.emailTemplates()).filter((template) => template === 'payment_failed')).toEqual([]);

    await stripeApi('POST', `/v1/subscriptions/${subscriptionId}`, { default_payment_method: good });
    expect(failures(await box.sync())).toEqual([]);
  });

  it('"Start again now" ends the pause, bills a new month today and starts it today', async () => {
    const resumed = await undoPause(box.rt, { orgId: box.org.orgId, actor: box.actor });
    expect(resumed.ok).toBe(true);
    const delivered = await box.sync();
    expect(failures(delivered)).toEqual([]);
    box.note('eventsAfterStartAgain', delivered.map((event) => `${event.type}:${event.outcome.result}`));

    const subscription = await stripeSubscription(subscriptionId);
    expect(subscription.status).toBe('active');
    expect(subscription.pause_collection).toBeNull();
    const item = subscription.items.data[0] as Json;
    // A new month from today.
    expect(item.current_period_start * 1000).toBe(box.now().getTime());
    const paid = (await stripeApi('GET', '/v1/invoices', { customer: box.customerId, status: 'paid', limit: 10 })).data as Json[];
    const invoice = paid.find((entry) => entry.metadata?.kitstak_restart === subscriptionId)!;
    expect(invoice).toBeDefined();
    box.note('startAgainInvoice', { id: invoice.id, number: invoice.number, status: invoice.status, total: invoice.total, amountPaid: invoice.amount_paid, reason: invoice.billing_reason });
    // The month is paid for today, in full. (Left to Stripe, this month was free.)
    expect(invoice.amount_paid).toBe(2 * CRM.monthly);
    expect(invoice.lines.data).toHaveLength(1);
    expect(invoice.lines.data[0]).toMatchObject({ amount: 2 * CRM.monthly, quantity: 2 });
    expect(invoice.lines.data[0].period.start * 1000).toBe(box.now().getTime());
    expect(invoice.lines.data[0].period.end).toBe(item.current_period_end);
    // Nothing waits, so the next renewal bills one month and no more.
    expect((await stripeApi('GET', '/v1/invoiceitems', { customer: box.customerId, pending: true, limit: 10 })).data).toEqual([]);
    const upcoming = await stripeApi('POST', '/v1/invoices/create_preview', { customer: box.customerId, subscription: subscriptionId });
    expect(upcoming.total).toBe(2 * CRM.monthly);

    const row = await box.subscriptionRow();
    expect(row).toMatchObject({ status: 'active', pause_starts_at: null, pause_resumes_at: null, next_charge_cents: 2 * CRM.monthly });
    expect(new Date(row!.current_period_end).getTime()).toBe(item.current_period_end * 1000);
    const rows = await box.entitlements();
    expect(rows).toMatchObject([{ module: 'crm', status: 'active', source: 'stripe', seats: 2 }]);
    expect(new Date(rows[0]!.current_period_end).getTime()).toBe(item.current_period_end * 1000);
    const actions = await box.auditActions();
    expect(actions).toContain('pause.undone');
    expect(actions).toContain('plan.resumed');
    const stored = (await box.invoices()).find((entry) => entry.id === invoice.id);
    expect(stored).toMatchObject({ status: 'paid', total_cents: 2 * CRM.monthly, amount_paid_cents: 2 * CRM.monthly, pm_last4: '4242' });
    expect((stored!.lines as Json[])[0]).toMatchObject({ product: 'crm', quantity: 2, unitCents: CRM.monthly, proration: false });
    const receipts = (await box.emails()).filter((email) => email.template === 'receipt');
    expect(receipts.map((email) => email.payload.invoiceId)).toContain(invoice.id);
    expect((await getPlanState(box.rt, box.org.orgId)).phase).toBe('active');
  });
});

describe.skipIf(!SANDBOX_ENABLED || !test?.available)('Stripe sandbox: a pause that runs its full time', () => {
  let box: Sandbox;
  let subscriptionId = '';

  beforeAll(async () => {
    box = await Sandbox.create(test!, '04b pause runs out');
    const bought = await buyPlan(box, { products: ['crm'], seats: 1, warehouses: 1, interval: 'monthly' });
    expect(failures(bought.delivered)).toEqual([]);
    subscriptionId = String(bought.subscription.id);
    box.note('subscriptionId', subscriptionId);
  });

  afterAll(async () => {
    await box?.dispose();
    await test?.pool.end();
  });

  it('the plan starts again by itself and the first month after the pause is charged', async () => {
    const paused = await pausePlan(box.rt, { orgId: box.org.orgId, months: 1, reason: 'seasonal', actor: box.actor });
    expect(paused.ok).toBe(true);
    const before = await box.subscriptionRow();
    const pauseStart = new Date(before!.pause_starts_at).getTime();
    const resumesAt = new Date(before!.pause_resumes_at).getTime();

    // Into the pause: view only, nothing charged.
    await box.advanceTo(new Date(pauseStart + 2 * HOUR_MS));
    expect(failures(await box.sync())).toEqual([]);
    expect((await getPlanState(box.rt, box.org.orgId)).phase).toBe('paused');
    const chargesInPause = (await stripeApi('GET', '/v1/charges', { customer: box.customerId, limit: 20 })).data.length;
    expect(chargesInPause).toBe(1);

    // Past the resume date and the renewal that follows it one hour later.
    await box.advanceTo(new Date(resumesAt + 4 * HOUR_MS));
    const delivered = await box.sync();
    expect(failures(delivered)).toEqual([]);
    box.note('eventsWhenPauseRanOut', delivered.map((event) => `${event.type}:${event.outcome.result}`));

    const subscription = await stripeSubscription(subscriptionId);
    expect(subscription.status).toBe('active');
    expect(subscription.pause_collection).toBeNull();
    const invoice = await stripeApi('GET', `/v1/invoices/${String(subscription.latest_invoice)}`);
    expect(invoice).toMatchObject({ status: 'paid', amount_paid: CRM.monthly, billing_reason: 'subscription_cycle' });
    box.note('firstInvoiceAfterPause', invoice.id);
    expect((await stripeApi('GET', '/v1/charges', { customer: box.customerId, limit: 20 })).data.length).toBe(2);

    const row = await box.subscriptionRow();
    expect(row).toMatchObject({ status: 'active', pause_starts_at: null, pause_resumes_at: null });
    const rows = await box.entitlements();
    expect(rows).toMatchObject([{ module: 'crm', status: 'active', source: 'stripe' }]);
    expect(new Date(rows[0]!.current_period_end).getTime()).toBe(subscription.items.data[0].current_period_end * 1000);
    expect(await box.auditActions()).toContain('plan.resumed');
    expect((await getPlanState(box.rt, box.org.orgId)).phase).toBe('active');
    const receipts = (await box.emails()).filter((email) => email.template === 'receipt');
    expect(receipts.map((email) => email.payload.invoiceId)).toContain(invoice.id);
  });
});
