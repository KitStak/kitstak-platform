/**
 * Seams between teams, on a throwaway organization: a planned job starts by itself with its first
 * logged work (so it shows on the day sheet), and the entries of a deleted job leave the entry
 * lists (so no list links to a page that is gone). Skipped when no database answers.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestOrg, databaseReady, type TestOrg } from '@/test/db';
import type { DomainContext } from './_shared';
import { listActivity } from './activity';
import { deleteJob, getJob } from './jobs';
import { deleteProductionEntries, getLogGrid, listProduction } from './production';
import { createClient, createJob, saveProductionEntry } from './test-exports';

const ready = await databaseReady();

describe.skipIf(!ready)('seams between jobs, the day sheet and the entry lists', () => {
  let org: TestOrg;
  let owner: DomainContext;
  let clientId: string;

  beforeAll(async () => {
    org = await createTestOrg('pulse-seams');
    owner = await org.member('owner', 'Seams Owner');
    clientId = (await createClient(owner, { name: 'Seams Client' })).id;
  }, 60_000);
  afterAll(async () => {
    await org?.destroy();
  });

  const stageChanges = async (jobId: string): Promise<number> => (await listActivity(owner, { jobId, limit: 100 })).items.filter((item) => item.verb === 'job.status_changed').length;

  it('a planned job is not on the day sheet, and the first logged work starts it', async () => {
    const job = await createJob(owner, { name: 'Planned kit', clientId, plannedUnits: '100', unitPrice: '2.0000' });
    expect(job.status).toBe('planned');
    const today = (await getLogGrid(owner)).date;
    expect((await getLogGrid(owner)).rows.some((row) => row.jobId === job.id)).toBe(false);

    const saved = await saveProductionEntry(owner, { jobId: job.id, workDate: today, unitsGood: '10', headcount: '2', hours: '4' });
    const started = await getJob(owner, job.id);
    expect(started.status).toBe('active');
    expect((await getLogGrid(owner)).rows.some((row) => row.jobId === job.id)).toBe(true);
    expect(await stageChanges(job.id)).toBe(1);

    // A second day does not log the stage change again, and removing the work does not undo the start.
    await saveProductionEntry(owner, { jobId: job.id, workDate: today, shift: 'second', unitsGood: '5', headcount: '1', hours: '2' });
    expect(await stageChanges(job.id)).toBe(1);
    await deleteProductionEntries(owner, [saved.entry.id]);
    expect((await getJob(owner, job.id)).status).toBe('active');
  });

  it('an active, on hold or completed job keeps its stage when work is logged', async () => {
    const job = await createJob(owner, { name: 'Running kit', clientId, status: 'active', plannedUnits: '100', unitPrice: '2.0000' });
    await saveProductionEntry(owner, { jobId: job.id, workDate: (await getLogGrid(owner)).date, unitsGood: '10', headcount: '2', hours: '4' });
    expect((await getJob(owner, job.id)).status).toBe('active');
    expect(await stageChanges(job.id)).toBe(0);
  });

  it('entries of a deleted job leave the lists and stay on the job itself', async () => {
    const job = await createJob(owner, { name: 'Short lived kit', clientId, status: 'active', plannedUnits: '100', unitPrice: '2.0000' });
    const today = (await getLogGrid(owner)).date;
    await saveProductionEntry(owner, { jobId: job.id, workDate: today, unitsGood: '10', headcount: '2', hours: '4' });
    expect((await listProduction(owner, { from: today, to: today })).some((entry) => entry.jobId === job.id)).toBe(true);
    await deleteJob(owner, job.id);
    expect((await listProduction(owner, { from: today, to: today })).some((entry) => entry.jobId === job.id)).toBe(false);
    expect(await listProduction(owner, { jobId: job.id })).toHaveLength(1);
    expect((await listProduction(owner, { from: today, to: today, includeDeleted: true })).some((entry) => entry.jobId === job.id)).toBe(true);
  });
});
