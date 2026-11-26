/**
 * The shared program money loader against the live database (SPEC 4.3.1, 3.14, 9.2). The GLOVE
 * fixture is the SPEC 3.15 setup, so the loaded inputs must reproduce E14, E15 and E16 through the
 * engine exactly; the filter cases prove every reader sees the same rows.
 */
import { ledgerRows, monthCharges } from '@kitstak/programs-engine/month';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  loadBuildHoursByDay,
  loadPrepTimeByDay,
  loadProgramBuilds,
  loadProgramFacts,
  loadProgramMonthInputs,
  loadTrailingDays,
  programsAvailable,
  readBuildOutput,
  readProgramMonth,
} from './loader';
import { createTestOrg, databaseReady, seedGloveFixture, type GloveFixture, type TestOrg } from './test-support';

const ready = await databaseReady(['core.organization', 'pm.build_output', 'pm.program_ledger']);

describe.skipIf(!ready)('loadProgramMonthInputs (GLOVE fixture)', () => {
  let org: TestOrg;
  let glove: GloveFixture;

  beforeAll(async () => {
    org = await createTestOrg('loader');
    glove = await seedGloveFixture(org, { output: true });
  });
  afterAll(async () => {
    await org?.destroy();
  });

  it('detects the program tables and column', async () => {
    expect(await programsAvailable(org.db)).toEqual({ kinds: true, tables: true });
  });

  it('merges the workspace calendar into the program calendar', async () => {
    const facts = await loadProgramFacts(org.db, org.orgId, glove.programId);
    expect(facts?.calendar).toEqual({
      timezone: 'America/Chicago',
      workingDays: [1, 2, 3, 4, 5],
      daysOff: ['2026-11-26'],
      extraWorkDays: [],
      activeFrom: '2026-09-15',
      activeTo: null,
      paused: [],
    });
    expect(facts?.hourlyTimeBasis).toBe('billable');
  });

  it('loads published versions with their lines and rules', async () => {
    const inputs = await loadProgramMonthInputs(org.db, org.orgId, glove.programId, '2026-11');
    expect(inputs.versions.map((version) => [version.number, version.effectiveFrom])).toEqual([[1, '2026-09-15'], [2, '2026-11-01']]);
    const v2 = inputs.versions[1]!;
    expect(v2.lines.filter((line) => line.kind === 'per_unit' && line.variantId === null)[0]?.unitPrice).toBe('1.9500');
    expect(v2.lines.filter((line) => line.variantId === glove.variants['XL-BRN'])[0]).toMatchObject({ unitPrice: '2.2000', kind: 'per_unit' });
    expect(v2.lines.find((line) => line.kind === 'flat_monthly')).toMatchObject({ amountCents: '150000', prorate: true, chargeWhilePaused: true });
    expect(v2.rules).toEqual([expect.objectContaining({ op: 'add', amount: '0.2500', valueId: 'xl' })]);
  });

  it('E14: September reproduces $21,660.00', async () => {
    const inputs = await loadProgramMonthInputs(org.db, org.orgId, glove.programId, '2026-09');
    expect(inputs.output).toHaveLength(12 * 8);
    expect(inputs.oneTime).toEqual([expect.objectContaining({ id: glove.setupId, kind: 'setup', chargeOn: '2026-09-15', amountCents: '250000' })]);
    const result = monthCharges({ ...inputs, asOf: '2026-11-25' });
    expect(result.work.totalCents).toBe(BigInt(1836000));
    expect(result.fixed.monthlyFeeCents).toBe(BigInt(80000));
    expect(result.fixed.setupCents).toBe(BigInt(250000));
    expect(result.minimum.minimumCents).toBe(BigInt(1600000));
    expect(result.minimum.status).toBe('met');
    expect(result.totalCents).toBe(BigInt(2166000));
  });

  it('E15: October reproduces $31,500.00 with the $165.00 minimum top up', async () => {
    const inputs = await loadProgramMonthInputs(org.db, org.orgId, glove.programId, '2026-10');
    expect(inputs.output).toHaveLength(22 * 8);
    const result = monthCharges({ ...inputs, asOf: '2026-11-25' });
    expect(result.work.totalCents).toBe(BigInt(2983500));
    expect(result.fixed.monthlyFeeCents).toBe(BigInt(150000));
    expect(result.minimum.topUpCents).toBe(BigInt(16500));
    expect(result.totalCents).toBe(BigInt(3150000));
    const topUp = ledgerRows(result).find((row) => row.kind === 'minimum_top_up');
    expect(topUp).toMatchObject({ ref: `pmf:${glove.programId}:minimum:2026-10`, chargeDate: '2026-10-31', cents: BigInt(16500) });
  });

  it('E16: November through Nov 24 reproduces $28,870.00 with a pending minimum', async () => {
    const inputs = await loadProgramMonthInputs(org.db, org.orgId, glove.programId, '2026-11');
    expect(inputs.output).toHaveLength(17 * 8);
    expect(inputs.oneTime).toEqual([]);
    const result = monthCharges({ ...inputs, asOf: '2026-11-24' });
    expect(result.work.totalCents).toBe(BigInt(2737000));
    expect(result.fixed.monthlyFeeCents).toBe(BigInt(150000));
    expect(result.minimum.status).toBe('pending');
    expect(result.minimum.gapSoFarCents).toBe(BigInt(263000));
    expect(result.totalCents).toBe(BigInt(2887000));
    const fee = ledgerRows(result).find((row) => row.kind === 'flat_monthly');
    expect(fee?.chargeDate).toBe('2026-11-01');
  });

  it('readProgramMonth returns the same output snapshots plus the ledger and settled day', async () => {
    await org.query(
      `insert into pm.program_ledger (org_id, program_id, ref, kind, charge_date, month, cents, label, posting)
       values ($1, $2, $3, 'flat_monthly', '2026-11-01', '2026-11-01', 150000, 'Monthly fee', 'program')`,
      [org.orgId, glove.programId, `pmf:${glove.programId}:monthly:2026-11`],
    );
    await org.query(`update pm.program_settings set settled_through = '2026-10-31' where program_id = $1`, [glove.programId]);
    const read = await readProgramMonth(org.db, org.orgId, glove.programId, '2026-11');
    const inputs = await loadProgramMonthInputs(org.db, org.orgId, glove.programId, '2026-11');
    expect(read.output).toEqual(inputs.output);
    expect(read.settledThrough).toBe('2026-10-31');
    expect(read.ledger).toEqual([
      expect.objectContaining({ ref: `pmf:${glove.programId}:monthly:2026-11`, cents: BigInt(150000), chargeDate: '2026-11-01', posting: 'program', pulseJobId: null }),
    ]);
  });

  it('readers ignore deleted output, deleted builds and deleted programs', async () => {
    const [row] = await org.query<{ id: string; build_id: string }>(
      `select id, build_id from pm.build_output where program_id = $1 and work_date = '2026-11-24' order by build_id limit 1`,
      [glove.programId],
    );
    const [other] = await org.query<{ build_id: string }>(
      `select build_id from pm.build_output where program_id = $1 and work_date = '2026-11-23' order by build_id limit 1`,
      [glove.programId],
    );
    await org.query('update pm.build_output set deleted_at = now() where id = $1', [row!.id]);
    await org.query('update pm.tasks set deleted_at = now() where id = $1', [other!.build_id]);
    const inputs = await loadProgramMonthInputs(org.db, org.orgId, glove.programId, '2026-11');
    expect(inputs.output).toHaveLength(17 * 8 - 2);
    expect(await readBuildOutput(org.db, org.orgId, [row!.build_id, other!.build_id], { from: '2026-11-01', to: '2026-11-30' })).toEqual([]);
    await org.query('update pm.build_output set deleted_at = null where id = $1', [row!.id]);
    await org.query('update pm.tasks set deleted_at = null where id = $1', [other!.build_id]);
    expect(await readBuildOutput(org.db, org.orgId, [row!.build_id], { from: '2026-11-24', to: '2026-11-24' })).toHaveLength(1);
  });

  it('finished builds: done with output, not cancelled, live task', async () => {
    const ids = await org.query<{ task_id: string }>(
      `select task_id from pm.builds where program_id = $1 and build_date = '2026-11-20' order by task_id limit 4`,
      [glove.programId],
    );
    const [done, cancelled, empty, deleted] = ids.map((row) => row.task_id);
    await org.query(`update pm.builds set finished_on = '2026-11-20', first_finished_on = '2026-11-20' where task_id = any($1::uuid[])`, [[done, cancelled, empty, deleted]]);
    await org.query('update pm.tasks set status_id = $2 where id = $1', [cancelled, glove.statusCancelled]);
    await org.query(`update pm.builds set built_qty = 0, finished_on = '2026-11-20' where task_id = $1`, [empty]);
    await org.query('update pm.tasks set deleted_at = now() where id = $1', [deleted]);
    const inputs = await loadProgramMonthInputs(org.db, org.orgId, glove.programId, '2026-11');
    expect(inputs.finished.map((row) => row.buildId)).toEqual([done]);
    const [task] = await org.query<{ number: number }>('select number from pm.tasks where id = $1', [done]);
    expect(inputs.finished[0]).toMatchObject({ buildKey: `GLOVE-${task!.number}`, finishedOn: '2026-11-20', builtQty: '100.000' });
  });

  it('time: billable, ended, live, counted on the program day; basis all counts every entry', async () => {
    const [build] = await org.query<{ task_id: string; variant_id: string }>(
      `select task_id, variant_id from pm.builds where program_id = $1 and build_date = '2026-11-23' order by task_id limit 1`,
      [glove.programId],
    );
    const [prep] = await org.query<{ id: string }>(
      `insert into pm.tasks (org_id, project_id, number, title, status_id, position) values ($1, $2, 9001, 'Order glove bags', $3, 'z0') returning id`,
      [org.orgId, glove.programId, glove.statusTodo],
    );
    const [optIn] = await org.query<{ id: string }>(
      `insert into pm.tasks (org_id, project_id, number, title, status_id, position) values ($1, $2, 9002, 'Label run', $3, 'z1') returning id`,
      [org.orgId, glove.programId, glove.statusTodo],
    );
    const second = await org.addUser('member');
    const entry = (taskId: string, userId: string, started: string, minutes: number | null, extra: { billable?: boolean; ended?: boolean; deleted?: boolean } = {}) =>
      org.query(
        `insert into pm.time_entries (org_id, project_id, task_id, user_id, started_at, ended_at, duration_minutes, billable, source, deleted_at)
         values ($1, $2, $3, $4, $5::timestamptz, case when $7 then $5::timestamptz + make_interval(mins => coalesce($6, 0)) else null end, $6, $8, 'manual', case when $9 then now() else null end)`,
        [org.orgId, glove.programId, taskId, userId, started, minutes, extra.ended ?? true, extra.billable ?? true, extra.deleted ?? false],
      );
    // 23:30 Chicago on Nov 23 is 05:30 UTC on Nov 24: it counts on Nov 23.
    await entry(build!.task_id, org.userId, '2026-11-24T05:30:00Z', 40);
    await entry(build!.task_id, second, '2026-11-23T15:00:00Z', 55);
    await entry(prep!.id, org.userId, '2026-11-23T16:00:00Z', 31);
    await entry(optIn!.id, second, '2026-11-23T17:00:00Z', 20);
    await entry(build!.task_id, org.userId, '2026-11-23T18:00:00Z', 15, { billable: false });
    await entry(build!.task_id, org.userId, '2026-11-23T19:00:00Z', 25, { deleted: true });
    await entry(build!.task_id, second, '2026-11-23T20:00:00Z', 0);

    const billable = await loadProgramMonthInputs(org.db, org.orgId, glove.programId, '2026-11');
    expect(billable.time).toEqual(
      expect.arrayContaining([
        { workDate: '2026-11-23', buildId: build!.task_id, variantId: build!.variant_id, minutes: 95 },
        { workDate: '2026-11-23', buildId: null, variantId: null, minutes: 31 },
        { workDate: '2026-11-23', buildId: null, variantId: null, minutes: 20 },
      ]),
    );
    expect(billable.time).toHaveLength(3);

    await org.query(`update pm.program_settings set hourly_time_basis = 'all' where program_id = $1`, [glove.programId]);
    const all = await loadProgramMonthInputs(org.db, org.orgId, glove.programId, '2026-11');
    expect(all.time.find((row) => row.buildId === build!.task_id)?.minutes).toBe(110);
    await org.query(`update pm.program_settings set hourly_time_basis = 'billable' where program_id = $1`, [glove.programId]);

    const hours = await loadBuildHoursByDay(org.db, org.orgId, { buildIds: [build!.task_id], timezone: 'America/Chicago', from: '2026-11-01', to: '2026-11-30' });
    expect(hours).toEqual([{ buildId: build!.task_id, workDate: '2026-11-23', minutes: 110, people: 2 }]);

    const prepTime = await loadPrepTimeByDay(org.db, org.orgId, { programId: glove.programId, timezone: 'America/Chicago', from: '2026-11-01', to: '2026-11-30', perTaskIds: [optIn!.id] });
    expect(prepTime).toEqual([
      { taskId: null, workDate: '2026-11-23', minutes: 31, people: 1 },
      { taskId: optIn!.id, workDate: '2026-11-23', minutes: 20, people: 1 },
    ]);
    const folded = await loadPrepTimeByDay(org.db, org.orgId, { programId: glove.programId, timezone: 'America/Chicago', from: '2026-11-01', to: '2026-11-30', perTaskIds: [] });
    expect(folded).toEqual([{ taskId: null, workDate: '2026-11-23', minutes: 51, people: 2 }]);
  });

  it('planned builds and recent days: live, not cancelled, in range, with per batch and per hour ledger rows', async () => {
    const ids = await org.query<{ task_id: string }>(
      `select b.task_id from pm.builds b join pm.tasks t on t.id = b.task_id
        where b.program_id = $1 and b.build_date = '2026-11-20' order by b.task_id limit 4`,
      [glove.programId],
    );
    const [, cancelled, , deleted] = ids.map((row) => row.task_id);
    const builds = await loadProgramBuilds(org.db, org.orgId, glove.programId, { from: '2026-11-01', to: '2026-11-30' });
    // 17 work days of 8 builds, less the cancelled one and the deleted one from the case above.
    expect(builds).toHaveLength(17 * 8 - 2);
    expect(builds.some((build) => build.id === cancelled || build.id === deleted)).toBe(false);
    expect(builds[0]).toMatchObject({ date: '2026-11-02', planned: '100.000', built: '100.000', rate: null });
    expect(builds.every((build) => build.date >= '2026-11-01' && build.date <= '2026-11-30')).toBe(true);
    expect(await loadProgramBuilds(org.db, org.orgId, glove.programId, { from: '2026-12-01', to: '2026-12-31' })).toEqual([]);

    await org.query(
      `insert into pm.program_ledger (org_id, program_id, ref, kind, charge_date, month, cents, quantity, unit_price, label, posting)
       values ($1, $2, $3, 'per_hour', '2026-11-20', '2026-11-01', 9000, 2, 45, 'Hourly work', 'program')`,
      [org.orgId, glove.programId, `pmf:${glove.programId}:hours:2026-11-20`],
    );
    const days = await loadTrailingDays(org.db, org.orgId, glove.programId, { from: '2026-11-18', before: '2026-11-21' });
    // The deleted build's output is left out; the cancelled build's output still counts; the monthly fee does not.
    const [{ cents: day20 }] = await org.query<{ cents: string }>(
      `select sum(o.revenue_cents)::text as cents from pm.build_output o join pm.tasks t on t.id = o.build_id and t.deleted_at is null
        where o.program_id = $1 and o.deleted_at is null and o.work_date = '2026-11-20'`,
      [glove.programId],
    ) as [{ cents: string }];
    expect(days.map((day) => day.date)).toEqual(['2026-11-18', '2026-11-19', '2026-11-20']);
    expect(days[2]).toEqual({ date: '2026-11-20', units: '700.000', cents: String(BigInt(day20) + BigInt(9000)) });
    expect(days[0]?.units).toBe('800.000');
  });

  it('returns empty inputs for an unknown program or a bad month', async () => {
    const missing = await loadProgramMonthInputs(org.db, org.orgId, '00000000-0000-4000-8000-000000000000', '2026-11');
    expect(missing.output).toEqual([]);
    expect(missing.versions).toEqual([]);
    const bad = await loadProgramMonthInputs(org.db, org.orgId, glove.programId, '2026-13');
    expect(bad.output).toEqual([]);
    expect(await readProgramMonth(org.db, org.orgId, glove.programId, 'nope')).toEqual({ output: [], ledger: [], settledThrough: null });
  });
});
