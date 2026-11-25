/**
 * Review round 3, operations: app banners are right on the first page load after any change, also
 * when the change was made in another process (the Portal) and both the old and the new state are
 * full access. Proven against the local dev Postgres. Skipped when the database is not reachable.
 *
 * In production the Portal and each product app are separate processes: the Portal clears only its
 * own memory after a write. Here both run in one process, so the two "clear my copy" calls are
 * turned off. What is left is exactly what a product app has: its 60 second copy and the billing
 * stamp in the database.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('@kitstak/entitlements', async (original) => ({
  ...(await original<typeof import('@kitstak/entitlements')>()),
  clearEntitlementsCache: vi.fn(),
}));
vi.mock('./state', async (original) => ({
  ...(await original<typeof import('./state')>()),
  clearPlanCache: vi.fn(),
}));

import { getModuleAccess, type EntitlementsDb } from '@kitstak/entitlements';
import type { PlanSelection } from '../catalog';
import { completeTestCheckout } from '../gateway/test';
import { createTestOrg, openTestDb, removeTestOrg, testRuntime, TEST_PORTAL_URL, type TestOrg } from '../testing/db';
import { pausePlan, scheduleCancel, undoCancel, undoPause } from './cancel';
import { createCheckout } from './checkout';
import { getAppPlanView } from './state';

const { pool, db, available } = await openTestDb();
vi.setConfig({ testTimeout: 90_000 });

const CARD = { cardNumber: '4242 4242 4242 4242', expMonth: 12, expYear: 2031, cvc: '123', name: 'Maya Chen', postalCode: '60601' };
const CRM: PlanSelection = { products: ['crm'], seats: 2, warehouses: 1, interval: 'monthly' };
const orgs: TestOrg[] = [];

afterAll(async () => {
  for (const org of orgs) await removeTestOrg(pool, org);
  await pool.end();
});

describe.skipIf(!available)('the billing stamp carries a change from the Portal to every app at once', () => {
  it('cancel, "Keep my plan", pause and "Undo pause" each show in the CRM on the very next read', async () => {
    const org = await createTestOrg(pool);
    orgs.push(org);
    // Real time on purpose: the copy the app holds is seconds old, far inside its 60 seconds.
    const rt = testRuntime(db);
    const actor = { userId: org.owner.id, label: org.owner.name };
    const checkout = await createCheckout(rt, { orgId: org.orgId, orgName: org.name, selection: CRM, actor, actorEmail: org.owner.email });
    if (!checkout.ok) throw new Error(checkout.error.message);
    expect((await completeTestCheckout(rt, { sessionId: checkout.data.sessionId, ...CARD })).ok).toBe(true);

    /** What the CRM shows the owner: its own cached read, exactly as `apps/crm/src/server/plan.ts` makes it. */
    const crm = () =>
      getAppPlanView(db, { orgId: org.orgId, module: 'crm', userId: org.owner.id, role: 'owner', portalUrl: TEST_PORTAL_URL, allowAll: false, timeZone: 'UTC' });
    const stamp = async () => Number((await pool.query(`select version from core.billing_stamps where org_id = $1`, [org.orgId])).rows[0]?.version ?? 0);

    // An active plan: no banner. The app now holds a copy.
    expect((await crm()).notice).toBeNull();
    expect((await crm()).access).toBe('full');
    const before = await stamp();
    expect(before).toBeGreaterThan(0);

    // The owner cancels in the Portal and goes straight to the CRM.
    expect((await scheduleCancel(rt, { orgId: org.orgId, reason: null, detail: null, actor })).ok).toBe(true);
    expect(await stamp()).toBeGreaterThan(before);
    const canceled = await crm();
    expect(canceled.access).toBe('full');
    expect(canceled.notice?.kind).toBe('cancel_scheduled');
    expect(canceled.notice?.action?.label).toBe('Keep my plan');

    // "Keep my plan", then the CRM at once: no banner. This is the case the review measured at 64 seconds.
    expect((await undoCancel(rt, { orgId: org.orgId, actor })).ok).toBe(true);
    const kept = await crm();
    expect(kept.notice).toBeNull();
    expect(kept.access).toBe('full');

    // The same for a pause that is set and taken back.
    expect((await pausePlan(rt, { orgId: org.orgId, months: 1, reason: null, actor })).ok).toBe(true);
    expect((await crm()).notice?.kind).toBe('pause_scheduled');
    expect((await undoPause(rt, { orgId: org.orgId, actor })).ok).toBe(true);
    expect((await crm()).notice).toBeNull();
  });

  it('the stamp moves on every billing write, whoever makes it, and the entitlement check follows it', async () => {
    const org = await createTestOrg(pool);
    orgs.push(org);
    const version = async () => Number((await pool.query(`select version from core.billing_stamps where org_id = $1`, [org.orgId])).rows[0]?.version ?? 0);
    const access = () => getModuleAccess(db as unknown as EntitlementsDb, org.orgId, 'wms');
    expect(await version()).toBe(0);

    // Plain SQL, like the manual grant script or a person at a database prompt.
    await pool.query(`insert into core.entitlements (org_id, module, status, source) values ($1, 'wms', 'active', 'manual')`, [org.orgId]);
    expect(await version()).toBe(1);
    expect(await access()).toBe('full');

    // Full access is cached. A manual revoke in another process must still show at once.
    await pool.query(`update core.entitlements set status = 'canceled' where org_id = $1 and module = 'wms'`, [org.orgId]);
    expect(await version()).toBe(2);
    expect(await access()).toBe('locked');

    await pool.query(`insert into core.billing_accounts (org_id) values ($1) on conflict (org_id) do update set updated_at = now()`, [org.orgId]);
    expect(await version()).toBe(3);
    await pool.query(`insert into core.billing_managers (org_id, user_id) values ($1, $2)`, [org.orgId, org.owner.id]);
    expect(await version()).toBe(4);
    await pool.query(`delete from core.entitlements where org_id = $1`, [org.orgId]);
    expect(await version()).toBe(5);
  });

  it('deleting an organization leaves no stamp behind', async () => {
    const org = await createTestOrg(pool);
    await pool.query(`insert into core.entitlements (org_id, module, status, source) values ($1, 'crm', 'active', 'manual')`, [org.orgId]);
    expect((await pool.query(`select 1 from core.billing_stamps where org_id = $1`, [org.orgId])).rowCount).toBe(1);
    await removeTestOrg(pool, org);
    expect((await pool.query(`select 1 from core.billing_stamps where org_id = $1`, [org.orgId])).rowCount).toBe(0);
  });
});
