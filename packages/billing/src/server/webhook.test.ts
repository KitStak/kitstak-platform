/** Against the local dev Postgres (docs/billing/DEV.md). Skipped when it is not reachable. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { completeTestCheckout, signTestPayload, testSendEvent } from '../gateway/test';
import { createTestOrg, openTestDb, removeTestOrg, testRuntime, type TestOrg } from '../testing/db';
import { createCheckout } from './checkout';
import type { BillingRuntime } from './db';
import { processWebhook } from './webhook';

const { pool, db, available } = await openTestDb();
vi.setConfig({ testTimeout: 30_000 });

describe.skipIf(!available)('processWebhook (database)', () => {
  const orgs: TestOrg[] = [];
  const rt = testRuntime(db);
  let org: TestOrg;

  beforeAll(async () => {
    org = await createTestOrg(pool);
    orgs.push(org);
    const checkout = await createCheckout(rt, {
      orgId: org.orgId,
      orgName: org.name,
      selection: { products: ['crm'], seats: 2, warehouses: 1, interval: 'monthly' },
      actor: { userId: org.owner.id, label: org.owner.name },
      actorEmail: org.owner.email,
    });
    if (!checkout.ok) throw new Error(checkout.error.message);
    const paid = await completeTestCheckout(rt, {
      sessionId: checkout.data.sessionId,
      cardNumber: '4242424242424242',
      expMonth: 12,
      expYear: 2031,
      cvc: '123',
      name: 'Maya Chen',
      postalCode: '60601',
    });
    if (!paid.ok) throw new Error(paid.error.message);
  });

  afterAll(async () => {
    for (const made of orgs) await removeTestOrg(pool, made);
    await pool.query(`delete from core.billing_events where id like 'evt_test_%' and org_id is null and status = 'ignored' and received_at > now() - interval '1 hour'`);
    await pool.end();
  });

  const ledger = async (eventId: string) => (await pool.query(`select id, type, status, attempts, org_id, gateway, error from core.billing_events where id = $1`, [eventId])).rows;
  const ledgerCount = async () => Number((await pool.query(`select count(*)::int as n from core.billing_events where org_id = $1`, [org.orgId])).rows[0].n);
  const eventIdOf = (rawBody: string) => (JSON.parse(rawBody) as { id: string }).id;

  it('the checkout itself went through the webhook path: events in the ledger, access granted', async () => {
    const events = (await pool.query(`select type, status, gateway from core.billing_events where org_id = $1 order by type`, [org.orgId])).rows;
    expect(events).toEqual([
      { type: 'checkout.session.completed', status: 'processed', gateway: 'test' },
      { type: 'customer.subscription.created', status: 'processed', gateway: 'test' },
      { type: 'invoice.paid', status: 'processed', gateway: 'test' },
    ]);
    const rows = (await pool.query(`select module, status, source, seats from core.entitlements where org_id = $1`, [org.orgId])).rows;
    expect(rows).toEqual([{ module: 'crm', status: 'active', source: 'stripe', seats: 2 }]);
  });

  it('a bad signature answers 400 and writes nothing at all', async () => {
    const { rawBody, signature } = await testSendEvent(rt, { type: 'customer.subscription.updated', orgId: org.orgId });
    const before = await ledgerCount();

    // A changed body with the old signature.
    const tampered = rawBody.replace('customer.subscription.updated', 'customer.subscription.deleted');
    await expect(processWebhook(rt, { rawBody: tampered, signature })).resolves.toEqual({ status: 400, result: 'bad_signature' });
    // No signature, a junk signature, and a signature made with another secret.
    await expect(processWebhook(rt, { rawBody, signature: null })).resolves.toEqual({ status: 400, result: 'bad_signature' });
    await expect(processWebhook(rt, { rawBody, signature: 't=1,v1=zz' })).resolves.toEqual({ status: 400, result: 'bad_signature' });
    await expect(processWebhook(rt, { rawBody, signature: signTestPayload(rawBody, 'another-secret', new Date()) })).resolves.toEqual({
      status: 400,
      result: 'bad_signature',
    });
    // A good signature that is too old (replay after the 5 minute window).
    const old = signTestPayload(rawBody, rt.config.testWebhookSecret, new Date(Date.now() - 6 * 60 * 1000));
    await expect(processWebhook(rt, { rawBody, signature: old })).resolves.toEqual({ status: 400, result: 'bad_signature' });

    expect(await ledgerCount()).toBe(before);
    expect(await ledger(eventIdOf(rawBody))).toEqual([]);
    expect(await ledger(eventIdOf(tampered))).toEqual([]);
  });

  it('the same event twice: processed, then duplicate, with one ledger row', async () => {
    const { rawBody, signature } = await testSendEvent(rt, { type: 'customer.subscription.updated', orgId: org.orgId });
    const eventId = eventIdOf(rawBody);
    await expect(processWebhook(rt, { rawBody, signature })).resolves.toEqual({ status: 200, result: 'processed', eventId });
    const auditsAfterFirst = (await pool.query(`select count(*)::int as n from core.billing_audit_log where org_id = $1`, [org.orgId])).rows[0].n;
    await expect(processWebhook(rt, { rawBody, signature })).resolves.toEqual({ status: 200, result: 'duplicate', eventId });
    await expect(processWebhook(rt, { rawBody, signature })).resolves.toEqual({ status: 200, result: 'duplicate', eventId });
    expect(await ledger(eventId)).toEqual([
      { id: eventId, type: 'customer.subscription.updated', status: 'processed', attempts: 1, org_id: org.orgId, gateway: 'test', error: null },
    ]);
    const auditsAfter = (await pool.query(`select count(*)::int as n from core.billing_audit_log where org_id = $1`, [org.orgId])).rows[0].n;
    expect(auditsAfter).toBe(auditsAfterFirst);
  });

  it('two deliveries at the same moment still make one row and run the handler once', async () => {
    const { rawBody, signature } = await testSendEvent(rt, { type: 'customer.subscription.updated', orgId: org.orgId });
    const eventId = eventIdOf(rawBody);
    const outcomes = await Promise.all([processWebhook(rt, { rawBody, signature }), processWebhook(rt, { rawBody, signature })]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual([200, 200]);
    expect(outcomes.map((outcome) => outcome.result).sort()).toEqual(['duplicate', 'processed']);
    expect(await ledger(eventId)).toHaveLength(1);
  });

  it('a handler error rolls back, records the event as failed, and a retry then succeeds', async () => {
    const { rawBody, signature } = await testSendEvent(rt, { type: 'customer.subscription.updated', orgId: org.orgId });
    const eventId = eventIdOf(rawBody);
    const before = (await pool.query(`select gateway_synced_at from core.billing_subscriptions where org_id = $1`, [org.orgId])).rows[0];

    const gateway = rt.gateway!;
    const broken: BillingRuntime = {
      ...rt,
      gateway: {
        ...gateway,
        // The subscription is applied, then the invoice read blows up: the transaction must undo the first part.
        getInvoice: async () => {
          throw new Error('gateway is down');
        },
      },
    };
    await expect(processWebhook(broken, { rawBody, signature })).resolves.toEqual({ status: 500, result: 'failed', eventId });
    let rows = await ledger(eventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'failed', attempts: 1, org_id: org.orgId });
    expect(rows[0].error).toContain('gateway is down');
    const afterFail = (await pool.query(`select gateway_synced_at from core.billing_subscriptions where org_id = $1`, [org.orgId])).rows[0];
    expect(afterFail.gateway_synced_at).toEqual(before.gateway_synced_at);

    // The gateway retries the same event. A failed row is not a duplicate.
    await expect(processWebhook(broken, { rawBody, signature })).resolves.toMatchObject({ status: 500, result: 'failed' });
    expect((await ledger(eventId))[0]).toMatchObject({ status: 'failed', attempts: 2 });

    await expect(processWebhook(rt, { rawBody, signature })).resolves.toEqual({ status: 200, result: 'processed', eventId });
    rows = await ledger(eventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'processed', attempts: 3, error: null });
    await expect(processWebhook(rt, { rawBody, signature })).resolves.toEqual({ status: 200, result: 'duplicate', eventId });
  });

  it('an event for a customer we do not know is recorded as ignored and changes nothing', async () => {
    const at = new Date();
    const body = JSON.stringify({
      id: `evt_test_unknown_${Date.now()}`,
      type: 'customer.subscription.updated',
      created: Math.floor(at.getTime() / 1000),
      data: { object: { id: 'sub_old_tier', object: 'subscription', customer: 'cus_someone_else', metadata: { org_id: org.orgId, plan_key: 'starter' } } },
    });
    const signature = signTestPayload(body, rt.config.testWebhookSecret, at);
    const eventId = eventIdOf(body);
    await expect(processWebhook(rt, { rawBody: body, signature })).resolves.toEqual({ status: 200, result: 'ignored', eventId });
    expect(await ledger(eventId)).toEqual([
      { id: eventId, type: 'customer.subscription.updated', status: 'ignored', attempts: 1, org_id: null, gateway: 'test', error: null },
    ]);
    await expect(processWebhook(rt, { rawBody: body, signature })).resolves.toEqual({ status: 200, result: 'duplicate', eventId });
  });

  it('an event type we do not handle is recorded as ignored', async () => {
    const { rawBody, signature } = await testSendEvent(rt, { type: 'customer.tax_id.created', orgId: org.orgId });
    const eventId = eventIdOf(rawBody);
    await expect(processWebhook(rt, { rawBody, signature })).resolves.toEqual({ status: 200, result: 'ignored', eventId });
    expect((await ledger(eventId))[0]).toMatchObject({ status: 'ignored', org_id: org.orgId });
  });

  it('an event that names our org but another customer\'s subscription grants nothing', async () => {
    const other = await createTestOrg(pool);
    orgs.push(other);
    const at = new Date();
    const mine = (await pool.query(`select gateway_subscription_id from core.billing_subscriptions where org_id = $1`, [org.orgId])).rows[0];
    // Forged metadata: it points our paid subscription at an org that never paid.
    const body = JSON.stringify({
      id: `evt_test_forged_${Date.now()}`,
      type: 'customer.subscription.updated',
      created: Math.floor(at.getTime() / 1000),
      data: { object: { id: mine.gateway_subscription_id, object: 'subscription', metadata: { kitstak_org_id: other.orgId } } },
    });
    const outcome = await processWebhook(rt, { rawBody: body, signature: signTestPayload(body, rt.config.testWebhookSecret, at) });
    expect(outcome).toMatchObject({ status: 200, result: 'ignored' });
    const rows = (await pool.query(`select 1 from core.entitlements where org_id = $1`, [other.orgId])).rows;
    expect(rows).toEqual([]);
  });

  it('with billing off there is no gateway to verify with, so nothing is accepted', async () => {
    const off = testRuntime(db, { env: { NODE_ENV: 'production' } as NodeJS.ProcessEnv });
    const { rawBody, signature } = await testSendEvent(rt, { type: 'customer.subscription.updated', orgId: org.orgId });
    await expect(processWebhook(off, { rawBody, signature })).resolves.toEqual({ status: 400, result: 'bad_signature' });
    expect(await ledger(eventIdOf(rawBody))).toEqual([]);
  });
});
