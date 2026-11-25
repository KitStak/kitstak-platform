/**
 * Review round 2 fixes, each proven against the local dev Postgres through the test gateway (the
 * same webhook path Stripe uses). Skipped when the database is not reachable.
 *
 *  - invoice events that arrive late or twice write no false line in the activity log,
 *  - two checkouts opened at the same moment make one customer and one open pay page, and a plan
 *    whose customer is not the stored one (data from before this fix) still gets its events,
 *  - the same plan change confirmed three times at once is applied and charged once,
 *  - the "fails at the next renewal" test card fails the next renewal, however it was saved,
 *  - one billing step at a time per organization (the lease in core.billing_locks).
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { PlanSelection } from '../catalog';
import {
  completeTestCardUpdate,
  completeTestCheckout,
  signTestPayload,
  testRunDue,
} from '../gateway/test';
import { reconcileSubscriptions } from '../jobs/reconcile';
import { addPerson, createTestOrg, openTestDb, removeTestOrg, testRuntime, TEST_PORTAL_URL, type TestOrg } from '../testing/db';
import { addBillingManager, billingAccessFor, checkBillingInvite, getBillingAccess, listBillingHolders, listBillingInvites, removeBillingManager } from './access';
import { billingOrganizationOptions } from './auth-hooks';
import { scheduleCancel } from './cancel';
import { applyPlanChange, previewPlanChange } from './changes';
import { createCheckout } from './checkout';
import type { BillingRuntime } from './db';
import { withOrgBillingTurn } from './lock';
import { billingRecipients } from './outbox';
import { createPaymentUpdateSession } from './payment';
import { hasBillingRole, isBillingOnlyRole, isFreeRole, usesSeat } from './roles';
import { getPlanState } from './state';
import { refreshFromGateway } from './sync';
import { checkSeatAvailable, countBillableSeats } from './usage';
import { processWebhook } from './webhook';

const { pool, db, available } = await openTestDb();
vi.setConfig({ testTimeout: 90_000 });

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const CARD = { cardNumber: '4242 4242 4242 4242', expMonth: 12, expYear: 2031, cvc: '123', name: 'Maya Chen', postalCode: '60601' };
const FAILS_AT_RENEWAL = '4000 0000 0000 0341';
const CRM = (seats: number, interval: 'monthly' | 'yearly' = 'monthly'): PlanSelection => ({ products: ['crm'], seats, warehouses: 1, interval });

const orgs: TestOrg[] = [];

interface Scene {
  readonly org: TestOrg;
  readonly rt: BillingRuntime;
  readonly clock: { at: Date };
  readonly actor: { userId: string; label: string };
  advance(ms: number): void;
}

async function scene(start = '2026-11-01T00:00:00.000Z'): Promise<Scene> {
  const org = await createTestOrg(pool);
  orgs.push(org);
  const clock = { at: new Date(start) };
  const rt = testRuntime(db, { now: () => clock.at });
  return {
    org,
    rt,
    clock,
    actor: { userId: org.owner.id, label: org.owner.name },
    advance(ms) {
      clock.at = new Date(clock.at.getTime() + ms);
    },
  };
}

async function open(s: Scene, selection: PlanSelection) {
  return createCheckout(s.rt, { orgId: s.org.orgId, orgName: s.org.name, selection, actor: s.actor, actorEmail: s.org.owner.email });
}

async function paidPlan(s: Scene, selection: PlanSelection, cardNumber = CARD.cardNumber): Promise<void> {
  const checkout = await open(s, selection);
  if (!checkout.ok) throw new Error(checkout.error.message);
  const paid = await completeTestCheckout(s.rt, { sessionId: checkout.data.sessionId, ...CARD, cardNumber });
  if (!paid.ok) throw new Error(paid.error.message);
}

const one = async <T extends Record<string, unknown>>(text: string, values: unknown[]): Promise<T> => (await pool.query(text, values)).rows[0] as T;
const all = async <T extends Record<string, unknown>>(text: string, values: unknown[]): Promise<T[]> => (await pool.query(text, values)).rows as T[];

const audits = (orgId: string, action: string) =>
  all<{ summary: string; data: Record<string, unknown> }>(
    `select summary, data from core.billing_audit_log where org_id = $1 and action = $2 order by created_at, id`,
    [orgId, action],
  );
const mails = async (orgId: string, template: string) =>
  Number((await one<{ n: number }>(`select count(*)::int as n from core.billing_emails where org_id = $1 and template = $2`, [orgId, template])).n);
const ledger = (orgId: string) =>
  all<{ type: string; status: string; n: number }>(
    `select type, status, count(*)::int as n from core.billing_events where org_id = $1 group by 1, 2 order by 1, 2`,
    [orgId],
  );

/** Posts a correctly signed event about one invoice, under a new event id, as a gateway would. */
async function sendInvoiceEvent(s: Scene, type: string, invoiceId: string): Promise<string> {
  const row = await one<{ sub: string; customer: string }>(
    `select gateway_subscription_id as sub, gateway_customer_id as customer from core.billing_subscriptions where org_id = $1`,
    [s.org.orgId],
  );
  const at = s.rt.now();
  const rawBody = JSON.stringify({
    id: `evt_test_round2_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
    object: 'event',
    type,
    created: Math.floor(at.getTime() / 1000),
    livemode: false,
    data: {
      object: { id: invoiceId, object: 'invoice', customer: row.customer, subscription: row.sub, status: 'open', total: 1, metadata: { kitstak_org_id: s.org.orgId } },
    },
  });
  const outcome = await processWebhook(s.rt, { rawBody, signature: signTestPayload(rawBody, s.rt.config.testWebhookSecret, at) });
  return outcome.status === 400 ? 'bad_signature' : outcome.result;
}

afterAll(async () => {
  for (const org of orgs) await removeTestOrg(pool, org);
  await pool.end();
});

describe.skipIf(!available)('invoice events out of order or sent twice', () => {
  it('a failed payment event that arrives after the invoice was paid writes no "could not charge" line', async () => {
    const s = await scene();
    await paidPlan(s, CRM(5));
    const invoice = await one<{ id: string; status: string }>(`select id, status from core.billing_invoices where org_id = $1`, [s.org.orgId]);
    expect(invoice.status).toBe('paid');
    const before = await getPlanState(s.rt, s.org.orgId);

    expect(await sendInvoiceEvent(s, 'invoice.payment_failed', invoice.id)).toBe('processed');
    expect(await sendInvoiceEvent(s, 'invoice.payment_failed', invoice.id)).toBe('processed');

    expect(await audits(s.org.orgId, 'payment.failed')).toEqual([]);
    expect(await mails(s.org.orgId, 'payment_failed')).toBe(0);
    const after = await getPlanState(s.rt, s.org.orgId);
    expect(after.phase).toBe(before.phase);
    expect(after.modules.crm.access).toBe('full');
  });

  it('a second paid event for the same invoice, under a new event id, adds no second payment or credit line', async () => {
    const s = await scene();
    await paidPlan(s, CRM(5));
    // Credit first, so the next invoice has a credit line too: 5 seats down to 1, then up to 9.
    s.advance(5 * DAY + HOUR);
    const down = await previewPlanChange(s.rt, { orgId: s.org.orgId, selection: CRM(1) });
    if (!down.ok) throw new Error(down.error.message);
    const lowered = await applyPlanChange(s.rt, { orgId: s.org.orgId, selection: CRM(1), basis: down.data.basis, expectedDueTodayCents: 0, actor: s.actor });
    expect(lowered.ok).toBe(true);
    const up = await previewPlanChange(s.rt, { orgId: s.org.orgId, selection: CRM(9) });
    if (!up.ok) throw new Error(up.error.message);
    expect(up.data.creditAppliedCents).toBeGreaterThan(0);
    expect(up.data.dueTodayCents).toBeGreaterThan(0);
    const raised = await applyPlanChange(s.rt, { orgId: s.org.orgId, selection: CRM(9), basis: up.data.basis, expectedDueTodayCents: up.data.dueTodayCents, actor: s.actor });
    expect(raised.ok).toBe(true);

    const invoices = await all<{ id: string }>(`select id from core.billing_invoices where org_id = $1 order by issued_at`, [s.org.orgId]);
    expect(invoices).toHaveLength(2);
    const paidBefore = await audits(s.org.orgId, 'payment.succeeded');
    const creditBefore = await audits(s.org.orgId, 'payment.credit_used');
    expect(paidBefore).toHaveLength(2);
    expect(creditBefore).toHaveLength(1);
    const receiptsBefore = await mails(s.org.orgId, 'receipt');

    // The gateway says "paid" again for both invoices, twice each, with new event ids.
    for (const invoice of [...invoices, ...invoices]) {
      expect(await sendInvoiceEvent(s, 'invoice.paid', invoice.id)).toBe('processed');
    }

    expect(await audits(s.org.orgId, 'payment.succeeded')).toEqual(paidBefore);
    expect(await audits(s.org.orgId, 'payment.credit_used')).toEqual(creditBefore);
    expect(await mails(s.org.orgId, 'receipt')).toBe(receiptsBefore);
    // One payment line per invoice, each naming its invoice.
    expect(new Set(paidBefore.map((row) => row.data.invoiceId))).toEqual(new Set(invoices.map((row) => row.id)));
  });

  it('a real failed renewal is written once per try, also when the gateway repeats the event', async () => {
    const s = await scene();
    await paidPlan(s, CRM(2), FAILS_AT_RENEWAL);
    s.advance(31 * DAY);
    await testRunDue(s.rt, { orgId: s.org.orgId });
    const failed = await audits(s.org.orgId, 'payment.failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]?.summary).toBe('We could not charge the Visa ending 0341 for $58.00.');
    const open = await one<{ id: string }>(`select id from core.billing_invoices where org_id = $1 and status = 'open'`, [s.org.orgId]);

    expect(await sendInvoiceEvent(s, 'invoice.payment_failed', open.id)).toBe('processed');
    expect(await audits(s.org.orgId, 'payment.failed')).toHaveLength(1);
    expect(await mails(s.org.orgId, 'payment_failed')).toBe(1);

    // The next try (3 days later) is a new fact and gets its own line.
    s.advance(3 * DAY + HOUR);
    await testRunDue(s.rt, { orgId: s.org.orgId });
    const again = await audits(s.org.orgId, 'payment.failed');
    expect(again.map((row) => row.data.attempt)).toEqual([1, 2]);
  });
});

describe.skipIf(!available)('two checkouts opened at the same moment', () => {
  it('make one gateway customer and leave one open pay page', async () => {
    for (let round = 0; round < 4; round += 1) {
      const s = await scene();
      const [a, b] = await Promise.all([open(s, CRM(5)), open(s, CRM(5))]);
      expect(a.ok && b.ok).toBe(true);
      const sessions = await all<{ status: string; customer: string }>(
        `select data->>'status' as status, data->>'customerId' as customer from core.billing_test_objects where org_id = $1 and kind = 'checkout_session'`,
        [s.org.orgId],
      );
      const customers = await all<{ id: string }>(`select id from core.billing_test_objects where org_id = $1 and kind = 'customer'`, [s.org.orgId]);
      const stored = await one<{ id: string }>(`select stripe_customer_id as id from core.stripe_customers where org_id = $1`, [s.org.orgId]);
      expect(customers).toEqual([{ id: stored.id }]);
      expect(sessions).toHaveLength(2);
      expect(sessions.filter((row) => row.status === 'open')).toHaveLength(1);
      expect(new Set(sessions.map((row) => row.customer))).toEqual(new Set([stored.id]));
      // The turn was given back.
      expect(await all(`select 1 from core.billing_locks where org_id = $1`, [s.org.orgId])).toEqual([]);
    }
  });

  it('after the race the plan gets every later event: renewal, failed payment, cancel and the end', async () => {
    const s = await scene();
    const [a, b] = await Promise.all([open(s, CRM(5)), open(s, CRM(5))]);
    if (!a.ok || !b.ok) throw new Error('checkout did not open');
    const openSession = await one<{ id: string }>(
      `select id from core.billing_test_objects where org_id = $1 and kind = 'checkout_session' and data->>'status' = 'open'`,
      [s.org.orgId],
    );
    const paid = await completeTestCheckout(s.rt, { sessionId: openSession.id, ...CARD, cardNumber: FAILS_AT_RENEWAL });
    expect(paid.ok).toBe(true);
    expect(await mails(s.org.orgId, 'receipt')).toBe(1);
    expect(await audits(s.org.orgId, 'payment.succeeded')).toHaveLength(1);

    // The renewal fails with this card. The event must reach the plan.
    s.advance(31 * DAY);
    await testRunDue(s.rt, { orgId: s.org.orgId });
    expect((await getPlanState(s.rt, s.org.orgId)).phase).toBe('past_due');
    expect(await audits(s.org.orgId, 'payment.failed')).toHaveLength(1);

    // A working card, the open bill paid by the retry, then a cancel and the end of the period.
    const card = await createPaymentUpdateSession(s.rt, { orgId: s.org.orgId, actor: s.actor });
    if (!card.ok) throw new Error(card.error.message);
    const cardSession = card.data.url.split('/').pop()!;
    expect((await completeTestCardUpdate(s.rt, { sessionId: cardSession, ...CARD })).ok).toBe(true);
    s.advance(3 * DAY + HOUR);
    await testRunDue(s.rt, { orgId: s.org.orgId });
    expect((await getPlanState(s.rt, s.org.orgId)).phase).toBe('active');
    const canceled = await scheduleCancel(s.rt, { orgId: s.org.orgId, reason: null, detail: null, actor: s.actor });
    expect(canceled.ok).toBe(true);
    s.advance(40 * DAY);
    await testRunDue(s.rt, { orgId: s.org.orgId });

    const state = await getPlanState(s.rt, s.org.orgId);
    expect(state.modules.crm.access).not.toBe('full');
    const row = await one<{ status: string }>(`select status from core.billing_subscriptions where org_id = $1`, [s.org.orgId]);
    expect(row.status).toBe('canceled');
    const entitlement = await one<{ status: string }>(`select status from core.entitlements where org_id = $1 and module = 'crm'`, [s.org.orgId]);
    expect(entitlement.status).toBe('canceled');
    // Nothing of this plan was ignored.
    expect((await ledger(s.org.orgId)).filter((entry) => entry.status !== 'processed')).toEqual([]);
  });

  it('a plan whose customer is not the stored one (made before this fix) is taken back in: events, card page and reconcile', async () => {
    const s = await scene();
    await paidPlan(s, CRM(5));
    const row = await one<{ customer: string; sub: string }>(
      `select gateway_customer_id as customer, gateway_subscription_id as sub from core.billing_subscriptions where org_id = $1`,
      [s.org.orgId],
    );
    // Rebuild the broken state by hand: the stored customer is another customer of the organization.
    const stray = `cus_test_stray_${Math.random().toString(36).slice(2)}`;
    await pool.query(
      `insert into core.billing_test_objects (id, kind, org_id, data) values ($1, 'customer', $2, $3::jsonb)`,
      [stray, s.org.orgId, JSON.stringify({ id: stray, orgId: s.org.orgId, email: s.org.owner.email, name: s.org.name, address: null, taxId: null, defaultPaymentMethodId: null, invoiceSeq: 0 })],
    );
    await pool.query(`update core.stripe_customers set stripe_customer_id = $2 where org_id = $1`, [s.org.orgId, stray]);

    const canceled = await scheduleCancel(s.rt, { orgId: s.org.orgId, reason: null, detail: null, actor: s.actor });
    expect(canceled.ok).toBe(true);
    // The first event of the plan brought the stored customer back in line with the plan.
    const stored = await one<{ id: string }>(`select stripe_customer_id as id from core.stripe_customers where org_id = $1`, [s.org.orgId]);
    expect(stored.id).toBe(row.customer);
    const card = await createPaymentUpdateSession(s.rt, { orgId: s.org.orgId, actor: s.actor });
    if (!card.ok) throw new Error(card.error.message);
    const portal = await one<{ customer: string }>(`select data->>'customerId' as customer from core.billing_test_objects where id = $1`, [card.data.url.split('/').pop()]);
    expect(portal.customer).toBe(row.customer);

    s.advance(40 * DAY);
    await testRunDue(s.rt, { orgId: s.org.orgId });
    expect((await one<{ status: string }>(`select status from core.billing_subscriptions where org_id = $1`, [s.org.orgId])).status).toBe('canceled');
    expect((await getPlanState(s.rt, s.org.orgId)).modules.crm.access).not.toBe('full');
    expect((await ledger(s.org.orgId)).filter((entry) => entry.status !== 'processed')).toEqual([]);
  });

  it('reconcile repairs a plan the gateway ended while our copy still says active, even with a wrong stored customer', async () => {
    const s = await scene();
    await paidPlan(s, CRM(5));
    const row = await one<{ sub: string }>(`select gateway_subscription_id as sub from core.billing_subscriptions where org_id = $1`, [s.org.orgId]);
    const stray = `cus_test_stray_${Math.random().toString(36).slice(2)}`;
    await pool.query(`update core.stripe_customers set stripe_customer_id = $2 where org_id = $1`, [s.org.orgId, stray]);
    // The gateway ended the plan and every event about it was lost.
    await pool.query(
      `update core.billing_test_objects set data = data || jsonb_build_object('status', 'canceled', 'endedAt', $2::text, 'canceledAt', $2::text) where id = $1`,
      [row.sub, s.clock.at.toISOString()],
    );
    s.advance(32 * DAY);
    await pool.query(`update core.billing_subscriptions set gateway_synced_at = $2 where org_id = $1`, [s.org.orgId, new Date(s.clock.at.getTime() - 2 * HOUR)]);

    expect(await reconcileSubscriptions(s.rt, { limit: 100 })).toBeGreaterThanOrEqual(1);
    expect((await one<{ status: string }>(`select status from core.billing_subscriptions where org_id = $1`, [s.org.orgId])).status).toBe('canceled');
    expect((await getPlanState(s.rt, s.org.orgId)).modules.crm.access).not.toBe('full');
    const refreshed = await refreshFromGateway(s.rt, s.org.orgId);
    expect(refreshed.ok).toBe(true);
  });

  it('a subscription of another organization is still refused, whatever the event says', async () => {
    const mine = await scene();
    const theirs = await scene();
    await paidPlan(mine, CRM(2));
    await paidPlan(theirs, CRM(3));
    const other = await one<{ sub: string; customer: string }>(
      `select gateway_subscription_id as sub, gateway_customer_id as customer from core.billing_subscriptions where org_id = $1`,
      [theirs.org.orgId],
    );
    const before = await one<{ sub: string; seats: number }>(`select gateway_subscription_id as sub, seats from core.billing_subscriptions where org_id = $1`, [mine.org.orgId]);
    const at = mine.rt.now();
    const rawBody = JSON.stringify({
      id: `evt_test_round2_${Math.random().toString(36).slice(2)}`,
      object: 'event',
      type: 'customer.subscription.updated',
      created: Math.floor(at.getTime() / 1000),
      data: { object: { id: other.sub, object: 'subscription', customer: 'cus_test_nobody', status: 'active', metadata: { kitstak_org_id: mine.org.orgId } } },
    });
    const outcome = await processWebhook(mine.rt, { rawBody, signature: signTestPayload(rawBody, mine.rt.config.testWebhookSecret, at) });
    expect(outcome).toMatchObject({ status: 200, result: 'ignored' });
    expect(await one(`select gateway_subscription_id as sub, seats from core.billing_subscriptions where org_id = $1`, [mine.org.orgId])).toEqual(before);
    expect((await one<{ id: string }>(`select stripe_customer_id as id from core.stripe_customers where org_id = $1`, [theirs.org.orgId])).id).toBe(other.customer);
  });
});

describe.skipIf(!available)('the same plan change confirmed at the same moment', () => {
  it('three confirms at once: one invoice, one charge, one activity line, one receipt', async () => {
    const s = await scene();
    await paidPlan(s, CRM(1));
    s.advance(5 * DAY + HOUR);
    const preview = await previewPlanChange(s.rt, { orgId: s.org.orgId, selection: CRM(5) });
    if (!preview.ok) throw new Error(preview.error.message);
    expect(preview.data.dueTodayCents).toBe(9667);
    const receiptsBefore = await mails(s.org.orgId, 'receipt');

    const confirm = () =>
      applyPlanChange(s.rt, { orgId: s.org.orgId, selection: CRM(5), basis: preview.data.basis, expectedDueTodayCents: preview.data.dueTodayCents, actor: s.actor });
    const results = await Promise.all([confirm(), confirm(), confirm()]);
    // Each one is told the truth: the plan now has 5 seats. Nobody is told to pay again.
    for (const result of results) {
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.selection.seats).toBe(5);
    }

    const invoices = await all<{ total_cents: number; status: string }>(
      `select total_cents, status from core.billing_invoices where org_id = $1 and billing_reason = 'subscription_update'`,
      [s.org.orgId],
    );
    expect(invoices).toEqual([{ total_cents: 9667, status: 'paid' }]);
    const gatewayInvoices = await all(`select id from core.billing_test_objects where org_id = $1 and kind = 'invoice'`, [s.org.orgId]);
    expect(gatewayInvoices).toHaveLength(2);
    const changed = await audits(s.org.orgId, 'plan.changed');
    expect(changed).toHaveLength(1);
    expect(changed[0]?.summary).toContain('$96.67 was charged for the days left.');
    expect(changed[0]?.data.invoiceId).toBeTruthy();
    expect(await audits(s.org.orgId, 'payment.succeeded')).toHaveLength(2);
    expect(await mails(s.org.orgId, 'receipt')).toBe(receiptsBefore + 1);
    expect(await all(`select 1 from core.billing_locks where org_id = $1`, [s.org.orgId])).toEqual([]);

    // The basis that was used is stale now, for any other change.
    const replay = await applyPlanChange(s.rt, { orgId: s.org.orgId, selection: CRM(50), basis: preview.data.basis, expectedDueTodayCents: preview.data.dueTodayCents, actor: s.actor });
    expect(replay.ok ? 'ok' : replay.error.code).toBe('price_changed');
  });

  it('two different changes confirmed at once from the same preview state: one lands, the other is asked to look again', async () => {
    const s = await scene();
    await paidPlan(s, CRM(1));
    s.advance(5 * DAY + HOUR);
    const three = await previewPlanChange(s.rt, { orgId: s.org.orgId, selection: CRM(3) });
    const seven = await previewPlanChange(s.rt, { orgId: s.org.orgId, selection: CRM(7) });
    if (!three.ok || !seven.ok) throw new Error('preview failed');
    expect(three.data.basis).toBe(seven.data.basis);

    const results = await Promise.all([
      applyPlanChange(s.rt, { orgId: s.org.orgId, selection: CRM(3), basis: three.data.basis, expectedDueTodayCents: three.data.dueTodayCents, actor: s.actor }),
      applyPlanChange(s.rt, { orgId: s.org.orgId, selection: CRM(7), basis: seven.data.basis, expectedDueTodayCents: seven.data.dueTodayCents, actor: s.actor }),
    ]);
    expect(results.map((result) => (result.ok ? 'ok' : result.error.code)).sort()).toEqual(['ok', 'price_changed']);
    expect(await audits(s.org.orgId, 'plan.changed')).toHaveLength(1);
    const invoices = await all(`select id from core.billing_invoices where org_id = $1 and billing_reason = 'subscription_update'`, [s.org.orgId]);
    expect(invoices).toHaveLength(1);
  });

  it('the activity line takes its amounts from what the gateway did: credit added and credit used', async () => {
    const s = await scene();
    await paidPlan(s, CRM(5));
    s.advance(5 * DAY + HOUR);
    const down = await previewPlanChange(s.rt, { orgId: s.org.orgId, selection: CRM(1) });
    if (!down.ok) throw new Error(down.error.message);
    await applyPlanChange(s.rt, { orgId: s.org.orgId, selection: CRM(1), basis: down.data.basis, expectedDueTodayCents: 0, actor: s.actor });
    const credit = (await one<{ credit: number }>(`select credit_cents as credit from core.billing_subscriptions where org_id = $1`, [s.org.orgId])).credit;
    expect(credit).toBe(down.data.creditCents);
    const up = await previewPlanChange(s.rt, { orgId: s.org.orgId, selection: CRM(2) });
    if (!up.ok) throw new Error(up.error.message);
    expect(up.data.dueTodayCents).toBe(0);
    await applyPlanChange(s.rt, { orgId: s.org.orgId, selection: CRM(2), basis: up.data.basis, expectedDueTodayCents: 0, actor: s.actor });
    const lines = await audits(s.org.orgId, 'plan.changed');
    expect(lines.map((row) => [row.data.creditCents, row.data.creditAppliedCents, row.data.dueTodayCents])).toEqual([
      [down.data.creditCents, 0, 0],
      [0, up.data.creditAppliedCents, 0],
    ]);
    expect(lines[1]?.summary).toContain('was paid from credit. Nothing was charged.');
  });
});

describe.skipIf(!available)('the confirm panel says why the amount is what it is', () => {
  const amounts = (text: string): number[] => [...text.matchAll(/\$([\d,]+\.\d\d)/g)].map((match) => Math.round(Number(match[1]!.replace(/,/g, '')) * 100));

  it('adding a seat names the days it is charged for, and taking it off names the full days that come back', async () => {
    const s = await scene();
    await paidPlan(s, CRM(5));
    s.advance(15 * DAY + HOUR);
    const add = await previewPlanChange(s.rt, { orgId: s.org.orgId, selection: CRM(6) });
    if (!add.ok) throw new Error(add.error.message);
    // $29.00 a seat, 15 of 30 days (today has started and counts).
    expect(add.data).toMatchObject({ dueTodayCents: 1450, daysLeft: 15, dueTodayNote: 'For the 15 days left in this period.', creditNote: null });

    const remove = await previewPlanChange(s.rt, { orgId: s.org.orgId, selection: CRM(4) });
    if (!remove.ok) throw new Error(remove.error.message);
    // 14 full days of 30.
    expect(remove.data).toMatchObject({
      dueTodayCents: 0,
      creditCents: 1353,
      daysLeft: 14,
      dueTodayNote: 'Nothing to pay now.',
      creditNote: 'That is for the 14 full days left in this period. A day that has started counts as used.',
    });
    expect(remove.data.lines.map((line) => line.description)).toEqual(['KitStak CRM: 1 user fewer, unused time, 14 full days left']);
  });

  it('monthly to yearly with credit on the account: a full year, less the unused month, less the credit, and it adds up', async () => {
    const s = await scene();
    await paidPlan(s, { products: ['crm', 'wms'], seats: 5, warehouses: 3, interval: 'monthly' });
    s.advance(HOUR);
    // Credit first: two warehouses fewer.
    const smaller: PlanSelection = { products: ['crm', 'wms'], seats: 5, warehouses: 1, interval: 'monthly' };
    const down = await previewPlanChange(s.rt, { orgId: s.org.orgId, selection: smaller });
    if (!down.ok) throw new Error(down.error.message);
    expect(down.data.creditCents).toBeGreaterThan(0);
    expect(down.data.creditNote).toBe('That is for the 29 full days left in this period. A day that has started counts as used.');
    const lowered = await applyPlanChange(s.rt, { orgId: s.org.orgId, selection: smaller, basis: down.data.basis, expectedDueTodayCents: 0, actor: s.actor });
    expect(lowered.ok).toBe(true);

    const yearly = await previewPlanChange(s.rt, { orgId: s.org.orgId, selection: { ...smaller, interval: 'yearly' } });
    if (!yearly.ok) throw new Error(yearly.error.message);
    const note = yearly.data.dueTodayNote;
    expect(note).toMatch(/^\$[\d,]+\.\d\d for the next year\. Less \$[\d,]+\.\d\d for the 29 full days left on your monthly plan\. Less \$[\d,]+\.\d\d from your credit\.$/);
    const [year, back, credit] = amounts(note);
    expect(year).toBe(yearly.data.newRecurringCents);
    expect(credit).toBe(yearly.data.creditAppliedCents);
    expect(year! - back! - credit!).toBe(yearly.data.dueTodayCents);

    // Without credit the same switch reads the same way, minus the last sentence.
    const fresh = await scene();
    await paidPlan(fresh, CRM(5));
    fresh.advance(HOUR);
    const plain = await previewPlanChange(fresh.rt, { orgId: fresh.org.orgId, selection: CRM(5, 'yearly') });
    if (!plain.ok) throw new Error(plain.error.message);
    expect(plain.data.dueTodayNote).toBe('$1,479.00 for the next year. Less $140.17 for the 29 full days left on your monthly plan.');
    expect(plain.data.dueTodayCents).toBe(147900 - 14017);
  });
});

describe.skipIf(!available)('the "fails at the next renewal" test card', () => {
  it('saved on the card page of an active plan: the very next renewal fails', async () => {
    const s = await scene();
    await paidPlan(s, CRM(2));
    const card = await createPaymentUpdateSession(s.rt, { orgId: s.org.orgId, actor: s.actor });
    if (!card.ok) throw new Error(card.error.message);
    const saved = await completeTestCardUpdate(s.rt, { sessionId: card.data.url.split('/').pop()!, ...CARD, cardNumber: FAILS_AT_RENEWAL });
    expect(saved.ok).toBe(true);

    s.advance(30 * DAY + HOUR);
    const due = await testRunDue(s.rt, { orgId: s.org.orgId });
    expect(due).toEqual({ renewed: 0, failed: 1 });
    expect((await getPlanState(s.rt, s.org.orgId)).phase).toBe('past_due');
    const renewal = await one<{ status: string }>(
      `select status from core.billing_invoices where org_id = $1 and billing_reason = 'subscription_cycle'`,
      [s.org.orgId],
    );
    expect(renewal.status).toBe('open');
  });

  it('used at a pay today checkout: the first bill and a seat added mid period are paid, the renewal fails', async () => {
    const s = await scene();
    await paidPlan(s, CRM(2), FAILS_AT_RENEWAL);
    s.advance(5 * DAY + HOUR);
    const preview = await previewPlanChange(s.rt, { orgId: s.org.orgId, selection: CRM(3) });
    if (!preview.ok) throw new Error(preview.error.message);
    expect(preview.data.dueTodayCents).toBeGreaterThan(0);
    const added = await applyPlanChange(s.rt, { orgId: s.org.orgId, selection: CRM(3), basis: preview.data.basis, expectedDueTodayCents: preview.data.dueTodayCents, actor: s.actor });
    expect(added.ok ? 'ok' : added.error.code).toBe('ok');

    s.advance(26 * DAY);
    expect(await testRunDue(s.rt, { orgId: s.org.orgId })).toEqual({ renewed: 0, failed: 1 });
    // "Pay now" on the renewal bill is a renewal charge too.
    s.advance(3 * DAY + HOUR);
    expect(await testRunDue(s.rt, { orgId: s.org.orgId })).toEqual({ renewed: 0, failed: 1 });
  });

  it('used at a free trial checkout: the first bill at the end of the trial is paid, the renewal after it fails', async () => {
    const s = await scene();
    const { startTrial } = await import('./trial');
    const trial = await startTrial(s.rt, { orgId: s.org.orgId, selection: CRM(2), actor: s.actor });
    expect(trial.ok).toBe(true);
    await paidPlan(s, CRM(2), FAILS_AT_RENEWAL);
    s.advance(14 * DAY + HOUR);
    expect(await testRunDue(s.rt, { orgId: s.org.orgId })).toEqual({ renewed: 1, failed: 0 });
    s.advance(31 * DAY);
    expect(await testRunDue(s.rt, { orgId: s.org.orgId })).toEqual({ renewed: 0, failed: 1 });
  });
});

describe.skipIf(!available)('one billing step at a time per organization', () => {
  it('steps of one organization run one after the other, and steps of two organizations do not wait for each other', async () => {
    const a = await scene();
    const b = await scene();
    const order: string[] = [];
    const step = (orgId: string, name: string, ms: number) =>
      withOrgBillingTurn(db, { orgId, purpose: 'test' }, async () => {
        order.push(`${name} in`);
        await new Promise((resolve) => setTimeout(resolve, ms));
        order.push(`${name} out`);
        return name;
      });
    const results = await Promise.all([step(a.org.orgId, 'a1', 150), step(a.org.orgId, 'a2', 10), step(b.org.orgId, 'b1', 10)]);
    expect(results).toEqual([
      { ok: true, value: 'a1' },
      { ok: true, value: 'a2' },
      { ok: true, value: 'b1' },
    ]);
    const a1 = [order.indexOf('a1 in'), order.indexOf('a1 out')];
    const a2 = [order.indexOf('a2 in'), order.indexOf('a2 out')];
    // Never inside each other.
    expect(a1[1]! < a2[0]! || a2[1]! < a1[0]!).toBe(true);
    // The other organization did not wait for the slow step.
    expect(order.indexOf('b1 out')).toBeLessThan(order.indexOf('a1 out'));
  });

  it('a turn that is not given back ends by itself, and a caller that cannot wait is told so', async () => {
    const s = await scene();
    await pool.query(
      `insert into core.billing_locks (org_id, holder, purpose, expires_at) values ($1, 'gone', 'test', now() + interval '1 hour')`,
      [s.org.orgId],
    );
    const refused = await withOrgBillingTurn(db, { orgId: s.org.orgId, purpose: 'test', waitMs: 200 }, async () => 'ran');
    expect(refused).toEqual({ ok: false });
    // The lease of a server that died has passed.
    await pool.query(`update core.billing_locks set expires_at = now() - interval '1 second' where org_id = $1`, [s.org.orgId]);
    const taken = await withOrgBillingTurn(db, { orgId: s.org.orgId, purpose: 'test', waitMs: 200 }, async () => 'ran');
    expect(taken).toEqual({ ok: true, value: 'ran' });
    expect(await all(`select 1 from core.billing_locks where org_id = $1`, [s.org.orgId])).toEqual([]);
  });

  it('a step that throws still gives the turn back', async () => {
    const s = await scene();
    await expect(
      withOrgBillingTurn(db, { orgId: s.org.orgId, purpose: 'test' }, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await all(`select 1 from core.billing_locks where org_id = $1`, [s.org.orgId])).toEqual([]);
  });
});

describe('the billing only role (pure)', () => {
  it('is free, is a billing manager by itself, and is not an owner or an admin', () => {
    expect(isFreeRole('billing')).toBe(true);
    expect(usesSeat('billing')).toBe(false);
    expect(isBillingOnlyRole('billing')).toBe(true);
    expect(hasBillingRole('member,billing')).toBe(true);
    // With another role it is a normal paid member who also manages billing.
    expect(isBillingOnlyRole('member,billing')).toBe(false);
    expect(usesSeat('member,billing')).toBe(true);
    expect(isBillingOnlyRole('deactivated:billing')).toBe(false);
    expect(billingAccessFor('billing', false, 'Maya Chen')).toMatchObject({
      isOwner: false,
      isAdmin: false,
      isBillingManager: true,
      canView: true,
      canManage: true,
      canStartTrial: true,
      canAssignManagers: false,
    });
    expect(billingAccessFor('deactivated:billing', false, null).canView).toBe(false);
    expect(billingAccessFor('guest', false, null).canView).toBe(false);
  });
});

describe.skipIf(!available)('a billing manager who holds no seat', () => {
  it('uses no seat as an invite or as a member, gets the billing mail, and leaves the organization when removed', async () => {
    const s = await scene();
    // A plan with 2 seats: the owner and one member. It is full.
    const member = await addPerson(pool, s.org.orgId, 'member', 'Sam Rivera');
    await paidPlan(s, CRM(2));
    const full = await checkSeatAvailable(db, { orgId: s.org.orgId, adding: 1, role: 'member' });
    expect(full.ok).toBe(false);

    // The invite for billing only is let through by the same hook that holds the seat limit.
    const hooks = billingOrganizationOptions({ db, portalUrl: TEST_PORTAL_URL, allowAll: () => false }).organizationHooks!;
    const organization = { id: s.org.orgId, name: s.org.name, slug: 'x', createdAt: new Date() };
    const inviter = { id: s.org.owner.id, email: s.org.owner.email, name: s.org.owner.name } as never;
    await expect(
      hooks.beforeCreateInvitation!({ invitation: { email: 'books@kitstak-test.example', role: 'billing', organizationId: s.org.orgId, inviterId: s.org.owner.id }, inviter, organization } as never),
    ).resolves.toBeUndefined();
    await expect(
      hooks.beforeCreateInvitation!({ invitation: { email: 'third@kitstak-test.example', role: 'member', organizationId: s.org.orgId, inviterId: s.org.owner.id }, inviter, organization } as never),
    ).rejects.toMatchObject({ body: { code: 'SEAT_LIMIT_REACHED' } });

    await pool.query(
      `insert into core.invitation (organization_id, email, role, status, expires_at, inviter_id) values ($1, $2, 'billing', 'pending', now() + interval '7 days', $3)`,
      [s.org.orgId, 'books@kitstak-test.example', s.org.owner.id],
    );
    expect(await countBillableSeats(db, s.org.orgId)).toEqual({ used: 2, pendingInvites: 0 });
    expect((await listBillingInvites(db, s.org.orgId)).map((row) => row.email)).toEqual(['books@kitstak-test.example']);

    // The address of a person who is already on the team is not invited; they are picked instead.
    expect(await checkBillingInvite(db, { orgId: s.org.orgId, email: ` ${member.email.toUpperCase()} ` })).toMatchObject({
      ok: false,
      error: { message: 'That person is already on your team. Pick them in the list instead.' },
    });
    expect(await checkBillingInvite(db, { orgId: s.org.orgId, email: 'not an address' })).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(await checkBillingInvite(db, { orgId: s.org.orgId, email: ' Books@Kitstak-Test.example ' })).toEqual({ ok: true, data: { email: 'books@kitstak-test.example' } });

    // The bookkeeper joins with the billing role.
    const books = await addPerson(pool, s.org.orgId, 'billing', 'Robin Vale');
    expect(await countBillableSeats(db, s.org.orgId)).toEqual({ used: 2, pendingInvites: 0 });
    const access = await getBillingAccess(db, { orgId: s.org.orgId, userId: books.id, role: 'billing' });
    expect(access).toMatchObject({ isBillingManager: true, canManage: true, canAssignManagers: false });
    const holders = await listBillingHolders(db, s.org.orgId);
    expect(holders.map((row) => [row.name, row.kind, row.billingOnly])).toEqual([
      ['Maya Chen', 'owner', false],
      ['Robin Vale', 'manager', true],
    ]);
    expect(await billingRecipients(db, s.org.orgId)).toEqual(expect.arrayContaining([s.org.owner.email, books.email]));
    expect(await billingRecipients(db, s.org.orgId)).not.toContain(member.email);
    // The plan still shows 2 of 2 seats used, not 3.
    expect((await getPlanState(s.rt, s.org.orgId)).usage.seatsUsed).toBe(2);

    // A member who is also made a billing manager keeps the seat and the member role.
    expect((await addBillingManager(s.rt, { orgId: s.org.orgId, userId: member.id, actor: s.actor })).ok).toBe(true);
    expect((await removeBillingManager(s.rt, { orgId: s.org.orgId, userId: member.id, actor: s.actor })).ok).toBe(true);
    expect(await all(`select role from core.member where organization_id = $1 and user_id = $2`, [s.org.orgId, member.id])).toEqual([{ role: 'member' }]);

    // Removing the bookkeeper removes them from the organization: billing was all they had.
    expect((await removeBillingManager(s.rt, { orgId: s.org.orgId, userId: books.id, actor: s.actor })).ok).toBe(true);
    expect(await all(`select role from core.member where organization_id = $1 and user_id = $2`, [s.org.orgId, books.id])).toEqual([]);
    expect((await listBillingHolders(db, s.org.orgId)).map((row) => row.name)).toEqual(['Maya Chen']);
    const removed = await audits(s.org.orgId, 'manager.removed');
    expect(removed[removed.length - 1]?.summary).toBe('Maya Chen removed Robin Vale as a billing manager. They no longer have access to this organization.');
    await pool.query(`delete from core."user" where id = any($1::uuid[])`, [[member.id, books.id]]);
  });
});
