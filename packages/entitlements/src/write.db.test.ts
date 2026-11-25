/**
 * Against the local dev Postgres (DATABASE_URL, default the database from docs/billing/DEV.md).
 * Everything runs inside one transaction that is rolled back, so no row is left behind. Skipped
 * when the database or the tables are not available.
 *
 * Proves with real SQL what the mock test can only describe: every column is written, a live manual
 * grant survives a trial write and a gateway write, and a manual revoke can be replaced.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { EntitlementsDb } from './db';
import { grantModule, revokeModule } from './grant';
import { getEntitlementsFresh, moduleAccess } from './read';
import { setEntitlement } from './write';

const url = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5544/kitstak';
const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 1500 });

async function ready(): Promise<boolean> {
  try {
    const { rows } = await pool.query<{ ok: boolean }>(
      "select to_regclass('core.entitlements') is not null and to_regclass('core.organization') is not null as ok",
    );
    return rows[0]?.ok === true;
  } catch {
    return false;
  }
}

const available = await ready();
vi.setConfig({ testTimeout: 30_000 });

describe.skipIf(!available)('setEntitlement (database)', () => {
  let client: pg.PoolClient;
  let db: EntitlementsDb;
  let orgId: string;

  beforeAll(async () => {
    client = await pool.connect();
    await client.query('BEGIN');
    const org = await client.query<{ id: string }>(
      `insert into core.organization (name, slug, created_at)
       values ('Entitlement Writer Test', 'entitlement-writer-test-' || substr(md5(random()::text), 1, 12), now())
       returning id`,
    );
    orgId = org.rows[0]!.id;
    db = drizzle(client) as unknown as EntitlementsDb;
  });

  afterAll(async () => {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  });

  const periodEnd = new Date('2026-12-07T12:00:00.000Z');

  it('writes every column and updates them on the next write', async () => {
    await expect(
      setEntitlement(db, {
        orgId,
        module: 'crm',
        status: 'trialing',
        source: 'trial',
        periodEnd,
        seats: 5,
        stripeSubscriptionId: null,
        stripePriceId: null,
      }),
    ).resolves.toBe(true);

    await expect(
      setEntitlement(db, {
        orgId,
        module: 'crm',
        status: 'active',
        source: 'stripe',
        periodEnd,
        seats: 6,
        stripeSubscriptionId: 'sub_test_1',
        stripePriceId: 'price_test_kitstak_crm_monthly',
      }),
    ).resolves.toBe(true);

    const { rows } = await client.query(
      `select status, source, seats, stripe_subscription_id, stripe_price_id, current_period_end
         from core.entitlements where org_id = $1 and module = 'crm'`,
      [orgId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'active',
      source: 'stripe',
      seats: 6,
      stripe_subscription_id: 'sub_test_1',
      stripe_price_id: 'price_test_kitstak_crm_monthly',
    });
    expect(new Date(rows[0].current_period_end as string).toISOString()).toBe(periodEnd.toISOString());
  });

  it('never overwrites a live manual grant', async () => {
    await grantModule(db, orgId, 'wms', 'manual');

    for (const source of ['trial', 'stripe'] as const) {
      await expect(
        setEntitlement(db, {
          orgId,
          module: 'wms',
          status: 'canceled',
          source,
          periodEnd: new Date('2020-01-01T00:00:00.000Z'),
          seats: null,
          stripeSubscriptionId: null,
          stripePriceId: null,
        }),
      ).resolves.toBe(false);
    }

    const snapshot = await getEntitlementsFresh(db, orgId);
    expect(snapshot.wms).toMatchObject({ status: 'active', source: 'manual' });
    expect(moduleAccess(snapshot.wms)).toBe('full');
  });

  it('replaces a manual revoke, and a manual write replaces anything', async () => {
    await revokeModule(db, orgId, 'projects', 'manual');
    await expect(
      setEntitlement(db, {
        orgId,
        module: 'projects',
        status: 'trialing',
        source: 'trial',
        periodEnd: new Date(Date.now() + 86_400_000),
        seats: 3,
        stripeSubscriptionId: null,
        stripePriceId: null,
      }),
    ).resolves.toBe(true);
    expect(moduleAccess((await getEntitlementsFresh(db, orgId)).projects)).toBe('full');

    await expect(
      setEntitlement(db, {
        orgId,
        module: 'projects',
        status: 'active',
        source: 'manual',
        periodEnd: null,
        seats: null,
        stripeSubscriptionId: null,
        stripePriceId: null,
      }),
    ).resolves.toBe(true);
    expect((await getEntitlementsFresh(db, orgId)).projects).toMatchObject({ status: 'active', source: 'manual' });
  });
});
