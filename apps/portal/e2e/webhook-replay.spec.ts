import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { testSendEvent } from '@kitstak/billing/gateway/test';
import { createBillingRuntime, type BillingDb } from '@kitstak/billing/server';
import { BASE_URL, CART_PULSE, DATABASE_URL, entitlementsOf, expectPhase, openBilling, paidAccount, sql } from './support';

/**
 * The test gateway signs its events with a secret derived from the local sign in secret, the same
 * way the running portal does. It is read from the untracked env file and never printed.
 */
function localAuthSecret(): string | null {
  if (process.env.BETTER_AUTH_SECRET) return process.env.BETTER_AUTH_SECRET;
  const file = path.join(__dirname, '..', '.env.local');
  if (!existsSync(file)) return null;
  const line = readFileSync(file, 'utf8').split(/\r?\n/).find((entry) => entry.startsWith('BETTER_AUTH_SECRET='));
  return line ? line.slice('BETTER_AUTH_SECRET='.length).trim() : null;
}

test.describe('webhooks: signed, recorded once, safe to replay', () => {
  test('the same signed event twice is processed once; a changed body or a missing signature is refused', async ({ page }) => {
    const secret = localAuthSecret();
    test.skip(!secret, 'BETTER_AUTH_SECRET is not in the environment or in apps/portal/.env.local, so a test event cannot be signed.');

    const { orgId } = await paidAccount(page, 'hook', CART_PULSE);
    const before = await entitlementsOf(orgId);

    const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 1, allowExitOnIdle: true });
    try {
      const rt = createBillingRuntime({
        db: drizzle(pool) as unknown as BillingDb,
        env: {
          NODE_ENV: 'development',
          BETTER_AUTH_SECRET: secret as string,
          ...(process.env.BILLING_TEST_WEBHOOK_SECRET ? { BILLING_TEST_WEBHOOK_SECRET: process.env.BILLING_TEST_WEBHOOK_SECRET } : {}),
        } as NodeJS.ProcessEnv,
        portalUrl: BASE_URL,
      });
      const event = await testSendEvent(rt, { type: 'customer.subscription.updated', orgId });
      const eventId = (JSON.parse(event.rawBody) as { id: string }).id;
      const post = (body: string, signature: string | null) =>
        page.request.post('/api/billing/webhooks/test', {
          data: body,
          headers: { 'content-type': 'application/json', ...(signature ? { 'kitstak-test-signature': signature } : {}) },
        });
      const ledger = () => sql<{ status: string; attempts: number }>(`SELECT status, attempts FROM core.billing_events WHERE id = $1`, [eventId]);

      // First delivery: processed, one ledger row.
      const first = await post(event.rawBody, event.signature);
      expect(first.status()).toBe(200);
      expect(await first.json()).toEqual({ ok: true, result: 'processed' });
      expect(await ledger()).toEqual([{ status: 'processed', attempts: 1 }]);

      // The same event again: 200 "duplicate", still one row, and nothing changed.
      const second = await post(event.rawBody, event.signature);
      expect(second.status()).toBe(200);
      expect(await second.json()).toEqual({ ok: true, result: 'duplicate' });
      expect(await ledger()).toEqual([{ status: 'processed', attempts: 1 }]);
      expect(await entitlementsOf(orgId)).toEqual(before);

      // A changed body with the old signature: 400 and no row.
      const forgedId = `evt_test_forged_${Date.now()}`;
      const forged = event.rawBody.replace(eventId, forgedId);
      const third = await post(forged, event.signature);
      expect(third.status()).toBe(400);
      expect(await sql(`SELECT 1 FROM core.billing_events WHERE id = $1`, [forgedId])).toEqual([]);

      // No signature at all: 400.
      const fourth = await post(event.rawBody, null);
      expect(fourth.status()).toBe(400);
      // A signature made with another secret: 400.
      const fifth = await post(event.rawBody, 't=1700000000,v1=' + '0'.repeat(64));
      expect(fifth.status()).toBe(400);
    } finally {
      await pool.end();
    }

    // The plan a person sees did not move.
    await openBilling(page);
    await expectPhase(page, 'active');
  });

  test('the other doors are shut: Stripe route with no key, the job route with a wrong secret', async ({ request }) => {
    // No Stripe key on this server, so the Stripe webhook route says so and does nothing.
    const stripe = await request.post('/api/billing/webhooks/stripe', { data: '{}', headers: { 'stripe-signature': 't=1,v1=abc' } });
    expect(stripe.status()).toBe(503);

    // Locally the job route runs with no secret. With a secret set, a wrong one is refused.
    const tick = await request.post('/api/billing/jobs/tick', { headers: { authorization: 'Bearer definitely-not-the-secret' } });
    expect([200, 401]).toContain(tick.status());
    if (tick.status() === 200) {
      const report = (await tick.json()) as { ok: boolean; errors: string[]; emails: { sent: number } };
      expect(report.errors).toEqual([]);
      expect(report.ok).toBe(true);
    }
    // The answer never caches.
    expect(tick.headers()['cache-control']).toContain('no-store');
  });
});
