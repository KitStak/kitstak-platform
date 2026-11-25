/**
 * Real Stripe sandbox, flow 5: cancel at the end of the paid period, keep the plan after all, cancel
 * again, and let the period run out. Skipped unless STRIPE_SANDBOX=1 (see ./harness.ts).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { scheduleCancel, undoCancel } from '../../src/server/cancel';
import { getPlanState } from '../../src/server/state';
import { buyPlan, failures, HOUR_MS, openTestDb, Sandbox, SANDBOX_ENABLED, stripeApi, stripeSubscription } from './harness';

const test = SANDBOX_ENABLED ? await openTestDb() : null;
vi.setConfig({ testTimeout: 900_000, hookTimeout: 900_000 });

describe.skipIf(!SANDBOX_ENABLED || !test?.available)('Stripe sandbox: cancel at the end of the paid period', () => {
  let box: Sandbox;
  let subscriptionId = '';
  let periodEnd = 0;

  beforeAll(async () => {
    box = await Sandbox.create(test!, '05 cancel at period end');
    const bought = await buyPlan(box, { products: ['crm', 'pulse'], seats: 2, warehouses: 1, interval: 'monthly' });
    expect(failures(bought.delivered)).toEqual([]);
    subscriptionId = String(bought.subscription.id);
    box.note('subscriptionId', subscriptionId);
    periodEnd = new Date((await box.subscriptionRow())!.current_period_end).getTime();
  });

  afterAll(async () => {
    await box?.dispose();
    await test?.pool.end();
  });

  it('a cancel keeps everything until the paid period ends, and can be undone', async () => {
    const canceled = await scheduleCancel(box.rt, { orgId: box.org.orgId, reason: 'too_expensive', detail: 'Sandbox run.', actor: box.actor });
    expect(canceled.ok).toBe(true);
    if (canceled.ok) expect(canceled.data.phase).toBe('cancel_scheduled');
    let subscription = await stripeSubscription(subscriptionId);
    expect(subscription.status).toBe('active');
    expect(subscription.cancel_at_period_end || subscription.cancel_at !== null).toBe(true);

    let row = await box.subscriptionRow();
    expect(row!.cancel_at_period_end || row!.cancel_at !== null).toBe(true);
    expect(row!.next_charge_cents).toBeNull();
    expect(await box.entitlements()).toMatchObject([
      { module: 'crm', status: 'active', source: 'stripe' },
      { module: 'pulse', status: 'active', source: 'stripe' },
    ]);
    const mail = (await box.emails()).find((email) => email.template === 'cancel_scheduled');
    expect(new Date(String(mail!.payload.endsAt)).getTime()).toBe(periodEnd);
    expect(await box.auditActions()).toContain('cancel.scheduled');
    expect(failures(await box.sync())).toEqual([]);

    const kept = await undoCancel(box.rt, { orgId: box.org.orgId, actor: box.actor });
    expect(kept.ok).toBe(true);
    if (kept.ok) expect(kept.data.phase).toBe('active');
    subscription = await stripeSubscription(subscriptionId);
    expect(subscription.cancel_at_period_end).toBe(false);
    expect(subscription.cancel_at).toBeNull();
    row = await box.subscriptionRow();
    expect(row).toMatchObject({ cancel_at_period_end: false, cancel_at: null });
    expect(row!.next_charge_cents).toBe(row!.recurring_cents);
    expect(await box.auditActions()).toContain('cancel.undone');
    expect(failures(await box.sync())).toEqual([]);
  });

  it('when the paid period runs out the plan ends, nothing more is charged and the apps are view only', async () => {
    const canceled = await scheduleCancel(box.rt, { orgId: box.org.orgId, reason: 'not_using', detail: null, actor: box.actor });
    expect(canceled.ok).toBe(true);
    expect(failures(await box.sync())).toEqual([]);
    const invoicesBefore = (await stripeApi('GET', '/v1/invoices', { customer: box.customerId, limit: 20 })).data.length;

    await box.advanceTo(new Date(periodEnd + 2 * HOUR_MS));
    const delivered = await box.sync();
    expect(failures(delivered)).toEqual([]);
    box.note('eventsWhenPlanEnded', delivered.map((event) => `${event.type}:${event.outcome.result}`));
    expect(delivered.map((event) => event.type)).toContain('customer.subscription.deleted');

    const subscription = await stripeSubscription(subscriptionId);
    expect(subscription.status).toBe('canceled');
    expect(subscription.ended_at * 1000).toBe(periodEnd);
    // No renewal invoice was made.
    expect((await stripeApi('GET', '/v1/invoices', { customer: box.customerId, limit: 20 })).data.length).toBe(invoicesBefore);

    const row = await box.subscriptionRow();
    expect(row).toMatchObject({ status: 'canceled', ended_reason: 'canceled' });
    expect(new Date(row!.ended_at).getTime()).toBe(periodEnd);
    const rows = await box.entitlements();
    expect(rows).toMatchObject([
      { module: 'crm', status: 'canceled', source: 'stripe' },
      { module: 'pulse', status: 'canceled', source: 'stripe' },
    ]);
    expect(new Date(rows[0]!.current_period_end).getTime()).toBe(periodEnd);
    const templates = await box.emailTemplates();
    expect(templates.filter((template) => template === 'plan_ended')).toHaveLength(1);
    expect(await box.auditActions()).toContain('plan.ended');
    const state = await getPlanState(box.rt, box.org.orgId);
    expect(state.phase).toBe('ended');
    expect(state.modules.crm.access).toBe('read_only');
  });
});
