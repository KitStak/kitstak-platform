/**
 * The fixes that came out of the real Stripe sandbox run (docs/billing/STRIPE-SANDBOX-RUN.md), proven
 * here without Stripe so they run in every test pass. Against the local dev Postgres through the
 * test gateway, and with a small fake gateway where a real gateway answer is needed. Skipped when
 * the database is not reachable.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { PlanSelection } from '../catalog';
import { completeTestCheckout, testRunDue, testSendEvent } from '../gateway/test';
import { type BillingGateway, GatewayAmountChangedError, GatewayCardError } from '../gateway/types';
import { createTestOrg, openTestDb, removeTestOrg, testRuntime, type TestOrg } from '../testing/db';
import { pausePlan, undoPause } from './cancel';
import { applyPlanChange, previewPlanChange } from './changes';
import { createCheckout } from './checkout';
import type { BillingRuntime } from './db';
import { retryPayment, stripeHostedUrl } from './payment';
import { processWebhook } from './webhook';

const { pool, db, available } = await openTestDb();
vi.setConfig({ testTimeout: 90_000 });

const DAY = 24 * 60 * 60 * 1000;
const CARD = { cardNumber: '4242 4242 4242 4242', expMonth: 12, expYear: 2031, cvc: '123', name: 'Maya Chen', postalCode: '60601' };
const FAILS_AT_RENEWAL = '4000 0000 0000 0341';
const CRM = (seats: number, interval: 'monthly' | 'yearly' = 'monthly'): PlanSelection => ({ products: ['crm'], seats, warehouses: 1, interval });

const orgs: TestOrg[] = [];

async function paidPlan(cardNumber = CARD.cardNumber, start = '2026-10-16T00:00:00.000Z') {
  const org = await createTestOrg(pool);
  orgs.push(org);
  const clock = { at: new Date(start) };
  const rt = testRuntime(db, { now: () => clock.at });
  const actor = { userId: org.owner.id, label: org.owner.name };
  const checkout = await createCheckout(rt, { orgId: org.orgId, orgName: org.name, selection: CRM(2), actor, actorEmail: org.owner.email });
  if (!checkout.ok) throw new Error(checkout.error.message);
  const paid = await completeTestCheckout(rt, { sessionId: checkout.data.sessionId, ...CARD, cardNumber });
  if (!paid.ok) throw new Error(paid.error.message);
  return {
    org,
    rt,
    actor,
    async advance(ms: number) {
      clock.at = new Date(clock.at.getTime() + ms);
      await testRunDue(rt, { orgId: org.orgId });
    },
  };
}

const mails = async (orgId: string, template: string) =>
  (await pool.query(`select payload from core.billing_emails where org_id = $1 and template = $2`, [orgId, template])).rows as { payload: Record<string, unknown> }[];

/** The runtime with some gateway methods replaced, to stand in for an answer only real Stripe gives. */
function withGateway(rt: BillingRuntime, overrides: Partial<BillingGateway>): BillingRuntime {
  const real = rt.gateway!;
  const gateway = new Proxy(real, {
    get: (target, name, receiver) => (name in overrides ? (overrides as Record<string | symbol, unknown>)[name] : Reflect.get(target, name, receiver)),
  });
  return { ...rt, gateway };
}

