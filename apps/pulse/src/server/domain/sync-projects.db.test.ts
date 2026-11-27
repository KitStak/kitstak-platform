/**
 * Project time as labor hours: a day whose time was deleted in Projects leaves Pulse on the next
 * sync. The Projects reader is replaced with a fake (so the test never writes into `pm.*`); the
 * Pulse side runs for real on a throwaway org. Skipped when no database answers.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestOrg, databaseReady, type TestOrg } from '@/test/db';
import type { PmProject, PmTimeDay } from '@/server/integrations/projects';
import type { DomainContext } from './_shared';

const fake = vi.hoisted(() => ({ time: [] as PmTimeDay[], fail: false }));
const PROJECT = '00000000-0000-4000-8000-0000000000f1';

vi.mock('@/server/integrations/projects', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/server/integrations/projects')>();
  const project: PmProject = { id: PROJECT, key: 'OPS', name: 'Ops project', status: 'active', health: 'on_track', dueDate: null, coreCustomerId: null, crmItemId: null, percentDone: null, path: '/p/OPS' };
  return {
    ...real,
    getProjects: async (_ctx: unknown, ids: readonly string[]) => (ids.includes(PROJECT) ? [project] : []),
    projectTimeByDay: async (_ctx: unknown, _ids: readonly string[], _tz: string, options: { throwOnError?: boolean } = {}) => {
      if (fake.fail) {
        if (options.throwOnError) throw new Error('Projects did not answer');
        return [];
      }
      return fake.time;
    },
  };
});
vi.mock('@/server/integrations/detect', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/server/integrations/detect')>();
  return { ...real, integrationAvailability: async () => ({ crm: false, wms: false, projects: true }) };
});

const { addJobLink, createClient, createJob, runSync } = await import('./test-exports');
const ready = await databaseReady();

describe.skipIf(!ready)('project time that was deleted in Projects', () => {
  let org: TestOrg;
  let owner: DomainContext;

  beforeAll(async () => {
    org = await createTestOrg('pulse-pm-gone');
    owner = await org.member('owner', 'Projects Owner');
    const client = await createClient(owner, { name: 'Projects Client' });
    const job = await createJob(owner, { name: 'Project job', clientId: client.id, status: 'active' });
    await addJobLink(owner, job.id, { targetType: 'pm_project', targetId: PROJECT, title: 'Ops project', importsTime: true });
  }, 60_000);
  afterAll(async () => {
    await org?.destroy();
  });
  beforeEach(() => {
    fake.fail = false;
  });

  const labor = () =>
    org.query<{ day: string; hours: string }>(
      `select work_date::text as day, hours::text as hours from pulse.production_entries where org_id = $1 and source = 'projects' and deleted_at is null order by work_date`,
      [org.orgId],
    );

  it('adds a labor row per day of logged time', async () => {
    fake.time = [
      { projectId: PROJECT, workDate: '2026-11-10', minutes: 120, people: 1 },
      { projectId: PROJECT, workDate: '2026-11-11', minutes: 90, people: 2 },
    ];
    const [result] = await runSync(owner, 'projects');
    expect(result).toMatchObject({ status: 'ok', created: 2 });
    expect(await labor()).toEqual([
      { day: '2026-11-10', hours: '2.00' },
      { day: '2026-11-11', hours: '1.50' },
    ]);
  }, 60_000);

  it('keeps the rows when Projects cannot be read, and says the sync failed', async () => {
    fake.fail = true;
    const [result] = await runSync(owner, 'projects');
    expect(result?.status).toBe('failed');
    expect(await labor()).toHaveLength(2);
  }, 60_000);

  it('takes a day out once its time is gone in Projects', async () => {
    fake.time = [{ projectId: PROJECT, workDate: '2026-11-10', minutes: 120, people: 1 }];
    const [result] = await runSync(owner, 'projects');
    expect(result).toMatchObject({ status: 'ok', updated: 1 });
    expect(await labor()).toEqual([{ day: '2026-11-10', hours: '2.00' }]);
    const [again] = await runSync(owner, 'projects');
    expect(again).toMatchObject({ status: 'ok', created: 0, updated: 0 });
  }, 60_000);
});
