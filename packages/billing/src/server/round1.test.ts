/**
 * Review round 1 fixes, each proven against the local dev Postgres through the test gateway (the
 * same webhook path Stripe uses). Skipped when the database is not reachable.
 *
 *  - two pay pages can never both be paid, and a second live subscription is canceled and refunded,
 *  - the server picks the proration date: whole days, and a date from the browser moves nothing,
 *  - a stale confirm panel is refused even when the dollars match,
 *  - credit and the real next charge are in the plan state, a promo code too,
 *  - an open invite holds a seat,
 *  - a billing manager who leaves loses the role at every door,
 *  - inviting needs a verified email at the endpoint itself, with a daily cap per organization.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createAuth } from '@kitstak/auth';
import * as schema from '@kitstak/db/schema';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { PlanSelection } from '../catalog';
import { applyTestPromo, completeTestCheckout, getTestCheckout, testRunDue } from '../gateway/test';
import { addPerson, createTestOrg, openTestDb, removeTestOrg, testRuntime, TEST_PORTAL_URL, type TestOrg } from '../testing/db';
import { addBillingManager } from './access';
import { billingOrganizationOptions, INVITES_PER_DAY } from './auth-hooks';
import { applyPlanChange, previewPlanChange } from './changes';
import { createCheckout, syncCheckoutSession } from './checkout';
import type { BillingRuntime } from './db';
import { signInviteProof, verifyInviteProof } from './invite-proof';
import { listInvoices } from './invoices';
import { getPlanState } from './state';
import { fetchAndApplySubscription } from './sync';
import { startTrial } from './trial';

const { pool, db, available } = await openTestDb();
vi.setConfig({ testTimeout: 90_000 });

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const CARD = { cardNumber: '4242 4242 4242 4242', expMonth: 12, expYear: 2031, cvc: '123', name: 'Maya Chen', postalCode: '60601' };
const CRM = (seats: number, interval: 'monthly' | 'yearly' = 'monthly'): PlanSelection => ({ products: ['crm'], seats, warehouses: 1, interval });

const orgs: TestOrg[] = [];
const extraUsers: string[] = [];

interface Scene {
  readonly org: TestOrg;
  readonly rt: BillingRuntime;
  readonly clock: { at: Date };
  readonly actor: { userId: string; label: string };
  advance(ms: number): void;
}

async function scene(start = '2026-11-01T00:00:00.000Z', extraRoles: readonly string[] = []): Promise<Scene> {
  const org = await createTestOrg(pool, extraRoles);
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

async function openCheckout(s: Scene, selection: PlanSelection) {
  const checkout = await createCheckout(s.rt, { orgId: s.org.orgId, orgName: s.org.name, selection, actor: s.actor, actorEmail: s.org.owner.email });
  if (!checkout.ok) throw new Error(checkout.error.message);
  return checkout.data;
}

async function pay(s: Scene, selection: PlanSelection, promoCode?: string) {
  const checkout = await openCheckout(s, selection);
  const result = await completeTestCheckout(s.rt, { sessionId: checkout.sessionId, ...CARD, ...(promoCode ? { promoCode } : {}) });
  if (!result.ok) throw new Error(result.error.message);
  return checkout;
}

/** Previews a change and confirms it the way the panel does: with the basis and the amount it showed. */
async function change(s: Scene, selection: PlanSelection, options: { prorationDate?: Date } = {}) {
  const preview = await previewPlanChange(s.rt, { orgId: s.org.orgId, selection });
  if (!preview.ok) throw new Error(preview.error.message);
  const applied = await applyPlanChange(s.rt, {
    orgId: s.org.orgId,
    selection,
    basis: preview.data.basis,
    expectedDueTodayCents: preview.data.dueTodayCents,
    actor: s.actor,
    ...(options.prorationDate ? { prorationDate: options.prorationDate } : {}),
  });
  if (!applied.ok) throw new Error(applied.error.message);
  return { preview: preview.data, state: applied.data };
}

const testDocs = async (orgId: string, kind: string) =>
  (await pool.query<{ id: string; data: Record<string, unknown> }>(`select id, data from core.billing_test_objects where org_id = $1 and kind = $2 order by created_at`, [orgId, kind])).rows;
const auditsOf = async (orgId: string) =>
  (await pool.query<{ action: string; summary: string }>(`select action, summary from core.billing_audit_log where org_id = $1 order by created_at, id`, [orgId])).rows;
