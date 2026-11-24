/**
 * Real Stripe sandbox, flow 6: a renewal that fails. Stripe's own retries (dunning), a new card
 * through the Billing Portal and "Pay now", a cancel while the bill is open, and a renewal the bank
 * wants approved (3D Secure). Skipped unless STRIPE_SANDBOX=1 (see ./harness.ts).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CATALOG } from '../../src/catalog';
import { scheduleCancel } from '../../src/server/cancel';
import { createPaymentUpdateSession, retryPayment } from '../../src/server/payment';
import { getPlanState } from '../../src/server/state';
import { buyPlan, CANCEL_NEEDS_APPROVAL, CHECK_REFUSED_CANCEL, DAY_MS, failures, HOUR_MS, type Json, openTestDb, Sandbox, SANDBOX_ENABLED, stripeApi, stripeSubscription } from './harness';

const test = SANDBOX_ENABLED ? await openTestDb() : null;
vi.setConfig({ testTimeout: 1_200_000, hookTimeout: 1_200_000 });
const CRM = CATALOG.products.crm.cents;
const boxes: Sandbox[] = [];

/** A paid monthly plan whose card will fail at the next renewal, moved to just after that renewal. */
async function lateOrg(label: string, renewalCard: string): Promise<{ box: Sandbox; subscriptionId: string; invoice: Json }> {
  const box = await Sandbox.create(test!, label);
  boxes.push(box);
  const bought = await buyPlan(box, { products: ['crm'], seats: 2, warehouses: 1, interval: 'monthly' });
  expect(failures(bought.delivered)).toEqual([]);
  const subscriptionId = String(bought.subscription.id);
  box.note('subscriptionId', subscriptionId);
  // The card on the plan is swapped for one that fails when it is charged later.
  const failing = await box.attachCard(renewalCard);
  await stripeApi('POST', `/v1/subscriptions/${subscriptionId}`, { default_payment_method: failing });
  expect(failures(await box.sync())).toEqual([]);
  const periodEnd = new Date((await box.subscriptionRow())!.current_period_end).getTime();
  await box.advanceTo(new Date(periodEnd + 2 * HOUR_MS));
  const delivered = await box.syncUntil('invoice.payment_failed');
  expect(failures(delivered)).toEqual([]);
  box.note('eventsAtFailedRenewal', delivered.map((event) => `${event.type}:${event.outcome.result}`));
  const subscription = await stripeSubscription(subscriptionId);
  const invoice = await stripeApi('GET', `/v1/invoices/${String(subscription.latest_invoice)}`);
  box.note('failedInvoiceId', invoice.id);
  return { box, subscriptionId, invoice };
}

