/**
 * The program tracker against the live database (docs/programs/PULSE_PROGRAMS_SPEC.md 4, 5.2, 9):
 * the GLOVE fixture of `@kitstak/db` (the SPEC 3.15 card) is written straight into `pm.*`, Pulse
 * tracks it, the program sync copies its rows in, and the reads must agree with Projects to the
 * cent: month revenue (parity) and the plan forecast (the pm-bridge copy of the Projects read).
 * Skipped with no database.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestOrg, databaseReady, TEST_DATABASE_URL, type TestOrg } from '@/test/db';
import { seedGloveFixture, type GloveFixture, type TestOrg as PmTestOrg } from '../../../../../packages/db/src/programs/test-support';
import { programMonthStats as bridgeMonthStats } from '../../../../../packages/pm-bridge/src/month-stats';
import type { BridgeExecutor } from '../../../../../packages/pm-bridge/src/executor';
import type { DomainContext } from './_shared';

vi.mock('@/server/integrations/detect', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/server/integrations/detect')>();
  return { ...real, integrationAvailability: async () => ({ crm: false, wms: false, projects: true }) };
});

const domain = await import('./test-exports');
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

/** Every money field of a DTO (cents, margins, shares of money) that is not null, by path. */
function moneyLeaks(value: unknown, path = ''): string[] {
  if (value === null || value === undefined || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap((item, index) => moneyLeaks(item, `${path}[${index}]`));
  const out: string[] = [];
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    const here = path ? `${path}.${key}` : key;
    const isMoney = /Cents$/.test(key) || (/Bp$/.test(key) && key !== 'hoursShareBp');
    if (isMoney && inner !== null) out.push(`${here}=${String(inner)}`);
    else out.push(...moneyLeaks(inner, here));
  }
  return out;
}

