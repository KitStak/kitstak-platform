/**
 * Program parity (docs/programs/SPEC.md 6.1 and 9.2): KitStak Programs feed a Pulse job, and the
 * money Pulse stamps equals what Projects stored, to the cent. The Projects side is the shared
 * GLOVE fixture of `@kitstak/db` (the SPEC 3.15 card: two versions, a rate rule, XL overrides, a
 * setup fee) written straight into `pm.*`; the moves Projects makes on its own (reposting days to a
 * job, posting fees in the ledger, logging time) are done here with plain SQL, the same rows the
 * Projects domain writes. Pulse runs for real on the same throwaway org. Skipped with no database.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestOrg, databaseReady, TEST_DATABASE_URL, type TestOrg } from '@/test/db';
import { seedGloveFixture, type GloveFixture, type TestOrg as PmTestOrg } from '../../../../../packages/db/src/programs/test-support';
import type { DomainContext } from './_shared';

vi.mock('@/server/integrations/detect', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/server/integrations/detect')>();
  return { ...real, integrationAvailability: async () => ({ crm: false, wms: false, projects: true }) };
});

const domain = await import('./test-exports');
const { syncPrograms, EDGE_READ_FAILED } = await import('./sync-programs');
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

describe.skipIf(!ready)('programs feed Pulse jobs with the money Projects stored', () => {
  let org: TestOrg;
  let owner: DomainContext;
  let pool: pg.Pool;
  let glove: GloveFixture;
  let j1: { id: string; number: string };
  let j2: { id: string; number: string };
  let prepTaskId: string;
  let mitt: string;

  const q = <T extends pg.QueryResultRow>(text: string, values: unknown[] = []) => org.query<T>(text, values);

  /** What Projects would do after a link: open days of the program move to the job. */
  const repost = async (jobId: string) => {
    await q(`update pm.build_output set posting = 'program_job', pulse_job_id = $2 where program_id = $1 and deleted_at is null and posting <> 'build_job'`, [glove.programId, jobId]);
    await q(`update pm.program_ledger set posting = 'program_job', pulse_job_id = $2 where program_id = $1 and deleted_at is null`, [glove.programId, jobId]);
  };

  const ledger = async (ref: string, kind: string, date: string, cents: number, label: string, extra: { quantity?: string; unitPrice?: string; variantId?: string } = {}) =>
    q(
      `insert into pm.program_ledger (org_id, program_id, ref, kind, charge_date, month, cents, quantity, unit_price, variant_id, label, posting, pulse_job_id)
       values ($1, $2, $3, $4, $5::date, date_trunc('month', $5::date)::date, $6, $7, $8, $9, $10, 'program', null)`,
      [org.orgId, glove.programId, ref, kind, date, cents, extra.quantity ?? null, extra.unitPrice ?? null, extra.variantId ?? null, label],
    );

  const pulseRows = () =>
    q<{ ref: string; job_id: string; units: string; revenue: string; hours: string; variant: string | null; work_date: string }>(
      `select source_ref as ref, job_id, units_good::text as units, base_revenue_cents::text as revenue, hours::text as hours, pm_variant_id::text as variant, work_date::text as work_date
         from pulse.production_entries where org_id = $1 and source = 'projects' and deleted_at is null order by source_ref`,
      [org.orgId],
    );
  const pulseFees = () =>
    q<{ ref: string; job_id: string; cents: string; kind: string }>(
      `select source_ref as ref, job_id, amount_cents::text as cents, kind from pulse.revenue_entries where org_id = $1 and source = 'projects' and deleted_at is null order by source_ref`,
      [org.orgId],
    );
  /** Projects side by variant: output posting to the job (every month that is open in Pulse). */
  const projectsByVariant = (jobId: string) =>
    q<{ variant: string | null; cents: string; units: string }>(
      `select o.variant_id::text as variant, sum(o.revenue_cents)::text as cents, sum(o.qty)::text as units
         from pm.build_output o join pm.tasks t on t.id = o.build_id and t.deleted_at is null
        where o.org_id = $1 and o.deleted_at is null and o.pulse_job_id = $2 group by 1 order by 1`,
      [org.orgId, jobId],
    );
  const pulseByVariant = (jobId: string) =>
    q<{ variant: string | null; cents: string; units: string }>(
      `select pm_variant_id::text as variant, sum(base_revenue_cents)::text as cents, sum(units_good)::text as units
         from pulse.production_entries where org_id = $1 and job_id = $2 and source = 'projects' and source_ref like 'pmb:%' and deleted_at is null
        group by 1 order by 1`,
      [org.orgId, jobId],
    );

  beforeAll(async () => {
    org = await createTestOrg('pulse-programs');
    owner = await org.member('owner', 'Program Owner');
    pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 2 });
    const shim: PmTestOrg = {
      orgId: org.orgId,
      userId: owner.userId,
      pool,
      db: null as unknown as PmTestOrg['db'],
      query: async (text, values) => (await pool.query(text, values)).rows,
      tx: async (fn) => {
        const client = await pool.connect();
        try {
          await client.query('begin');
          const result = await fn(client);
          await client.query('commit');
          return result;
        } catch (error) {
          await client.query('rollback').catch(() => undefined);
          throw error;
        } finally {
          client.release();
        }
      },
      addUser: async () => owner.userId,
      destroy: async () => undefined,
    };
    glove = await seedGloveFixture(shim, { output: true });
    // A prep task in the program (not a build) for labor rows.
    prepTaskId = randomUUID();
    await q(`insert into pm.tasks (id, org_id, project_id, number, title, status_id, position, kind) values ($1, $2, $3, 9001, 'Order more glove bags', $4, 'z0', 'task')`, [prepTaskId, org.orgId, glove.programId, glove.statusTodo]);
    const client = await domain.createClient(owner, { name: 'Gripwell Safety Supply' });
    const make = (name: string) => domain.createJob(owner, { name, clientId: client.id, kind: 'ongoing', pricingModel: 'per_unit', unitLabel: 'kits', status: 'active', startDate: '2026-09-01' });
    const first = await make('Glove program');
    const second = await make('Glove build job');
    j1 = { id: first.id, number: first.number };
    j2 = { id: second.id, number: second.number };
  }, 120_000);

  afterAll(async () => {
    await pool?.end().catch(() => undefined);
    await org?.destroy();
  });

  it('links the program from Pulse: one edge in core.record_links and its mirror', async () => {
    const job = await domain.linkProgramToJob(owner, j1.id, glove.programId);
    expect(job.program).toMatchObject({ kind: 'program', key: 'GLOVE', programId: glove.programId });
    const edges = await q<{ from_id: string; to_id: string }>(`select from_id, to_id from core.record_links where org_id = $1 and relation = 'bills_to'`, [org.orgId]);
    expect(edges).toEqual([{ from_id: glove.programId, to_id: j1.id }]);
    // Projects moves the open days and posts the fees once it sees the edge.
    await ledger(`pmf:${glove.programId}:setup:${glove.setupId}`, 'setup', '2026-09-15', 250000, 'Setup fee');
    await ledger(`pmf:${glove.programId}:monthly:2026-11`, 'flat_monthly', '2026-11-24', 150000, 'Monthly fee');
    await ledger(`pmf:${glove.programId}:adj:${randomUUID()}`, 'adjustment', '2026-11-10', -2500, 'Damaged cartons credit', { variantId: glove.variants['S-BRN'] });
    await ledger(`pmf:${glove.programId}:hours:2026-11-12`, 'per_hour', '2026-11-12', 9000, 'Hourly work', { quantity: '2.000', unitPrice: '45.0000' });
    await repost(j1.id);
  }, 60_000);

  it('copies every build day and fee, and Pulse stamps equal Projects to the cent, per variant', async () => {
    // Build labor and prep labor, in the program zone (Chicago).
    const build = await q<{ task_id: string }>(`select task_id::text from pm.builds where program_id = $1 and build_date = '2026-11-20' order by task_id limit 1`, [glove.programId]);
    await q(
      `insert into pm.time_entries (org_id, project_id, task_id, user_id, started_at, ended_at, duration_minutes, billable) values
         ($1, $2, $3, $4, '2026-11-20 14:00+00', '2026-11-20 16:00+00', 120, true),
         ($1, $2, $5, $4, '2026-11-19 14:00+00', '2026-11-19 15:30+00', 90, false)`,
      [org.orgId, glove.programId, build[0]!.task_id, owner.userId, prepTaskId],
    );
    const [result] = await domain.runSync(owner, 'projects');
    expect(result?.status, result?.message).toBe('ok');
    const projects = await projectsByVariant(j1.id);
    expect(projects.length).toBe(8);
    expect(await pulseByVariant(j1.id)).toEqual(projects);
    const fees = await pulseFees();
    const stored = await q<{ ref: string; cents: string }>(`select ref, cents::text from pm.program_ledger where program_id = $1 and deleted_at is null order by ref`, [glove.programId]);
    expect(fees.map((fee) => ({ ref: fee.ref, cents: fee.cents }))).toEqual(stored);
    expect(fees.every((fee) => fee.job_id === j1.id)).toBe(true);
    expect(fees.find((fee) => fee.ref.includes(':adj:'))?.kind).toBe('adjustment');
    const rows = await pulseRows();
    expect(rows.find((row) => row.ref === `pmb:${build[0]!.task_id}:2026-11-20`)?.hours).toBe('2.00');
    expect(rows.find((row) => row.ref === `pmt:${glove.programId}:program:2026-11-19`)).toMatchObject({ hours: '1.50', units: '0.000', job_id: j1.id });
    // The program card agrees with Projects.
    const card = await domain.getJobProgram(owner, j1.number);
    expect(card.available).toBe(true);
    expect(card.blocks[0]?.matches).toBe(true);
    expect(card.blocks[0]?.variants).toHaveLength(8);
    // Totals of the By variant table equal the job's own numbers.
    const job = await domain.getJob(owner, j1.number);
    expect(card.totals?.revenueCents).toBe(job.stats.revenueCents);
    expect(card.totals?.profitCents).toBe(job.stats.profitCents);
  }, 120_000);

  it('runs again as a no op', async () => {
    const [result] = await domain.runSync(owner, 'projects');
    expect(result).toMatchObject({ status: 'ok', created: 0, updated: 0 });
  }, 120_000);

  it('writes one prep labor row per task per day when the link asks for task time (MAHCO)', async () => {
    // A second prep task, with time on two days; the first prep task already has time on Nov 19.
    const countTaskId = randomUUID();
    await q(`insert into pm.tasks (id, org_id, project_id, number, title, status_id, position, kind) values ($1, $2, $3, 9002, 'Count glove bags', $4, 'z1', 'task')`, [countTaskId, org.orgId, glove.programId, glove.statusTodo]);
    await q(
      `insert into pm.time_entries (org_id, project_id, task_id, user_id, started_at, ended_at, duration_minutes, billable) values
         ($1, $2, $3, $4, '2026-11-18 14:00+00', '2026-11-18 15:00+00', 60, false),
         ($1, $2, $3, $4, '2026-11-19 16:00+00', '2026-11-19 16:30+00', 30, false)`,
      [org.orgId, glove.programId, countTaskId, owner.userId],
    );
    await q(`update core.record_links set meta = coalesce(meta, '{}'::jsonb) || '{"importTaskTime": true}'::jsonb where org_id = $1 and from_type = 'pm_program' and from_id = $2 and relation = 'bills_to'`, [org.orgId, glove.programId]);
    const [result] = await domain.runSync(owner, 'projects');
    expect(result?.status, result?.message).toBe('ok');
    const prep = (await pulseRows()).filter((row) => row.ref.startsWith('pmt:')).map((row) => ({ ref: row.ref, hours: row.hours, units: row.units, job_id: row.job_id }));
    expect(prep).toEqual(
      [
        { ref: `pmt:${glove.programId}:${countTaskId}:2026-11-18`, hours: '1.00', units: '0.000', job_id: j1.id },
        { ref: `pmt:${glove.programId}:${countTaskId}:2026-11-19`, hours: '0.50', units: '0.000', job_id: j1.id },
        { ref: `pmt:${glove.programId}:${prepTaskId}:2026-11-19`, hours: '1.50', units: '0.000', job_id: j1.id },
      ].sort((a, b) => a.ref.localeCompare(b.ref)),
    );
    // Each per task row names its task, so Cost by task can show it.
    const tagged = await q<{ pm_task_id: string | null }>(`select pm_task_id::text from pulse.production_entries where org_id = $1 and source_ref like 'pmt:%' and deleted_at is null`, [org.orgId]);
    expect(new Set(tagged.map((row) => row.pm_task_id))).toEqual(new Set([prepTaskId, countTaskId]));
    const costs = await domain.getJobTaskCosts(owner, j1.number);
    expect(costs.rows.find((row) => row.taskId === prepTaskId)).toMatchObject({ title: 'Order more glove bags', ref: 'GLOVE-9001', hours: '1.50' });
    expect(costs.rows.some((row) => row.title === 'Task no longer in Projects')).toBe(false);
    // Build lines roll up to one row per program, and rows with no hours stay out.
    expect(costs.rows.filter((row) => row.taskId?.startsWith('builds:'))).toHaveLength(1);
    expect(costs.rows.every((row) => row.taskId === null || Number(row.hours) > 0)).toBe(true);
    // Back to program level time for the cases below.
    await q(`update core.record_links set meta = meta - 'importTaskTime' where org_id = $1 and from_type = 'pm_program' and from_id = $2`, [org.orgId, glove.programId]);
    await q(`update pm.time_entries set deleted_at = now() where task_id = $1`, [countTaskId]).catch(() => q(`delete from pm.time_entries where task_id = $1`, [countTaskId]));
    const [again] = await domain.runSync(owner, 'projects');
    expect(again?.status, again?.message).toBe('ok');
    expect((await pulseRows()).filter((row) => row.ref.startsWith('pmt:')).map((row) => row.ref)).toEqual([`pmt:${glove.programId}:program:2026-11-19`]);
  }, 120_000);

  it('removes the Pulse line when the output row is deleted in Projects', async () => {
    const [gone] = await q<{ id: string; build_id: string; work_date: string }>(
      `select id::text, build_id::text, work_date::text from pm.build_output where program_id = $1 and work_date = '2026-11-23' and deleted_at is null order by id limit 1`,
      [glove.programId],
    );
    await q(`update pm.build_output set deleted_at = now() where id = $1`, [gone!.id]);
    await domain.runSync(owner, 'projects');
    const rows = await pulseRows();
    expect(rows.some((row) => row.ref === `pmb:${gone!.build_id}:${gone!.work_date}`)).toBe(false);
    expect(await pulseByVariant(j1.id)).toEqual(await projectsByVariant(j1.id));
  }, 120_000);

  it('moves a reposted build to its own job once, restamps both jobs, and its time follows it', async () => {
    const [build] = await q<{ task_id: string }>(`select task_id::text from pm.builds where program_id = $1 and build_date = '2026-11-20' order by task_id limit 1`, [glove.programId]);
    await q(`insert into core.record_links (org_id, from_type, from_id, to_type, to_id, relation) values ($1, 'pm_build', $2, 'pulse_job', $3, 'bills_to')`, [org.orgId, build!.task_id, j2.id]);
    await q(`update pm.build_output set posting = 'build_job', pulse_job_id = $2 where build_id = $1 and deleted_at is null`, [build!.task_id, j2.id]);
    const before = (await pulseRows()).find((row) => row.ref === `pmb:${build!.task_id}:2026-11-20`);
    await domain.runSync(owner, 'projects');
    const after = await q<{ id: string; job_id: string; hours: string }>(`select id::text, job_id::text, hours::text from pulse.production_entries where org_id = $1 and source_ref = $2 and deleted_at is null`, [org.orgId, `pmb:${build!.task_id}:2026-11-20`]);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ job_id: j2.id, hours: '2.00' });
    expect(before?.job_id).toBe(j1.id);
    expect(await pulseByVariant(j2.id)).toEqual(await projectsByVariant(j2.id));
    expect(await pulseByVariant(j1.id)).toEqual(await projectsByVariant(j1.id));
    const stats = await q<{ job_id: string; revenue: string }>(`select job_id::text, revenue_cents::text as revenue from pulse.job_stats where job_id in ($1, $2)`, [j1.id, j2.id]);
    const j2Revenue = (await projectsByVariant(j2.id)).reduce((sum, row) => sum + BigInt(row.cents), BigInt(0));
    expect(stats.find((row) => row.job_id === j2.id)?.revenue).toBe(j2Revenue.toString());
    const mirrors = await q<{ target_type: string; job_id: string }>(`select target_type, job_id::text from pulse.job_links where org_id = $1 order by target_type`, [org.orgId]);
    expect(mirrors).toEqual([
      { target_type: 'pm_build', job_id: j2.id },
      { target_type: 'pm_program', job_id: j1.id },
    ]);
  }, 120_000);

  it('keeps closed month rows and counts them as skipped', async () => {
    await q(`insert into pulse.periods (org_id, period_month, status, closed_at) values ($1, '2026-10-01', 'closed', now())`, [org.orgId]);
    const [row] = await q<{ id: string; build_id: string }>(`select id::text, build_id::text from pm.build_output where program_id = $1 and work_date = '2026-10-20' and deleted_at is null order by id limit 1`, [glove.programId]);
    await q(`update pm.build_output set qty = qty + 1, revenue_cents = round((qty + 1) * unit_price * 100) where id = $1`, [row!.id]);
    const [result] = await domain.runSync(owner, 'projects');
    expect(result?.status).toBe('ok');
    expect(result?.skippedClosed).toBeGreaterThan(0);
    const [pulse] = await q<{ units: string }>(`select units_good::text as units from pulse.production_entries where org_id = $1 and source_ref = $2 and deleted_at is null`, [org.orgId, `pmb:${row!.build_id}:2026-10-20`]);
    expect(pulse?.units).toBe('100.000');
  }, 120_000);

  it('aborts on an empty edge read while mirrors exist, and removes nothing', async () => {
    const before = await pulseRows();
    const tally = { created: 0, updated: 0, skipped: 0, skippedClosed: 0, counts: {} };
    await expect(syncPrograms({ ...owner, actorKind: 'integration' }, tally, { readEdges: async () => [] })).rejects.toThrow(EDGE_READ_FAILED);
    expect(await pulseRows()).toEqual(before);
  }, 120_000);

  it('refuses edits that belong to Projects', async () => {
    const [fee] = await q<{ id: string }>(`select id::text from pulse.revenue_entries where org_id = $1 and source_ref like 'pmf:%' and deleted_at is null and revenue_date >= '2026-11-01' limit 1`, [org.orgId]);
    await expect(domain.saveRevenue(owner, { id: fee!.id, jobId: j1.id, revenueDate: '2026-11-24', kind: 'fee', amountCents: 1 })).rejects.toThrow(/price card in Projects/);
    await expect(domain.deleteRevenue(owner, fee!.id)).rejects.toThrow(/price card in Projects/);
    const [line] = await q<{ id: string; version: number }>(`select id::text, version from pulse.production_entries where org_id = $1 and job_id = $2 and source_ref like 'pmb:%' and deleted_at is null and work_date >= '2026-11-01' limit 1`, [org.orgId, j1.id]);
    await expect(domain.saveProductionEntry(owner, { id: line!.id, jobId: j1.id, version: line!.version, workDate: '2026-11-24', unitsGood: '1' })).rejects.toThrow(/comes from build/);
    await expect(domain.deleteProductionEntries(owner, [line!.id])).rejects.toThrow(/comes from build/);
    // Typed lines carry hours and crew only.
    await expect(domain.saveProductionEntry(owner, { jobId: j1.id, workDate: '2026-11-24', unitsGood: '5', hours: '1' })).rejects.toThrow('Units for this job come from builds in Projects.');
    const typed = await domain.saveProductionEntry(owner, { jobId: j1.id, workDate: '2026-11-24', unitsGood: '0', hours: '3', headcount: '1' });
    expect(typed.entry.hours).toBe('3.00');
    // The job keeps its per unit model and cannot be deleted while the program bills to it.
    await expect(domain.updateJob(owner, j1.id, { pricingModel: 'fixed', fixedPriceCents: 100000 })).rejects.toThrow(/stays a per unit job/);
    await expect(domain.deleteJob(owner, j1.id)).rejects.toThrow('GLOVE bills to this job. Remove the link in Projects first.');
    await expect(domain.setJobPrice(owner, j1.id, { unitPrice: '2.0000' })).rejects.toThrow(/price card in Projects/);
  }, 120_000);

  it('refuses a second program on the same job', async () => {
    const shim = { orgId: org.orgId, userId: owner.userId, pool, db: null, query: async () => [], tx: async <T,>(fn: (client: pg.PoolClient) => Promise<T>) => {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const result = await fn(client);
        await client.query('commit');
        return result;
      } finally {
        client.release();
      }
    }, addUser: async () => owner.userId, destroy: async () => undefined } as unknown as PmTestOrg;
    const other = await seedGloveFixture(shim, { key: 'MITT' });
    mitt = other.programId;
    await expect(domain.linkProgramToJob(owner, j1.id, other.programId)).rejects.toThrow(/another program|already/);
    await expect(
      q(`insert into core.record_links (org_id, from_type, from_id, to_type, to_id, relation) values ($1, 'pm_program', $2, 'pulse_job', $3, 'bills_to')`, [org.orgId, other.programId, j1.id]),
    ).rejects.toThrow();
  }, 120_000);

  it('makes a new job from a program and links it on save, together or not at all', async () => {
    const client = await domain.createClient(owner, { name: 'Mitt Works' });
    const job = await domain.createJob(owner, { name: 'Mitt program', clientId: client.id, kind: 'ongoing', pricingModel: 'per_unit', unitLabel: 'kits', linkProgramId: mitt });
    expect(job.program).toMatchObject({ kind: 'program', key: 'MITT' });
    const edge = await q(`select 1 from core.record_links where org_id = $1 and relation = 'bills_to' and from_id = $2 and to_id = $3`, [org.orgId, mitt, job.id]);
    expect(edge).toHaveLength(1);
    // A fixed job cannot take a program: the job is not saved either.
    const before = await q(`select count(*)::int as n from pulse.jobs where org_id = $1`, [org.orgId]);
    await expect(domain.createJob(owner, { name: 'Wrong kind', clientId: client.id, kind: 'ongoing', pricingModel: 'fixed', fixedPriceCents: 100000, linkProgramId: glove.programId })).rejects.toThrow();
    expect(await q(`select count(*)::int as n from pulse.jobs where org_id = $1`, [org.orgId])).toEqual(before);
  }, 120_000);

  it('refuses to close a month the program has not settled', async () => {
    await expect(domain.closePeriod(owner, '2026-09')).rejects.toThrow("GLOVE has not added September's monthly charges yet. This happens on its own a few minutes after the month ends.");
    await q(`update pm.program_settings set settled_through = '2026-09-30' where program_id = any($1::uuid[])`, [[glove.programId, mitt]]);
    const closed = await domain.closePeriod(owner, '2026-09');
    expect(closed.status).toBe('closed');
  }, 120_000);

  it('removes every open program row from the old job when the link is removed', async () => {
    await q(`delete from core.record_links where org_id = $1 and relation = 'bills_to'`, [org.orgId]);
    await q(`update pm.build_output set posting = 'program', pulse_job_id = null where program_id = $1`, [glove.programId]);
    const [result] = await domain.runSync(owner, 'projects');
    expect(result?.status, result?.message).toBe('ok');
    const left = await pulseRows();
    // Only rows in closed months (September and October) stay.
    expect(left.length).toBeGreaterThan(0);
    expect(left.every((row) => row.work_date < '2026-11-01')).toBe(true);
    const fees = await pulseFees();
    expect(fees.every((fee) => fee.ref.includes(':setup:'))).toBe(true);
    const mirrors = await q(`select 1 from pulse.job_links where org_id = $1 and target_type in ('pm_program', 'pm_build')`, [org.orgId]);
    expect(mirrors).toHaveLength(0);
  }, 120_000);
});
