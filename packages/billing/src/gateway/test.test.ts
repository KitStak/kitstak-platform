/**
 * The test gateway, end to end through the same webhook path Stripe uses. Against the local dev
 * Postgres (docs/billing/DEV.md); skipped when it is not reachable. Each scenario has its own org and
 * its own clock, so trial end, renewal and failed payments are reached without waiting.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { PlanSelection } from '../catalog';
import { scheduleCancel, pausePlan, undoCancel, undoPause } from '../server/cancel';
import { applyPlanChange, previewPlanChange } from '../server/changes';
import { checkoutPreview, createCheckout, syncCheckoutSession } from '../server/checkout';
import type { BillingRuntime } from '../server/db';
import { getInvoice, getInvoicePdf, listInvoices } from '../server/invoices';
import { createPaymentUpdateSession, retryPayment } from '../server/payment';
import { getPlanState } from '../server/state';
import { startTrial } from '../server/trial';
import { createTestOrg, openTestDb, removeTestOrg, testRuntime, type TestOrg } from '../testing/db';
import {
  TEST_CARDS,
  completeTestCardUpdate,
  completeTestCheckout,
  cancelTestCheckout,
  getTestCardUpdate,
  getTestCheckout,
  signTestPayload,
  testFailNextPayment,
  testRunDue,
  testShiftTime,
} from './test';
import { WebhookSignatureError } from './types';

const { pool, db, available } = await openTestDb();
vi.setConfig({ testTimeout: 60_000 });

const DAY = 24 * 60 * 60 * 1000;
const CARD = { expMonth: 12, expYear: 2031, cvc: '123', name: 'Maya Chen', postalCode: '60601' };
const WORKS = '4242 4242 4242 4242';
const DECLINED = '4000 0000 0000 0002';
const NO_MONEY = '4000 0000 0000 9995';
const NEEDS_BANK = '4000 0027 6000 3184';
const FAILS_LATER = '4000 0000 0000 0341';

const CRM5: PlanSelection = { products: ['crm'], seats: 5, warehouses: 1, interval: 'monthly' };
const CRM_WMS: PlanSelection = { products: ['crm', 'wms'], seats: 5, warehouses: 1, interval: 'monthly' };

const orgs: TestOrg[] = [];

interface Scene {
  readonly org: TestOrg;
  readonly rt: BillingRuntime;
  readonly clock: { at: Date };
  readonly actor: { userId: string; label: string };
  advance(days: number): void;
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
    advance(days) {
      clock.at = new Date(clock.at.getTime() + days * DAY);
    },
  };
}

async function openCheckout(s: Scene, selection: PlanSelection) {
  const checkout = await createCheckout(s.rt, {
    orgId: s.org.orgId,
    orgName: s.org.name,
    selection,
    actor: s.actor,
    actorEmail: s.org.owner.email,
  });
  if (!checkout.ok) throw new Error(checkout.error.message);
  return checkout.data;
}

async function pay(s: Scene, selection: PlanSelection, cardNumber = WORKS, promoCode?: string) {
  const checkout = await openCheckout(s, selection);
  const result = await completeTestCheckout(s.rt, { sessionId: checkout.sessionId, cardNumber, ...CARD, ...(promoCode ? { promoCode } : {}) });
  return { checkout, result };
}

const entitlementsOf = async (orgId: string) =>
  (await pool.query(`select module, status, source from core.entitlements where org_id = $1 order by module`, [orgId])).rows;
const emailsOf = async (orgId: string) =>
  (await pool.query(`select template from core.billing_emails where org_id = $1 order by created_at, template`, [orgId])).rows.map((row) => row.template as string);
const auditsOf = async (orgId: string) =>
  (await pool.query(`select action, summary from core.billing_audit_log where org_id = $1 order by created_at, id`, [orgId])).rows;

afterAll(async () => {
  for (const org of orgs) await removeTestOrg(pool, org);
  await pool.end();
});

describe('test cards', () => {
  it('lists the five cards the test checkout page offers', () => {
    expect(TEST_CARDS.map((card) => [card.number, card.outcome])).toEqual([
      ['4242 4242 4242 4242', 'success'],
      ['4000 0000 0000 0002', 'declined'],
      ['4000 0000 0000 9995', 'insufficient_funds'],
      ['4000 0027 6000 3184', 'requires_action'],
      ['4000 0000 0000 0341', 'fails_on_renewal'],
    ]);
  });
});

describe.skipIf(!available)('test gateway: checkout', () => {
  it('a working card: paid today, one invoice equal to the quote, access through the webhook path', async () => {
    const s = await scene();
    const preview = await checkoutPreview(s.rt, { orgId: s.org.orgId, selection: CRM_WMS });
    expect(preview).toMatchObject({ ok: true, data: { dueTodayCents: 39520, trialEnd: null, taxNote: false } });

    const { checkout, result } = await pay(s, CRM_WMS);
    expect(checkout.url).toBe(`http://localhost:3300/test-gateway/checkout/${checkout.sessionId}`);
    expect(checkout.dueTodayCents).toBe(39520);
    expect(result).toEqual({
      ok: true,
      data: { status: 'complete', redirectUrl: `http://localhost:3300/billing/checkout/success?session_id=${checkout.sessionId}` },
    });

    const state = await getPlanState(s.rt, s.org.orgId);
    expect(state.phase).toBe('active');
    expect(state.hasSubscription).toBe(true);
    expect(state.paymentMethod).toEqual({ brand: 'visa', last4: '4242', expMonth: 12, expYear: 2031 });
    expect(state.nextCharge).toEqual({ amountCents: 39520, at: new Date('2026-12-01T00:00:00.000Z') });
    expect(await entitlementsOf(s.org.orgId)).toEqual([
      { module: 'crm', status: 'active', source: 'stripe' },
      { module: 'wms', status: 'active', source: 'stripe' },
    ]);

    const invoices = await listInvoices(db, { orgId: s.org.orgId });
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ number: 'TEST-0001', status: 'paid', totalCents: 39520, amountDueCents: 0, taxCents: 0, paymentMethodLast4: '4242' });
    expect(invoices[0]!.lines.map((line) => [line.description, line.amountCents])).toEqual([
      ['KitStak CRM (5 users)', 11600],
      ['KitStak WMS (1 warehouse)', 27920],
    ]);

    expect((await emailsOf(s.org.orgId)).sort()).toEqual(['plan_started', 'receipt']);
    const actions = (await auditsOf(s.org.orgId)).map((row) => row.action);
    expect(actions).toEqual(expect.arrayContaining(['checkout.started', 'plan.started', 'payment.succeeded']));
    expect((await auditsOf(s.org.orgId)).find((row) => row.action === 'payment.succeeded')?.summary).toBe('Payment of $395.20 succeeded.');

    // The success page runs the same sync. Calling it again changes nothing.
    const again = await syncCheckoutSession(s.rt, { orgId: s.org.orgId, sessionId: checkout.sessionId });
    expect(again).toMatchObject({ ok: true, data: { phase: 'active' } });
    expect(await listInvoices(db, { orgId: s.org.orgId })).toHaveLength(1);
    // A second checkout is refused: change the plan instead.
    const second = await createCheckout(s.rt, { orgId: s.org.orgId, orgName: s.org.name, selection: CRM5, actor: s.actor, actorEmail: s.org.owner.email });
    expect(second).toMatchObject({ ok: false, error: { code: 'already_subscribed' } });
  });

  it('a declined card: the plain message, the page stays open, and no access row changes', async () => {
    const s = await scene();
    for (const [card, message] of [
      [DECLINED, 'That card was declined. Try another card or call your bank.'],
      [NO_MONEY, 'That card does not have enough money. Try another card.'],
      ['4111 1111 1111 1111', 'Use one of the test cards on this page. Real cards do not work in test mode.'],
    ] as const) {
      const { checkout, result } = await pay(s, CRM5, card);
      expect(result).toEqual({ ok: false, error: { code: 'card_declined', message } });
      expect((await getTestCheckout(db, checkout.sessionId, s.clock.at))?.status).toBe('open');
      // A session that is not paid never grants anything, also when the success page is opened by hand.
      const synced = await syncCheckoutSession(s.rt, { orgId: s.org.orgId, sessionId: checkout.sessionId });
      expect(synced).toMatchObject({ ok: true, data: { phase: 'none', hasSubscription: false } });
    }
    expect(await entitlementsOf(s.org.orgId)).toEqual([]);
    expect((await pool.query(`select 1 from core.billing_subscriptions where org_id = $1`, [s.org.orgId])).rowCount).toBe(0);
    expect(await listInvoices(db, { orgId: s.org.orgId })).toEqual([]);

    const checkout = await openCheckout(s, CRM5);
    const expired = await completeTestCheckout(s.rt, { sessionId: checkout.sessionId, cardNumber: WORKS, ...CARD, expYear: 2020 });
    expect(expired).toMatchObject({ ok: false, error: { message: 'That expiry date is in the past. Check it and try again.' } });
    const badPromo = await completeTestCheckout(s.rt, { sessionId: checkout.sessionId, cardNumber: WORKS, ...CARD, promoCode: 'FREE' });
    expect(badPromo).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    // Going back keeps the cart.
    await expect(cancelTestCheckout(s.rt, checkout.sessionId)).resolves.toEqual({ redirectUrl: 'http://localhost:3300/billing/checkout/canceled' });
    expect((await getPlanState(s.rt, s.org.orgId)).selection).toEqual(CRM5);
  });

  it('a card that needs bank approval: fail changes nothing, approve finishes the checkout', async () => {
    const s = await scene();
    const first = await pay(s, CRM5, NEEDS_BANK);
    expect(first.result).toEqual({
      ok: true,
      data: { status: 'requires_action', redirectUrl: `http://localhost:3300/test-gateway/checkout/${first.checkout.sessionId}?step=bank` },
    });
    expect((await getTestCheckout(db, first.checkout.sessionId, s.clock.at))?.needsBankApproval).toBe(true);
    expect(await entitlementsOf(s.org.orgId)).toEqual([]);

    const failed = await completeTestCheckout(s.rt, { sessionId: first.checkout.sessionId, cardNumber: '', expMonth: 0, expYear: 0, cvc: '', name: '', postalCode: '', approve3ds: false });
    expect(failed).toEqual({
      ok: false,
      error: { code: 'card_declined', message: 'Your bank did not approve the payment. Try again or use another card.' },
    });
    expect(await entitlementsOf(s.org.orgId)).toEqual([]);

    await completeTestCheckout(s.rt, { sessionId: first.checkout.sessionId, cardNumber: NEEDS_BANK, ...CARD });
    const approved = await completeTestCheckout(s.rt, { sessionId: first.checkout.sessionId, cardNumber: '', expMonth: 0, expYear: 0, cvc: '', name: '', postalCode: '', approve3ds: true });
    expect(approved).toMatchObject({ ok: true, data: { status: 'complete' } });
    expect(await entitlementsOf(s.org.orgId)).toEqual([{ module: 'crm', status: 'active', source: 'stripe' }]);
    expect((await getPlanState(s.rt, s.org.orgId)).paymentMethod?.last4).toBe('3184');
  });

  it('adding a card during the trial costs no trial days: due today is $0.00 and the first charge is at trial end', async () => {
    const s = await scene();
    await startTrial(s.rt, { orgId: s.org.orgId, selection: CRM_WMS, actor: s.actor });
    s.advance(5);
    const trialEnd = new Date('2026-11-15T00:00:00.000Z');
    const preview = await checkoutPreview(s.rt, { orgId: s.org.orgId, selection: CRM_WMS });
    expect(preview).toMatchObject({ ok: true, data: { dueTodayCents: 0, firstChargeAt: trialEnd, trialEnd } });

    const { checkout, result } = await pay(s, CRM_WMS);
    expect(checkout).toMatchObject({ dueTodayCents: 0, firstChargeAt: trialEnd });
    expect(result.ok).toBe(true);
    const view = await getTestCheckout(db, checkout.sessionId, s.clock.at);
    expect(view).toMatchObject({ status: 'complete', orgName: s.org.name });

    const state = await getPlanState(s.rt, s.org.orgId);
    expect(state.phase).toBe('active');
    expect(state.trial).toEqual({ startedAt: new Date('2026-11-01T00:00:00.000Z'), endsAt: trialEnd, daysLeft: 9 });
    expect(state.nextCharge).toEqual({ amountCents: 39520, at: trialEnd });
    expect(await entitlementsOf(s.org.orgId)).toEqual([
      { module: 'crm', status: 'active', source: 'stripe' },
      { module: 'wms', status: 'active', source: 'stripe' },
    ]);
    // No money moved yet, so there is no invoice and no receipt.
    expect(await listInvoices(db, { orgId: s.org.orgId })).toEqual([]);
    expect(await emailsOf(s.org.orgId)).not.toContain('receipt');

    // Trial end: the first charge runs by itself and the plan is simply active.
    s.advance(10);
    await expect(testRunDue(s.rt, { orgId: s.org.orgId })).resolves.toEqual({ renewed: 1, failed: 0 });
    const after = await getPlanState(s.rt, s.org.orgId);
    expect(after.phase).toBe('active');
    expect(after.trial).toBeNull();
    const invoices = await listInvoices(db, { orgId: s.org.orgId });
    expect(invoices.map((invoice) => [invoice.number, invoice.status, invoice.totalCents, invoice.issuedAt])).toEqual([
      ['TEST-0001', 'paid', 39520, trialEnd],
    ]);
    expect(await emailsOf(s.org.orgId)).toContain('receipt');
  });

  it('a card added with less than 2 days of trial left is first charged 2 days from now', async () => {
    const s = await scene();
    await startTrial(s.rt, { orgId: s.org.orgId, selection: CRM5, actor: s.actor });
    s.advance(13);
    const preview = await checkoutPreview(s.rt, { orgId: s.org.orgId, selection: CRM5 });
    expect(preview.ok && preview.data.firstChargeAt.getTime()).toBe(s.clock.at.getTime() + 48 * 60 * 60 * 1000 + 5 * 60 * 1000);
    expect(preview.ok && preview.data.dueTodayCents).toBe(0);
  });

  it('the promo code TEST10 takes 10% off the first charge, as its own line', async () => {
    const s = await scene();
    const { result } = await pay(s, CRM_WMS, WORKS, 'test10');
    expect(result.ok).toBe(true);
    const [invoice] = await listInvoices(db, { orgId: s.org.orgId });
    expect(invoice).toMatchObject({ totalCents: 35568, discountCents: 3952 });
    expect(invoice!.lines.at(-1)).toMatchObject({ description: 'Promo code TEST10 (10% off)', amountCents: -3952 });
    // The next bill is the full price again.
    s.advance(31);
    await testRunDue(s.rt, { orgId: s.org.orgId });
    const invoices = await listInvoices(db, { orgId: s.org.orgId });
    expect(invoices[0]).toMatchObject({ number: 'TEST-0002', totalCents: 39520, discountCents: 0 });
  });
});

describe.skipIf(!available)('test gateway: one rule for every plan change', () => {
  it('1 CRM seat at the half way point of a 30 day period is $14.50, and the invoice says the same', async () => {
    const s = await scene('2026-11-01T00:00:00.000Z');
    await pay(s, CRM5);
    s.advance(15);

    const more = { ...CRM5, seats: 6 };
    const preview = await previewPlanChange(s.rt, { orgId: s.org.orgId, selection: more });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.data).toMatchObject({
      dueTodayCents: 1450,
      creditCents: 0,
      newRecurringCents: 17400,
      recurringDeltaCents: 2900,
      nextChargeAt: new Date('2026-12-01T00:00:00.000Z'),
      taxCents: 0,
    });
    expect(preview.data.lines).toEqual([
      { description: 'KitStak CRM: 1 user more for the 15 days left in this period', product: 'crm', quantity: 1, unitCents: 2900, amountCents: 1450, proration: true },
    ]);

    // A changed amount is never confirmed.
    const stale = await applyPlanChange(s.rt, { orgId: s.org.orgId, selection: more, prorationDate: preview.data.prorationDate, expectedDueTodayCents: 900, actor: s.actor });
    expect(stale).toMatchObject({ ok: false, error: { code: 'price_changed' } });
    expect((await getPlanState(s.rt, s.org.orgId)).selection.seats).toBe(5);

    const applied = await applyPlanChange(s.rt, { orgId: s.org.orgId, selection: more, prorationDate: preview.data.prorationDate, expectedDueTodayCents: 1450, actor: s.actor });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.data.selection.seats).toBe(6);
    expect(applied.data.nextCharge).toEqual({ amountCents: 17400, at: new Date('2026-12-01T00:00:00.000Z') });
    expect(applied.data.usage.seatLimit).toBe(6);

    const invoices = await listInvoices(db, { orgId: s.org.orgId });
    expect(invoices[0]).toMatchObject({ number: 'TEST-0002', status: 'paid', totalCents: 1450 });
    expect(invoices[0]!.lines).toEqual(preview.data.lines);
    expect((await auditsOf(s.org.orgId)).find((row) => row.action === 'plan.changed')?.summary).toBe('Maya Chen added 1 seat. The plan is now 6 seats.');

    // Giving the seat back becomes credit, and the credit comes off the next bill.
    const less = await previewPlanChange(s.rt, { orgId: s.org.orgId, selection: CRM5 });
    expect(less).toMatchObject({ ok: true, data: { dueTodayCents: 0, creditCents: 1450, recurringDeltaCents: -2900 } });
    if (!less.ok) return;
    const removed = await applyPlanChange(s.rt, { orgId: s.org.orgId, selection: CRM5, prorationDate: less.data.prorationDate, expectedDueTodayCents: 0, actor: s.actor });
    expect(removed).toMatchObject({ ok: true, data: { selection: { seats: 5 } } });
    expect(await listInvoices(db, { orgId: s.org.orgId })).toHaveLength(2);

    s.advance(16);
    await expect(testRunDue(s.rt, { orgId: s.org.orgId })).resolves.toEqual({ renewed: 1, failed: 0 });
    const renewal = (await listInvoices(db, { orgId: s.org.orgId }))[0]!;
    expect(renewal).toMatchObject({ number: 'TEST-0003', totalCents: 14500 - 1450, status: 'paid' });
    expect(renewal.lines.at(-1)).toMatchObject({ description: 'Credit from plan changes', amountCents: -1450 });
  });

  it('adding a second app moves every app to its bundle price in the same change', async () => {
    const s = await scene('2026-11-01T00:00:00.000Z');
    await pay(s, CRM5);
    s.advance(15);
    const preview = await previewPlanChange(s.rt, { orgId: s.org.orgId, selection: CRM_WMS });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    // Unused CRM at list (-72.50), CRM at the bundle price (+58.00), WMS at the bundle price (+139.60).
    expect(preview.data.lines.map((line) => line.amountCents)).toEqual([-7250, 5800, 13960]);
    expect(preview.data).toMatchObject({ dueTodayCents: 12510, newRecurringCents: 39520, recurringDeltaCents: 25020 });

    const applied = await applyPlanChange(s.rt, { orgId: s.org.orgId, selection: CRM_WMS, prorationDate: preview.data.prorationDate, expectedDueTodayCents: 12510, actor: s.actor });
    expect(applied.ok).toBe(true);
    const rows = (await pool.query(`select module, status, stripe_price_id from core.entitlements where org_id = $1 order by module`, [s.org.orgId])).rows;
    expect(rows).toEqual([
      { module: 'crm', status: 'active', stripe_price_id: 'price_test_kitstak_crm_monthly_bundle' },
      { module: 'wms', status: 'active', stripe_price_id: 'price_test_kitstak_wms_monthly_bundle' },
    ]);
    expect((await auditsOf(s.org.orgId)).find((row) => row.action === 'plan.changed')?.summary).toBe('Maya Chen added WMS.');

    // Removing it again starts right away, with credit, and CRM goes back to its list price.
    const back = await previewPlanChange(s.rt, { orgId: s.org.orgId, selection: CRM5 });
    expect(back).toMatchObject({ ok: true, data: { dueTodayCents: 0, creditCents: 12510 } });
    if (!back.ok) return;
    const removed = await applyPlanChange(s.rt, { orgId: s.org.orgId, selection: CRM5, prorationDate: back.data.prorationDate, expectedDueTodayCents: 0, actor: s.actor });
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.data.modules.wms).toMatchObject({ access: 'read_only', inPlan: false });
    expect(removed.data.modules.crm).toMatchObject({ access: 'full', inPlan: true });
    expect(removed.data.nextCharge?.amountCents).toBe(14500);
  });

  it('monthly to yearly starts a new period today, with credit for the unused part of the month', async () => {
    const s = await scene('2026-11-01T00:00:00.000Z');
    await pay(s, CRM5);
    s.advance(15);
    const yearly = { ...CRM5, interval: 'yearly' } as const;
    const preview = await previewPlanChange(s.rt, { orgId: s.org.orgId, selection: yearly });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    // 5 x $295.80 for the year, less $72.50 for the 15 unused days of the month.
    expect(preview.data).toMatchObject({ dueTodayCents: 147900 - 7250, newRecurringCents: 147900, nextChargeAt: new Date('2027-11-16T00:00:00.000Z') });
    const applied = await applyPlanChange(s.rt, { orgId: s.org.orgId, selection: yearly, prorationDate: preview.data.prorationDate, expectedDueTodayCents: 140650, actor: s.actor });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.data.selection.interval).toBe('yearly');
    expect(applied.data.nextCharge).toEqual({ amountCents: 147900, at: new Date('2027-11-16T00:00:00.000Z') });
    // Yearly plans cannot be paused.
    const paused = await pausePlan(s.rt, { orgId: s.org.orgId, months: 1, reason: null, actor: s.actor });
    expect(paused).toMatchObject({ ok: false, error: { code: 'yearly_no_pause' } });
  });

  it('a declined card changes nothing', async () => {
    const s = await scene('2026-11-01T00:00:00.000Z');
    await pay(s, CRM5);
    s.advance(10);
    await expect(testFailNextPayment(s.rt, { orgId: s.org.orgId })).resolves.toEqual({ ok: true, data: null });
    const more = { ...CRM5, seats: 8 };
    const preview = await previewPlanChange(s.rt, { orgId: s.org.orgId, selection: more });
    if (!preview.ok) throw new Error(preview.error.message);
    const declined = await applyPlanChange(s.rt, { orgId: s.org.orgId, selection: more, prorationDate: preview.data.prorationDate, expectedDueTodayCents: preview.data.dueTodayCents, actor: s.actor });
    expect(declined).toEqual({ ok: false, error: { code: 'card_declined', message: 'That card was declined. Try another card or call your bank.' } });
    const state = await getPlanState(s.rt, s.org.orgId);
    expect(state.selection.seats).toBe(5);
    expect(state.phase).toBe('active');
    expect(await listInvoices(db, { orgId: s.org.orgId })).toHaveLength(1);
  });

  it('refuses a plan below what is in use, and an empty plan', async () => {
    const s = await scene();
    await pool.query(`insert into core.member (organization_id, user_id, role, created_at) select $1, id, 'member', now() from core."user" where id = $2`, [
      s.org.orgId,
      (await pool.query(`insert into core."user" (name, email, email_verified) values ('Second Person', $1, true) returning id`, [`second-${s.org.orgId}@kitstak-test.example`])).rows[0].id,
    ]);
    await pay(s, { ...CRM5, seats: 2 });
    const tooSmall = await previewPlanChange(s.rt, { orgId: s.org.orgId, selection: { ...CRM5, seats: 1 } });
    expect(tooSmall).toEqual({ ok: false, error: { code: 'below_usage', message: 'You have 2 people. Pick 2 seats or more.' } });
    const empty = await previewPlanChange(s.rt, { orgId: s.org.orgId, selection: { ...CRM5, products: [] } });
    expect(empty).toMatchObject({ ok: false, error: { code: 'invalid_selection' } });
    await pool.query(`delete from core."user" where email = $1`, [`second-${s.org.orgId}@kitstak-test.example`]);
  });
});

describe.skipIf(!available)('test gateway: renewals and failed payments', () => {
  it('renews at the period end with a new invoice', async () => {
    const s = await scene('2026-11-01T00:00:00.000Z');
    await pay(s, CRM5);
    s.advance(29);
    await expect(testRunDue(s.rt, { orgId: s.org.orgId })).resolves.toEqual({ renewed: 0, failed: 0 });
    s.advance(2);
    await expect(testRunDue(s.rt, { orgId: s.org.orgId })).resolves.toEqual({ renewed: 1, failed: 0 });
    const invoices = await listInvoices(db, { orgId: s.org.orgId });
    expect(invoices.map((invoice) => [invoice.number, invoice.totalCents, invoice.issuedAt.toISOString()])).toEqual([
      ['TEST-0002', 14500, '2026-12-01T00:00:00.000Z'],
      ['TEST-0001', 14500, '2026-11-01T00:00:00.000Z'],
    ]);
    expect((await getPlanState(s.rt, s.org.orgId)).nextCharge?.at).toEqual(new Date('2027-01-01T00:00:00.000Z'));
  });

  it('a failed renewal: 7 days of full access, then view only, and paying turns it back on at once', async () => {
    const s = await scene('2026-11-01T00:00:00.000Z');
    await pay(s, CRM5, FAILS_LATER);
    expect((await getPlanState(s.rt, s.org.orgId)).phase).toBe('active');

    s.advance(30);
    await expect(testRunDue(s.rt, { orgId: s.org.orgId })).resolves.toEqual({ renewed: 0, failed: 1 });
    const late = await getPlanState(s.rt, s.org.orgId);
    expect(late.phase).toBe('past_due');
    expect(late.modules.crm.access).toBe('full');
    expect(late.pastDue).toEqual({
      since: new Date('2026-12-01T00:00:00.000Z'),
      amountDueCents: 14500,
      nextRetryAt: new Date('2026-12-04T00:00:00.000Z'),
      accessChangesAt: new Date('2026-12-08T00:00:00.000Z'),
    });
    expect(await entitlementsOf(s.org.orgId)).toEqual([{ module: 'crm', status: 'past_due', source: 'stripe' }]);
    expect(await emailsOf(s.org.orgId)).toContain('payment_failed');
    const failedEmail = (await pool.query(`select payload from core.billing_emails where org_id = $1 and template = 'payment_failed'`, [s.org.orgId])).rows[0].payload;
    expect(failedEmail).toMatchObject({ amountDueCents: 14500, last4: '0341', attempt: 1, nextRetryAt: '2026-12-04T00:00:00.000Z', accessChangesAt: '2026-12-08T00:00:00.000Z' });
    expect((await auditsOf(s.org.orgId)).find((row) => row.action === 'payment.failed')?.summary).toBe('We could not charge the Visa ending 0341 for $145.00.');

    // "Pay now" with the same card fails again and says so.
    const stillBad = await retryPayment(s.rt, { orgId: s.org.orgId, actor: s.actor });
    expect(stillBad).toMatchObject({ ok: false, error: { code: 'card_declined' } });

    // Day 8: two retries have failed, the grace days are over, the apps are view only.
    s.advance(8);
    await expect(testRunDue(s.rt, { orgId: s.org.orgId })).resolves.toEqual({ renewed: 0, failed: 2 });
    const unpaid = await getPlanState(s.rt, s.org.orgId);
    expect(unpaid.phase).toBe('unpaid');
    expect(unpaid.modules.crm.access).toBe('read_only');
    expect((await emailsOf(s.org.orgId)).filter((template) => template === 'payment_failed').length).toBeGreaterThanOrEqual(3);

    // A new card, then the open bill is paid at once.
    const session = await createPaymentUpdateSession(s.rt, { orgId: s.org.orgId, actor: s.actor });
    expect(session.ok).toBe(true);
    if (!session.ok) return;
    const sessionId = session.data.url.split('/').pop()!;
    expect(session.data.url).toBe(`http://localhost:3300/test-gateway/card/${sessionId}`);
    expect(await getTestCardUpdate(db, sessionId)).toMatchObject({ current: { last4: '0341' }, returnUrl: 'http://localhost:3300/billing?updated=card' });
    const badCard = await completeTestCardUpdate(s.rt, { sessionId, cardNumber: DECLINED, expMonth: 12, expYear: 2031, cvc: '123' });
    expect(badCard).toMatchObject({ ok: false, error: { code: 'card_declined' } });
    const updated = await completeTestCardUpdate(s.rt, { sessionId, cardNumber: WORKS, expMonth: 12, expYear: 2031, cvc: '123' });
    expect(updated).toEqual({ ok: true, data: { redirectUrl: 'http://localhost:3300/billing?updated=card' } });
    expect((await auditsOf(s.org.orgId)).find((row) => row.action === 'card.updated')?.summary).toBe('The card on file is now Visa ending 4242.');

    const paid = await retryPayment(s.rt, { orgId: s.org.orgId, actor: s.actor });
    expect(paid.ok).toBe(true);
    if (!paid.ok) return;
    expect(paid.data.phase).toBe('active');
    expect(paid.data.modules.crm.access).toBe('full');
    expect(paid.data.pastDue).toBeNull();
    expect(await entitlementsOf(s.org.orgId)).toEqual([{ module: 'crm', status: 'active', source: 'stripe' }]);
    expect((await auditsOf(s.org.orgId)).find((row) => row.action === 'payment.retried')?.summary).toBe('Maya Chen paid the open bill of $145.00.');
    expect((await emailsOf(s.org.orgId)).filter((template) => template === 'receipt')).toHaveLength(2);
  });

  it('after the last retry the gateway closes the plan: ended, view only, nothing deleted', async () => {
    const s = await scene('2026-11-01T00:00:00.000Z');
    await pay(s, CRM5, FAILS_LATER);
    s.advance(46);
    await expect(testRunDue(s.rt, { orgId: s.org.orgId })).resolves.toEqual({ renewed: 0, failed: 4 });
    const state = await getPlanState(s.rt, s.org.orgId);
    expect(state.phase).toBe('ended');
    expect(state.endedAt).toEqual(new Date('2026-12-16T00:00:00.000Z'));
    expect(state.modules.crm.access).toBe('read_only');
    expect(await entitlementsOf(s.org.orgId)).toEqual([{ module: 'crm', status: 'canceled', source: 'stripe' }]);
    expect(await emailsOf(s.org.orgId)).toContain('plan_ended');
    // "Pick a plan" starts fresh, with no second trial.
    expect(state.trialEligible).toBe(false);
    const again = await pay(s, CRM5);
    expect(again.result.ok).toBe(true);
    expect((await getPlanState(s.rt, s.org.orgId)).phase).toBe('active');
  });

  it('the "make the next payment fail" tool fails one charge; the retry then works', async () => {
    const s = await scene('2026-11-01T00:00:00.000Z');
    await pay(s, CRM5);
    await testFailNextPayment(s.rt, { orgId: s.org.orgId });
    s.advance(30);
    await expect(testRunDue(s.rt, { orgId: s.org.orgId })).resolves.toEqual({ renewed: 0, failed: 1 });
    expect((await getPlanState(s.rt, s.org.orgId)).phase).toBe('past_due');
    s.advance(3);
    await expect(testRunDue(s.rt, { orgId: s.org.orgId })).resolves.toEqual({ renewed: 1, failed: 0 });
    expect((await getPlanState(s.rt, s.org.orgId)).phase).toBe('active');
  });
});

describe.skipIf(!available)('test gateway: cancel and pause', () => {
  it('cancel keeps access to the end of the period, can be undone, and then ends as view only', async () => {
    const s = await scene('2026-11-01T00:00:00.000Z');
    await pay(s, CRM5);
    const canceled = await scheduleCancel(s.rt, { orgId: s.org.orgId, reason: 'too_expensive', detail: '  A little too much for now.  ', actor: s.actor });
    expect(canceled.ok).toBe(true);
    if (!canceled.ok) return;
    expect(canceled.data.phase).toBe('cancel_scheduled');
    expect(canceled.data.cancelAt).toEqual(new Date('2026-12-01T00:00:00.000Z'));
    expect(canceled.data.modules.crm.access).toBe('full');
    expect(canceled.data.nextCharge).toBeNull();
    const feedback = (await pool.query(`select reason, detail, outcome from core.billing_cancel_feedback where org_id = $1`, [s.org.orgId])).rows;
    expect(feedback).toEqual([{ reason: 'too_expensive', detail: 'A little too much for now.', outcome: 'canceled' }]);
    expect((await auditsOf(s.org.orgId)).find((row) => row.action === 'cancel.scheduled')?.summary).toBe('Maya Chen canceled the plan. It ends on Dec 1, 2026.');
    expect(await emailsOf(s.org.orgId)).toContain('cancel_scheduled');

    const kept = await undoCancel(s.rt, { orgId: s.org.orgId, actor: s.actor });
    expect(kept).toMatchObject({ ok: true, data: { phase: 'active', cancelAt: null } });

    await scheduleCancel(s.rt, { orgId: s.org.orgId, reason: null, detail: null, actor: s.actor });
    s.advance(31);
    await expect(testRunDue(s.rt, { orgId: s.org.orgId })).resolves.toEqual({ renewed: 0, failed: 0 });
    const ended = await getPlanState(s.rt, s.org.orgId);
    expect(ended.phase).toBe('ended');
    expect(ended.endedAt).toEqual(new Date('2026-12-01T00:00:00.000Z'));
    expect(ended.modules.crm.access).toBe('read_only');
    // No renewal invoice was made for a plan that ended.
    expect(await listInvoices(db, { orgId: s.org.orgId })).toHaveLength(1);
    const after = await undoCancel(s.rt, { orgId: s.org.orgId, actor: s.actor });
    expect(after).toMatchObject({ ok: false, error: { code: 'no_subscription' } });
  });

  it('pause for 2 months: no bill while paused, view only, then it starts again by itself', async () => {
    const s = await scene('2026-11-01T00:00:00.000Z');
    await pay(s, CRM5);
    const paused = await pausePlan(s.rt, { orgId: s.org.orgId, months: 2, reason: 'seasonal', actor: s.actor });
    expect(paused.ok).toBe(true);
    if (!paused.ok) return;
    expect(paused.data.phase).toBe('pause_scheduled');
    expect(paused.data.pause).toEqual({ startsAt: new Date('2026-12-01T00:00:00.000Z'), resumesAt: new Date('2027-01-31T23:00:00.000Z') });
    expect(paused.data.modules.crm.access).toBe('full');
    expect(await emailsOf(s.org.orgId)).toContain('paused');

    s.advance(31);
    await expect(testRunDue(s.rt, { orgId: s.org.orgId })).resolves.toEqual({ renewed: 0, failed: 0 });
    const inPause = await getPlanState(s.rt, s.org.orgId);
    expect(inPause.phase).toBe('paused');
    expect(inPause.modules.crm.access).toBe('read_only');
    expect(await listInvoices(db, { orgId: s.org.orgId })).toHaveLength(1);

    s.advance(62);
    await expect(testRunDue(s.rt, { orgId: s.org.orgId })).resolves.toEqual({ renewed: 1, failed: 0 });
    const back = await getPlanState(s.rt, s.org.orgId);
    expect(back.phase).toBe('active');
    expect(back.pause).toBeNull();
    expect(back.modules.crm.access).toBe('full');
    const invoices = await listInvoices(db, { orgId: s.org.orgId });
    expect(invoices.map((invoice) => invoice.issuedAt.toISOString())).toEqual(['2027-02-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z']);
    const actions = (await auditsOf(s.org.orgId)).map((row) => row.action);
    expect(actions.filter((action) => action === 'plan.paused')).toHaveLength(1);
    expect(actions).toContain('plan.resumed');
  });

  it('a pause can be undone before it starts, and "start again now" during it bills today', async () => {
    const s = await scene('2026-11-01T00:00:00.000Z');
    await pay(s, CRM5);
    await pausePlan(s.rt, { orgId: s.org.orgId, months: 1, reason: null, actor: s.actor });
    const undone = await undoPause(s.rt, { orgId: s.org.orgId, actor: s.actor });
    expect(undone).toMatchObject({ ok: true, data: { phase: 'active', pause: null } });
    expect(await listInvoices(db, { orgId: s.org.orgId })).toHaveLength(1);

    await pausePlan(s.rt, { orgId: s.org.orgId, months: 3, reason: null, actor: s.actor });
    s.advance(40);
    await testRunDue(s.rt, { orgId: s.org.orgId });
    expect((await getPlanState(s.rt, s.org.orgId)).phase).toBe('paused');
    const started = await undoPause(s.rt, { orgId: s.org.orgId, actor: s.actor });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.data.phase).toBe('active');
    expect(started.data.modules.crm.access).toBe('full');
    const invoices = await listInvoices(db, { orgId: s.org.orgId });
    expect(invoices).toHaveLength(2);
    expect(invoices[0]).toMatchObject({ status: 'paid', totalCents: 14500, issuedAt: s.clock.at });
    expect(started.data.nextCharge?.at).toEqual(new Date('2027-01-11T00:00:00.000Z'));
  });
});

describe.skipIf(!available)('test gateway: time shift tool, invoices and signatures', () => {
  it('skipping 14 days ends a trial with no card: view only, nothing deleted, paying turns it on', async () => {
    const org = await createTestOrg(pool);
    orgs.push(org);
    // The shift tool moves stored dates and runs on the real clock.
    const rt = testRuntime(db);
    const actor = { userId: org.owner.id, label: org.owner.name };
    await startTrial(rt, { orgId: org.orgId, selection: CRM_WMS, actor });
    const week = await testShiftTime(rt, { orgId: org.orgId, days: 7 });
    expect(week).toMatchObject({ ok: true, data: { phase: 'trial' } });
    expect(week.ok && week.data.trial?.daysLeft).toBe(7);

    const ended = await testShiftTime(rt, { orgId: org.orgId, days: 7 });
    expect(ended.ok).toBe(true);
    if (!ended.ok) return;
    expect(ended.data.phase).toBe('trial_ended');
    expect(ended.data.modules.crm.access).toBe('read_only');
    expect(await entitlementsOf(org.orgId)).toEqual([
      { module: 'crm', status: 'trialing', source: 'trial' },
      { module: 'wms', status: 'trialing', source: 'trial' },
    ]);

    const checkout = await createCheckout(rt, { orgId: org.orgId, orgName: org.name, selection: CRM_WMS, actor, actorEmail: org.owner.email });
    expect(checkout).toMatchObject({ ok: true, data: { dueTodayCents: 39520 } });
    if (!checkout.ok) return;
    await completeTestCheckout(rt, { sessionId: checkout.data.sessionId, cardNumber: WORKS, ...CARD });
    const paid = await getPlanState(rt, org.orgId);
    expect(paid.phase).toBe('active');
    expect(paid.modules.crm.access).toBe('full');

    // A month later the renewal has run by itself.
    const month = await testShiftTime(rt, { orgId: org.orgId, days: 32 });
    expect(month).toMatchObject({ ok: true, data: { phase: 'active' } });
    expect(await listInvoices(db, { orgId: org.orgId })).toHaveLength(2);
    expect((await auditsOf(org.orgId)).filter((row) => row.action === 'test.tool').map((row) => row.summary)).toContain(
      'Test tool: skipped ahead 7 days. No real money moved.',
    );
  });

  it('the test tools do not exist outside test gateway mode', async () => {
    const off = testRuntime(db, { env: { NODE_ENV: 'production' } as NodeJS.ProcessEnv });
    const org = await createTestOrg(pool);
    orgs.push(org);
    await expect(testShiftTime(off, { orgId: org.orgId, days: 7 })).resolves.toMatchObject({ ok: false, error: { code: 'billing_unavailable' } });
    await expect(testFailNextPayment(off, { orgId: org.orgId })).resolves.toMatchObject({ ok: false, error: { code: 'billing_unavailable' } });
    await expect(testRunDue(off, { orgId: org.orgId })).resolves.toEqual({ renewed: 0, failed: 0 });
    await expect(completeTestCheckout(off, { sessionId: 'cs_test_x', cardNumber: WORKS, ...CARD })).resolves.toMatchObject({
      ok: false,
      error: { code: 'billing_unavailable' },
    });
    // And with billing off, checkout fails closed with the honest message.
    const checkout = await createCheckout(off, { orgId: org.orgId, orgName: org.name, selection: CRM5, actor: { userId: org.owner.id, label: 'Maya Chen' }, actorEmail: org.owner.email });
    expect(checkout).toEqual({
      ok: false,
      error: { code: 'billing_unavailable', message: 'Billing is not available right now. Nothing was charged. Please try again later.' },
    });
    expect(await entitlementsOf(org.orgId)).toEqual([]);
  });

  it('makes a real PDF for an invoice, and only for the org that owns it', async () => {
    const s = await scene();
    await pay(s, CRM_WMS);
    const [invoice] = await listInvoices(db, { orgId: s.org.orgId });
    expect(await getInvoice(db, { orgId: s.org.orgId, invoiceId: invoice!.id })).toMatchObject({ number: 'TEST-0001' });

    const pdf = await getInvoicePdf(s.rt, { orgId: s.org.orgId, invoiceId: invoice!.id });
    expect(pdf.ok).toBe(true);
    if (!pdf.ok || pdf.data.kind !== 'bytes') throw new Error('expected bytes');
    expect(pdf.data.filename).toBe('KitStak-TEST-0001.pdf');
    const body = Buffer.from(pdf.data.bytes).toString('latin1');
    expect(body.startsWith('%PDF-1.4')).toBe(true);
    expect(body.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(body).toContain('(Invoice TEST-0001)');
    expect(body).toContain('($395.20)');
    expect(body).toContain('Test mode. No real money moved.');
    // The cross reference table really points at the objects.
    const xrefAt = Number(/startxref\n(\d+)/.exec(body)?.[1]);
    expect(body.slice(xrefAt, xrefAt + 4)).toBe('xref');
    const firstObject = Number(/\n(\d{10}) 00000 n /.exec(body)?.[1]);
    expect(body.slice(firstObject, firstObject + 7)).toBe('1 0 obj');

    const other = await scene();
    await expect(getInvoice(db, { orgId: other.org.orgId, invoiceId: invoice!.id })).resolves.toBeNull();
    await expect(getInvoicePdf(other.rt, { orgId: other.org.orgId, invoiceId: invoice!.id })).resolves.toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('signs events like Stripe does, and refuses anything else', async () => {
    const s = await scene();
    const gateway = s.rt.gateway!;
    const body = JSON.stringify({ id: 'evt_test_sig', type: 'customer.updated', created: 1, data: { object: { id: 'cus_1', object: 'customer' } } });
    const good = signTestPayload(body, s.rt.config.testWebhookSecret, s.clock.at);
    expect(good).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(gateway.verifyWebhook(body, good)).toMatchObject({ id: 'evt_test_sig', type: 'customer.updated', customerId: 'cus_1', orgId: null });
    for (const bad of [null, '', 'v1=abc', good.replace(/.$/, good.endsWith('0') ? '1' : '0'), signTestPayload(body, 'wrong', s.clock.at)]) {
      expect(() => gateway.verifyWebhook(body, bad)).toThrow(WebhookSignatureError);
    }
    expect(() => gateway.verifyWebhook(`${body} `, good)).toThrow(WebhookSignatureError);
    const old = signTestPayload(body, s.rt.config.testWebhookSecret, new Date(s.clock.at.getTime() - 301_000));
    expect(() => gateway.verifyWebhook(body, old)).toThrow(WebhookSignatureError);
  });
});
