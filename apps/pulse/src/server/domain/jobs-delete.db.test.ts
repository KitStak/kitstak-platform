/**
 * Deleting and restoring a job, and quick add next to a client with a close name, on a throwaway
 * organization. Skipped when no database answers.
 *
 *  - Quick add never makes a client whose name is close to one you have unless the caller says so.
 *  - A deleted job shows in the Deleted list with who deleted it and when, and leaves the job lists.
 *  - Restore puts the job, its entries and its revenue back.
 *  - Only people who may manage jobs can read the Deleted list, or list or read a deleted job any other way.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestOrg, databaseReady, type TestOrg } from '@/test/db';
import type { DomainContext } from './_shared';
import { listClients } from './catalog';
import { deleteJob, getJob, getJobRowForReader, listDeletedJobs, listJobPrices, listJobs, quickAddJob, restoreJob } from './jobs';
import { saveProductionEntry } from './production';
import { setMemberRole } from './test-exports';

const ready = await databaseReady();

describe.skipIf(!ready)('job delete, restore and quick add clients', () => {
  let org: TestOrg;
  let owner: DomainContext;
  let supervisor: DomainContext;

  beforeAll(async () => {
    org = await createTestOrg('pulse-job-delete');
    owner = await org.member('owner', 'Olive Owner');
    supervisor = await org.member('member', 'Sam Supervisor');
    await setMemberRole(owner, supervisor.userId, { role: 'supervisor' });
  }, 60_000);
  afterAll(async () => {
    await org?.destroy();
  });

  const clientNames = async () => (await listClients(owner, {})).map((client) => client.name).sort();

  it('refuses a client name close to one you have, unless the caller asks for a new client', async () => {
    const first = await quickAddJob(owner, { clientName: 'Harbor Roast Collective', name: 'Gift sets' });
    expect(first.clientName).toBe('Harbor Roast Collective');
    expect(await clientNames()).toEqual(['Harbor Roast Collective']);

    // A part of the name, and a slip of a letter: both are refused and nothing is made.
    for (const typed of ['Harbor', 'harbor roast', 'Harbr Roast Collective', 'Harbor Roast Collective Inc']) {
      await expect(quickAddJob(owner, { clientName: typed, name: 'Second job' })).rejects.toMatchObject({
        code: 'VALIDATION',
        message: expect.stringContaining('looks like Harbor Roast Collective'),
        fields: { clientName: expect.any(String) },
      });
    }
    expect(await clientNames()).toEqual(['Harbor Roast Collective']);
    expect((await listJobs(owner, { tab: 'all' })).map((job) => job.name)).toEqual(['Gift sets']);

    // The exact name (case aside) or the code uses the client that is there.
    const same = await quickAddJob(owner, { clientName: '  harbor ROAST collective ', name: 'Same client' });
    expect(same.clientId).toBe(first.clientId);
    const byCode = await quickAddJob(owner, { clientName: first.clientCode.toLowerCase(), name: 'By code' });
    expect(byCode.clientId).toBe(first.clientId);

    // Saying so makes the close name a client of its own.
    const made = await quickAddJob(owner, { clientName: 'Harbor', createClient: true, name: 'Other Harbor' });
    expect(made.clientId).not.toBe(first.clientId);
    expect(made.clientName).toBe('Harbor');

    // A name that is close to nothing needs no flag.
    const fresh = await quickAddJob(owner, { clientName: 'Summit Supply', name: 'Fresh client job' });
    expect(fresh.clientName).toBe('Summit Supply');
    expect(await clientNames()).toEqual(['Harbor', 'Harbor Roast Collective', 'Summit Supply']);
  });

  it('lists a deleted job with who deleted it, and restore puts it and its numbers back', async () => {
    const job = await quickAddJob(owner, { clientName: 'Summit Supply', name: 'Winter kits', plannedUnits: '100', unitPrice: '2.0000' });
    await saveProductionEntry(owner, { jobId: job.id, workDate: job.startDate as string, unitsGood: '40' });
    const before = await getJob(owner, job.id);
    expect(before.stats.revenueCents).toBe(8000);
    expect(await listDeletedJobs(owner)).toEqual([]);

    await deleteJob(owner, job.id);
    const deleted = await listDeletedJobs(owner);
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toMatchObject({ id: job.id, number: job.number, name: 'Winter kits', clientName: 'Summit Supply', deletedById: owner.userId });
    expect(deleted[0]?.deletedAt).toEqual(expect.any(String));
    expect((await listJobs(owner, { tab: 'all' })).some((item) => item.id === job.id)).toBe(false);

    const back = await restoreJob(owner, job.id);
    expect(back.deletedAt).toBeNull();
    expect(back.stats.revenueCents).toBe(8000);
    expect(back.stats.unitsGood).toBe(before.stats.unitsGood);
    expect(await listDeletedJobs(owner)).toEqual([]);
    expect((await listJobs(owner, { tab: 'all' })).some((item) => item.id === job.id)).toBe(true);
  });

  it('keeps the Deleted list to people who may manage jobs', async () => {
    await expect(listDeletedJobs(supervisor)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('gives a supervisor no other way to list or read a deleted job', async () => {
    const job = await quickAddJob(owner, { clientName: 'Summit Supply', name: 'Gone kits', plannedUnits: '50', unitPrice: '1.0000' });
    // Before the delete the supervisor reads it like any job.
    expect((await getJob(supervisor, job.id)).id).toBe(job.id);
    expect((await listJobs(supervisor, { tab: 'all' })).some((item) => item.id === job.id)).toBe(true);
    await deleteJob(owner, job.id);

    // The list flag that used to let anyone in (GET /api/v1/jobs?deleted=1).
    await expect(listJobs(supervisor, { tab: 'all', includeDeleted: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await listJobs(supervisor, { tab: 'all' })).some((item) => item.id === job.id)).toBe(false);
    // The job by id and by number (GET /api/v1/jobs/J-1045), and the routes that hang off it.
    await expect(getJob(supervisor, job.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(getJob(supervisor, job.number)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(listJobPrices(supervisor, job.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(getJobRowForReader(supervisor, job.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(getJobRowForReader(supervisor, job.number)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // A person who may manage jobs still reads it, so the job page can offer Restore.
    expect((await getJob(owner, job.id)).deletedAt).toEqual(expect.any(String));
    expect((await listJobs(owner, { tab: 'all', includeDeleted: true })).some((item) => item.id === job.id)).toBe(true);
    expect((await getJobRowForReader(owner, job.number)).id).toBe(job.id);

    await restoreJob(owner, job.id);
    expect((await getJob(supervisor, job.id)).deletedAt).toBeNull();
  });
});
