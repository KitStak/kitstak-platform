/**
 * Links out to sibling apps follow the plan: when the workspace no longer has an app, a job's
 * link to a record in that app (and an extra service entry's link back to the warehouse) has no
 * address, so the page shows plain words instead of a link nobody can open.
 * Skipped when no database answers.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestOrg, databaseReady, type TestOrg } from '@/test/db';
import type { DomainContext } from './_shared';
import { addJobLink, createClient, createJob, createVasService, getJob, listVasEntries, saveVasEntry, siblingLinkUrl } from './test-exports';

const ready = await databaseReady();
const HOSTS = { crm: 'https://crm.example', wms: 'https://wms.example/', projects: 'https://projects.example' };
const ALL = { crm: true, wms: true, projects: true };

describe('the address of a linked record', () => {
  it('joins the app host and the stored path', () => {
    expect(siblingLinkUrl('wms_work_order', '/work-orders/1', ALL, HOSTS)).toBe('https://wms.example/work-orders/1');
    expect(siblingLinkUrl('crm_deal', '/board?item=9', ALL, HOSTS)).toBe('https://crm.example/board?item=9');
    expect(siblingLinkUrl('pm_project', '/p/KEY', ALL, HOSTS)).toBe('https://projects.example/p/KEY');
  });

  it('is null when the plan does not include that app', () => {
    expect(siblingLinkUrl('wms_work_order', '/work-orders/1', { ...ALL, wms: false }, HOSTS)).toBeNull();
    expect(siblingLinkUrl('crm_account', '/board?item=9', { ...ALL, crm: false }, HOSTS)).toBeNull();
    expect(siblingLinkUrl('pm_project', '/p/KEY', { ...ALL, projects: false }, HOSTS)).toBeNull();
    // Other apps stay linked.
    expect(siblingLinkUrl('crm_deal', '/board?item=9', { ...ALL, wms: false }, HOSTS)).toBe('https://crm.example/board?item=9');
  });

  it('is null for a missing or unsafe path', () => {
    expect(siblingLinkUrl('wms_work_order', null, ALL, HOSTS)).toBeNull();
    expect(siblingLinkUrl('wms_work_order', 'work-orders/1', ALL, HOSTS)).toBeNull();
    expect(siblingLinkUrl('wms_work_order', '//evil.example/x', ALL, HOSTS)).toBeNull();
  });
});

describe.skipIf(!ready)('links on a job follow the plan', () => {
  let org: TestOrg;
  let owner: DomainContext;
  let jobId: string;
  let clientId: string;
  const before = process.env.ENTITLEMENTS_DEV_ALLOW_ALL;

  beforeAll(async () => {
    org = await createTestOrg('pulse-links');
    owner = await org.member('owner', 'Link Owner');
    // The plan of this workspace: Pulse and CRM. No warehouse, no Projects.
    await org.query(`insert into core.entitlements (org_id, module, status, source) values ($1, 'pulse', 'active', 'manual'), ($1, 'crm', 'active', 'manual')`, [org.orgId]);
    const client = await createClient(owner, { name: 'Link Client' });
    clientId = client.id;
    const job = await createJob(owner, { name: 'Linked job', clientId, status: 'active', plannedUnits: '10', unitPrice: '1.0000' });
    jobId = job.id;
    await addJobLink(owner, jobId, { targetType: 'wms_work_order', targetId: 'wo-1', title: 'WO000088 Desk bundle', status: 'Completed', url: '/work-orders/wo-1' });
    await addJobLink(owner, jobId, { targetType: 'crm_deal', targetId: '00000000-0000-4000-8000-0000000000d1', title: 'Desk bundle deal', status: 'Won', url: '/board?item=d1' });
    await addJobLink(owner, jobId, { targetType: 'pm_project', targetId: '00000000-0000-4000-8000-0000000000f1', title: 'Desk bundle project', url: '/p/DESK' });
    const service = await createVasService(owner, { name: 'Relabel', defaultPrice: '0.5000' });
    await saveVasEntry({ ...owner, actorKind: 'integration' }, { vasServiceId: service.id, clientId, workDate: '2026-11-10', quantity: '4', source: 'wms', sourceRef: 'wms:vas:test-1', meta: { wms: { path: '/billing/vas' } } });
  }, 60_000);

  afterAll(async () => {
    if (before === undefined) delete process.env.ENTITLEMENTS_DEV_ALLOW_ALL;
    else process.env.ENTITLEMENTS_DEV_ALLOW_ALL = before;
    await org?.destroy();
  });

  it('a link to an app that is off the plan keeps its words and loses its address', async () => {
    process.env.ENTITLEMENTS_DEV_ALLOW_ALL = '0';
    const job = await getJob(owner, jobId);
    const byType = Object.fromEntries(job.links.map((link) => [link.targetType, link]));
    expect(byType.wms_work_order).toMatchObject({ title: 'WO000088 Desk bundle', status: 'Completed', url: null });
    expect(byType.pm_project).toMatchObject({ title: 'Desk bundle project', url: null });
    expect(byType.crm_deal?.url).toMatch(/\/board\?item=d1$/);
    // The same holds for the link from an extra service entry back to the warehouse.
    const [entry] = await listVasEntries(owner, { clientId });
    expect(entry).toMatchObject({ source: 'wms', sourceUrl: null });
  });

  it('the address comes back when the app is on the plan', async () => {
    process.env.ENTITLEMENTS_DEV_ALLOW_ALL = '1';
    const job = await getJob(owner, jobId);
    expect(job.links.find((link) => link.targetType === 'wms_work_order')?.url).toMatch(/\/work-orders\/wo-1$/);
    expect(job.links.find((link) => link.targetType === 'pm_project')?.url).toMatch(/\/p\/DESK$/);
    const [entry] = await listVasEntries(owner, { clientId });
    expect(entry?.sourceUrl).toMatch(/\/billing\/vas$/);
  });
});