describe.skipIf(!ready)('the program tracker reads a program the way Projects does', () => {
  let org: TestOrg;
  let owner: DomainContext;
  let viewer: DomainContext;
  let pool: pg.Pool;
  let glove: GloveFixture;
  let mitt: GloveFixture;
  let client: { id: string };
  let job: { id: string; number: string };

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
  const ledger = (programId: string, ref: string, kind: string, date: string, cents: number, label: string) =>
    q(
      `insert into pm.program_ledger (org_id, program_id, ref, kind, charge_date, month, cents, label, posting, pulse_job_id)
       values ($1, $2, $3, $4, $5::date, date_trunc('month', $5::date)::date, $6, $7, 'program', null)`,
      [org.orgId, programId, ref, kind, date, cents, label],
    );
  /** Projects' month revenue: stored output of live builds plus the month's ledger (the headline of `stats.ts`). */
  const projectsMonthCents = async (programId: string, month: string): Promise<bigint> => {
    const [row] = await q<{ output: string; ledger: string }>(
      `select (select coalesce(sum(o.revenue_cents), 0)::text from pm.build_output o join pm.tasks t on t.id = o.build_id and t.deleted_at is null
                where o.program_id = $1 and o.deleted_at is null and to_char(o.work_date, 'YYYY-MM') = $2) as output,
              (select coalesce(sum(cents), 0)::text from pm.program_ledger where program_id = $1 and deleted_at is null and to_char(month, 'YYYY-MM') = $2) as ledger`,
      [programId, month],
    );
    return BigInt(row!.output) + BigInt(row!.ledger);
  };

  beforeAll(async () => {
    org = await createTestOrg('pulse-program-tracker');
    owner = await org.member('owner', 'Program Owner');
    viewer = await org.member('member', 'Vera Viewer');
    await domain.setMemberRole(owner, viewer.userId, { role: 'viewer' });
    pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 2 });
    glove = await seedGloveFixture(shimFor(), { output: true });
    mitt = await seedGloveFixture(shimFor(), { key: 'MITT' });
    // Builds still to make this month (Nov 26 is the holiday): open, planned, nothing built yet.
    const builds = await q<{ day: string; variant: string; n: number }>(
      `select d::date::text as day, v.id::text as variant, row_number() over (order by d, v.position)::int as n
         from generate_series('2026-11-27'::date, '2026-11-30'::date, interval '1 day') d cross join pm.program_variants v
        where v.program_id = $1 and extract(isodow from d) < 6`,
      [glove.programId],
    );
    // A build task needs its build row in the same transaction.
    await shimFor().tx(async (conn) => {
      for (const build of builds) {
        const taskId = randomUUID();
        await conn.query(`insert into pm.tasks (id, org_id, project_id, number, title, status_id, position, kind, start_date, due_date) values ($1, $2, $3, $4, 'Open build', $5, $6, 'build', $7, $7)`, [taskId, org.orgId, glove.programId, 70000 + build.n, glove.statusTodo, `y${String(build.n).padStart(5, '0')}`, build.day]);
        await conn.query(`insert into pm.builds (task_id, org_id, container_id, program_id, variant_id, build_date, planned_qty, built_qty, planned_from) values ($1, $2, $3, $3, $4, $5, 120, 0, 'schedule')`, [taskId, org.orgId, glove.programId, build.variant, build.day]);
      }
    });
    const made = await domain.createClient(owner, { name: 'Gripwell Safety Supply' });
    client = { id: made.id };
    await q(`update pulse.clients set target_margin_bp = 2500 where id = $1`, [client.id]);
  }, 180_000);

  afterAll(async () => {
    await pool?.end().catch(() => undefined);
    await org?.destroy();
  });

  it('lists GLOVE and MITT under Not tracked yet before anything is tracked', async () => {
    const list = await domain.listTrackedPrograms(owner, { month: '2026-11' });
    expect(list.available).toBe(true);
    expect(list.programs).toEqual([]);
    expect(list.notTracked.map((row) => row.key).sort()).toEqual(['GLOVE', 'MITT']);
    expect(list.notTracked[0]?.matchedClient).toBeNull();
    expect(await domain.countTrackedPrograms(owner)).toBe(0);
  });

  it('trackProgram asks for a client when none matches, then makes the job and the edge once', async () => {
    await expect(domain.trackProgram(owner, glove.programId)).rejects.toThrow('Pick the Pulse client for GLOVE.');
    await expect(domain.trackProgram(viewer, glove.programId, { clientId: client.id })).rejects.toThrow(/role cannot do this/);
    const tracked = await domain.trackProgram(owner, glove.programId, { clientId: client.id });
    expect(tracked).toMatchObject({ key: 'GLOVE', changed: true, path: '/programs/GLOVE' });
    job = { id: tracked.jobId, number: tracked.jobNumber };
    const [row] = await q<{ kind: string; pricing_model: string; unit_label: string; program_job: boolean; unit_price: string | null; client_id: string }>(
      `select kind, pricing_model, unit_label, program_job, unit_price::text, client_id::text from pulse.jobs where id = $1`,
      [job.id],
    );
    expect(row).toEqual({ kind: 'ongoing', pricing_model: 'per_unit', unit_label: 'kits', program_job: true, unit_price: null, client_id: client.id });
    expect(await q(`select 1 from pulse.job_plans where job_id = $1`, [job.id])).toHaveLength(0);
    const edges = await q<{ from_id: string; to_id: string }>(`select from_id, to_id from core.record_links where org_id = $1 and relation = 'bills_to'`, [org.orgId]);
    expect(edges).toEqual([{ from_id: glove.programId, to_id: job.id }]);
    const mirrors = await q(`select 1 from pulse.job_links where org_id = $1 and job_id = $2 and target_type = 'pm_program' and target_id = $3`, [org.orgId, job.id, glove.programId]);
    expect(mirrors).toHaveLength(1);
    const events = await q(`select 1 from pulse.bridge_events where org_id = $1 and kind = 'pm_program_changed' and target_id = $2 and processed_at is null`, [org.orgId, glove.programId]);
    expect(events).toHaveLength(1);
    const lines = await q<{ body: string }>(`select body from pulse.activity where org_id = $1 and job_id = $2 and field = 'program_job'`, [org.orgId, job.id]);
    expect(lines.map((line) => line.body)).toEqual([`${job.number} is now tracked as the GLOVE program.`]);
  }, 60_000);

  it('refuses to track GLOVE a second time, and leaves one job and one edge', async () => {
    await expect(domain.trackProgram(owner, glove.programId, { clientId: client.id })).rejects.toThrow(`GLOVE is already tracked in Pulse on ${job.number}.`);
    expect(await q(`select 1 from core.record_links where org_id = $1 and relation = 'bills_to'`, [org.orgId])).toHaveLength(1);
    expect(await q(`select 1 from pulse.jobs where org_id = $1 and deleted_at is null`, [org.orgId])).toHaveLength(1);
  });

  it('refuses a job that is not per unit, and writes nothing', async () => {
    const fixed = await domain.createJob(owner, { name: 'Mitt setup', clientId: client.id, kind: 'ongoing', pricingModel: 'fixed', fixedPriceCents: 100000 });
    await expect(domain.trackProgram(owner, mitt.programId, { jobRef: fixed.number })).rejects.toThrow(/per unit/i);
    expect(await q(`select 1 from core.record_links where org_id = $1 and relation = 'bills_to' and from_id = $2`, [org.orgId, mitt.programId])).toHaveLength(0);
    const [flag] = await q<{ program_job: boolean }>(`select program_job from pulse.jobs where id = $1`, [fixed.id]);
    expect(flag?.program_job).toBe(false);
  });

  it('copies the program in, and November revenue equals Projects to the cent', async () => {
    // What Projects does once it sees the edge: open days move to the job, fees are posted.
    await ledger(glove.programId, `pmf:${glove.programId}:setup:${glove.setupId}`, 'setup', '2026-09-15', 250000, 'Setup fee');
    await ledger(glove.programId, `pmf:${glove.programId}:minimum:2026-10`, 'minimum_top_up', '2026-10-31', 16500, 'Minimum top up');
    await ledger(glove.programId, `pmf:${glove.programId}:monthly:2026-11`, 'flat_monthly', '2026-11-01', 150000, 'Monthly fee');
    await q(`update pm.build_output set posting = 'program_job', pulse_job_id = $2 where program_id = $1 and deleted_at is null`, [glove.programId, job.id]);
    await q(`update pm.program_ledger set posting = 'program_job', pulse_job_id = $2 where program_id = $1 and deleted_at is null`, [glove.programId, job.id]);
    // Hours typed on the program job on two days with units.
    await domain.saveProductionEntry(owner, { jobId: job.id, workDate: '2026-11-23', unitsGood: '0', hours: '24', headcount: '3' });
    await domain.saveProductionEntry(owner, { jobId: job.id, workDate: '2026-11-24', unitsGood: '0', hours: '16', headcount: '2' });
    const [result] = await domain.runSync(owner, 'projects');
    expect(result?.status, result?.message).toBe('ok');

    const month = await domain.getProgramMonth(owner, 'glove', '2026-11');
    const projects = await projectsMonthCents(glove.programId, '2026-11');
    expect(BigInt(month.figures.revenueCents!)).toBe(projects);
    // 17 work days of 8 variants at 100 kits: $27,370.00 of work plus the $1,500.00 fee (E16).
    expect(month.figures.workRevenueCents).toBe(2737000);
    expect(month.figures.feeCents).toBe(150000);
    expect(month.figures.units).toBe('13600.000');
    expect(month.parity).toMatchObject({ status: 'matches', visible: true, diffCents: 0 });
    expect(month.header).toMatchObject({ key: 'GLOVE', statusLabel: 'Running', deleted: false, readOnly: false, client: { id: client.id }, job: { id: job.id, number: job.number }, cardVersion: 2 });
    expect(month.target).toEqual({ targetMarginBp: 2500, source: 'client', clientId: client.id, clientPath: `/clients/${client.id}` });
    // October: the stored minimum top up is part of the month too.
    const october = await domain.getProgramMonth(owner, 'GLOVE', '2026-10');
    expect(BigInt(october.figures.revenueCents!)).toBe(await projectsMonthCents(glove.programId, '2026-10'));
  }, 180_000);

  it('the plan forecast equals what Projects computes for the same day', async () => {
    const month = await domain.getProgramMonth(owner, 'GLOVE', '2026-11');
    expect(month.plan).not.toBeNull();
    const asOf = month.plan!.asOf;
    const bridgeDb = drizzle(pool) as unknown as BridgeExecutor;
    const [settings] = await q<{ target: string | null }>(`select monthly_target_cents::text as target from pm.program_settings where program_id = $1`, [glove.programId]);
    const projects = await bridgeMonthStats(bridgeDb, org.orgId, { id: glove.programId, monthlyTargetCents: settings?.target ? BigInt(settings.target) : null }, asOf, '2026-11');
    expect(BigInt(month.plan!.forecastCents!)).toBe(projects.forecast.forecastCents);
    expect(BigInt(month.plan!.projectedGapCents!)).toBe(projects.forecast.projectedGapCents);
    expect(month.plan!.forecastMethod).toBe(projects.forecast.method);
    // Planned: built so far plus the open builds from today to month end (8 variants x 120 on each work day left).
    const workDaysLeft = (await q<{ n: number }>(`select count(distinct build_date)::int as n from pm.builds where program_id = $1 and build_date >= $2::date and built_qty = 0`, [glove.programId, asOf]))[0]!.n;
    expect(Number(month.plan!.plannedUnits)).toBe(13600 + workDaysLeft * 8 * 120);
    expect(month.costForecast).not.toBeNull();
  }, 60_000);

  it('shows every work day with its planned units, variants with names, months and labor', async () => {
    const days = await domain.getProgramDays(owner, 'GLOVE', '2026-11');
    expect(days.days.find((day) => day.date === '2026-11-26')).toBeUndefined();
    expect(days.days.filter((day) => day.workDay)).toHaveLength(20);
    expect(days.days.find((day) => day.date === '2026-11-30')).toMatchObject({ plannedUnits: '960.000', units: '0.000' });
    expect(days.days.find((day) => day.date === '2026-11-23')).toMatchObject({ units: '800.000', missingHours: false });
    expect(days.days.find((day) => day.date === '2026-11-20')).toMatchObject({ missingHours: true });

    const variants = await domain.getProgramVariants(owner, 'GLOVE', '2026-11');
    expect(variants.variants).toHaveLength(8);
    expect(variants.variants.map((row) => row.name)).toContain('XL Brown');
    const sum = variants.variants.reduce((total, row) => total + row.revenueCents!, 0) + variants.fees.totalCents! + variants.notTiedToVariant.revenueCents!;
    expect(sum).toBe(variants.total.revenueCents);
    const cost = variants.variants.reduce((total, row) => total + row.costCents!, 0) + variants.notTiedToVariant.costCents!;
    expect(cost).toBe(variants.total.costCents);
    expect(variants.variants.find((row) => row.name === 'Small Brown')?.plannedUnits).toBe(String(1700 + 2 * 120) + '.000');

    const months = await domain.getProgramMonths(owner, 'GLOVE', { from: '2026-09', to: '2026-11' });
    expect(months.months.map((row) => row.month)).toEqual(['2026-11', '2026-10', '2026-09']);
    expect(months.months.find((row) => row.month === '2026-10')?.minimum).toBe('missed');
    expect(months.months.find((row) => row.month === '2026-11')?.minimum).toBe('open');

    const labor = await domain.getProgramLabor(owner, 'GLOVE', '2026-11');
    expect(labor.totals.hours).toBe('40.00');
    expect(labor.hoursWithoutName).toBe('40.00');
    expect(labor.byClass.reduce((total, row) => total + Number(row.hours), 0)).toBe(40);
  }, 120_000);

  it('lists GLOVE as tracked with its job, and finds it from the job', async () => {
    const list = await domain.listTrackedPrograms(owner, { month: '2026-11' });
    expect(list.programs.map((row) => row.key)).toEqual(['GLOVE']);
    expect(list.programs[0]).toMatchObject({ jobNumber: job.number, units: '13600.000', targetMarginBp: 2500 });
    expect(BigInt(list.programs[0]!.revenueCents!)).toBe(await projectsMonthCents(glove.programId, '2026-11'));
    expect(list.notTracked.map((row) => row.key)).toEqual(['MITT']);
    expect(await domain.countTrackedPrograms(owner)).toBe(1);
    expect(await domain.programForJob(owner, job.number)).toMatchObject({ key: 'GLOVE', cardVersion: 2, path: '/programs/GLOVE' });
    await expect(domain.getProgramMonth(owner, 'MITT', '2026-11')).rejects.toThrow(/That program/);
    await expect(domain.getProgramMonth(owner, 'NOPE', '2026-11')).rejects.toThrow();
  }, 120_000);

  it('hides money from a viewer on every read', async () => {
    const reads = {
      list: await domain.listTrackedPrograms(viewer, { month: '2026-11' }),
      month: await domain.getProgramMonth(viewer, 'GLOVE', '2026-11'),
      variants: await domain.getProgramVariants(viewer, 'GLOVE', '2026-11'),
      months: await domain.getProgramMonths(viewer, 'GLOVE', { from: '2026-09', to: '2026-11' }),
      days: await domain.getProgramDays(viewer, 'GLOVE', '2026-11'),
      labor: await domain.getProgramLabor(viewer, 'GLOVE', '2026-11'),
    };
    expect(moneyLeaks(reads)).toEqual([]);
    for (const read of Object.values(reads)) expect(read.moneyHidden).toBe(true);
    // Units, hours and the plan in units are still there.
    expect(reads.month.figures.units).toBe('13600.000');
    expect(reads.month.plan?.plannedUnits).toBeTruthy();
    expect(reads.month.alerts.every((alert) => alert.rule === 'P6' || alert.rule === 'P7')).toBe(true);
    expect(reads.month.alerts.map((alert) => alert.rule)).toContain('P6');
    expect(reads.month.parity.visible).toBe(false);
    expect(reads.list.programs[0]?.units).toBe('13600.000');
    expect(reads.list.canTrack).toBe(false);
  }, 120_000);

  it('a program job with a typed quote never gets W7, W8, D4 or add_plan', async () => {
    // GLOVE in production: a typed quote of 2,000 kits, far under the units built.
    await domain.savePlan(owner, job.id, 'quote', { units: '2000', revenueCents: 8926020 });
    const [stats] = await q<{ risk_reasons: { rule: string; nextStep: string }[]; needs: { noPlan: boolean } }>(`select risk_reasons, needs from pulse.job_stats where job_id = $1`, [job.id]);
    const rules = stats!.risk_reasons.map((reason) => reason.rule);
    for (const rule of ['W7', 'W8', 'D4']) expect(rules).not.toContain(rule);
    expect(stats!.risk_reasons.map((reason) => reason.nextStep)).not.toContain('add_plan');
    expect(stats!.needs.noPlan).toBe(false);
    // The quote is kept, not deleted.
    expect(await q(`select 1 from pulse.job_plans where job_id = $1 and plan = 'quote'`, [job.id])).toHaveLength(1);
  }, 60_000);

  it('convertToProgramJob is idempotent and writes one activity line', async () => {
    // An older linked job: the link is there but the flag is not set yet.
    await q(`update pulse.jobs set program_job = false where id = $1`, [job.id]);
    await q(`delete from pulse.activity where job_id = $1 and field = 'program_job'`, [job.id]);
    const first = await domain.convertToProgramJob(owner, job.number);
    expect(first).toMatchObject({ key: 'GLOVE', jobId: job.id, changed: true });
    const second = await domain.convertToProgramJob(owner, job.number);
    expect(second.changed).toBe(false);
    const lines = await q<{ body: string }>(`select body from pulse.activity where org_id = $1 and job_id = $2 and field = 'program_job'`, [org.orgId, job.id]);
    expect(lines.map((line) => line.body)).toEqual([`${job.number} is now tracked as the GLOVE program.`]);
    const [flag] = await q<{ program_job: boolean }>(`select program_job from pulse.jobs where id = $1`, [job.id]);
    expect(flag?.program_job).toBe(true);
    const plain = await domain.createJob(owner, { name: 'Plain job', clientId: client.id, kind: 'ongoing', pricingModel: 'per_unit' });
    await expect(domain.convertToProgramJob(owner, plain.number)).rejects.toThrow(/not linked to a program/);
  }, 60_000);

  it('keeps a program deleted in Projects readable, read only', async () => {
    await q(`update pulse.periods set status = status where org_id = $1`, [org.orgId]);
    await q(`insert into pulse.periods (org_id, period_month, status, closed_at) values ($1, '2026-10-01', 'closed', now()) on conflict do nothing`, [org.orgId]);
    await q(`update pm.projects set deleted_at = now() where id = $1`, [glove.programId]);
    await q(`delete from core.record_links where org_id = $1 and from_id = $2`, [org.orgId, glove.programId]);
    const [result] = await domain.runSync(owner, 'projects');
    expect(result?.status, result?.message).toBe('ok');
    const october = await domain.getProgramMonth(owner, 'GLOVE', '2026-10');
    expect(october.header).toMatchObject({ deleted: true, readOnly: true });
    expect(october.figures.units).not.toBe('0.000');
    expect(october.plan).toBeNull();
    expect(october.parity.status).toBe('unknown');
  }, 120_000);
});
