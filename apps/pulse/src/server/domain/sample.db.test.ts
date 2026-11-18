/**
 * Sample data loads through the real domain layer, shows real profit, and comes out again
 * without touching real work. The owner can delete everything. Skipped when no database answers.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestOrg, databaseReady, type TestOrg } from '@/test/db';
import type { DomainContext } from './_shared';
import { clearSampleData, getSampleState, loadSampleData, purgeAllData } from './sample';
import { createClient, createJob, getProfit, saveProductionEntry } from './test-exports';

const ready = await databaseReady();

describe.skipIf(!ready)('sample data and the danger zone', () => {
  let org: TestOrg;
  let owner: DomainContext;

  beforeAll(async () => {
    org = await createTestOrg('pulse-sample');
    owner = await org.member('owner', 'Sample Owner');
  });
  afterAll(async () => {
    await org?.destroy();
  });

  const count = async (table: string, where = 'true'): Promise<number> => Number((await org.query<{ n: string }>(`select count(*) as n from pulse.${table} where org_id = $1 and ${where}`, [org.orgId]))[0]?.n ?? 0);

  it('loads a shop with real profit numbers', async () => {
    const state = await loadSampleData(owner);
    expect(state).toMatchObject({ loaded: true, jobs: 5, clients: 3 });
    expect(state.entries).toBeGreaterThan(25);
    const profit = await getProfit(owner, 'job', { from: '2000-01-01', to: '2100-01-01' });
    expect(profit.rows.length).toBeGreaterThanOrEqual(4);
    expect(profit.total.revenueCents).toBeGreaterThan(0);
    expect(profit.total.laborCents).toBeGreaterThan(0);
    await expect(loadSampleData(owner)).rejects.toThrow(/already loaded/);
  }, 60_000);

  it('removes the sample and keeps real work', async () => {
    const client = await createClient(owner, { name: 'Real Client Co' });
    const job = await createJob(owner, { name: 'Real job', clientId: client.id, status: 'active', plannedUnits: '100', unitPrice: '2.0000' });
    await saveProductionEntry(owner, { jobId: job.id, workDate: '2026-11-02', unitsGood: '10', hours: '1' });
    const state = await clearSampleData(owner);
    expect(state).toMatchObject({ loaded: false, jobs: 0, clients: 0, entries: 0 });
    expect(await count('jobs')).toBe(1);
    expect(await count('clients')).toBe(1);
    expect(await count('production_entries')).toBe(1);
    expect(await count('labor_rates')).toBe(0);
    expect(await count('labor_classes')).toBe(0);
    expect(await count('job_types', 'not is_builtin')).toBe(0);
    expect(await count('vas_services')).toBe(0);
    expect(await count('items')).toBe(0);
    expect(await count('fact_days', `job_id <> '${job.id}'`)).toBe(0);
    const profit = await getProfit(owner, 'job', { from: '2000-01-01', to: '2100-01-01' });
    expect(profit.rows).toHaveLength(1);
    expect(profit.total.revenueCents).toBe(2000);
    // It can be loaded again afterwards.
    expect((await loadSampleData(owner)).jobs).toBe(5);
    expect((await clearSampleData(owner)).jobs).toBe(0);
    expect((await getSampleState(owner)).loaded).toBe(false);
  }, 120_000);

  it('lets only the owner delete everything, and only with the workspace name', async () => {
    const admin = await org.member('admin', 'Admin');
    await expect(purgeAllData(admin, org.slug)).rejects.toThrow();
    await expect(purgeAllData(owner, 'wrong')).rejects.toThrow(/to confirm/);
    const result = await purgeAllData(owner, org.slug);
    expect(result.deleted).toBeGreaterThan(0);
    expect(await count('jobs')).toBe(0);
    expect(await count('clients')).toBe(0);
    expect(await count('sites')).toBe(1);
    expect(await count('activity', "verb = 'data.purged'")).toBe(1);
  });
});
