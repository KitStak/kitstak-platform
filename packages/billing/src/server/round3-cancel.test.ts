/**
 * Review round 3, operations: cancel while a payment is late, emails for late tries, and the reason
 * a plan ended. Proven against the local dev Postgres through the test gateway (the same webhook
 * path Stripe uses). Skipped when the database is not reachable.
 *
 * The one rule for a cancel with a bill open: the plan ends today and the bill is dropped. Nothing
 * is charged afterwards, by a retry or by a new card.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { PlanSelection } from '../catalog';
import { emailContent } from '../emails/render';
import { completeTestCardUpdate, completeTestCheckout, testRunDue } from '../gateway/test';
import { cancelWords, planEndedLine, planNoticeFor } from '../plan-state';
import { createTestOrg, openTestDb, removeTestOrg, testRuntime, TEST_PORTAL_URL, type TestOrg } from '../testing/db';
import { scheduleCancel, undoCancel } from './cancel';
import { createCheckout } from './checkout';
import type { BillingRuntime } from './db';
import { createPaymentUpdateSession, retryPayment } from './payment';
import { getPlanState } from './state';

const { pool, db, available } = await openTestDb();
vi.setConfig({ testTimeout: 90_000 });

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const CARD = { cardNumber: '4242 4242 4242 4242', expMonth: 12, expYear: 2031, cvc: '123', name: 'Maya Chen', postalCode: '60601' };
const FAILS_AT_RENEWAL = '4000 0000 0000 0341';
const CRM = (seats: number): PlanSelection => ({ products: ['crm'], seats, warehouses: 1, interval: 'monthly' });

const orgs: TestOrg[] = [];

interface Scene {
  readonly org: TestOrg;
  readonly rt: BillingRuntime;
  readonly actor: { userId: string; label: string };
  now(): Date;
  advance(ms: number): Promise<void>;
}

/** A paid CRM plan for 2 users ($58.00 a month) on the card that fails at renewals. */
async function scene(start = '2026-10-16T00:00:00.000Z'): Promise<Scene> {
  const org = await createTestOrg(pool);
  orgs.push(org);
  const clock = { at: new Date(start) };
  const rt = testRuntime(db, { now: () => clock.at });
  const actor = { userId: org.owner.id, label: org.owner.name };
  const checkout = await createCheckout(rt, { orgId: org.orgId, orgName: org.name, selection: CRM(2), actor, actorEmail: org.owner.email });
  if (!checkout.ok) throw new Error(checkout.error.message);
  const paid = await completeTestCheckout(rt, { sessionId: checkout.data.sessionId, ...CARD, cardNumber: FAILS_AT_RENEWAL });
  if (!paid.ok) throw new Error(paid.error.message);
  return {
    org,
    rt,
    actor,
    now: () => clock.at,
    async advance(ms) {
      clock.at = new Date(clock.at.getTime() + ms);
      await testRunDue(rt, { orgId: org.orgId });
    },
  };
}

const one = async <T extends Record<string, unknown>>(text: string, values: unknown[]): Promise<T> => (await pool.query(text, values)).rows[0] as T;
const all = async <T extends Record<string, unknown>>(text: string, values: unknown[]): Promise<T[]> => (await pool.query(text, values)).rows as T[];
const audits = (orgId: string, action: string) =>
  all<{ summary: string; data: Record<string, unknown>; actor_label: string }>(
    `select summary, data, actor_label from core.billing_audit_log where org_id = $1 and action = $2 order by created_at, id`,
    [orgId, action],
  );
const mails = (orgId: string, template: string) =>
  all<{ payload: Record<string, unknown> }>(`select payload from core.billing_emails where org_id = $1 and template = $2 order by created_at, id`, [orgId, template]);
const subscriptionRow = (orgId: string) =>
  one<{ status: string; cancel_at_period_end: boolean; ended_reason: string | null; ended_amount_cents: number | null; ended_attempts: number | null; amount_due_cents: number | null }>(
    `select status, cancel_at_period_end, ended_reason, ended_amount_cents, ended_attempts, amount_due_cents from core.billing_subscriptions where org_id = $1`,
    [orgId],
  );
const invoiceStatuses = async (orgId: string) =>
  (await all<{ status: string }>(`select status from core.billing_invoices where org_id = $1 order by issued_at`, [orgId])).map((row) => row.status);
const viewer = { canManage: true, canView: true, ownerName: 'Maya Chen' };

afterAll(async () => {
  for (const org of orgs) await removeTestOrg(pool, org);
  await pool.end();
});

