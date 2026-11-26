/**
 * Program jobs on the Jobs pages and in search (docs/programs/PULSE_PROGRAMS_SPEC.md 5.3, 5.4),
 * against the live database with the GLOVE fixture of `@kitstak/db` tracked in Pulse. Skipped
 * with no database.
 *
 *  - The Jobs list query leaves out the program job, keeps a normal job and a job only fed by
 *    billed builds ("Fed by a program"), and pickers (the default) still find the program job.
 *  - Counts, "Jobs that need you" and the Jobs badge leave it out the same way.
 *  - The job page finds GLOVE behind its job (the redirect to `/programs/GLOVE`) and reads its
 *    card price as "Varies by variant".
 *  - Search returns the program first, then its job (opened with `?view=job`).
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestOrg, databaseReady, TEST_DATABASE_URL, type TestOrg } from '@/test/db';
import { seedGloveFixture, type GloveFixture, type TestOrg as PmTestOrg } from '../../../../../packages/db/src/programs/test-support';
import { programJobRedirect } from '@/features/jobs/program-job';
import { db } from '@/server/db';
import type { DomainContext } from './_shared';

vi.mock('@/server/integrations/detect', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/server/integrations/detect')>();
  return { ...real, integrationAvailability: async () => ({ crm: false, wms: false, projects: true }) };
});

const domain = await import('./test-exports');
const { jobProgramPage, jobProgramRef } = await import('@/features/jobs/server/program-job');
const ready = (await databaseReady()) && (await pmReady());

async function pmReady(): Promise<boolean> {
  if (!TEST_DATABASE_URL) return false;
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  try {
    await client.connect();
    const result = await client.query("select to_regclass('pm.build_output') is not null and to_regclass('core.record_links') is not null and to_regclass('pm.program_ledger') is not null as ok");
    return Boolean(result.rows[0]?.ok);
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

describe.skipIf(!ready)('program jobs leave the Jobs list and lead search', () => {
  let org: TestOrg;
  let owner: DomainContext;
  let viewer: DomainContext;
  let pool: pg.Pool;
  let glove: GloveFixture;
  let programJob: { id: string; number: string };
  let normalJob: { id: string; number: string };
  let buildsJob: { id: string; number: string };

  const q = <T extends pg.QueryResultRow>(text: string, values: unknown[] = []) => org.query<T>(text, values);
  const shimFor = (): PmTestOrg => ({
    orgId: org.orgId,
    userId: owner.userId,
    pool,
    db: null as unknown as PmTestOrg['db'],
    query: async (text, values) => (await pool.query(text, values)).rows,
    tx: async (fn) => {
      const conn = await pool.connect();
      try {
        await conn.query('begin');
        const result = await fn(conn);
        await conn.query('commit');
        return result;
      } catch (error) {
        await conn.query('rollback').catch(() => undefined);
        throw error;
      } finally {
        conn.release();
      }
    },
    addUser: async () => owner.userId,
    destroy: async () => undefined,
  });

  beforeAll(async () => {
    org = await createTestOrg('pulse-program-job-lists');
    owner = await org.member('owner', 'Lists Owner');
    viewer = await org.member('member', 'Lists Viewer');
    await domain.setMemberRole(owner, viewer.userId, { role: 'viewer' });
    pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 2 });
    glove = await seedGloveFixture(shimFor(), { output: true });
    const client = await domain.createClient(owner, { name: 'Gripwell Safety Supply' });
    const tracked = await domain.trackProgram(owner, glove.programId, { clientId: client.id });
    programJob = { id: tracked.jobId, number: tracked.jobNumber };
    await q(`update pulse.jobs set status = 'active' where id = $1`, [programJob.id]);
    const other = await domain.createClient(owner, { name: 'Orchard Pet Supply' });
    const normal = await domain.createJob(owner, { name: 'Orchard chew toy 3-pack', clientId: other.id, status: 'active', unitPrice: '1.0000' });
    normalJob = { id: normal.id, number: normal.number };
    // A job that only takes builds billed one by one: fed by a program, not a program job.
    const builds = await domain.createJob(owner, { name: 'Glove rework builds', clientId: client.id, kind: 'ongoing', status: 'active', unitPrice: '1.0000' });
    buildsJob = { id: builds.id, number: builds.number };
    await q(
      `insert into pulse.job_links (org_id, job_id, target_type, target_id, cached_title, meta) values ($1, $2, 'pm_build', $3, 'GLOVE build', $4::jsonb)`,
      [org.orgId, buildsJob.id, randomUUID(), JSON.stringify({ key: 'GLOVE-B1', programId: glove.programId, programKey: 'GLOVE' })],
    );
    await domain.recomputeJobs(db, owner, [programJob.id, normalJob.id, buildsJob.id]);
  }, 180_000);

  afterAll(async () => {
    await pool?.end().catch(() => undefined);
    await org?.destroy();
  });

  it('the Jobs list query leaves out the program job and keeps the rest', async () => {
    const [flag] = await q<{ program_job: boolean }>(`select program_job from pulse.jobs where id = $1`, [programJob.id]);
    expect(flag?.program_job).toBe(true);
    for (const tab of ['all', 'open'] as const) {
      const listed = (await domain.listJobs(owner, { tab, programJobs: 'exclude' })).map((job) => job.number);
      expect(listed, tab).not.toContain(programJob.number);
      expect(listed, tab).toEqual(expect.arrayContaining([normalJob.number, buildsJob.number]));
    }
    // "Fed by a program" still finds the job that only takes billed builds.
    const fed = await domain.listJobs(owner, { tab: 'all', programJobs: 'exclude', fedByProgram: true });
    expect(fed.map((job) => job.number)).toEqual([buildsJob.number]);
    expect(fed[0]?.program).toMatchObject({ kind: 'builds', key: 'GLOVE' });
  });

  it('pickers that log hours still find the program job', async () => {
    const all = (await domain.listJobs(owner, { tab: 'open' })).map((job) => job.number);
    expect(all).toContain(programJob.number);
    expect((await domain.listJobs(viewer, { tab: 'all', q: programJob.number })).map((job) => job.number)).toEqual([programJob.number]);
  });

  it('counts, Jobs that need you and the Jobs badge leave the program job out too', async () => {
    await q(`update pulse.job_stats set risk_status = 'at_risk' where job_id in ($1, $2)`, [programJob.id, normalJob.id]);
    const counts = await domain.countJobsByRisk(owner);
    expect(Object.values(counts).reduce((sum, n) => sum + n, 0)).toBe(2);
    expect(counts.at_risk).toBe(1);
    expect((await domain.listJobsNeedingAttention(owner)).map((job) => job.number)).toEqual([normalJob.number]);
    expect((await domain.getBadges(owner)).jobsAtRisk).toBe(1);
    expect(await domain.countTrackedPrograms(owner)).toBe(1);
    expect(await domain.listProgramJobLinks(viewer)).toEqual([{ programId: glove.programId, key: 'GLOVE', name: 'Glove program', jobId: programJob.id, jobNumber: programJob.number }]);
  });

  it('finds GLOVE behind its job: /jobs/J-... goes to /programs/GLOVE, a normal job stays', async () => {
    const [detail, normal, builds] = await Promise.all([domain.getJob(owner, programJob.number), domain.getJob(owner, normalJob.number), domain.getJob(owner, buildsJob.number)]);
    const ref = await jobProgramRef(owner, detail);
    expect(ref).toMatchObject({ key: 'GLOVE', path: '/programs/GLOVE', cardVersion: 2, deleted: false });
    expect(programJobRedirect({ tab: 'overview', view: undefined, program: ref })).toBe('/programs/GLOVE');
    expect(programJobRedirect({ tab: 'overview', view: 'job', program: ref })).toBeNull();
    expect(await jobProgramRef(owner, normal)).toBeNull();
    expect(await jobProgramRef(owner, builds)).toBeNull();
    // The card gives XL its own price, so the job reads "Varies by variant"; no price for a viewer.
    expect((await jobProgramPage(owner, ref!, { seesMoney: true, today: '2026-11-25' })).price).toEqual({ kind: 'varies' });
    expect((await jobProgramPage(viewer, ref!, { seesMoney: false, today: '2026-11-25' })).price).toBeNull();
  }, 60_000);

  it('search returns the program first, then its job', async () => {
    for (const typed of ['glove', 'GLOVE', 'glove program']) {
      const hits = await domain.searchAll(owner, typed);
      expect(hits[0], typed).toMatchObject({ type: 'program', id: glove.programId, title: 'GLOVE · Glove program', href: '/programs/GLOVE' });
      expect(hits[0]?.subtitle).toBe('Program, Gripwell Safety Supply');
      expect(hits[1], typed).toMatchObject({ type: 'job', id: programJob.id, href: `/jobs/${programJob.number}?view=job` });
    }
    // A viewer finds it too, and no hit carries money.
    const seen = await domain.searchAll(viewer, 'glove');
    expect(seen[0]?.type).toBe('program');
    for (const hit of seen) expect(Object.keys(hit).sort()).toEqual(['href', 'id', 'subtitle', 'title', 'type']);
    // The job number still finds the job first, as a job.
    expect((await domain.searchAll(owner, programJob.number))[0]).toMatchObject({ type: 'job', id: programJob.id });
    // A normal job is not touched.
    expect((await domain.searchAll(owner, 'chew toy')).map((hit) => hit.href)).toEqual([`/jobs/${normalJob.number}`]);
  });
});
