/** Against the local dev Postgres (docs/billing/DEV.md). Skipped when it is not reachable. */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type EntitlementsDb, grantModule } from '@kitstak/entitlements';
import { type PlanSelection, isBundle, priceKey, quantityFor, unitCents } from '../catalog';
import type { GatewayInvoice, GatewaySubscription, GatewaySubscriptionStatus } from '../gateway/types';
import { createTestOrg, openTestDb, removeTestOrg, testRuntime, TEST_PORTAL_URL, type TestOrg } from '../testing/db';
import { getPlanState } from './state';
import { applyInvoiceSnapshot, applySubscriptionSnapshot } from './sync';
import { startTrial } from './trial';

const { pool, db, available } = await openTestDb();
vi.setConfig({ testTimeout: 30_000 });

const NOW = new Date('2026-12-10T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY);

/** Subscription ids are unique across orgs, so each test org gets its own. */
let subId = 'sub_test_sync_1';

function snapshot(selection: PlanSelection, overrides: Partial<GatewaySubscription> = {}): GatewaySubscription {
  const bundle = isBundle(selection.products);
  return {
    id: subId,
    customerId: 'cus_test_sync_1',
    orgId: null,
    status: 'active',
    interval: selection.interval,
    items: selection.products.map((product) => ({
      id: `si_${product}`,
      priceKey: priceKey(product, selection.interval, bundle),
      priceId: `price_test_${priceKey(product, selection.interval, bundle)}`,
      product,
      quantity: quantityFor(product, selection),
      unitCents: unitCents(product, selection.interval, bundle),
    })),
    currentPeriodStart: at(-5),
    currentPeriodEnd: at(25),
    trialEnd: null,
    cancelAtPeriodEnd: false,
    cancelAt: null,
    canceledAt: null,
    endedAt: null,
    pauseResumesAt: null,
    paymentMethod: { brand: 'visa', last4: '4242', expMonth: 8, expYear: 2028 },
    latestInvoiceId: null,
    ...overrides,
  };
}

function invoice(overrides: Partial<GatewayInvoice> = {}): GatewayInvoice {
  return {
    id: `in_test_sync_${Math.random().toString(36).slice(2)}`,
    customerId: 'cus_test_sync_1',
    subscriptionId: 'sub_test_sync_1',
    number: 'TEST-0001',
    status: 'open',
    billingReason: 'subscription_cycle',
    subtotalCents: 39520,
    discountCents: 0,
    taxCents: 0,
    totalCents: 39520,
    amountPaidCents: 0,
    amountDueCents: 39520,
    lines: [{ description: 'KitStak CRM (5 users)', product: 'crm', quantity: 5, unitCents: 2320, amountCents: 11600, proration: false }],
    periodStart: at(-2),
    periodEnd: at(28),
    issuedAt: at(-2),
    paidAt: null,
    attemptCount: 1,
    nextPaymentAttempt: at(1),
    lastErrorCode: 'card_declined',
    paymentMethodLast4: '4242',
    ...overrides,
  };
}

const CART: PlanSelection = { products: ['crm', 'wms'], seats: 5, warehouses: 1, interval: 'monthly' };

describe.skipIf(!available)('applySubscriptionSnapshot (database)', () => {
  const orgs: TestOrg[] = [];
  const rt = testRuntime(db, { now: () => NOW });
  let org: TestOrg;

  beforeEach(async () => {
    org = await createTestOrg(pool);
    orgs.push(org);
    subId = `sub_test_sync_${org.orgId}`;
  });

  afterAll(async () => {
    for (const made of orgs) await removeTestOrg(pool, made);
    await pool.end();
  });

  const apply = (subscription: GatewaySubscription, latestInvoice: GatewayInvoice | null = null, now = NOW) =>
    applySubscriptionSnapshot(db, { orgId: org.orgId, gateway: 'test', subscription, latestInvoice, now, portalUrl: TEST_PORTAL_URL });

  const entitlementRows = async () =>
    (
      await pool.query(
        `select module, status, source, seats, current_period_end, stripe_subscription_id, stripe_price_id
           from core.entitlements where org_id = $1 order by module`,
        [org.orgId],
      )
    ).rows;

  it('active: one active row per app from source stripe, with the period end, seats and gateway ids', async () => {
    await apply(snapshot(CART));
    const rows = await entitlementRows();
    expect(rows.map((row) => [row.module, row.status, row.source, row.seats, row.stripe_subscription_id, row.stripe_price_id])).toEqual([
      ['crm', 'active', 'stripe', 5, subId, 'price_test_kitstak_crm_monthly_bundle'],
      ['wms', 'active', 'stripe', null, subId, 'price_test_kitstak_wms_monthly_bundle'],
    ]);
    for (const row of rows) expect(new Date(row.current_period_end)).toEqual(at(25));

    const sub = (await pool.query(`select * from core.billing_subscriptions where org_id = $1`, [org.orgId])).rows[0];
    expect(sub).toMatchObject({ status: 'active', interval: 'monthly', seats: 5, warehouses: 1, recurring_cents: 39520, pm_last4: '4242', gateway: 'test' });
    expect(sub.items).toHaveLength(2);

    const state = await getPlanState(rt, org.orgId);
    expect(state.phase).toBe('active');
    expect(state.nextCharge).toEqual({ amountCents: 39520, at: at(25) });
  });

  it('trialing in the gateway (card saved): rows are active, and trial rows are replaced', async () => {
    await startTrial(rt, { orgId: org.orgId, selection: CART, actor: { userId: org.owner.id, label: org.owner.name } });
    await apply(snapshot(CART, { status: 'trialing', trialEnd: at(14), currentPeriodEnd: at(14) }));
    const rows = await entitlementRows();
    expect(rows.map((row) => [row.module, row.status, row.source])).toEqual([
      ['crm', 'active', 'stripe'],
      ['wms', 'active', 'stripe'],
    ]);
    const state = await getPlanState(rt, org.orgId);
    expect(state.phase).toBe('active');
    expect(state.trial?.endsAt).toEqual(at(14));
  });

  it('past_due: rows are past_due with the invoice day, so the grace math gives 7 days', async () => {
    await apply(snapshot(CART));
    await apply(snapshot(CART, { status: 'past_due' }), invoice());
    const rows = await entitlementRows();
    expect(rows.map((row) => row.status)).toEqual(['past_due', 'past_due']);
    for (const row of rows) expect(new Date(row.current_period_end)).toEqual(at(-2));

    const inGrace = await getPlanState(rt, org.orgId);
    expect(inGrace.phase).toBe('past_due');
    expect(inGrace.modules.crm.access).toBe('full');
    expect(inGrace.pastDue).toEqual({ since: at(-2), amountDueCents: 39520, nextRetryAt: at(1), accessChangesAt: at(5) });

    // A second failed try does not move the date the grace days count from.
    await apply(snapshot(CART, { status: 'past_due' }), invoice({ issuedAt: at(-2), attemptCount: 2, nextPaymentAttempt: at(6) }), at(3));
    const after = (await pool.query(`select past_due_since from core.billing_subscriptions where org_id = $1`, [org.orgId])).rows[0];
    expect(new Date(after.past_due_since)).toEqual(at(-2));

    const late = await getPlanState(testRuntime(db, { now: () => at(6) }), org.orgId);
    expect(late.phase).toBe('unpaid');
    expect(late.modules.crm.access).toBe('read_only');

    // Paying clears it at once.
    await apply(snapshot(CART, { status: 'active' }), invoice({ status: 'paid', amountDueCents: 0, amountPaidCents: 39520 }), at(6));
    const paid = await getPlanState(testRuntime(db, { now: () => at(6) }), org.orgId);
    expect(paid.phase).toBe('active');
    expect(paid.modules.crm.access).toBe('full');
    expect(paid.pastDue).toBeNull();
  });

  it.each(['unpaid', 'canceled'] as GatewaySubscriptionStatus[])('%s: rows are canceled and the apps are view only', async (status) => {
    await apply(snapshot(CART));
    await apply(snapshot(CART, { status, endedAt: status === 'canceled' ? at(-1) : null, canceledAt: status === 'canceled' ? at(-1) : null }));
    const rows = await entitlementRows();
    expect(rows.map((row) => [row.module, row.status, row.source])).toEqual([
      ['crm', 'canceled', 'stripe'],
      ['wms', 'canceled', 'stripe'],
    ]);
    const state = await getPlanState(rt, org.orgId);
    expect(state.phase).toBe(status === 'canceled' ? 'ended' : 'unpaid');
    expect(state.modules.crm.access).toBe('read_only');
    expect(state.modules.projects.access).toBe('locked');
  });

  it('incomplete: the subscription row is written and no access is granted', async () => {
    await apply(snapshot(CART, { status: 'incomplete' }));
    expect(await entitlementRows()).toEqual([]);
    const sub = (await pool.query(`select status from core.billing_subscriptions where org_id = $1`, [org.orgId])).rows[0];
    expect(sub.status).toBe('incomplete');
    const state = await getPlanState(rt, org.orgId);
    expect(state.hasSubscription).toBe(false);
    expect(state.modules.crm.access).toBe('locked');
  });

  it('pause: full access until the pause starts, then view only; ending the pause turns it back on', async () => {
    await apply(snapshot(CART));
    await apply(snapshot(CART, { pauseResumesAt: at(86) }));
    let rows = await entitlementRows();
    expect(rows.map((row) => row.status)).toEqual(['canceled', 'canceled']);
    for (const row of rows) expect(new Date(row.current_period_end)).toEqual(at(25));
    expect((await getPlanState(rt, org.orgId)).phase).toBe('pause_scheduled');
    expect((await getPlanState(rt, org.orgId)).modules.crm.access).toBe('full');

    // Inside the pause the period has rolled on. The start of the pause is kept.
    const inPause = testRuntime(db, { now: () => at(30) });
    await apply(snapshot(CART, { pauseResumesAt: at(86), currentPeriodStart: at(25), currentPeriodEnd: at(55) }), null, at(30));
    const paused = await getPlanState(inPause, org.orgId);
    expect(paused.phase).toBe('paused');
    expect(paused.pause).toEqual({ startsAt: at(25), resumesAt: at(86) });
    expect(paused.modules.crm.access).toBe('read_only');

    await apply(snapshot(CART, { currentPeriodStart: at(86), currentPeriodEnd: at(116) }), null, at(86));
    rows = await entitlementRows();
    expect(rows.map((row) => row.status)).toEqual(['active', 'active']);
    const audits = (await pool.query(`select action from core.billing_audit_log where org_id = $1 order by created_at, action`, [org.orgId])).rows.map((row) => row.action);
    expect(audits).toEqual(expect.arrayContaining(['plan.started', 'plan.paused', 'plan.resumed']));
    expect(audits.filter((action) => action === 'plan.paused')).toHaveLength(1);
  });

  it('an app removed from the plan becomes view only; the others keep full access', async () => {
    await apply(snapshot(CART));
    await apply(snapshot({ ...CART, products: ['wms'] }));
    const rows = await entitlementRows();
    expect(rows.map((row) => [row.module, row.status])).toEqual([
      ['crm', 'canceled'],
      ['wms', 'active'],
    ]);
    // WMS moved from its bundle price to its list price in the same change.
    expect(rows[1].stripe_price_id).toBe('price_test_kitstak_wms_monthly');
    const state = await getPlanState(rt, org.orgId);
    expect(state.modules.crm).toMatchObject({ access: 'read_only', inPlan: false });
    expect(state.modules.wms).toMatchObject({ access: 'full', inPlan: true });
  });

  it('a manual grant is never touched, whatever the gateway says', async () => {
    await grantModule(db as unknown as EntitlementsDb, org.orgId, 'crm', 'manual');
    await apply(snapshot(CART));
    await apply(snapshot(CART, { status: 'canceled', endedAt: at(-1) }));
    const rows = await entitlementRows();
    expect(rows.map((row) => [row.module, row.status, row.source])).toEqual([
      ['crm', 'active', 'manual'],
      ['wms', 'canceled', 'stripe'],
    ]);
    expect((await getPlanState(rt, org.orgId)).modules.crm).toMatchObject({ access: 'full', source: 'manual' });
  });

  it('an old object of a replaced subscription cannot undo the live one', async () => {
    await apply(snapshot(CART, { id: `${subId}_new` }));
    await apply(snapshot(CART, { id: `${subId}_old`, status: 'canceled', endedAt: at(-40) }));
    const sub = (await pool.query(`select gateway_subscription_id, status from core.billing_subscriptions where org_id = $1`, [org.orgId])).rows[0];
    expect(sub).toEqual({ gateway_subscription_id: `${subId}_new`, status: 'active' });
    expect((await entitlementRows()).map((row) => row.status)).toEqual(['active', 'active']);
  });

  it('applying the same snapshot twice changes nothing and audits once', async () => {
    await apply(snapshot(CART));
    await apply(snapshot(CART));
    const audits = (await pool.query(`select action, summary from core.billing_audit_log where org_id = $1`, [org.orgId])).rows;
    expect(audits).toEqual([{ action: 'plan.started', summary: 'The plan started: CRM and WMS for $395.20 per month.' }]);
    const emails = (await pool.query(`select template, to_email from core.billing_emails where org_id = $1`, [org.orgId])).rows;
    expect(emails).toEqual([{ template: 'plan_started', to_email: org.owner.email }]);
  });

  it('the plan ending is recorded once, with an email', async () => {
    await apply(snapshot(CART));
    await apply(snapshot(CART, { status: 'canceled', endedAt: NOW, canceledAt: NOW }));
    await apply(snapshot(CART, { status: 'canceled', endedAt: NOW, canceledAt: NOW }));
    const audits = (await pool.query(`select action from core.billing_audit_log where org_id = $1 and action = 'plan.ended'`, [org.orgId])).rows;
    expect(audits).toHaveLength(1);
    const emails = (await pool.query(`select template from core.billing_emails where org_id = $1 and template = 'plan_ended'`, [org.orgId])).rows;
    expect(emails).toHaveLength(1);
  });

  it('caches invoices, and never lets one org write over another org\'s invoice', async () => {
    const mine = invoice({ id: `in_test_sync_owned_${org.orgId}` });
    await applyInvoiceSnapshot(db, { orgId: org.orgId, gateway: 'test', invoice: mine });
    await applyInvoiceSnapshot(db, { orgId: org.orgId, gateway: 'test', invoice: { ...mine, status: 'paid', amountDueCents: 0, amountPaidCents: 39520, paidAt: NOW } });
    const other = await createTestOrg(pool);
    orgs.push(other);
    await applyInvoiceSnapshot(db, { orgId: other.orgId, gateway: 'test', invoice: { ...mine, totalCents: 1 } });
    const stored = (await pool.query(`select org_id, status, total_cents, amount_paid_cents from core.billing_invoices where id = $1`, [mine.id])).rows;
    expect(stored).toEqual([{ org_id: org.orgId, status: 'paid', total_cents: 39520, amount_paid_cents: 39520 }]);
  });
});