describe.skipIf(!SANDBOX_ENABLED || !test?.available)('Stripe sandbox: a failed renewal', () => {
  afterAll(async () => {
    for (const box of boxes) await box.dispose();
    await test?.pool.end();
  });

  describe('Stripe keeps trying (dunning)', () => {
    let box: Sandbox;
    let subscriptionId = '';
    let invoice: Json;

    beforeAll(async () => {
      ({ box, subscriptionId, invoice } = await lateOrg('06a failed renewal and dunning', 'pm_card_chargeCustomerFail'));
    });

    it('the first failure makes the plan late, keeps full access and sends one email', async () => {
      const subscription = await stripeSubscription(subscriptionId);
      expect(subscription.status).toBe('past_due');
      expect(invoice).toMatchObject({ status: 'open', amount_due: 2 * CRM.monthly, attempt_count: 1, billing_reason: 'subscription_cycle' });
      expect(invoice.next_payment_attempt).not.toBeNull();
      box.note('firstRetryAt', new Date(invoice.next_payment_attempt * 1000).toISOString());

      const row = await box.subscriptionRow();
      expect(row).toMatchObject({ status: 'past_due', amount_due_cents: 2 * CRM.monthly, latest_invoice_id: invoice.id, pm_last4: '0341' });
      expect(row!.past_due_since).not.toBeNull();
      expect(new Date(row!.next_payment_attempt).getTime()).toBe(invoice.next_payment_attempt * 1000);
      const rows = await box.entitlements();
      expect(rows).toMatchObject([{ module: 'crm', status: 'past_due', source: 'stripe' }]);
      const state = await getPlanState(box.rt, box.org.orgId);
      expect(state.phase).toBe('past_due');
      expect(state.modules.crm.access).toBe('full');

      const mails = (await box.emails()).filter((email) => email.template === 'payment_failed');
      expect(mails).toHaveLength(1);
      expect(mails[0]!.payload).toMatchObject({ amountDueCents: 2 * CRM.monthly, last4: '0341', attempt: 1 });
      expect(new Date(String(mails[0]!.payload.nextRetryAt)).getTime()).toBe(invoice.next_payment_attempt * 1000);
      // Access changes 7 days after the plan became late.
      expect(new Date(String(mails[0]!.payload.accessChangesAt)).getTime()).toBe(new Date(row!.past_due_since).getTime() + CATALOG.graceDays * DAY_MS);
      const failed = (await box.audit()).filter((entry) => entry.action === 'payment.failed');
      expect(failed).toHaveLength(1);
      expect(String(failed[0]!.summary)).toBe('We could not charge the Visa ending 0341 for $58.00.');
      expect((await box.invoices()).find((entry) => entry.id === invoice.id)).toMatchObject({ status: 'open', amount_due_cents: 2 * CRM.monthly, attempt_count: 1 });
    });

    it('each retry that fails sends one more email, and after 7 days the apps are view only', async () => {
      const attempts: { attempt: number; at: string; status: string; next: string | null }[] = [];
      let current = invoice;
      for (let round = 0; round < 12 && current.next_payment_attempt; round += 1) {
        const triesBefore = Number(current.attempt_count);
        await box.advanceTo(new Date(current.next_payment_attempt * 1000 + HOUR_MS));
        // The retry has run when Stripe counts one more try, or has ended the plan.
        const delivered = await box.syncWhen(async () => {
          const seen = await stripeApi('GET', `/v1/invoices/${String(invoice.id)}`);
          return Number(seen.attempt_count) > triesBefore || (await stripeSubscription(subscriptionId)).status !== 'past_due';
        });
        expect(failures(delivered)).toEqual([]);
        const subscription = await stripeSubscription(subscriptionId);
        current = await stripeApi('GET', `/v1/invoices/${String(invoice.id)}`);
        attempts.push({
          attempt: current.attempt_count,
          at: box.now().toISOString(),
          status: `${String(subscription.status)}/${String(current.status)}`,
          next: current.next_payment_attempt ? new Date(current.next_payment_attempt * 1000).toISOString() : null,
        });
        if (subscription.status !== 'past_due') break;
      }
      box.note('stripeRetries', attempts);
      expect(attempts.length).toBeGreaterThan(0);

      // One email and one activity line per try that failed. Never two for the same try.
      expect(failures(await box.sync())).toEqual([]);
      const tries = (await stripeApi('GET', `/v1/invoices/${String(invoice.id)}`)).attempt_count as number;
      const mails = (await box.emails()).filter((email) => email.template === 'payment_failed');
      const lines = (await box.audit()).filter((entry) => entry.action === 'payment.failed');
      const mailed = mails.map((email) => Number(email.payload.attempt));
      const logged = lines.map((entry) => Number(entry.data.attempt));
      box.note('failedTryEmails', mailed);
      box.note('failedTryActivityLines', logged);
      // Never two for the same try, and never a try Stripe did not make.
      expect(new Set(mailed).size).toBe(mailed.length);
      expect(new Set(logged).size).toBe(logged.length);
      expect(logged.every((attempt) => attempt >= 1 && attempt <= tries)).toBe(true);
      // The email is for a plan that is late. The try after which Stripe gave up ends the plan, and
      // the "your plan ended" email says so instead. (A Stripe event that reaches us only after the
      // next try has run is counted with that try, so on a slow day a number can be missing.)
      const stillLate = (await stripeSubscription(subscriptionId)).status === 'past_due';
      expect(mailed.every((attempt) => attempt >= 1 && attempt <= (stillLate ? tries : tries - 1))).toBe(true);
      expect(mailed[0]).toBe(1);
      expect(mailed.length).toBeGreaterThanOrEqual(Math.ceil(tries / 2));

      const subscription = await stripeSubscription(subscriptionId);
      const row = await box.subscriptionRow();
      box.note('afterLastRetry', { stripeStatus: subscription.status, invoiceStatus: current.status, tries, rowStatus: row!.status, endedReason: row!.ended_reason, emails: await box.emailTemplates() });
      // Our copy says what Stripe says.
      expect(row!.status).toBe(subscription.status === 'incomplete_expired' ? 'canceled' : subscription.status);

      const state = await getPlanState(box.rt, box.org.orgId);
      const sevenDaysOn = box.now().getTime() >= new Date(invoice.created * 1000).getTime() + CATALOG.graceDays * DAY_MS;
      expect(sevenDaysOn).toBe(true);
      if (subscription.status === 'canceled') {
        // Stripe gave up after its last try: the plan ended, and the reason is on the row.
        expect(row).toMatchObject({ ended_reason: 'payment_failed', ended_amount_cents: 2 * CRM.monthly, ended_attempts: tries });
        expect(state.phase).toBe('ended');
        const ended = (await box.emails()).filter((email) => email.template === 'plan_ended');
        expect(ended).toHaveLength(1);
        expect(ended[0]!.payload).toMatchObject({ reason: 'payment_failed', amountCents: 2 * CRM.monthly, attempts: tries });
        expect(await box.entitlements()).toMatchObject([{ module: 'crm', status: 'canceled' }]);
        const line = (await box.audit()).filter((entry) => entry.action === 'plan.ended').pop();
        expect(String(line!.summary)).toContain(`We could not collect $58.00 after ${String(tries)} tries, so the plan ended.`);
      } else {
        expect(state.phase).toBe('unpaid');
      }
      expect(state.modules.crm.access).toBe('read_only');
    });
  });

  describe('a new card and "Pay now"', () => {
    let box: Sandbox;
    let subscriptionId = '';
    let invoice: Json;

    beforeAll(async () => {
      ({ box, subscriptionId, invoice } = await lateOrg('06b new card and pay now', 'pm_card_chargeCustomerFail'));
    });

    it('"Pay now" with the same bad card is declined and says so', async () => {
      const result = await retryPayment(box.rt, { orgId: box.org.orgId, actor: box.actor });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('card_declined');
      expect(failures(await box.sync())).toEqual([]);
      expect(await box.subscriptionRow()).toMatchObject({ status: 'past_due' });
      expect((await stripeApi('GET', `/v1/invoices/${String(invoice.id)}`)).status).toBe('open');
    });

    it('the card update link is a real Billing Portal session for this customer', async () => {
      const session = await createPaymentUpdateSession(box.rt, { orgId: box.org.orgId, actor: box.actor });
      expect(session.ok).toBe(true);
      if (!session.ok) return;
      const url = new URL(session.data.url);
      expect(url.protocol).toBe('https:');
      expect(url.host).toBe('billing.stripe.com');
      box.note('billingPortalHost', url.host);
      // Stripe recorded the session: for our customer, our configuration, the card update flow, back to billing home.
      const events = await box.pullEvents();
      const created = events.find((event) => event.type === 'billing_portal.session.created');
      expect(created).toBeDefined();
      const made = (created!.data as Json).object as Json;
      expect(made).toMatchObject({
        customer: box.customerId,
        livemode: false,
        return_url: 'http://localhost:3300/billing?updated=card',
        flow: { type: 'payment_method_update', after_completion: { type: 'redirect', redirect: { return_url: 'http://localhost:3300/billing?updated=card' } } },
      });
      if (process.env.STRIPE_PORTAL_CONFIGURATION_ID) expect(made.configuration).toBe(process.env.STRIPE_PORTAL_CONFIGURATION_ID);
      box.note('billingPortalSessionId', made.id);
      expect(failures(await box.deliver(events))).toEqual([]);
    });

    it('a card saved in the Billing Portal becomes the card of the plan', async () => {
      // What the Billing Portal does when a person saves a new card: attach it and make it the customer's default.
      const fresh = await box.attachCard('pm_card_mastercard');
      await stripeApi('POST', `/v1/customers/${box.customerId}`, { invoice_settings: { default_payment_method: fresh } });
      const delivered = await box.sync();
      expect(failures(delivered)).toEqual([]);
      box.note('eventsAfterCardUpdate', delivered.map((event) => `${event.type}:${event.outcome.result}`));

      // The plan charges the subscription's own card first, so the adapter moved the new card onto it.
      const subscription = await stripeSubscription(subscriptionId);
      expect(subscription.default_payment_method).toBe(fresh);
      expect(await box.subscriptionRow()).toMatchObject({ pm_brand: 'mastercard', pm_last4: '4444', status: 'past_due' });
      // One line for the new card. (An earlier line is the test's own swap to the failing card.)
      const changed = (await box.audit()).filter((entry) => entry.action === 'card.updated').map((entry) => String(entry.summary));
      expect(changed.filter((summary) => summary.includes('4444'))).toEqual(['The card on file is now Mastercard ending 4444.']);
    });

    it('"Pay now" pays the open bill with the new card and the plan is active again', async () => {
      const result = await retryPayment(box.rt, { orgId: box.org.orgId, actor: box.actor });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.phase).toBe('active');
      const delivered = await box.sync();
      expect(failures(delivered)).toEqual([]);

      const subscription = await stripeSubscription(subscriptionId);
      expect(subscription.status).toBe('active');
      const paid = await stripeApi('GET', `/v1/invoices/${String(invoice.id)}`);
      expect(paid).toMatchObject({ status: 'paid', amount_paid: 2 * CRM.monthly, amount_remaining: 0 });

      expect(await box.subscriptionRow()).toMatchObject({ status: 'active', past_due_since: null, amount_due_cents: null, next_payment_attempt: null, pm_last4: '4444' });
      expect(await box.entitlements()).toMatchObject([{ module: 'crm', status: 'active', source: 'stripe' }]);
      expect((await box.invoices()).find((entry) => entry.id === invoice.id)).toMatchObject({ status: 'paid', amount_due_cents: 0, pm_last4: '4444' });
      const receipts = (await box.emails()).filter((email) => email.template === 'receipt' && email.payload.invoiceId === invoice.id);
      expect(receipts).toHaveLength(1);
      expect(receipts[0]!.payload).toMatchObject({ amountPaidCents: 2 * CRM.monthly, last4: '4444' });
      const actions = await box.auditActions();
      expect(actions).toContain('payment.retried');
      expect(actions.filter((action) => action === 'payment.succeeded')).toHaveLength(2);
    });
  });

  describe('cancel with a bill open', () => {
    let box: Sandbox;
    let subscriptionId = '';
    let invoice: Json;

    beforeAll(async () => {
      ({ box, subscriptionId, invoice } = await lateOrg('06c cancel with an open bill', 'pm_card_chargeCustomerFail'));
    });

    it.skipIf(!CHECK_REFUSED_CANCEL)('when Stripe refuses the cancel (this key needs a person to approve it), nothing changes and nothing is lost', async () => {
      const result = await scheduleCancel(box.rt, { orgId: box.org.orgId, reason: 'too_expensive', detail: null, actor: box.actor });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('gateway_error');
      expect(failures(await box.sync())).toEqual([]);

      // Stripe did nothing: the plan is still late and the bill is still open.
      expect((await stripeSubscription(subscriptionId)).status).toBe('past_due');
      expect((await stripeApi('GET', `/v1/invoices/${String(invoice.id)}`)).status).toBe('open');
      // Our copy says the same, and the note "the customer canceled" was taken off again.
      expect(await box.subscriptionRow()).toMatchObject({ status: 'past_due', ended_reason: null, ended_amount_cents: null });
      expect(await box.entitlements()).toMatchObject([{ module: 'crm', status: 'past_due', source: 'stripe' }]);
      expect((await box.auditActions()).filter((action) => action === 'cancel.ended_now')).toEqual([]);
      expect((await box.emailTemplates()).filter((template) => template === 'plan_ended')).toEqual([]);
      expect((await getPlanState(box.rt, box.org.orgId)).phase).toBe('past_due');
      box.note('cancelWithOpenBill', 'blocked by the Stripe key: DELETE /v1/subscriptions needs a person to approve it. The app kept the plan as it was.');
    });

    it.skipIf(CANCEL_NEEDS_APPROVAL)('the plan ends today, the bill is dropped, and nothing is charged after that', async () => {
      const result = await scheduleCancel(box.rt, { orgId: box.org.orgId, reason: 'too_expensive', detail: null, actor: box.actor });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.phase).toBe('ended');
      const delivered = await box.sync();
      expect(failures(delivered)).toEqual([]);
      box.note('eventsAfterCancelWithOpenBill', delivered.map((event) => `${event.type}:${event.outcome.result}`));

      const subscription = await stripeSubscription(subscriptionId);
      expect(subscription.status).toBe('canceled');
      const dropped = await stripeApi('GET', `/v1/invoices/${String(invoice.id)}`);
      expect(dropped).toMatchObject({ status: 'void', amount_paid: 0 });
      expect((await stripeApi('GET', '/v1/invoices', { customer: box.customerId, status: 'open', limit: 10 })).data).toEqual([]);

      const row = await box.subscriptionRow();
      expect(row).toMatchObject({ status: 'canceled', ended_reason: 'canceled_unpaid', ended_amount_cents: 2 * CRM.monthly });
      expect(await box.entitlements()).toMatchObject([{ module: 'crm', status: 'canceled', source: 'stripe' }]);
      expect((await box.invoices()).find((entry) => entry.id === invoice.id)).toMatchObject({ status: 'void' });
      const ended = (await box.audit()).filter((entry) => entry.action === 'cancel.ended_now');
      expect(ended).toHaveLength(1);
      expect(String(ended[0]!.summary)).toContain('with a bill of $58.00 open. The plan ended and the bill was dropped. It will not be charged.');
      const mails = (await box.emails()).filter((email) => email.template === 'plan_ended');
      expect(mails).toHaveLength(1);
      expect(mails[0]!.payload).toMatchObject({ reason: 'canceled_unpaid', amountCents: 2 * CRM.monthly });

      // A month later Stripe has tried nothing more.
      await box.advanceBy(31 * DAY_MS);
      expect(failures(await box.sync())).toEqual([]);
      expect((await stripeApi('GET', `/v1/invoices/${String(invoice.id)}`)).status).toBe('void');
      expect((await stripeApi('GET', '/v1/invoices', { customer: box.customerId, limit: 10 })).data).toHaveLength(2);
      expect(await box.subscriptionRow()).toMatchObject({ status: 'canceled', ended_reason: 'canceled_unpaid' });
    });
  });

  describe('a renewal the bank wants approved (3D Secure)', () => {
    let box: Sandbox;
    let subscriptionId = '';
    let invoice: Json;

    beforeAll(async () => {
      ({ box, subscriptionId, invoice } = await lateOrg('06d renewal needs bank approval', 'pm_card_authenticationRequired'));
    });

    it('the plan is late, and the bank approval email goes out once', async () => {
      const subscription = await stripeSubscription(subscriptionId);
      expect(subscription.status).toBe('past_due');
      expect(invoice.status).toBe('open');
      expect((box.evidence.eventsAtFailedRenewal as string[]).some((entry) => entry.startsWith('invoice.payment_action_required:processed'))).toBe(true);
      expect(await box.subscriptionRow()).toMatchObject({ status: 'past_due', amount_due_cents: 2 * CRM.monthly });
      const mails = (await box.emails()).filter((email) => email.template === 'payment_action_required');
      expect(mails).toHaveLength(1);
      expect(mails[0]!.payload).toMatchObject({ amountDueCents: 2 * CRM.monthly, last4: '3184' });
      expect((await getPlanState(box.rt, box.org.orgId)).phase).toBe('past_due');
    });

    it('"Pay now" sends the person to Stripe\'s page for this bill, where the bank step can be done', async () => {
      const result = await retryPayment(box.rt, { orgId: box.org.orgId, actor: box.actor });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('payment_needs_approval');
        const url = new URL(String(result.error.actionUrl));
        expect(url.protocol).toBe('https:');
        expect(url.host).toBe('invoice.stripe.com');
        // It is the page of this very invoice.
        expect(result.error.actionUrl).toBe((await stripeApi('GET', `/v1/invoices/${String(invoice.id)}`)).hosted_invoice_url);
        box.note('payNowWith3dsCard', { code: result.error.code, message: result.error.message, host: url.host });
      }
      expect(failures(await box.sync())).toEqual([]);
      // Nothing was charged and the plan is still late.
      expect(await box.subscriptionRow()).toMatchObject({ status: 'past_due' });
      expect((await stripeApi('GET', `/v1/invoices/${String(invoice.id)}`)).status).toBe('open');
    });

    it('another card and "Pay now" also clears it', async () => {
      const fresh = await box.attachCard('pm_card_visa');
      await stripeApi('POST', `/v1/customers/${box.customerId}`, { invoice_settings: { default_payment_method: fresh } });
      expect(failures(await box.sync())).toEqual([]);
      const paid = await retryPayment(box.rt, { orgId: box.org.orgId, actor: box.actor });
      expect(paid.ok).toBe(true);
      expect(failures(await box.sync())).toEqual([]);
      expect((await stripeSubscription(subscriptionId)).status).toBe('active');
      expect(await box.subscriptionRow()).toMatchObject({ status: 'active', pm_last4: '4242' });
      expect(await box.entitlements()).toMatchObject([{ module: 'crm', status: 'active', source: 'stripe' }]);
    });
  });
});