const paidOnCard = async (orgId: string) =>
  (await listInvoices(db, { orgId })).filter((invoice) => invoice.status === 'paid').reduce((sum, invoice) => sum + invoice.amountPaidCents, 0);

afterAll(async () => {
  for (const org of orgs) await removeTestOrg(pool, org, extraUsers);
  if (extraUsers.length > 0) await pool.query(`delete from core."user" where id = any($1::uuid[])`, [extraUsers]);
  await pool.end();
});

describe('invite proof', () => {
  const secret = 'a-secret-that-is-long-enough-for-tests-0001';
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
  it('only checks out for the invitation and the address it was made for', () => {
    const proof = signInviteProof(secret, id, 'Casey@Northwind.example');
    expect(proof).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(verifyInviteProof(secret, id, 'casey@northwind.example', proof)).toBe(true);
    expect(verifyInviteProof(secret, id, 'other@northwind.example', proof)).toBe(false);
    expect(verifyInviteProof(secret, '11111111-d9cb-469f-a165-70867728950e', 'casey@northwind.example', proof)).toBe(false);
    expect(verifyInviteProof('another-secret-another-secret-another-0002', id, 'casey@northwind.example', proof)).toBe(false);
    expect(verifyInviteProof(secret, id, 'casey@northwind.example', null)).toBe(false);
    expect(verifyInviteProof(secret, id, 'casey@northwind.example', `${proof.slice(0, 42)}x`)).toBe(false);
    expect(verifyInviteProof('', id, 'casey@northwind.example', proof)).toBe(false);
  });
});