describe.skipIf(!available)('cancel while a payment is late (day 0, full access still on)', () => {
  it('says the plan ends today and the bill is dropped, then does exactly that', async () => {
    const s = await scene();
    await s.advance(31 * DAY);
    const late = await getPlanState(s.rt, s.org.orgId);
    expect(late.phase).toBe('past_due');
    expect(late.pastDue?.amountDueCents).toBe(5800);

    // What the cancel page says before the button.
    const words = cancelWords(late, 'UTC');
    expect(words).toMatchObject({
      mode: 'now',
      notice:
        'You have an unpaid bill of $58.00. If you cancel now, your plan ends today and we will not charge the $58.00. Your apps become view only today. Nothing is deleted.',
      instead: 'Want to keep your plan? Pay the $58.00 and you have full access until Dec 16, 2026.',
      confirmLabel: 'End my plan today',
      doneNotice: 'Your plan has ended. We will not charge the $58.00. Your data is safe.',
      openBillCents: 5800,
    });
    expect(words.notice).not.toContain('You keep everything until');

    const result = await scheduleCancel(s.rt, { orgId: s.org.orgId, reason: 'too_expensive', detail: null, actor: s.actor });
    if (!result.ok) throw new Error(result.error.message);
    const ended = result.data;
    expect(ended.phase).toBe('ended');
    expect(ended.hasSubscription).toBe(false);
    expect(ended.pastDue).toBeNull();
    expect(ended.cancelAt).toBeNull();
    expect(ended.endedReason).toBe('canceled_unpaid');
    expect(ended.endedAmountCents).toBe(5800);
    expect(ended.modules.crm.access).toBe('read_only');
    expect(planEndedLine(ended, 'UTC')).toBe('You canceled, so your plan ended on Nov 16, 2026. We did not charge the $58.00.');

    // The database agrees: the plan is over, the cancel flag is not left hanging, the bill is void.
    expect(await subscriptionRow(s.org.orgId)).toMatchObject({ status: 'canceled', cancel_at_period_end: false, ended_reason: 'canceled_unpaid', ended_amount_cents: 5800 });
    expect(await invoiceStatuses(s.org.orgId)).toEqual(['paid', 'void']);

    // The activity page and the email say what happened. No "set to end" email goes out.
    const canceled = await audits(s.org.orgId, 'cancel.ended_now');
    expect(canceled.map((row) => row.summary)).toEqual([
      'Maya Chen canceled the plan with a bill of $58.00 open. The plan ended and the bill was dropped. It will not be charged.',
    ]);
    expect((await audits(s.org.orgId, 'plan.ended')).map((row) => row.summary)).toEqual(['The plan ended. Your apps are view only. Your data is safe.']);
    expect(await audits(s.org.orgId, 'cancel.scheduled')).toEqual([]);
    expect(await mails(s.org.orgId, 'cancel_scheduled')).toEqual([]);
    const [mail] = await mails(s.org.orgId, 'plan_ended');
    expect(mail?.payload).toMatchObject({ reason: 'canceled_unpaid', amountCents: 5800 });
    const email = emailContent('plan_ended', mail!.payload as never);
    const text = email.blocks.flatMap((block) => (block.kind === 'text' || block.kind === 'note' ? [block.text] : [])).join(' ');
    expect(text).toContain('You canceled the plan');
    expect(text).toContain('A bill of $58.00 was still open. We dropped it. We will not charge it.');
  });

  it('nothing is charged after the cancel: not by the retries, not by a new card, not by "Pay now"', async () => {
    const s = await scene();
    await s.advance(31 * DAY);
    const result = await scheduleCancel(s.rt, { orgId: s.org.orgId, reason: null, detail: null, actor: s.actor });
    expect(result.ok && result.data.phase).toBe('ended');
    const failedBefore = (await audits(s.org.orgId, 'payment.failed')).length;
    const paidBefore = (await audits(s.org.orgId, 'payment.succeeded')).length;

    // The days the gateway would have tried again (3, 8 and 15 days after the bill).
    for (const days of [3, 5, 7]) await s.advance(days * DAY + HOUR);
    expect((await audits(s.org.orgId, 'payment.failed')).length).toBe(failedBefore);

    // A working card is saved. Before this fix that charged the bill of the canceled plan at once.
    const card = await createPaymentUpdateSession(s.rt, { orgId: s.org.orgId, actor: s.actor });
    if (!card.ok) throw new Error(card.error.message);
    expect((await completeTestCardUpdate(s.rt, { sessionId: card.data.url.split('/').pop()!, ...CARD })).ok).toBe(true);
    const pay = await retryPayment(s.rt, { orgId: s.org.orgId, actor: s.actor });
    expect(pay.ok).toBe(false);
    if (!pay.ok) expect(pay.error.code).toBe('no_subscription');

    expect((await audits(s.org.orgId, 'payment.succeeded')).length).toBe(paidBefore);
    expect(await invoiceStatuses(s.org.orgId)).toEqual(['paid', 'void']);
    expect((await getPlanState(s.rt, s.org.orgId)).phase).toBe('ended');
    // "Keep my plan" has nothing to bring back, and says so instead of failing oddly.
    const keep = await undoCancel(s.rt, { orgId: s.org.orgId, actor: s.actor });
    expect(keep.ok).toBe(false);
  });
});

