/**
 * Schedules, the sweep, Pulse job links, builds in projects, moves and generic task callers
 * (docs/programs/SPEC.md 9.2), in a throwaway org on the program clock fixed at 2026-11-25.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestOrg, databaseReady, type TestOrg } from '@/test/db';
import type { DomainContext } from '../_shared';

const ready = await databaseReady(['pm.projects', 'pm.builds', 'pm.build_output', 'pm.program_ledger', 'core.record_links']);

describe.skipIf(!ready)('programs: schedules, jobs, projects and moves', () => {
  let org: TestOrg;
  let owner: DomainContext;
  let programs: typeof import('./index');
  let tasksDomain: typeof import('../tasks');
  let projectsDomain: typeof import('../projects');
  let triage: typeof import('../triage');
  let time: typeof import('../time');
  let programId = '';
  let projectId = '';
  const variant: Record<string, string> = {};
  let pulse = false;

  const count = async (text: string, values: unknown[]) => Number((await org.query<{ n: number }>(text, values))[0]?.n ?? 0);

  /** A minimal ongoing per unit Pulse job with a dated price (only when Pulse is installed). */
  async function pulseJob(number: string, price: string): Promise<string> {
    const site = randomUUID();
    const client = randomUUID();
    const type = randomUUID();
    const job = randomUUID();
    await org.query(`insert into pulse.sites (id, org_id, code, name, timezone) values ($1, $2, $3, 'Main', 'America/Chicago')`, [site, org.orgId, `S${number}`]);
    await org.query(`insert into pulse.clients (id, org_id, code, name) values ($1, $2, $3, 'Gripwell')`, [client, org.orgId, `C${number}`]);
    await org.query(`insert into pulse.job_types (id, org_id, code, name) values ($1, $2, $3, 'Kitting')`, [type, org.orgId, `T${number}`]);
    await org.query(`insert into pulse.jobs (id, org_id, number, name, client_id, job_type_id, site_id, kind, status, pricing_model, unit_label, unit_price) values ($1, $2, $3, 'Glove job', $4, $5, $6, 'ongoing', 'active', 'per_unit', 'kits', $7)`, [job, org.orgId, number, client, type, site, price]);
    await org.query(`insert into pulse.job_prices (org_id, job_id, effective_from, unit_price) values ($1, $2, '2026-01-01', $3)`, [org.orgId, job, price]);
    return job;
  }

  beforeAll(async () => {
    programs = await import('./index');
    tasksDomain = await import('../tasks');
    projectsDomain = await import('../projects');
    triage = await import('../triage');
    time = await import('../time');
    programs.setProgramClock(() => new Date('2026-11-25T15:00:00Z'));
    org = await createTestOrg('programs-plan');
    owner = await org.member('owner', 'Maya Owner');
    await org.query(`insert into pm.org_calendar (org_id, timezone, working_days, holidays) values ($1, 'America/Chicago', '{1,2,3,4,5}', $2::jsonb)`, [org.orgId, JSON.stringify([{ date: '2026-11-26', name: 'Thanksgiving' }])]);
    const { createFixtureProgram } = await import('./fixture');
    await createFixtureProgram(owner, { key: 'PLAN', startDate: '2026-11-25' });
    programId = (await org.query<{ id: string }>(`select id from pm.projects where org_id = $1 and key = 'PLAN'`, [org.orgId]))[0]!.id;
    for (const v of await org.query<{ id: string; key: string }>(`select id, key from pm.program_variants where program_id = $1`, [programId])) variant[v.key] = v.id;
    projectId = (await projectsDomain.createProject(owner, { name: 'Frames', key: 'FRM' })).id;
    pulse = (await org.query<{ ok: boolean }>(`select to_regclass('pulse.jobs') is not null and to_regclass('pulse.job_types') is not null as ok`))[0]?.ok === true;
  });

  afterAll(async () => {
    programs?.resetProgramClock();
    await org?.destroy();
  });

  it('runs the sweep twice and in parallel without making builds twice', async () => {
    const before = await count(`select count(*)::int as n from pm.builds where program_id = $1`, [programId]);
    expect(before).toBe(40);
    await Promise.all([programs.runProgramSweep(owner), programs.runProgramSweep(owner)]);
    await programs.runProgramSweep(owner);
    expect(await count(`select count(*)::int as n from pm.builds where program_id = $1`, [programId])).toBe(40);
  });

  it('never brings back a deleted generated build', async () => {
    const [row] = await org.query<{ id: string }>(`select task_id::text as id from pm.builds where program_id = $1 and build_date = '2026-12-01' limit 1`, [programId]);
    await tasksDomain.deleteTasks(owner, [row!.id]);
    const schedule = (await org.query<{ id: string }>(`select id from pm.build_schedules where program_id = $1`, [programId]))[0]!;
    await org.query(`update pm.build_schedules set generated_through = '2026-11-24' where id = $1`, [schedule.id]);
    await programs.runScheduleGeneration(owner, { programId });
    expect(await count(`select count(*)::int as n from pm.builds b join pm.tasks t on t.id = b.task_id where b.program_id = $1 and t.deleted_at is null`, [programId])).toBe(39);
  });

  it('regenerates untouched future builds with a new qty and gives Saturday its own qty', async () => {
    const [schedule] = await programs.listSchedules(owner, 'PLAN');
    const lines = schedule!.lines.map((line) => ({ variantId: line.variantId, qty: '120', qtyByWeekday: { '6': '60' } }));
    const updated = await programs.updateSchedule(owner, schedule!.id, { lines, pattern: 'custom_days', days: [1, 2, 3, 4, 5, 6] }, schedule!.version, { regenerateFuture: true });
    expect(updated.lines[0]!.qty).toBe('120.000');
    const future = await org.query<{ build_date: string; planned_qty: string; n: number }>(
      `select b.build_date::text, b.planned_qty::text, count(*)::int as n from pm.builds b join pm.tasks t on t.id = b.task_id
        where b.program_id = $1 and t.deleted_at is null and b.build_date > '2026-11-25' group by 1, 2 order by 1`,
      [programId],
    );
    expect(future.find((r) => r.build_date === '2026-11-27')).toEqual({ build_date: '2026-11-27', planned_qty: '120.000', n: 8 });
    expect(future.find((r) => r.build_date === '2026-11-28')).toEqual({ build_date: '2026-11-28', planned_qty: '60.000', n: 8 });
    // Today's builds were not touched (they are dated today, not after it).
    expect(await count(`select count(*)::int as n from pm.builds where program_id = $1 and build_date = '2026-11-25' and planned_qty = 100`, [programId])).toBe(8);
  });

  it('prices a project build at its job price and posts build_job; with no job it is not billed', async () => {
    const plain = await programs.createBuild(owner, 'FRM', { buildDate: '2026-11-25', plannedQty: '10', title: 'Frames batch' });
    await programs.logOutput(owner, 'FRM', { date: '2026-11-25', entries: [{ buildId: plain.id, mode: 'add', qty: '4' }] });
    const unbilled = (await org.query<{ posting: string; price_source: string; unit_price: string }>(`select posting, price_source, unit_price::text from pm.build_output where build_id = $1`, [plain.id]))[0]!;
    expect(unbilled).toEqual({ posting: 'unbilled', price_source: 'none', unit_price: '0.0000' });
    if (!pulse) return;
    const job = await pulseJob('J-9001', '3.2500');
    const billed = await programs.createBuild(owner, 'FRM', { buildDate: '2026-11-25', plannedQty: '10', title: 'Billed frames' });
    await programs.linkPulseJob(owner, { buildId: billed.id }, job);
    await programs.logOutput(owner, 'FRM', { date: '2026-11-25', entries: [{ buildId: billed.id, mode: 'add', qty: '4' }] });
    const row = (await org.query<{ posting: string; price_source: string; unit_price: string; revenue_cents: string; pulse_job_id: string }>(`select posting, price_source, unit_price::text, revenue_cents::text, pulse_job_id::text from pm.build_output where build_id = $1`, [billed.id]))[0]!;
    expect(row).toEqual({ posting: 'build_job', price_source: 'job', unit_price: '3.2500', revenue_cents: '1300', pulse_job_id: job });
  });

  it('links a program job, reposts open rows, and refuses a second program on the same job', async () => {
    if (!pulse) return;
    const [b] = await org.query<{ id: string }>(`select b.task_id::text as id from pm.builds b join pm.program_variants v on v.id = b.variant_id
        where b.program_id = $1 and b.build_date = '2026-11-25' and v.key not like 'XL-%' order by v.key limit 1`, [programId]);
    await programs.logOutput(owner, 'PLAN', { date: '2026-11-25', entries: [{ buildId: b!.id, mode: 'add', qty: '10' }] });
    const job = await pulseJob('J-9002', '1.0000');
    const result = await programs.linkPulseJob(owner, { programKey: 'PLAN' }, job);
    expect(result.repostedRows).toBe(1);
    const row = (await org.query<{ posting: string; unit_price: string }>(`select posting, unit_price::text from pm.build_output where build_id = $1`, [b!.id]))[0]!;
    // The card price still wins over the job price; only the posting moves.
    expect(row).toEqual({ posting: 'program_job', unit_price: '1.9500' });
    const fees = await org.query<{ posting: string }>(`select distinct posting from pm.program_ledger where program_id = $1 and deleted_at is null`, [programId]);
    expect(fees.map((f) => f.posting)).toEqual(['program_job']);
    const { createFixtureProgram } = await import('./fixture');
    await createFixtureProgram(owner, { key: 'OTHR', startDate: '2026-11-25', withSchedule: false });
    await expect(programs.linkPulseJob(owner, { programKey: 'OTHR' }, job)).rejects.toThrow('This job already takes revenue from another program.');
    await programs.unlinkPulseJob(owner, { programKey: 'PLAN' });
    const back = (await org.query<{ posting: string }>(`select posting from pm.build_output where build_id = $1`, [b!.id]))[0]!;
    expect(back.posting).toBe('program');
  });

  it('moves a project build into a program, which adopts the card for open days', async () => {
    const b = await programs.createBuild(owner, 'FRM', { buildDate: '2026-11-25', plannedQty: '10', title: 'Gloves made in a project' });
    await programs.logOutput(owner, 'FRM', { date: '2026-11-25', entries: [{ buildId: b.id, mode: 'add', qty: '2' }] });
    const moved = await programs.moveBuild(owner, b.id, { toContainerKey: 'PLAN', variantId: variant['XL-BR'] });
    expect(moved.build.containerKind).toBe('program');
    expect(moved.projectKey).toBe('PLAN');
    const row = (await org.query<{ unit_price: string; price_source: string; program_id: string }>(`select unit_price::text, price_source, program_id::text from pm.build_output where build_id = $1`, [b.id]))[0]!;
    expect(row).toEqual({ unit_price: '2.2000', price_source: 'variant', program_id: programId });
  });

  it('keeps generic callers making tasks, refuses builds where they do not belong', async () => {
    const task = await tasksDomain.createTask(owner, { projectId: programId, title: 'Order more glove bags' });
    expect(task.kind).toBe('task');
    const [build] = await org.query<{ id: string }>(`select task_id::text as id from pm.builds where program_id = $1 limit 1`, [programId]);
    await expect(tasksDomain.moveTaskToProject(owner, build!.id, projectId)).rejects.toThrow('Use Move to program or Move to project for builds.');
    // A triage accept into a program makes a task.
    const item = await triage.createTriageItem(owner, { projectId: programId, title: 'Check the glove supplier', source: 'manual' } as never);
    const accepted = await triage.acceptTriageItem(owner, item.id);
    expect(accepted.task.kind).toBe('task');
  });

  it('makes a build from a build form and a task from a task form', async () => {
    const forms = await import('../forms');
    const buildForm = await forms.createForm(owner, {
      projectId: programId,
      name: 'Request a glove build',
      isPublic: true,
      fields: [
        { id: 'kit', label: 'Kit', type: 'short_text', required: true },
        { id: 'qty', label: 'How many', type: 'number', required: true },
      ],
      settings: { build: { variantFieldId: 'kit', qtyFieldId: 'qty' } } as never,
    });
    const token = (await org.query<{ token: string }>(`select public_token as token from pm.forms where id = $1`, [buildForm.id]))[0]!.token;
    await forms.submitForm({ token, answers: { kit: 'Small Brown', qty: '25' } });
    const made = await org.query<{ kind: string; planned_qty: string; planned_from: string }>(
      `select t.kind, b.planned_qty::text, b.planned_from from pm.builds b join pm.tasks t on t.id = b.task_id where b.program_id = $1 and b.planned_from = 'form'`,
      [programId],
    );
    expect(made).toEqual([{ kind: 'build', planned_qty: '25.000', planned_from: 'form' }]);
    const taskForm = await forms.createForm(owner, { projectId: programId, name: 'Prep request', isPublic: true, fields: [{ id: 'what', label: 'What', type: 'short_text', required: true, mapTo: 'title' }] });
    const taskToken = (await org.query<{ token: string }>(`select public_token as token from pm.forms where id = $1`, [taskForm.id]))[0]!.token;
    await forms.submitForm({ token: taskToken, answers: { what: 'Order tape' } });
    const task = await org.query<{ kind: string }>(`select kind from pm.tasks where project_id = $1 and title = 'Order tape'`, [programId]);
    expect(task).toEqual([{ kind: 'task' }]);
  });

  it('refuses moving a task with time in a closed program month', async () => {
    const task = await tasksDomain.createTask(owner, { projectId: programId, title: 'Count bags' });
    await time.addManualTime(owner, { taskId: task.id, minutes: 30, date: '2026-11-03' });
    await org.query(`insert into pm.program_closes (org_id, program_id, month, total_cents, units, checklist, closed_by, closed_at) values ($1, $2, '2026-11-01', 0, 0, '{}'::jsonb, $3, now())`, [org.orgId, programId, owner.userId]);
    await expect(tasksDomain.moveTaskToProject(owner, task.id, projectId)).rejects.toThrow('This task has time in a closed month. Copy it instead.');
    await org.query(`update pm.program_closes set reopened_at = now(), reopened_by = $2, reopen_reason = 'test' where program_id = $1`, [programId, owner.userId]);
  });

  it('summarizes Floor today and the directory for the day', async () => {
    const floor = await programs.floorToday(owner, { date: '2026-11-25' });
    const plan = floor.programs.find((p) => p.key === 'PLAN');
    expect(plan?.runs.length).toBeGreaterThan(0);
    const list = await programs.listPrograms(owner);
    const item = list.find((p) => p.key === 'PLAN')!;
    expect(item.today.builds).toBeGreaterThan(0);
    expect(item.month.revenueCents).not.toBeNull();
  });
});