describe.skipIf(!available)('fixes from the real Stripe run', () => {
  afterAll(async () => {
    for (const org of orgs) await removeTestOrg(pool, org);
    await pool.end();
  });

  describe('the "your bank needs you to approve a payment" email', () => {
    it('is not sent for a bill that is already paid (an event that arrives late)', async () => {
      const { org, rt } = await paidPlan();
      const { rawBody, signature } = await testSendEvent(rt, { type: 'invoice.payment_action_required', orgId: org.orgId });
      await expect(processWebhook(rt, { rawBody, signature })).resolves.toMatchObject({ status: 200, result: 'processed' });
      expect(await mails(org.orgId, 'payment_action_required')).toEqual([]);
    });

    it('is sent once for an open bill of a plan that is running', async () => {
      const { org, rt, advance } = await paidPlan(FAILS_AT_RENEWAL);
      await advance(31 * DAY);
      const row = (await pool.query(`select status from core.billing_subscriptions where org_id = $1`, [org.orgId])).rows[0];
      expect(row.status).toBe('past_due');
      const first = await testSendEvent(rt, { type: 'invoice.payment_action_required', orgId: org.orgId });
      await expect(processWebhook(rt, { rawBody: first.rawBody, signature: first.signature })).resolves.toMatchObject({ status: 200, result: 'processed' });
      const second = await testSendEvent(rt, { type: 'invoice.payment_action_required', orgId: org.orgId });
      await expect(processWebhook(rt, { rawBody: second.rawBody, signature: second.signature })).resolves.toMatchObject({ status: 200, result: 'processed' });
      const sent = await mails(org.orgId, 'payment_action_required');
      expect(sent).toHaveLength(1);
      expect(sent[0]!.payload).toMatchObject({ amountDueCents: 5800 });
    });

    it('is not sent for a first payment that is still on the pay page', async () => {
      const { org, rt } = await paidPlan();
      // What real Stripe has while the bank step is open on the pay page: a subscription that has
      // not started (`incomplete`) and its first invoice, open.
      const real = rt.gateway!;
      const pending = withGateway(rt, {
        getSubscription: async (id) => {
          const subscription = await real.getSubscription(id);
          return subscription ? { ...subscription, status: 'incomplete' as const } : null;
        },
        getInvoice: async (id) => {
          const invoice = await real.getInvoice(id);
          return invoice ? { ...invoice, status: 'open' as const, amountDueCents: 5800, amountPaidCents: 0, paidAt: null } : null;
        },
      });
      const { rawBody, signature } = await testSendEvent(rt, { type: 'invoice.payment_action_required', orgId: org.orgId });
      await expect(processWebhook(pending, { rawBody, signature })).resolves.toMatchObject({ status: 200, result: 'processed' });
      expect(await mails(org.orgId, 'payment_action_required')).toEqual([]);
    });
  });

  describe('"Pay now" when the bank wants approval', () => {
    it('sends the person to Stripe\'s page for the bill, and only to a Stripe address', async () => {
      const { org, rt, actor, advance } = await paidPlan(FAILS_AT_RENEWAL);
      await advance(31 * DAY);
      const needsBank = (url: string | null) =>
        withGateway(rt, {
          payLatestInvoice: async () => {
            throw new GatewayCardError('The bank needs the card holder to approve this payment.', 'authentication_required', url);
          },
        });

      const sent = await retryPayment(needsBank('https://invoice.stripe.com/i/acct_1/test_abc?s=ap'), { orgId: org.orgId, actor });
      expect(sent).toEqual({
        ok: false,
        error: {
          code: 'payment_needs_approval',
          message: 'Your bank wants you to approve this payment. We are taking you to a secure Stripe page to do that. Nothing was charged yet.',
          actionUrl: 'https://invoice.stripe.com/i/acct_1/test_abc?s=ap',
        },
      });

      // No link, or a link that is not Stripe's: a plain decline message, and no redirect.
      for (const url of [null, 'https://invoice.stripe.com.evil.example/i/1', 'http://invoice.stripe.com/i/1', 'javascript:alert(1)']) {
        const result = await retryPayment(needsBank(url), { orgId: org.orgId, actor });
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('card_declined');
          expect(result.error.actionUrl).toBeUndefined();
        }
      }
    });

    it('stripeHostedUrl keeps https Stripe pages and drops everything else', () => {
      expect(stripeHostedUrl('https://invoice.stripe.com/i/acct_1/test_abc')).toBe('https://invoice.stripe.com/i/acct_1/test_abc');
      expect(stripeHostedUrl('https://stripe.com/x')).toBe('https://stripe.com/x');
      expect(stripeHostedUrl('https://notstripe.com/x')).toBeNull();
      expect(stripeHostedUrl('https://stripe.com.example.org/x')).toBeNull();
      expect(stripeHostedUrl('http://invoice.stripe.com/x')).toBeNull();
      expect(stripeHostedUrl('not a url')).toBeNull();
      expect(stripeHostedUrl(null)).toBeNull();
    });
  });

  describe('a plan change whose amount can move with the clock', () => {
    it('the confirmed amount is handed to the gateway, and a moved amount charges nothing', async () => {
      const { org, rt, actor } = await paidPlan();
      const preview = await previewPlanChange(rt, { orgId: org.orgId, selection: CRM(2, 'yearly') });
      expect(preview.ok).toBe(true);
      if (!preview.ok) return;
      const real = rt.gateway!;
      const seen: (number | undefined)[] = [];
      const moved = withGateway(rt, {
        applyChange: async (input) => {
          seen.push(input.expectedDueTodayCents);
          throw new GatewayAmountChangedError();
        },
      });
      const result = await applyPlanChange(moved, {
        orgId: org.orgId,
        selection: CRM(2, 'yearly'),
        basis: preview.data.basis,
        expectedDueTodayCents: preview.data.dueTodayCents,
        actor,
      });
      expect(seen).toEqual([preview.data.dueTodayCents]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('price_changed');
      // Nothing changed: the plan is still monthly.
      const row = (await pool.query(`select interval from core.billing_subscriptions where org_id = $1`, [org.orgId])).rows[0];
      expect(row.interval).toBe('monthly');
      void real;
    });

    it('the day count is only said when the gateway priced from the whole day date it was given', async () => {
      const { org, rt, advance } = await paidPlan();
      await advance(10 * DAY + 5 * 60 * 60 * 1000);
      const exact = await previewPlanChange(rt, { orgId: org.orgId, selection: CRM(2, 'yearly') });
      expect(exact.ok).toBe(true);
      if (!exact.ok) return;
      expect(exact.data.daysLeft).not.toBeNull();
      expect(exact.data.dueTodayNote).toContain('full days left on your monthly plan');

      // Real Stripe prices a change of billing period from the moment of the call, not from the date.
      const real = rt.gateway!;
      const byTheSecond = withGateway(rt, {
        previewChange: async (input) => ({ ...(await real.previewChange(input)), prorationDate: rt.now() }),
      });
      const loose = await previewPlanChange(byTheSecond, { orgId: org.orgId, selection: CRM(2, 'yearly') });
      expect(loose.ok).toBe(true);
      if (!loose.ok) return;
      expect(loose.data.daysLeft).toBeNull();
      expect(loose.data.dueTodayNote).toContain('for the time left on your monthly plan');
      expect(loose.data.dueTodayNote).not.toContain('full day');
    });
  });

  describe('"Start again now" in the middle of a pause', () => {
    it('a card that cannot be charged answers "card declined", and the plan stays paused', async () => {
      const { org, rt, actor, advance } = await paidPlan();
      expect((await pausePlan(rt, { orgId: org.orgId, months: 1, reason: null, actor })).ok).toBe(true);
      await advance(31 * DAY);
      const declined = withGateway(rt, {
        resume: async () => {
          throw new GatewayCardError('The card was declined.', 'insufficient_funds');
        },
      });
      const result = await undoPause(declined, { orgId: org.orgId, actor });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('card_declined');
      const row = (await pool.query(`select pause_resumes_at from core.billing_subscriptions where org_id = $1`, [org.orgId])).rows[0];
      expect(row.pause_resumes_at).not.toBeNull();
    });
  });
});
