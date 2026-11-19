/**
 * The one rule for deleted jobs and deleted clients (domain/deleted.ts), on a throwaway organization: only a
 * person who may manage jobs can list or read a deleted job, a deleted client, or their rows. For
 * a supervisor or a viewer a filter by the id answers NOT_FOUND (the same as the job page), the
 * deleted clients list is FORBIDDEN, and lists with no filter leave the rows out. Skipped when no
 * database answers.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestOrg, databaseReady, type TestOrg } from '@/test/db';
import type { DomainContext } from './_shared';
import { listActivity } from './activity';
import { createClient, deleteClient, getClient, listClients } from './catalog';
import { assertAddressRefsReadable, assertReadableRefs } from './deleted';
import { listCosts, listRevenue, listVasEntries, saveCost, saveRevenue } from './entries';
import { createJob, deleteJob } from './jobs';
import { listProduction, saveProductionEntry } from './production';
import { listPunches } from './punches';
import { setMemberRole } from './test-exports';

const ready = await databaseReady();

describe.skipIf(!ready)('rows of a deleted job or a deleted client', () => {
  let org: TestOrg;
  let owner: DomainContext;
  let supervisor: DomainContext;
  let viewer: DomainContext;
  let liveJob: string;
  let goneJob: string;
  let goneClient: string;

  beforeAll(async () => {
    org = await createTestOrg('pulse-deleted-reads');
    owner = await org.member('owner', 'Dee Owner');
    supervisor = await org.member('member', 'Sid Supervisor');
    viewer = await org.member('member', 'Val Viewer');
    await setMemberRole(owner, supervisor.userId, { role: 'supervisor' });
    await setMemberRole(owner, viewer.userId, { role: 'viewer' });
    const client = await createClient(owner, { name: 'Keeper Goods' });
    const live = await createJob(owner, { name: 'Live job', clientId: client.id, status: 'active', plannedUnits: '100', unitPrice: '1.0000' });
    const gone = await createJob(owner, { name: 'Gone job', clientId: client.id, status: 'active', plannedUnits: '100', unitPrice: '1.0000' });
    liveJob = live.id;
    goneJob = gone.id;
    for (const jobId of [liveJob, goneJob]) {
      await saveProductionEntry(owner, { jobId, workDate: '2026-11-02', unitsGood: '10', hours: '1' });
      await saveCost(owner, { jobId, costDate: '2026-11-02', category: 'freight', amountCents: 1200 });
      await saveRevenue(owner, { jobId, revenueDate: '2026-11-02', kind: 'fee', amountCents: 5000 });
    }
    // A client with no jobs, with a client cost and a client fee, then deleted.
    const lone = await createClient(owner, { name: 'Vanished Supply Co' });
    goneClient = lone.id;
    await saveCost(owner, { clientId: goneClient, costDate: '2026-11-03', category: 'freight', amountCents: 700 });
    await saveRevenue(owner, { clientId: goneClient, revenueDate: '2026-11-03', kind: 'fee', amountCents: 900 });
    await deleteJob(owner, goneJob);
    await deleteClient(owner, goneClient);
  }, 120_000);
  afterAll(async () => {
    await org?.destroy();
  });

  const notFound = { code: 'NOT_FOUND' };

  it('a manager still reads a deleted job and a deleted client, and their rows', async () => {
    expect((await listProduction(owner, { jobId: goneJob })).length).toBe(1);
    expect((await listActivity(owner, { jobId: goneJob })).items.length).toBeGreaterThan(0);
    expect((await listActivity(owner, { clientId: goneClient })).items.length).toBeGreaterThan(0);
    expect((await listClients(owner, { includeDeleted: true })).map((client) => client.id)).toContain(goneClient);
    expect((await getClient(owner, goneClient)).deletedAt).not.toBeNull();
    expect((await listCosts(owner, { clientId: goneClient })).length).toBe(1);
    expect((await listRevenue(owner, { jobId: goneJob })).length).toBe(1);
    expect(await assertReadableRefs(owner, { jobId: goneJob, clientId: goneClient })).toBe(true);
  });

  it('for a supervisor and a viewer, a filter by a deleted job or client answers NOT_FOUND', async () => {
    for (const reader of [supervisor, viewer]) {
      await expect(listProduction(reader, { jobId: goneJob })).rejects.toMatchObject(notFound);
      await expect(listProduction(reader, { jobId: goneJob, includeDeleted: true })).rejects.toMatchObject(notFound);
      await expect(listActivity(reader, { jobId: goneJob })).rejects.toMatchObject(notFound);
      await expect(listActivity(reader, { entityType: 'job', entityId: goneJob })).rejects.toMatchObject(notFound);
      await expect(listActivity(reader, { clientId: goneClient })).rejects.toMatchObject(notFound);
      await expect(listCosts(reader, { jobId: goneJob })).rejects.toMatchObject(notFound);
      await expect(listCosts(reader, { clientId: goneClient })).rejects.toMatchObject(notFound);
      await expect(listRevenue(reader, { clientId: goneClient })).rejects.toMatchObject(notFound);
      await expect(listVasEntries(reader, { jobId: goneJob })).rejects.toMatchObject(notFound);
      await expect(listPunches(reader, { jobId: goneJob })).rejects.toMatchObject(notFound);
      await expect(getClient(reader, goneClient)).rejects.toMatchObject(notFound);
      await expect(listClients(reader, { includeDeleted: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      // The check every API route and download runs on `?job=` and `?client=`.
      await expect(assertAddressRefsReadable(reader, new URLSearchParams({ job: goneJob }))).rejects.toMatchObject(notFound);
      await expect(assertAddressRefsReadable(reader, new URLSearchParams({ client: goneClient }))).rejects.toMatchObject(notFound);
      await expect(assertAddressRefsReadable(reader, new URLSearchParams({ job: liveJob }))).resolves.toBeUndefined();
      // A live job reads as before.
      expect((await listProduction(reader, { jobId: liveJob })).length).toBe(1);
    }
  });

  it('for a supervisor and a viewer, lists with no filter leave out the rows of a deleted job or client', async () => {
    for (const reader of [supervisor, viewer]) {
      const work = await listProduction(reader, { includeDeleted: true });
      expect(work.map((row) => row.jobId)).toEqual([liveJob]);
      const costs = await listCosts(reader, {});
      expect(costs.map((row) => row.jobId)).toEqual([liveJob]);
      const fees = await listRevenue(reader, {});
      expect(fees.every((row) => row.jobId === liveJob)).toBe(true);
      expect(fees.some((row) => row.clientId === goneClient)).toBe(false);
      const feed = (await listActivity(reader, { limit: 200 })).items;
      expect(feed.length).toBeGreaterThan(0);
      expect(feed.some((item) => item.jobId === goneJob || item.clientId === goneClient)).toBe(false);
      expect((await listClients(reader, {})).map((client) => client.name)).toEqual(['Keeper Goods']);
    }
    // The owner's unfiltered lists are unchanged.
    expect((await listCosts(owner, {})).length).toBe(3);
    expect((await listActivity(owner, { limit: 200 })).items.some((item) => item.jobId === goneJob)).toBe(true);
  });
});