describe.skipIf(!available)('cancel when the apps are already view only (day 8 of a late payment)', () => {
  it('the third try fails after the access date: the email says view only, with no date that has passed', async () => {
    const s = await scene();
    await s.advance(31 * DAY); // try 1, Nov 16
    await s.advance(3 * DAY + HOUR); // try 2, day 3
    await s.advance(5 * DAY); // try 3, day 8: one day after the apps became view only
    const state = await getPlanState(s.rt, s.org.orgId);
    expect(state.phase).toBe('unpaid');
    expect(state.modules.crm.access).toBe('read_only');

    const sent = await mails(s.org.orgId, 'payment_failed');
    expect(sent.map((row) => row.payload.attempt)).toEqual([1, 2, 3]);
    const third = sent[2]!.payload as { accessChangesAt: string; asOf: string; nextRetryAt: string | null };
    expect(new Date(third.asOf).getTime()).toBeGreaterThan(new Date(third.accessChangesAt).getTime());

    const email = emailContent('payment_failed', third as never);
    const words = [
      email.subject,
      email.preheader,
      email.heading,
      ...email.blocks.flatMap((block) => (block.kind === 'text' || block.kind === 'note' ? [block.text] : block.kind === 'facts' ? block.rows.map((row) => `${row.label}: ${row.value}`) : [])),
    ].join(' | ');
    expect(email.subject).toBe('Your KitStak apps are view only. Your payment is still late.');
    expect(words).toContain('Your apps are view only now. Pay $58.00 to turn them back on.');
    expect(words).toContain('Apps view only since: Nov 23, 2026');
    expect(words).toContain('We try again on: Dec 1, 2026');
    expect(words).not.toContain('keep full access');
    expect(words).not.toContain('Full access until');
    expect(words).not.toMatch(/by Nov 2\d/);

    // The first two tries, inside the grace days, still give the day to act by.
    const first = emailContent('payment_failed', sent[0]!.payload as never);
    expect(first.subject).toBe('We could not charge your card for KitStak');
    expect(first.preheader).toBe('Update your card by Nov 23, 2026 to keep full access.');
  });

  it('cancel says the apps are view only now, ends the plan and drops the bill', async () => {
    const s = await scene();
    await s.advance(31 * DAY);
    await s.advance(3 * DAY + HOUR);
    await s.advance(5 * DAY);
    const state = await getPlanState(s.rt, s.org.orgId);
    expect(state.phase).toBe('unpaid');
    const words = cancelWords(state, 'UTC');
    expect(words.mode).toBe('now');
    expect(words.notice).toBe(
      'You have an unpaid bill of $58.00, and your apps are view only now. If you cancel, your plan ends today and we will not charge the $58.00. Nothing is deleted.',
    );
    expect(words.notice).not.toContain('You keep everything until');

    const result = await scheduleCancel(s.rt, { orgId: s.org.orgId, reason: 'not_using', detail: 'We moved on.', actor: s.actor });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.data.phase).toBe('ended');
    expect(result.data.endedReason).toBe('canceled_unpaid');
    expect(await subscriptionRow(s.org.orgId)).toMatchObject({ status: 'canceled', cancel_at_period_end: false, ended_reason: 'canceled_unpaid', ended_amount_cents: 5800, ended_attempts: 3 });
    expect(await invoiceStatuses(s.org.orgId)).toEqual(['paid', 'void']);

    // The last retry day comes and goes. Nothing is tried and nothing is charged.
    const failedBefore = (await audits(s.org.orgId, 'payment.failed')).length;
    await s.advance(8 * DAY);
    expect((await audits(s.org.orgId, 'payment.failed')).length).toBe(failedBefore);
    expect(await mails(s.org.orgId, 'plan_ended')).toHaveLength(1);
    const feedback = await all<{ reason: string; outcome: string }>(`select reason, outcome from core.billing_cancel_feedback where org_id = $1`, [s.org.orgId]);
    expect(feedback).toEqual([{ reason: 'not_using', outcome: 'canceled' }]);
  });
});

