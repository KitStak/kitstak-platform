/**
 * The entitlement backfill against the local dev Postgres (docs/billing/DEV.md). Skipped when it is
 * not reachable. Every call is limited to the organizations this test made, so real local
 * organizations are never touched.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { getPlanState } from '../src/server/state';
import { createTestOrg, openTestDb, removeTestOrg, testRuntime, type TestOrg } from '../src/testing/db';
import { backfillManual, backfillTrial, findOrgsWithoutEntitlements } from '../scripts/backfill-lib';

const { pool, db, available } = await openTestDb();
vi.setConfig({ testTimeout: 30_000 });

const orgs: TestOrg[] = [];
async function newOrg(extraRoles: readonly string[] = []): Promise<TestOrg> {
  const org = await createTestOrg(pool, extraRoles);
  orgs.push(org);
  return org;
}

const rowsOf = async (orgId: string) =>
  (await pool.query(`select module, status, source from core.entitlements where org_id = $1 order by module`, [orgId])).rows;

afterAll(async () => {
  for (const org of orgs) await removeTestOrg(pool, org);
  await pool.end();
});

describe.skipIf(!available)('entitlement backfill', () => {
  it('check lists an organization with no rows, with its head count', async () => {
    const org = await newOrg(['member', 'member']);
    const found = await findOrgsWithoutEntitlements(db, { onlyOrgIds: [org.orgId] });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ id: org.orgId, name: org.name, members: 3 });
  });

  it('apply manual grants all four apps, and a second run changes nothing', async () => {
    const org = await newOrg();
    const lines = await backfillManual(db, { onlyOrgIds: [org.orgId] });
    expect(lines.map((line) => line.outcome)).toEqual(['granted']);
    expect(await rowsOf(org.orgId)).toEqual([
      { module: 'crm', status: 'active', source: 'manual' },
      { module: 'projects', status: 'active', source: 'manual' },
      { module: 'pulse', status: 'active', source: 'manual' },
      { module: 'wms', status: 'active', source: 'manual' },
    ]);
    expect(await findOrgsWithoutEntitlements(db, { onlyOrgIds: [org.orgId] })).toEqual([]);
    await expect(backfillManual(db, { onlyOrgIds: [org.orgId] })).resolves.toEqual([]);

    // A manual grant shows as included and is never billed.
    const state = await getPlanState(testRuntime(db), org.orgId);
    expect(state.modules.crm).toMatchObject({ access: 'full', source: 'manual' });
    expect(state.phase).toBe('none');
  });

  it('apply trial starts a 14 day trial of all four apps in the owner\'s name', async () => {
    const org = await newOrg(['member']);
    const rt = testRuntime(db, { now: () => new Date('2031-04-01T09:00:00.000Z') });
    const lines = await backfillTrial(rt, { onlyOrgIds: [org.orgId] });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ outcome: 'trial_started', note: '14 day trial in the name of Maya Chen, ends 2031-04-15.' });
    expect(await rowsOf(org.orgId)).toEqual([
      { module: 'crm', status: 'trialing', source: 'trial' },
      { module: 'projects', status: 'trialing', source: 'trial' },
      { module: 'pulse', status: 'trialing', source: 'trial' },
      { module: 'wms', status: 'trialing', source: 'trial' },
    ]);
    const state = await getPlanState(rt, org.orgId);
    expect(state.phase).toBe('trial');
    expect(state.trial?.endsAt).toEqual(new Date('2031-04-15T09:00:00.000Z'));
    expect(state.selection.seats).toBe(2);
    const welcome = (await pool.query(`select status from core.billing_emails where dedupe_key = $1`, [`welcome:${org.orgId}`])).rows;
    expect(welcome).toEqual([{ status: 'queued' }]);
    await pool.query(`update core.billing_emails set status = 'skipped' where dedupe_key = $1`, [`welcome:${org.orgId}`]);

    await expect(backfillTrial(rt, { onlyOrgIds: [org.orgId] })).resolves.toEqual([]);
  });

  it('apply trial quiet holds back the welcome email, and the trial is still real', async () => {
    const org = await newOrg();
    const rt = testRuntime(db, { now: () => new Date('2031-04-01T09:00:00.000Z') });
    const lines = await backfillTrial(rt, { onlyOrgIds: [org.orgId], quiet: true });
    expect(lines[0]?.outcome).toBe('trial_started');
    const welcome = (await pool.query(`select status, error from core.billing_emails where dedupe_key = $1`, [`welcome:${org.orgId}`])).rows;
    expect(welcome).toEqual([{ status: 'skipped', error: 'Held back by the backfill (quiet).' }]);
    expect((await getPlanState(rt, org.orgId)).phase).toBe('trial');
  });

  it('an organization with no owner is skipped, with the reason', async () => {
    const org = await newOrg();
    await pool.query(`update core.member set role = 'admin' where organization_id = $1`, [org.orgId]);
    const rt = testRuntime(db, { now: () => new Date('2031-04-01T09:00:00.000Z') });
    const lines = await backfillTrial(rt, { onlyOrgIds: [org.orgId] });
    expect(lines).toEqual([{ org: expect.objectContaining({ id: org.orgId }), outcome: 'skipped', note: 'No owner. Use "apply manual" or grant by hand.' }]);
    expect(await rowsOf(org.orgId)).toEqual([]);
  });
});
