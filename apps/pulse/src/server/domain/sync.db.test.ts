/**
 * Fail soft and no double counting, on a throwaway organization that has no CRM boards, no
 * warehouse and no projects (the "Pulse on its own" case). Skipped when no database answers.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestOrg, databaseReady, type TestOrg } from '@/test/db';
import { getAccounts, getDeals, listWonDeals, searchDeals } from '@/server/integrations/crm';
import { getProjects, projectTimeByDay, searchProjects } from '@/server/integrations/projects';
import { resolveRecords, searchRecords } from '@/server/integrations/records';
import { listBilledRevenue, listVasRevenue, listWorkOrders, wmsReady, workOrderBuildsByDay } from '@/server/integrations/wms';
import type { DomainContext } from './_shared';
import { getConnectedApps, listLinkedJobs, runSync, syncIfStale } from './sync';
import { addJobLink, createClient, createJob, saveProductionEntry } from './test-exports';

const ready = await databaseReady();
const NOBODY = '00000000-0000-4000-8000-000000000009';

describe.skipIf(!ready)('sibling sync with nothing to read', () => {
  let org: TestOrg;
  let owner: DomainContext;
  let viewer: DomainContext;
  let jobId: string;

  beforeAll(async () => {
    org = await createTestOrg('pulse-sync');
    owner = await org.member('owner', 'Sync Owner');
    viewer = await org.member('viewer', 'Sync Viewer');
    const client = await createClient(owner, { name: 'Standalone Client' });
    const job = await createJob(owner, { name: 'Standalone job', clientId: client.id, status: 'active', plannedUnits: '100', unitPrice: '2.0000' });
    jobId = job.id;
    await saveProductionEntry(owner, { jobId, workDate: '2026-11-10', unitsGood: '10', headcount: '2', hours: '4' });
  }, 60_000);
  afterAll(async () => {
    await org?.destroy();
  });

  const count = async (table: string): Promise<number> => Number((await org.query<{ n: string }>(`select count(*) as n from pulse.${table} where org_id = $1`, [org.orgId]))[0]?.n ?? 0);

  it('every reader answers with nothing instead of throwing', async () => {
    expect(await wmsReady(owner)).toBeNull();
    expect(await listWorkOrders(owner)).toEqual([]);
    expect(await listWorkOrders(owner, { ids: ['x'], query: "'; drop table" })).toEqual([]);
    expect(await workOrderBuildsByDay(owner, ['x'], 'America/New_York')).toEqual([]);
    expect(await listBilledRevenue(owner)).toEqual([]);
    expect(await listVasRevenue(owner)).toEqual([]);
    expect(await listWonDeals(owner)).toEqual([]);
    expect(await searchDeals(owner, 'anything')).toEqual([]);
    expect(await getDeals(owner, [NOBODY, 'not-a-uuid'])).toEqual([]);
    expect(await getAccounts(owner, [NOBODY])).toEqual([]);
    expect(await getProjects(owner, [NOBODY])).toEqual([]);
    expect(await searchProjects(owner, '')).toEqual([]);
    expect(await projectTimeByDay(owner, [NOBODY], 'Not/AZone')).toEqual([]);
    for (const type of ['crm_deal', 'wms_work_order', 'pm_project'] as const) expect(await searchRecords(owner, type, 'kit')).toEqual([]);
  });

  it('a link to a record that is not there reads as gone or offline, never an error', async () => {
    await addJobLink(owner, jobId, { targetType: 'wms_work_order', targetId: 'no-such-work-order', title: 'WO000001 Old copy', status: 'Open', url: '/work-orders/no-such-work-order' });
    await addJobLink(owner, jobId, { targetType: 'crm_deal', targetId: NOBODY, title: 'Old deal', status: 'Won' });
    await addJobLink(owner, jobId, { targetType: 'pm_project', targetId: NOBODY, title: 'Old project', importsTime: true });
    const live = await resolveRecords(owner, [
      { type: 'wms_work_order', id: 'no-such-work-order' },
      { type: 'crm_deal', id: NOBODY },
      { type: 'pm_project', id: NOBODY },
    ]);
    expect(live.map((record) => record.state)).toEqual(['offline', 'gone', 'gone']);
    expect(live.every((record) => record.url === null && record.title === null)).toBe(true);
    expect((await listLinkedJobs(owner)).map((link) => link.title).sort()).toEqual(['Old deal', 'Old project', 'WO000001 Old copy']);
  });

  it('shows the warehouse as not set up and the others as connected with nothing in them', async () => {
    const apps = await getConnectedApps(owner);
    const state = Object.fromEntries(apps.apps.map((app) => [app.app, app.state]));
    expect(state.wms).toBe('not_set_up');
    expect(apps.canManage).toBe(true);
    expect((await getConnectedApps(viewer).catch(() => null))?.canManage ?? false).toBe(false);
  });

  it('a sync writes nothing, keeps the stored copy on the links, and can run again', async () => {
    const before = { entries: await count('production_entries'), revenue: await count('revenue_entries'), usage: await count('material_usage') };
    const first = await runSync(owner, 'all');
    expect(first.find((result) => result.source === 'wms')).toMatchObject({ status: 'skipped', created: 0 });
    for (const result of first.filter((item) => item.source !== 'wms')) expect(result).toMatchObject({ status: 'ok', created: 0, updated: 0 });
    const second = await runSync(owner, 'all');
    for (const result of second) expect(result.created + result.updated).toBe(0);
    expect({ entries: await count('production_entries'), revenue: await count('revenue_entries'), usage: await count('material_usage') }).toEqual(before);
    expect((await listLinkedJobs(owner)).find((link) => link.targetType === 'crm_deal')?.title).toBe('Old deal');
    const runs = await org.query<{ status: string }>('select status from pulse.sync_runs where org_id = $1', [org.orgId]);
    expect(runs.length).toBe(4);
    expect(runs.every((run) => run.status === 'ok')).toBe(true);
  }, 60_000);

  it('only one sync runs at a time, and a viewer cannot start one', async () => {
    await org.query("update pulse.sync_state set locked_until = now() + interval '5 minutes' where org_id = $1 and source = 'crm'", [org.orgId]);
    const [held] = await runSync(owner, 'crm');
    expect(held).toMatchObject({ status: 'skipped', message: 'A sync is already running. Try again in a minute.' });
    await org.query("update pulse.sync_state set locked_until = null where org_id = $1", [org.orgId]);
    await expect(runSync(viewer, 'crm')).rejects.toThrow();
  });

  it('answers the change notes sibling apps leave, once', async () => {
    await org.query("insert into pulse.bridge_events (org_id, kind, target_id, payload) values ($1, 'crm_deal_stage_changed', $2, '{}'::jsonb), ($1, 'wms_work_order_changed', 'wo-1', '{}'::jsonb)", [org.orgId, NOBODY]);
    await syncIfStale({ ...owner, actorKind: 'system' });
    const events = await org.query<{ processed: boolean; attempts: number }>('select processed_at is not null as processed, attempts from pulse.bridge_events where org_id = $1', [org.orgId]);
    expect(events).toHaveLength(2);
    expect(events.every((event) => event.processed && event.attempts === 1)).toBe(true);
    const eventRuns = await org.query<{ source: string }>("select source from pulse.sync_runs where org_id = $1 and trigger = 'event'", [org.orgId]);
    expect(eventRuns.map((run) => run.source)).toEqual(['crm']);
  }, 60_000);
});
