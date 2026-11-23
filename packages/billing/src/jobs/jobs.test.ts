/**
 * The one minute job, against the local dev Postgres (docs/billing/DEV.md). Skipped when it is not
 * reachable. The reminder tests run on a clock in 2031, so the scans can never match a real local
 * organization. The tick and reconcile tests use the real clock, like the real job.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { PlanSelection } from '../catalog';
import { deliverQueuedEmails } from '../emails/deliver';
import { completeTestCheckout, testRunDue } from '../gateway/test';
import { addBillingManager } from '../server/access';
import { createCheckout } from '../server/checkout';
import type { BillingRuntime } from '../server/db';
import { enqueueEmail } from '../server/outbox';
import { updateBillingProfile } from '../server/profile';
import { getPlanState } from '../server/state';
import { startTrial } from '../server/trial';
import { addPerson, createTestOrg, openTestDb, removeTestOrg, testRuntime, type TestOrg } from '../testing/db';
import { reconcileSubscriptions } from './reconcile';
import { queueGraceReminders, queueTrialReminders } from './reminders';
import { runBillingTick } from './tick';

const { pool, db, available } = await openTestDb();
vi.setConfig({ testTimeout: 60_000 });

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const CARD = { expMonth: 12, expYear: 2035, cvc: '123', name: 'Maya Chen', postalCode: '60601' };
const WORKS = '4242 4242 4242 4242';
const FAILS_LATER = '4000 0000 0000 0341';
const CRM_WMS: PlanSelection = { products: ['crm', 'wms'], seats: 5, warehouses: 1, interval: 'monthly' };
const PULSE: PlanSelection = { products: ['pulse'], seats: 1, warehouses: 1, interval: 'monthly' };

const orgs: TestOrg[] = [];
const extraUsers: string[] = [];

interface Scene {
  readonly org: TestOrg;
  readonly rt: BillingRuntime;
  readonly clock: { at: Date };
  readonly actor: { userId: string; label: string };
  advance(ms: number): void;
}

async function scene(start: string | null, extraRoles: readonly string[] = []): Promise<Scene> {
  const org = await createTestOrg(pool, extraRoles);
  orgs.push(org);
  const clock = { at: start ? new Date(start) : new Date() };
  const rt = start ? testRuntime(db, { now: () => clock.at }) : testRuntime(db);
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

async function pay(s: Scene, selection: PlanSelection, cardNumber = WORKS): Promise<void> {
  const checkout = await createCheckout(s.rt, {
    orgId: s.org.orgId,
    orgName: s.org.name,
    selection,
    actor: s.actor,
    actorEmail: s.org.owner.email,
  });
  if (!checkout.ok) throw new Error(checkout.error.message);
  const result = await completeTestCheckout(s.rt, { sessionId: checkout.data.sessionId, cardNumber, ...CARD });
  if (!result.ok) throw new Error(result.error.message);
}

const emails = async (orgId: string, template: string) =>
  (
    await pool.query(
      `select to_email, payload, dedupe_key, status from core.billing_emails where org_id = $1 and template = $2 order by created_at, to_email`,
      [orgId, template],
    )
  ).rows as { to_email: string; payload: Record<string, unknown>; dedupe_key: string; status: string }[];

afterAll(async () => {
  for (const org of orgs) await removeTestOrg(pool, org, extraUsers);
  await pool.end();
});

describe.skipIf(!available)('trial reminders', () => {
  it('go out once each at 7, 3 and 1 days left, then once when the trial has ended', async () => {
    const s = await scene('2031-03-01T10:00:00.000Z');
    const started = await startTrial(s.rt, { orgId: s.org.orgId, selection: CRM_WMS, actor: s.actor });
    expect(started.ok).toBe(true);

    // Day 0 to day 6: nothing.
    await expect(queueTrialReminders(s.rt)).resolves.toBe(0);
    s.advance(6 * DAY);
    await expect(queueTrialReminders(s.rt)).resolves.toBe(0);

    // Day 7: 7 days left.
    s.advance(1 * DAY);
    await expect(queueTrialReminders(s.rt)).resolves.toBe(1);
    await expect(queueTrialReminders(s.rt)).resolves.toBe(0);
    const week = await emails(s.org.orgId, 'trial_ending');
    expect(week).toHaveLength(1);
    expect(week[0]).toMatchObject({ to_email: s.org.owner.email, dedupe_key: `trial:${s.org.orgId}:7:${s.org.owner.email}`, status: 'queued' });
    expect(week[0]!.payload).toEqual({
      orgName: s.org.name,
      portalUrl: 'http://localhost:3300',
      daysLeft: 7,
      trialEndsAt: '2031-03-15T10:00:00.000Z',
      totalCents: 39520,
      interval: 'monthly',
      products: ['crm', 'wms'],
    });

    // Day 8 to 10: nothing new. Day 11: 3 days left. Day 13: tomorrow.
    s.advance(1 * DAY);
    await expect(queueTrialReminders(s.rt)).resolves.toBe(0);
    s.advance(3 * DAY);
    await expect(queueTrialReminders(s.rt)).resolves.toBe(1);
    s.advance(2 * DAY);
    await expect(queueTrialReminders(s.rt)).resolves.toBe(1);
    await expect(queueTrialReminders(s.rt)).resolves.toBe(0);
    expect((await emails(s.org.orgId, 'trial_ending')).map((row) => row.payload.daysLeft)).toEqual([7, 3, 1]);
    expect(await emails(s.org.orgId, 'trial_ended')).toHaveLength(0);

    // One hour after the end: the "trial has ended" email, once.
    s.advance(1 * DAY + HOUR);
    expect((await getPlanState(s.rt, s.org.orgId)).phase).toBe('trial_ended');
    await expect(queueTrialReminders(s.rt)).resolves.toBe(1);
    await expect(queueTrialReminders(s.rt)).resolves.toBe(0);
    const ended = await emails(s.org.orgId, 'trial_ended');
    expect(ended).toHaveLength(1);
    expect(ended[0]!.payload).toEqual({
      orgName: s.org.name,
      portalUrl: 'http://localhost:3300',
      trialEndedAt: '2031-03-15T10:00:00.000Z',
      products: ['crm', 'wms'],
    });

    // Long after: nothing more, ever.
    s.advance(3 * DAY);
    await expect(queueTrialReminders(s.rt)).resolves.toBe(0);
    expect(await emails(s.org.orgId, 'trial_ending')).toHaveLength(3);
  });

  it('go to the billing email, every owner and every billing manager, and to nobody else', async () => {
    const s = await scene('2031-05-01T10:00:00.000Z', ['admin', 'member']);
    const manager = s.org.people[2]!;
    await startTrial(s.rt, { orgId: s.org.orgId, selection: PULSE, actor: s.actor });
    await addBillingManager(s.rt, { orgId: s.org.orgId, userId: manager.id, actor: s.actor });
    const profile = await updateBillingProfile(s.rt, {
      orgId: s.org.orgId,
      actor: s.actor,
      profile: { billingEmail: 'Books@Kitstak-Test.example', companyName: null, address: {}, taxIdType: null, taxIdValue: null },
    });
    expect(profile.ok).toBe(true);

    s.advance(11 * DAY);
    await expect(queueTrialReminders(s.rt)).resolves.toBe(3);
    const rows = await emails(s.org.orgId, 'trial_ending');
    expect(rows.map((row) => row.to_email).sort()).toEqual(['books@kitstak-test.example', manager.email, s.org.owner.email].sort());
    expect(rows[0]!.payload).toMatchObject({ daysLeft: 3, totalCents: 2900, products: ['pulse'] });
  });

  it('do not go out when a card is on file: the plan simply starts', async () => {
    const s = await scene('2031-07-01T10:00:00.000Z');
    await startTrial(s.rt, { orgId: s.org.orgId, selection: CRM_WMS, actor: s.actor });
    await pay(s, CRM_WMS);
    for (const days of [7, 4, 2]) {
      s.advance(days * DAY);
      await expect(queueTrialReminders(s.rt)).resolves.toBe(0);
    }
    s.advance(1 * DAY + HOUR);
    await testRunDue(s.rt, { orgId: s.org.orgId });
    await expect(queueTrialReminders(s.rt)).resolves.toBe(0);
    expect(await emails(s.org.orgId, 'trial_ending')).toHaveLength(0);
    expect(await emails(s.org.orgId, 'trial_ended')).toHaveLength(0);
    expect((await getPlanState(s.rt, s.org.orgId)).phase).toBe('active');
  });
});

describe.skipIf(!available)('the last day reminder for a late payment', () => {
  it('goes out once, when one day of full access is left', async () => {
    const s = await scene('2031-09-01T00:00:00.000Z');
    await pay(s, PULSE, FAILS_LATER);
    s.advance(30 * DAY);
    await expect(testRunDue(s.rt, { orgId: s.org.orgId })).resolves.toEqual({ renewed: 0, failed: 1 });
    const late = await getPlanState(s.rt, s.org.orgId);
    expect(late.phase).toBe('past_due');
    expect(late.pastDue?.accessChangesAt).toEqual(new Date('2031-10-08T00:00:00.000Z'));

    // 4 days of full access left: too early.
    s.advance(3 * DAY);
    await expect(queueGraceReminders(s.rt)).resolves.toBe(0);

    // 23 hours left: the reminder, once.
    s.advance(3 * DAY + HOUR);
    await expect(queueGraceReminders(s.rt)).resolves.toBe(1);
    await expect(queueGraceReminders(s.rt)).resolves.toBe(0);
    const rows = await emails(s.org.orgId, 'grace_ending');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.dedupe_key).toBe(`grace:${s.org.orgId}:2031-10-01T00:00:00.000Z:${s.org.owner.email}`);
    expect(rows[0]!.payload).toEqual({
      orgName: s.org.name,
      portalUrl: 'http://localhost:3300',
      amountDueCents: 2900,
      accessChangesAt: '2031-10-08T00:00:00.000Z',
    });

    // After the 7 days the plan is view only. No more "last day" email.
    s.advance(2 * DAY);
    expect((await getPlanState(s.rt, s.org.orgId)).phase).toBe('unpaid');
    await expect(queueGraceReminders(s.rt)).resolves.toBe(0);
  });
});

describe.skipIf(!available)('reconcile', () => {
  it('asks the gateway again about a plan that a missed event left behind, and repairs it', async () => {
    const s = await scene(null);
    await pay(s, PULSE);
    expect((await getPlanState(s.rt, s.org.orgId)).phase).toBe('active');

    // Pretend an event was lost: our copy says past due and has not been checked for a long time.
    await pool.query(
      `update core.billing_subscriptions set status = 'past_due', past_due_since = now(), gateway_synced_at = '2000-01-01' where org_id = $1`,
      [s.org.orgId],
    );
    const reconciled = await reconcileSubscriptions(s.rt, { limit: 5 });
    expect(reconciled).toBeGreaterThanOrEqual(1);
    const row = (await pool.query(`select status, past_due_since, gateway_synced_at from core.billing_subscriptions where org_id = $1`, [s.org.orgId])).rows[0];
    expect(row.status).toBe('active');
    expect(row.past_due_since).toBeNull();
    expect(Date.now() - new Date(row.gateway_synced_at).getTime()).toBeLessThan(60_000);

    // Fresh rows are left alone: nothing of this org is due again.
    await pool.query(`update core.billing_subscriptions set status = 'past_due' where org_id = $1`, [s.org.orgId]);
    await reconcileSubscriptions(s.rt, { limit: 5 });
    expect((await pool.query(`select status from core.billing_subscriptions where org_id = $1`, [s.org.orgId])).rows[0].status).toBe('past_due');
    await pool.query(`update core.billing_subscriptions set status = 'active' where org_id = $1`, [s.org.orgId]);
  });

  it('does nothing when billing is off', async () => {
    const off = testRuntime(db, { env: { NODE_ENV: 'production', BETTER_AUTH_SECRET: 'x'.repeat(40) } as NodeJS.ProcessEnv });
    expect(off.mode).toBe('unavailable');
    await expect(reconcileSubscriptions(off)).resolves.toBe(0);
  });
});

describe.skipIf(!available)('runBillingTick', () => {
  it('runs only the steps asked for and reports what it did', async () => {
    const s = await scene('2031-11-01T10:00:00.000Z');
    await startTrial(s.rt, { orgId: s.org.orgId, selection: PULSE, actor: s.actor });
    s.advance(13 * DAY);
    const report = await runBillingTick(s.rt, { only: ['reminders'] });
    expect(report).toMatchObject({ emails: { sent: 0, failed: 0, skipped: 0 }, reminders: 1, reconciled: 0, testRenewals: 0, errors: [] });
    expect(report.tookMs).toBeGreaterThanOrEqual(0);
    const again = await runBillingTick(s.rt, { only: ['reminders'] });
    expect(again.reminders).toBe(0);
    // Leave no queued mail behind for the shared local outbox.
    await deliverQueuedEmails(db, { keyPrefix: `trial:${s.org.orgId}:`, env: { NODE_ENV: 'test' } as NodeJS.ProcessEnv, now: s.clock.at });
    await deliverQueuedEmails(db, { keyPrefix: `welcome:${s.org.orgId}`, env: { NODE_ENV: 'test' } as NodeJS.ProcessEnv, now: s.clock.at });
  });

  it('a full tick sends queued mail and never throws', async () => {
    const s = await scene(null);
    const extra = await addPerson(pool, null, 'member');
    extraUsers.push(extra.id);
    const dedupeKey = `ticktest:${s.org.orgId}:${Date.now()}`;
    await enqueueEmail(db, {
      orgId: s.org.orgId,
      to: extra.email,
      template: 'cancel_scheduled',
      payload: { orgName: s.org.name, portalUrl: 'http://localhost:3300', endsAt: '2031-12-23T00:00:00.000Z' },
      dedupeKey,
    });
    const report = await runBillingTick(s.rt, { env: { NODE_ENV: 'test' } as NodeJS.ProcessEnv });
    expect(report.errors).toEqual([]);
    expect(report.emails.sent).toBeGreaterThanOrEqual(1);
    const row = (await pool.query(`select status, provider, subject from core.billing_emails where dedupe_key = $1`, [dedupeKey])).rows[0];
    expect(row).toEqual({ status: 'sent', provider: 'outbox', subject: 'Your KitStak plan will end on Dec 23' });
    const audit = (await pool.query(`select summary from core.billing_audit_log where org_id = $1 and action = 'email.sent'`, [s.org.orgId])).rows;
    expect(audit).toEqual([{ summary: `We emailed a cancel confirmation to ${extra.email}.` }]);
  });

  it('a step that throws is reported and the other steps still run', async () => {
    const s = await scene('2032-01-01T10:00:00.000Z');
    const broken: BillingRuntime = {
      ...s.rt,
      db: new Proxy(s.rt.db, {
        get(target, property, receiver) {
          if (property === 'select') {
            return () => {
              throw new Error('database is away');
            };
          }
          return Reflect.get(target, property, receiver) as unknown;
        },
      }),
    };
    const report = await runBillingTick(broken, { only: ['reminders', 'reconcile'] });
    expect(report.reminders).toBe(0);
    expect(report.errors).toEqual([
      'trial reminders: Error: database is away',
      'grace reminders: Error: database is away',
      'reconcile: Error: database is away',
    ]);
  });
});
