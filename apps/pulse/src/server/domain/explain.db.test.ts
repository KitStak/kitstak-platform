/**
 * "How we got this" for a job that is not there answers "not found", like every other job
 * route, instead of quietly explaining the whole workspace. Skipped when no database answers.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestOrg, databaseReady, type TestOrg } from '@/test/db';
import type { DomainContext } from './_shared';
import { createClient, createJob, deleteJob, explain, saveProductionEntry } from './test-exports';

const ready = await databaseReady();
const range = { from: '2026-11-01', to: '2026-11-30' };

describe.skipIf(!ready)('explain with a job that is not there', () => {
  let org: TestOrg;
  let other: TestOrg;
  let owner: DomainContext;
  let jobId: string;
  let otherJobId: string;

  beforeAll(async () => {
    org = await createTestOrg('pulse-explain');
    other = await createTestOrg('pulse-explain-b');
    owner = await org.member('owner', 'Explain Owner');
    const otherOwner = await other.member('owner', 'Other Owner');
    const client = await createClient(owner, { name: 'Explain Client' });
    const job = await createJob(owner, { name: 'Explained job', clientId: client.id, status: 'active', plannedUnits: '10', unitPrice: '3.0000' });
    jobId = job.id;
    await saveProductionEntry(owner, { jobId, workDate: '2026-11-10', unitsGood: '10', headcount: '1', hours: '2' });
    const otherClient = await createClient(otherOwner, { name: 'Other Client' });
    otherJobId = (await createJob(otherOwner, { name: 'Not yours', clientId: otherClient.id, status: 'active' })).id;
  }, 60_000);
  afterAll(async () => {
    await org?.destroy();
    await other?.destroy();
  });

  it('explains a real job', async () => {
    const answer = await explain(owner, 'units', { ...range, jobId });
    expect(answer.lines.find((line) => line.op === 'total')?.value).toBe(10);
  });

  it('an unknown job id is not found', async () => {
    await expect(explain(owner, 'units', { ...range, jobId: '00000000-0000-4000-8000-0000000000aa' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it("another workspace's job is not found", async () => {
    await expect(explain(owner, 'profit', { ...range, jobId: otherJobId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('a deleted job is not found', async () => {
    const client = await createClient(owner, { name: 'Gone Client' });
    const gone = await createJob(owner, { name: 'Gone job', clientId: client.id, status: 'planned' });
    await deleteJob(owner, gone.id);
    await expect(explain(owner, 'units', { ...range, jobId: gone.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