describe.skipIf(!available)('one plan per organization (two checkout sessions)', () => {
  it('a new pay page closes the older one, so only one can be paid', async () => {
    const s = await scene();
    const first = await openCheckout(s, CRM(1));
    const second = await openCheckout(s, CRM(500));
    expect((await s.rt.gateway!.getCheckoutSession(first.sessionId))?.status).toBe('expired');
    expect((await s.rt.gateway!.getCheckoutSession(second.sessionId))?.status).toBe('open');

    const closed = await completeTestCheckout(s.rt, { sessionId: first.sessionId, ...CARD });
    expect(closed).toMatchObject({ ok: false, error: { code: 'not_found', message: 'This checkout page has closed. Go back to Billing and start again.' } });
    expect(await testDocs(s.org.orgId, 'subscription')).toHaveLength(0);

    const paid = await completeTestCheckout(s.rt, { sessionId: second.sessionId, ...CARD });
    expect(paid.ok).toBe(true);
    // A third page cannot even be opened: the plan exists.
    const again = await createCheckout(s.rt, { orgId: s.org.orgId, orgName: s.org.name, selection: CRM(2), actor: s.actor, actorEmail: s.org.owner.email });
    expect(again).toMatchObject({ ok: false, error: { code: 'already_subscribed' } });
  });

  it('two sessions, both paid at the same moment: one live subscription and one charge', async () => {
    const s = await scene();
    const gateway = s.rt.gateway!;
    const first = await openCheckout(s, { products: ['pulse'], seats: 1, warehouses: 1, interval: 'monthly' });
    const customerId = (await gateway.getCheckoutSession(first.sessionId))!.customerId!;
    // A second session made behind the server's back (the worst case: nothing expired it).
    const second = await gateway.createCheckoutSession({
      orgId: s.org.orgId,
      customerId,
      selection: CRM(500),
      trialEnd: null,
      successUrl: `${TEST_PORTAL_URL}/billing/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${TEST_PORTAL_URL}/billing/checkout/canceled`,
    });

    const results = await Promise.all([
      completeTestCheckout(s.rt, { sessionId: first.sessionId, ...CARD }),
      completeTestCheckout(s.rt, { sessionId: second.id, ...CARD }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const refused = results.find((result) => !result.ok);
    expect(refused).toMatchObject({ ok: false, error: { code: 'already_subscribed', message: 'You already have a plan. Nothing was charged here.' } });

    const subscriptions = await testDocs(s.org.orgId, 'subscription');
    expect(subscriptions).toHaveLength(1);
    const invoices = await testDocs(s.org.orgId, 'invoice');
    expect(invoices.filter((doc) => doc.data.status === 'paid')).toHaveLength(1);
    const row = (await pool.query(`select gateway_subscription_id, status from core.billing_subscriptions where org_id = $1`, [s.org.orgId])).rows;
    expect(row).toEqual([{ gateway_subscription_id: subscriptions[0]!.id, status: 'active' }]);
    // The return page of the page that lost shows the plan that exists and charges nothing.
    const loser = results[0]!.ok ? second.id : first.sessionId;
    const synced = await syncCheckoutSession(s.rt, { orgId: s.org.orgId, sessionId: loser });
    expect(synced).toMatchObject({ ok: true, data: { hasSubscription: true } });
    expect((await listInvoices(db, { orgId: s.org.orgId })).filter((invoice) => invoice.status === 'paid')).toHaveLength(1);
  });

  it('a second live subscription that still got through is canceled and refunded, never applied', async () => {
    const s = await scene();
    await pay(s, CRM(2));
    const [kept] = await testDocs(s.org.orgId, 'subscription');
    const [firstInvoice] = await testDocs(s.org.orgId, 'invoice');
    // What Stripe would hold after two pages were both paid: a second live subscription with its own paid invoice.
    const dupSub = `sub_test_dup_${Date.now().toString(36)}`;
    const dupInvoice = `in_test_dup_${Date.now().toString(36)}`;
    await pool.query(`insert into core.billing_test_objects (id, kind, org_id, data) values ($1, 'invoice', $2, $3)`, [
      dupInvoice,
      s.org.orgId,
      JSON.stringify({ ...firstInvoice!.data, id: dupInvoice, subscriptionId: dupSub, number: 'TEST-0002', totalCents: 1450000, amountPaidCents: 1450000, subtotalCents: 1450000 }),
    ]);
    await pool.query(`insert into core.billing_test_objects (id, kind, org_id, data) values ($1, 'subscription', $2, $3)`, [
      dupSub,
      s.org.orgId,
      JSON.stringify({ ...kept!.data, id: dupSub, seats: 500, latestInvoiceId: dupInvoice }),
    ]);

    const applied = await db.transaction(async (tx) => fetchAndApplySubscription(s.rt, tx, { orgId: s.org.orgId, subscriptionId: dupSub }));
    expect(applied).toBeNull();

    const row = (await pool.query(`select gateway_subscription_id, seats, status from core.billing_subscriptions where org_id = $1`, [s.org.orgId])).rows[0];
    expect(row).toEqual({ gateway_subscription_id: kept!.id, seats: 2, status: 'active' });
    const after = await testDocs(s.org.orgId, 'subscription');
    expect(after.find((doc) => doc.id === dupSub)?.data.status).toBe('canceled');
    expect(after.find((doc) => doc.id === kept!.id)?.data.status).toBe('active');
    expect((await testDocs(s.org.orgId, 'invoice')).find((doc) => doc.id === dupInvoice)?.data.refundedCents).toBe(1450000);
    const stored = (await pool.query(`select refunded_cents, amount_paid_cents from core.billing_invoices where id = $1`, [dupInvoice])).rows[0];
    expect(stored).toEqual({ refunded_cents: 1450000, amount_paid_cents: 1450000 });
    expect((await auditsOf(s.org.orgId)).find((entry) => entry.action === 'checkout.duplicate_refunded')?.summary).toBe(
      'A second payment of $14,500.00 came in for a plan you already have. We canceled it and sent the money back.',
    );
    // Entitlement seats did not flip to the newcomer.
    const seats = (await pool.query(`select seats from core.entitlements where org_id = $1 and module = 'crm'`, [s.org.orgId])).rows[0];
    expect(seats).toEqual({ seats: 2 });

    // A later event of the canceled newcomer changes nothing either.
    await db.transaction(async (tx) => fetchAndApplySubscription(s.rt, tx, { orgId: s.org.orgId, subscriptionId: dupSub }));
    expect((await getPlanState(s.rt, s.org.orgId)).selection.seats).toBe(2);
  });
});

describe.skipIf(!available)('the server picks the proration date', () => {
  it('whole days: the amount matches "days left" and does not move within a day', async () => {
    const s = await scene('2026-11-01T09:30:00.000Z');
    await pay(s, CRM(5));

    // Paid minutes ago: one more seat costs the full $29.00, "for the 30 days left".
    const amounts: number[] = [];
    for (const wait of [3 * MINUTE, 4 * MINUTE, 5 * HOUR, 18 * HOUR]) {
      s.advance(wait);
      const preview = await previewPlanChange(s.rt, { orgId: s.org.orgId, selection: CRM(6) });
      if (!preview.ok) throw new Error(preview.error.message);
      amounts.push(preview.data.dueTodayCents);
      expect(preview.data.daysLeft).toBe(30);
      expect(preview.data.lines[0]?.description).toBe('KitStak CRM: 1 user more for the 30 days left in this period');
      expect(preview.data.prorationDate).toEqual(new Date('2026-11-01T09:30:00.000Z'));
    }
    expect(amounts).toEqual([2900, 2900, 2900, 2900]);

    // Half way through day 16: 15 days are left for a charge (the started day counts) ...
    s.clock.at = new Date('2026-11-16T21:30:00.000Z');
    const more = await previewPlanChange(s.rt, { orgId: s.org.orgId, selection: CRM(6) });
    expect(more).toMatchObject({ ok: true, data: { dueTodayCents: 1450, daysLeft: 15, proratedCents: 1450, creditAppliedCents: 0 } });
    // ... and 14 full days for a credit.
    const fewer = await previewPlanChange(s.rt, { orgId: s.org.orgId, selection: CRM(4) });
    expect(fewer).toMatchObject({ ok: true, data: { dueTodayCents: 0, creditCents: Math.round((2900 * 14) / 30), daysLeft: 14 } });
  });

  it('adding seats and taking them off again, with a back dated date from the browser, never leaves more credit than was paid', async () => {
    const s = await scene('2026-11-01T00:00:00.000Z');
    await pay(s, CRM(1));
    const planPrice = 2900;
    const oneDay = Math.round((499 * 2900) / 30);

    for (let cycle = 1; cycle <= 5; cycle += 1) {
      s.advance(MINUTE);
      const up = await change(s, CRM(500));
      s.advance(MINUTE);
      // The attack from the review: confirm the downgrade with a date 59 minutes in the past.
      const down = await change(s, CRM(1), { prorationDate: new Date(s.clock.at.getTime() - 59 * MINUTE) });

      const credit = down.state.creditCents;
      const charged = (await paidOnCard(s.org.orgId)) - planPrice;
      // What the card paid for the seats is always more than the credit that came back.
      expect(credit).toBeLessThanOrEqual(up.preview.proratedCents);
      expect(charged).toBeGreaterThan(credit);
      // Every round trip costs one full day of the extra seats. Nothing is free.
      expect(charged - credit).toBeGreaterThanOrEqual(cycle * oneDay - cycle);
    }
    const state = await getPlanState(s.rt, s.org.orgId);
    expect(state.selection.seats).toBe(1);
  });

  it('refuses a confirm with no basis, and a wrong amount', async () => {
    const s = await scene();
    await pay(s, CRM(5));
    s.advance(DAY);
    const preview = await previewPlanChange(s.rt, { orgId: s.org.orgId, selection: CRM(6) });
    if (!preview.ok) throw new Error(preview.error.message);
    const noBasis = await applyPlanChange(s.rt, { orgId: s.org.orgId, selection: CRM(6), basis: '', expectedDueTodayCents: preview.data.dueTodayCents, actor: s.actor });
    expect(noBasis).toMatchObject({ ok: false, error: { code: 'price_changed' } });
    const wrongAmount = await applyPlanChange(s.rt, { orgId: s.org.orgId, selection: CRM(6), basis: preview.data.basis, expectedDueTodayCents: preview.data.dueTodayCents - 1, actor: s.actor });
    expect(wrongAmount).toMatchObject({ ok: false, error: { code: 'price_changed' } });
    expect((await getPlanState(s.rt, s.org.orgId)).selection.seats).toBe(5);
  });
});

describe.skipIf(!available)('a stale confirm panel', () => {
  it('is refused when another change landed first, even when the dollars match', async () => {
    const s = await scene('2026-11-01T00:00:00.000Z');
    await pay(s, CRM(5));
    s.advance(2 * DAY + HOUR);
    await change(s, CRM(3)); // two seats of credit on the account
    s.advance(MINUTE);

    // Tab 1: "Add 1 seat. Due today $0.00" (the credit pays for it).
    const tabOne = await previewPlanChange(s.rt, { orgId: s.org.orgId, selection: CRM(4) });
    if (!tabOne.ok) throw new Error(tabOne.error.message);
    expect(tabOne.data.dueTodayCents).toBe(0);
    expect(tabOne.data.creditAppliedCents).toBeGreaterThan(0);

    // Tab 2: adds 2 seats and confirms. The plan is now 5 seats.
    s.advance(MINUTE);
    const tabTwo = await change(s, CRM(5));
    expect(tabTwo.state.selection.seats).toBe(5);

    // Tab 1 presses Confirm. From 5 seats, "4 seats" would be a removal that costs $0.00 too.
    s.advance(MINUTE);
    const fresh = await previewPlanChange(s.rt, { orgId: s.org.orgId, selection: CRM(4) });
    expect(fresh).toMatchObject({ ok: true, data: { dueTodayCents: 0 } });
    const stale = await applyPlanChange(s.rt, { orgId: s.org.orgId, selection: CRM(4), basis: tabOne.data.basis, expectedDueTodayCents: 0, actor: s.actor });
    expect(stale).toEqual({ ok: false, error: { code: 'price_changed', message: 'The amount changed while you were looking. Check the new amount and confirm again.' } });
    expect((await getPlanState(s.rt, s.org.orgId)).selection.seats).toBe(5);
  });
});

describe.skipIf(!available)('credit and the real next charge', () => {
  it('monthly to yearly and back: the credit shows, the next charge is what the card will pay, and a renewal paid by credit says so', async () => {
    const s = await scene('2026-11-01T00:00:00.000Z');
    await pay(s, CRM(3));
    s.advance(DAY + HOUR);
    await change(s, CRM(3, 'yearly'));
    s.advance(HOUR);
    const back = await change(s, CRM(3, 'monthly'));

    // The yearly price is $887.40. 364 full days of it came back, less the $87.00 for the new month.
    const yearlyCredit = Math.round((88740 * 364) / 365);
    expect(back.preview.creditCents).toBe(yearlyCredit - 8700);
    const state = back.state;
    expect(state.creditCents).toBe(yearlyCredit - 8700);
    expect(state.nextCharge).toMatchObject({ amountCents: 0, planCents: 8700, creditAppliedCents: 8700 });
    expect((await auditsOf(s.org.orgId)).at(-1)?.summary).toContain('credit was added. It comes off the next bills.');

    // Renewal day: an invoice for $0.00, paid from credit, with an activity line that says so.
    s.clock.at = new Date(state.nextCharge!.at.getTime() + MINUTE);
    await expect(testRunDue(s.rt, { orgId: s.org.orgId })).resolves.toEqual({ renewed: 1, failed: 0 });
    const renewal = (await listInvoices(db, { orgId: s.org.orgId }))[0]!;
    expect(renewal).toMatchObject({ totalCents: 0, status: 'paid' });
    const after = await getPlanState(s.rt, s.org.orgId);
    expect(after.creditCents).toBe(yearlyCredit - 2 * 8700);
    // The month after is still paid by credit, and the plan state says $0.00, not $87.00.
    expect(after.nextCharge).toMatchObject({ amountCents: 0, planCents: 8700, creditAppliedCents: 8700 });
    const used = (await auditsOf(s.org.orgId)).find((entry) => entry.action === 'payment.credit_used');
    expect(used?.summary).toMatch(/^This bill was paid in full from your credit \(\$87\.00\)\. Nothing was charged\. \$[\d,]+\.\d\d credit is left\.$/);
    expect((await pool.query(`select credit_applied_cents from core.billing_invoices where id = $1`, [renewal.id])).rows[0]).toEqual({ credit_applied_cents: 8700 });
  });

  it('removing seats: the next charge is the plan price less the credit, to the cent of the next invoice', async () => {
    const s = await scene('2026-11-01T00:00:00.000Z');
    await pay(s, { products: ['crm', 'wms'], seats: 8, warehouses: 1, interval: 'monthly' });
    s.advance(HOUR);
    const smaller = await change(s, { products: ['crm', 'wms'], seats: 5, warehouses: 1, interval: 'monthly' });
    const credit = smaller.preview.creditCents;
    expect(credit).toBe(Math.round((3 * 2320 * 29) / 30));
    expect(smaller.state.creditCents).toBe(credit);
    expect(smaller.state.nextCharge).toMatchObject({ amountCents: 39520 - credit, planCents: 39520, creditAppliedCents: credit });

    s.clock.at = new Date(smaller.state.nextCharge!.at.getTime() + MINUTE);
    await testRunDue(s.rt, { orgId: s.org.orgId });
    const renewal = (await listInvoices(db, { orgId: s.org.orgId }))[0]!;
    expect(renewal.totalCents).toBe(smaller.state.nextCharge!.amountCents);
    const after = await getPlanState(s.rt, s.org.orgId);
    expect(after.creditCents).toBe(0);
    expect(after.nextCharge).toMatchObject({ amountCents: 39520, creditAppliedCents: 0 });
  });

  it('credit stays on the account when the plan ends and comes off the first bill of a new plan', async () => {
    const s = await scene('2026-11-01T00:00:00.000Z');
    await pay(s, CRM(6));
    s.advance(HOUR);
    const smaller = await change(s, CRM(2));
    const credit = smaller.state.creditCents;
    expect(credit).toBeGreaterThan(0);
    const subscription = (await testDocs(s.org.orgId, 'subscription'))[0]!;
    await s.rt.gateway!.setCancelAtPeriodEnd(subscription.id, true);
    expect((await getPlanState(s.rt, s.org.orgId)).creditCents).toBe(credit);
    s.advance(31 * DAY);
    await testRunDue(s.rt, { orgId: s.org.orgId });
    expect((await getPlanState(s.rt, s.org.orgId)).phase).toBe('ended');

    const checkout = await openCheckout(s, CRM(2));
    const view = await getTestCheckout(db, checkout.sessionId, s.clock.at);
    expect(view).toMatchObject({ creditAppliedCents: Math.min(credit, 5800), firstChargeCents: 5800 - Math.min(credit, 5800) });
    await completeTestCheckout(s.rt, { sessionId: checkout.sessionId, ...CARD });
    expect((await listInvoices(db, { orgId: s.org.orgId }))[0]!.totalCents).toBe(5800 - Math.min(credit, 5800));
  });
});

describe.skipIf(!available)('a promo code', () => {
  const CART: PlanSelection = { products: ['crm', 'wms'], seats: 5, warehouses: 1, interval: 'monthly' };

  it('applied on the pay page: the summary shows the promo line and the real first charge', async () => {
    const s = await scene();
    const started = await startTrial(s.rt, { orgId: s.org.orgId, selection: CART, actor: s.actor });
    expect(started.ok).toBe(true);
    const checkout = await openCheckout(s, CART);
    expect(await getTestCheckout(db, checkout.sessionId, s.clock.at)).toMatchObject({ promo: null, firstChargeCents: 39520, dueTodayCents: 0 });

    await expect(applyTestPromo(s.rt, { sessionId: checkout.sessionId, promoCode: 'nope' })).resolves.toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    const applied = await applyTestPromo(s.rt, { sessionId: checkout.sessionId, promoCode: ' test10 ' });
    expect(applied).toEqual({ ok: true, data: { promo: { code: 'TEST10', label: 'Promo code TEST10 (10% off)', discountCents: 3952 }, firstChargeCents: 35568 } });
    expect(await getTestCheckout(db, checkout.sessionId, s.clock.at)).toMatchObject({ firstChargeCents: 35568, dueTodayCents: 0 });

    // Paying with the box left empty still uses the code that was applied on the page.
    const paid = await completeTestCheckout(s.rt, { sessionId: checkout.sessionId, ...CARD });
    expect(paid.ok).toBe(true);
    const state = await getPlanState(s.rt, s.org.orgId);
    expect(state.nextCharge).toMatchObject({ amountCents: 35568, planCents: 39520, discountCents: 3952, discountLabel: 'Promo code TEST10 (10% off)' });
    const mail = (await pool.query(`select payload from core.billing_emails where org_id = $1 and template = 'plan_started'`, [s.org.orgId])).rows[0];
    expect(mail.payload).toMatchObject({ totalCents: 39520, firstChargeCents: 35568, dueTodayCents: 0 });

    // The first invoice charges exactly the amount every screen showed.
    s.clock.at = new Date(state.nextCharge!.at.getTime() + MINUTE);
    await testRunDue(s.rt, { orgId: s.org.orgId });
    const first = (await listInvoices(db, { orgId: s.org.orgId }))[0]!;
    expect(first.totalCents).toBe(35568);
    expect(first.totalCents).toBe(state.nextCharge!.amountCents);
    // The code was for the first charge only.
    expect((await getPlanState(s.rt, s.org.orgId)).nextCharge).toMatchObject({ amountCents: 39520, discountCents: 0, discountLabel: null });
  });

  it('typed in the box at pay time works the same', async () => {
    const s = await scene();
    await startTrial(s.rt, { orgId: s.org.orgId, selection: CART, actor: s.actor });
    await pay(s, CART, 'TEST10');
    expect((await getPlanState(s.rt, s.org.orgId)).nextCharge).toMatchObject({ amountCents: 35568, discountCents: 3952 });
  });
});

describe.skipIf(!available)('an open invite holds a seat', () => {
  it('the plan cannot be made smaller than people plus open invites', async () => {
    const s = await scene('2026-11-01T00:00:00.000Z', ['member', 'member']);
    await pay(s, CRM(4));
    await pool.query(
      `insert into core.invitation (organization_id, email, role, status, expires_at, inviter_id) values ($1, $2, 'member', 'pending', now() + interval '7 days', $3)`,
      [s.org.orgId, `invited-${s.org.orgId}@kitstak-test.example`, s.org.owner.id],
    );
    const state = await getPlanState(s.rt, s.org.orgId);
    expect(state.usage).toMatchObject({ seatsUsed: 3, pendingInvites: 1, seatFloor: 4, seatLimit: 4 });

    s.advance(HOUR);
    const smaller = await previewPlanChange(s.rt, { orgId: s.org.orgId, selection: CRM(3) });
    expect(smaller).toEqual({
      ok: false,
      error: {
        code: 'below_usage',
        message: 'You have 3 people and 1 open invite. Each open invite holds a seat. Pick 4 seats or more, or cancel an invite first.',
      },
    });
    const forced = await applyPlanChange(s.rt, { orgId: s.org.orgId, selection: CRM(3), basis: 'anything', expectedDueTodayCents: 0, actor: s.actor });
    expect(forced).toMatchObject({ ok: false, error: { code: 'below_usage' } });
    expect((await getPlanState(s.rt, s.org.orgId)).selection.seats).toBe(4);

    // With the invite canceled the seat is free again and the plan can shrink.
    await pool.query(`update core.invitation set status = 'canceled' where organization_id = $1`, [s.org.orgId]);
    expect((await previewPlanChange(s.rt, { orgId: s.org.orgId, selection: CRM(3) })).ok).toBe(true);
  });
});

describe.skipIf(!available)('a billing manager who leaves', () => {
  it('loses the role when removed, when leaving and when deactivated, at the database itself', async () => {
    const s = await scene('2026-11-01T00:00:00.000Z', ['member', 'member']);
    const [, casey, robin] = s.org.people;
    const managers = async () =>
      (await pool.query<{ user_id: string }>(`select user_id from core.billing_managers where org_id = $1 order by user_id`, [s.org.orgId])).rows.map((row) => row.user_id);
    await addBillingManager(s.rt, { orgId: s.org.orgId, userId: casey!.id, actor: s.actor });
    await addBillingManager(s.rt, { orgId: s.org.orgId, userId: robin!.id, actor: s.actor });
    expect(await managers()).toEqual([casey!.id, robin!.id].sort());

    // Removed (any app, any SQL): the row goes with the membership.
    await pool.query(`delete from core.member where organization_id = $1 and user_id = $2`, [s.org.orgId, casey!.id]);
    expect(await managers()).toEqual([robin!.id]);
    // Deactivated the CRM way: the role string gets a prefix, the member row stays.
    await pool.query(`update core.member set role = 'deactivated:member' where organization_id = $1 and user_id = $2`, [s.org.orgId, robin!.id]);
    expect(await managers()).toEqual([]);

    const lines = (await auditsOf(s.org.orgId)).filter((entry) => entry.action === 'manager.removed').map((entry) => entry.summary);
    expect(lines).toEqual([
      `${casey!.name} left the organization and is no longer a billing manager.`,
      `${robin!.name} was deactivated and is no longer a billing manager.`,
    ]);

    // Invited again: a plain member, not a billing manager.
    await pool.query(`insert into core.member (organization_id, user_id, role, created_at) values ($1, $2, 'member', now())`, [s.org.orgId, casey!.id]);
    await pool.query(`update core.member set role = 'member' where organization_id = $1 and user_id = $2`, [s.org.orgId, robin!.id]);
    expect(await managers()).toEqual([]);
  });
});

describe.skipIf(!available)('inviting needs a verified email, at the endpoint itself', () => {
  const origin = 'http://localhost:3300';
  const secret = 'round-one-test-secret-round-one-test-secret-01';
  const auth = createAuth({
    db: drizzle(pool, { schema }),
    schema,
    secret,
    baseURL: origin,
    trustedOrigins: [origin],
    organization: billingOrganizationOptions({ db, portalUrl: origin, allowAll: () => true, inviteSecret: secret }),
  });

  async function call(path: string, body: unknown, cookie?: string): Promise<{ status: number; json: Record<string, unknown>; cookie: string | null }> {
    const response = await auth.handler(
      new Request(`${origin}/api/auth${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin, ...(cookie ? { cookie } : {}) },
        body: JSON.stringify(body),
      }),
    );
    const text = await response.text();
    const set = response.headers.getSetCookie().map((line) => line.split(';')[0]).filter(Boolean);
    return { status: response.status, json: text ? (JSON.parse(text) as Record<string, unknown>) : {}, cookie: set.length > 0 ? set.join('; ') : null };
  }

  it('refuses POST /organization/invite-member from an account that never proved its address', async () => {
    const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const email = `r1-attacker-${tag}@kitstak-test.example`;
    const signedUp = await call('/sign-up/email', { name: 'Not Verified', email, password: 'Correct-Horse-9-Battery' });
    expect(signedUp.status).toBe(200);
    const userId = (signedUp.json.user as { id: string }).id;
    extraUsers.push(userId);
    const cookie = signedUp.cookie!;
    const org = await call('/organization/create', { name: 'Big Bank Security', slug: `r1-bank-${tag}` }, cookie);
    expect(org.status).toBe(200);
    const orgId = org.json.id as string;
    orgs.push({ orgId, name: 'Big Bank Security', owner: { id: userId, name: 'Not Verified', email, role: 'owner' }, people: [] });

    const stranger = `r1-stranger-${tag}@kitstak-test.example`;
    const refused = await call('/organization/invite-member', { organizationId: orgId, email: stranger, role: 'member' }, cookie);
    expect(refused.status).toBe(403);
    expect(refused.json).toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
    expect(String(refused.json.message)).toContain('Verify your email first.');
    const queued = async () => (await pool.query(`select payload from core.billing_emails where to_email = $1 and template = 'invitation'`, [stranger])).rows;
    expect(await queued()).toHaveLength(0);
    expect((await pool.query(`select 1 from core.invitation where organization_id = $1`, [orgId])).rowCount).toBe(0);

    // Once the address is verified the same call works, and the link carries the proof for that mailbox.
    await pool.query(`update core."user" set email_verified = true where id = $1`, [userId]);
    const sent = await call('/organization/invite-member', { organizationId: orgId, email: stranger, role: 'member' }, cookie);
    expect(sent.status).toBe(200);
    const [mail] = await queued();
    const acceptUrl = new URL((mail!.payload as { acceptUrl: string }).acceptUrl);
    const invitationId = acceptUrl.pathname.split('/').pop()!;
    expect(acceptUrl.pathname).toBe(`/invite/${sent.json.id as string}`);
    expect(verifyInviteProof(secret, invitationId, stranger, acceptUrl.searchParams.get('t'))).toBe(true);
    await pool.query(`delete from core.billing_emails where to_email = $1`, [stranger]);
  });

  it('accounts from before email codes existed may keep inviting, and one organization has a daily cap', async () => {
    const org = await createTestOrg(pool);
    orgs.push(org);
    const organization = { id: org.orgId, name: org.name, slug: 'x', createdAt: new Date() };
    const hooks = billingOrganizationOptions({ db, portalUrl: origin, allowAll: () => true }).organizationHooks!;
    const inviter = { id: org.owner.id, name: org.owner.name, email: org.owner.email, emailVerified: true, createdAt: new Date(), updatedAt: new Date() };
    const invite = (address: string) =>
      hooks.beforeCreateInvitation!({ invitation: { email: address, role: 'guest', organizationId: org.orgId, inviterId: org.owner.id }, inviter, organization });

    // The session may say "verified" (a cached copy). The database decides.
    await pool.query(`update core."user" set email_verified = false, created_at = now() where id = $1`, [org.owner.id]);
    await expect(invite('a@kitstak-test.example')).rejects.toMatchObject({ body: { code: 'EMAIL_NOT_VERIFIED' } });
    // An older account that was never asked to verify.
    await pool.query(`update core."user" set created_at = '2026-06-01' where id = $1`, [org.owner.id]);
    await expect(invite('a@kitstak-test.example')).resolves.toBeUndefined();

    await pool.query(`update core."user" set email_verified = true where id = $1`, [org.owner.id]);
    for (let sent = 1; sent < INVITES_PER_DAY.withoutPlan; sent += 1) await invite(`cap-${sent}@kitstak-test.example`);
    const capped = await invite('one-too-many@kitstak-test.example').catch((error: unknown) => error);
    expect(capped).toMatchObject({ status: 'TOO_MANY_REQUESTS', body: { code: 'INVITE_LIMIT_REACHED' } });
    expect((capped as { body: { message: string } }).body.message).toBe(
      'Your team sent 50 invites today. That is the most for one day. Try again tomorrow, or talk to us if you need more.',
    );
  });
});