describe.skipIf(!available)('the gateway gives up after its last try', () => {
  it('the email, billing home, the app banner and the activity line all say why the plan ended', async () => {
    const s = await scene();
    await s.advance(31 * DAY); // try 1
    await s.advance(3 * DAY + HOUR); // try 2
    await s.advance(5 * DAY); // try 3
    await s.advance(7 * DAY); // try 4, the last one
    const state = await getPlanState(s.rt, s.org.orgId);
    expect(state.phase).toBe('ended');
    expect(state).toMatchObject({ endedReason: 'payment_failed', endedAmountCents: 5800, endedAttempts: 4 });
    expect(planEndedLine(state, 'UTC')).toBe('We could not collect $58.00 after 4 tries, so your plan ended on Dec 1, 2026.');

    const banner = planNoticeFor(state, { module: 'crm', viewer, portalUrl: TEST_PORTAL_URL, now: s.now(), timeZone: 'UTC' });
    expect(banner?.text).toBe('We could not collect $58.00 after 4 tries, so your plan ended on Dec 1. Your data is safe. Pick a plan to keep working.');

    const ended = await audits(s.org.orgId, 'plan.ended');
    expect(ended.map((row) => row.summary)).toEqual(['We could not collect $58.00 after 4 tries, so the plan ended. Your apps are view only. Your data is safe.']);
    expect(ended[0]?.actor_label).toBe('KitStak');

    const [mail] = await mails(s.org.orgId, 'plan_ended');
    expect(mail?.payload).toMatchObject({ reason: 'payment_failed', amountCents: 5800, attempts: 4 });
    const email = emailContent('plan_ended', mail!.payload as never);
    expect(email.subject).toBe('Your KitStak plan has ended. We could not collect your payment.');
    expect(email.blocks[0]).toEqual({ kind: 'text', text: `We could not collect $58.00 after 4 tries, so the plan for ${s.org.name} ended on Dec 1, 2026.` });
    // The last try got no "we will try again" email after the plan was already closed.
    expect((await mails(s.org.orgId, 'payment_failed')).map((row) => row.payload.attempt)).toEqual([1, 2, 3]);
  });
});

describe.skipIf(!available)('a cancel on a plan in good standing is unchanged', () => {
  it('runs to the end of the paid time, can be kept, and records a plain reason when the day comes', async () => {
    const org = await createTestOrg(pool);
    orgs.push(org);
    const clock = { at: new Date('2026-10-16T00:00:00.000Z') };
    const rt = testRuntime(db, { now: () => clock.at });
    const actor = { userId: org.owner.id, label: org.owner.name };
    const checkout = await createCheckout(rt, { orgId: org.orgId, orgName: org.name, selection: CRM(2), actor, actorEmail: org.owner.email });
    if (!checkout.ok) throw new Error(checkout.error.message);
    expect((await completeTestCheckout(rt, { sessionId: checkout.data.sessionId, ...CARD })).ok).toBe(true);

    const active = await getPlanState(rt, org.orgId);
    expect(cancelWords(active, 'UTC')).toMatchObject({
      mode: 'period_end',
      notice: 'Your plan will end on Nov 16, 2026. You keep everything until then. After that your apps are view only. Nothing is deleted.',
      confirmLabel: 'Cancel my plan',
      openBillCents: null,
    });
    const set = await scheduleCancel(rt, { orgId: org.orgId, reason: null, detail: null, actor });
    expect(set.ok && set.data.phase).toBe('cancel_scheduled');
    expect(set.ok && set.data.cancelAt?.toISOString()).toBe('2026-11-16T00:00:00.000Z');
    expect(await subscriptionRow(org.orgId)).toMatchObject({ status: 'active', cancel_at_period_end: true, ended_reason: null });

    clock.at = new Date('2026-11-16T01:00:00.000Z');
    await testRunDue(rt, { orgId: org.orgId });
    const ended = await getPlanState(rt, org.orgId);
    expect(ended.phase).toBe('ended');
    expect(ended.endedReason).toBe('canceled');
    expect(planEndedLine(ended, 'UTC')).toBe('Your plan ended on Nov 16, 2026.');
    const [mail] = await mails(org.orgId, 'plan_ended');
    expect(mail?.payload).toMatchObject({ reason: 'canceled' });
  });
});
