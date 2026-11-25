/**
 * Kind isolation across the project surfaces, scheduled automations on builds, run triggers,
 * undo of a log batch, goals that track a program, the customer strip and money in activity for
 * a viewer (docs/programs/SPEC.md 4.1, 4.9, 4.10, 9.2). Runs in a throwaway org on the program
 * clock fixed at 2026-11-25 (America/Chicago). Trigger guards KP101 to KP105 are covered by
 * `src/server/db/programs-schema.db.test.ts` (L1).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestOrg, databaseReady, type TestOrg } from '@/test/db';
import type { DomainContext } from '../_shared';

const ready = await databaseReady(['pm.projects', 'pm.builds', 'pm.build_output', 'pm.program_ledger', 'pm.automations', 'pm.saved_views', 'core.record_links']);

const addDays = (date: string, days: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

describe.skipIf(!ready)('programs: isolation, sweeps, undo, goals and customers', () => {
  let org: TestOrg;
  let owner: DomainContext;
  let member: DomainContext;
  let viewer: DomainContext;
  let programs: typeof import('./index');
  let projectsDomain: typeof import('../projects');
  let tasksDomain: typeof import('../tasks');
  let programId = '';
  let projectId = '';
  let spaceId = '';
  const variant: Record<string, string> = {};

  const one = async <T extends Record<string, unknown>>(text: string, values: unknown[] = []) => (await org.query<T>(text, values))[0]!;

  beforeAll(async () => {
    programs = await import('./index');
    projectsDomain = await import('../projects');
    tasksDomain = await import('../tasks');
    programs.setProgramClock(() => new Date('2026-11-25T15:00:00Z'));
    org = await createTestOrg('programs-isolation');
    owner = await org.member('owner', 'Maya Owner');
    member = await org.member('member', 'Sam Member');
    viewer = await org.member('member', 'Vic Viewer');
    await org.query(`insert into pm.org_calendar (org_id, timezone, working_days, holidays) values ($1, 'America/Chicago', '{1,2,3,4,5}', $2::jsonb)`, [org.orgId, JSON.stringify([{ date: '2026-11-26', name: 'Thanksgiving' }])]);
    const { createSpace } = await import('../spaces');
    spaceId = (await createSpace(owner, { name: 'Operations' })).id;
    const project = await projectsDomain.createProject(owner, { name: 'Frames', key: 'FRA', spaceId });
    projectId = project.id;
    const { createFixtureProgram } = await import('./fixture');
    await createFixtureProgram(owner, { key: 'GLOVE', startDate: '2026-11-25' });
    programId = (await one<{ id: string }>(`select id from pm.projects where org_id = $1 and key = 'GLOVE'`, [org.orgId])).id;
    for (const v of await org.query<{ id: string; key: string }>(`select id, key from pm.program_variants where program_id = $1`, [programId])) variant[v.key] = v.id;
    // Programs have no space in v1; even a row that points at one must not count on project surfaces.
    await org.query(`update pm.projects set space_id = $2 where id = $1`, [programId, spaceId]);
    await projectsDomain.addProjectMembers(owner, programId, [{ userId: viewer.userId, role: 'viewer' }]);
  });

  afterAll(async () => {
    programs?.resetProgramClock();
    await org?.destroy();
  });

  it('keeps programs out of the portfolio report, space counts, the template gallery and work views', async () => {
    const { getPortfolioReport } = await import('../portfolio');
    const report = await getPortfolioReport(owner);
    expect(report.scope.kind === 'portfolio' && report.scope.projectCount).toBe(1);
    const { listSpaces } = await import('../spaces');
    const space = (await listSpaces(owner)).find((s) => s.id === spaceId);
    expect(space?.projectCount).toBe(1);
    // Program templates never show in the project gallery.
    const saved = await programs.saveProgramTemplate(owner, 'GLOVE', { name: 'Glove kit program' });
    const { listTemplates } = await import('../templates');
    const gallery = await listTemplates(owner);
    expect(gallery.some((t) => t.id === saved.templateId)).toBe(false);
    expect((await programs.listProgramTemplates(owner)).some((t) => t.id === saved.templateId)).toBe(true);
    // Saved views: My Work never lists the directory or Floor today views.
    const views = await import('../views');
    const config = {} as never;
    await views.createSavedView(owner, { projectId: null, name: 'Mine', type: 'list', config });
    await views.createSavedView(owner, { projectId: null, name: 'At risk programs', type: 'list', config, surface: 'programs' });
    await views.createSavedView(owner, { projectId: null, name: 'Floor A', type: 'list', config, surface: 'floor' });
    expect((await views.listSavedViews(owner, null)).map((v) => v.name)).toEqual(['Mine']);
    expect((await views.listSavedViews(owner, null, { surface: 'programs' })).map((v) => v.name)).toEqual(['At risk programs']);
    expect((await views.listSavedViews(owner, null, { surface: 'floor' })).map((v) => v.name)).toEqual(['Floor A']);
  });

  it('never runs a workspace due date rule on builds', async () => {
    const { createAutomation } = await import('../automations');
    const { sweepAutomations } = await import('../automation-sweep');
    const { todayIso } = await import('@/lib/dates');
    const soon = addDays(todayIso(), 1);
    const task = await tasksDomain.createTask(owner, { projectId, title: 'Order frame steel', dueDate: soon });
    const build = await programs.createBuild(owner, 'GLOVE', { variantId: variant['S-BR'], buildDate: soon, plannedQty: '25' });
    const rule = await createAutomation(owner, {
      projectId: null,
      name: 'Heads-up two days before something is due',
      trigger: { type: 'due_date_approaching', days: 2 },
      actions: [{ type: 'notify', target: 'assignee' }],
    });
    await sweepAutomations(owner, { force: true });
    const runs = await org.query<{ task_id: string; kind: string }>(
      `select r.task_id::text, t.kind from pm.automation_runs r join pm.tasks t on t.id = r.task_id where r.automation_id = $1`,
      [rule.id],
    );
    expect(runs.some((r) => r.task_id === task.id)).toBe(true);
    expect(runs.some((r) => r.task_id === build.id)).toBe(false);
    expect(runs.every((r) => r.kind === 'task')).toBe(true);
    await org.query(`update pm.automations set enabled = false where id = $1`, [rule.id]);
  });

  it('fires run triggers once per run (done) and once per run per day (below plan)', async () => {
    const { createAutomation } = await import('../automations');
    const { runTriggers, runShortPercent } = await import('./sweep');
    expect(runShortPercent('100.000', '40.000')).toBe(60);
    expect(runShortPercent('100.000', '120.000')).toBe(0);
    const done = await createAutomation(owner, { projectId: programId, name: 'Run finished', trigger: { type: 'run_done' }, actions: [{ type: 'notify', target: 'project_owner' }] });
    const below = await createAutomation(owner, { projectId: null, name: 'Run behind', trigger: { type: 'run_below_plan', percent: 50, at: '08:00' }, actions: [{ type: 'notify', target: 'project_owner' }] });
    // A manual run of two builds, both filled (auto done when full).
    const a = await programs.createBuild(owner, 'GLOVE', { variantId: variant['M-BR'], buildDate: '2026-11-25', plannedQty: '10' });
    const b = await programs.createBuild(owner, 'GLOVE', { variantId: variant['L-BR'], buildDate: '2026-11-25', plannedQty: '10' });
    await programs.logOutput(owner, 'GLOVE', { date: '2026-11-25', entries: [{ buildId: a.id, mode: 'add', qty: '10' }, { buildId: b.id, mode: 'add', qty: '10' }] });
    const program = { id: programId, key: 'GLOVE' };
    await runTriggers(owner, program, 'America/Chicago', '2026-11-25');
    await runTriggers(owner, program, 'America/Chicago', '2026-11-25');
    const doneRuns = await org.query<{ dedupe: string }>(`select detail ->> 'dedupe' as dedupe from pm.automation_runs where automation_id = $1`, [done.id]);
    expect(doneRuns.map((r) => r.dedupe)).toEqual(['run_done:run:manual:2026-11-25']);
    // The run's first build changes (reorder or delete): the run still fired once.
    await org.query(`update pm.automation_runs set task_id = case when task_id = $2::uuid then $3::uuid else $2::uuid end where automation_id = $1`, [done.id, a.id, b.id]);
    await runTriggers(owner, program, 'America/Chicago', '2026-11-25');
    expect((await one<{ n: number }>(`select count(*)::int as n from pm.automation_runs where automation_id = $1`, [done.id])).n).toBe(1);
    // The scheduled run of the day has no output yet: 100 percent below plan, past 08:00 program time.
    const belowRuns = await org.query<{ dedupe: string; event: string }>(`select detail ->> 'dedupe' as dedupe, detail ->> 'event' as event from pm.automation_runs where automation_id = $1`, [below.id]);
    expect(belowRuns.length).toBe(1);
    expect(belowRuns[0]!.event).toBe('run_below_plan');
    expect(belowRuns[0]!.dedupe).toMatch(/^run_below_plan:run:[0-9a-f-]{36}:2026-11-25:2026-11-25$/);
    await org.query(`update pm.automations set enabled = false where id = any($1::uuid[])`, [[done.id, below.id]]);
  });

  it('undoes a batch only for builds of this container, in one transaction', async () => {
    const date = '2026-11-25';
    const logged = await programs.logOutput(owner, 'GLOVE', { date, entries: [{ newBuild: { variantId: variant['XL-YE']! }, qty: '7' }] });
    expect(logged.createdBuildIds.length).toBe(1);
    const created = logged.createdBuildIds[0]!;
    // A project's sheet cannot remove a program's output.
    await expect(programs.undoLogOutput(owner, 'FRA', { date, entries: [], createdBuildIds: [created] })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // A planned build is not something a batch created.
    const planned = await one<{ id: string }>(`select task_id::text as id from pm.builds where program_id = $1 and planned_from = 'schedule' limit 1`, [programId]);
    await expect(programs.undoLogOutput(owner, 'GLOVE', { date, entries: [], createdBuildIds: [planned.id] })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await one<{ n: number }>(`select count(*)::int as n from pm.build_output where build_id = $1 and deleted_at is null`, [created])).n).toBe(1);
    await programs.undoLogOutput(owner, 'GLOVE', logged.undo);
    const after = await one<{ live: number; built: string; deleted: boolean }>(
      `select (select count(*)::int from pm.build_output o where o.build_id = b.task_id and o.deleted_at is null) as live, b.built_qty::text as built, t.deleted_at is not null as deleted
         from pm.builds b join pm.tasks t on t.id = b.task_id where b.task_id = $1`,
      [created],
    );
    expect(after).toEqual({ live: 0, built: '0.000', deleted: true });
  });

  it('refuses to undo a created build that has output on another day or time logged', async () => {
    const date = '2026-11-25';
    const logged = await programs.logOutput(owner, 'GLOVE', { date, entries: [{ newBuild: { variantId: variant['XL-YE']! }, qty: '5' }] });
    const created = logged.createdBuildIds[0]!;
    // The same build gets output on another day after the batch.
    await programs.logOutput(owner, 'GLOVE', { date: '2026-11-24', entries: [{ buildId: created, mode: 'add', qty: '3' }] });
    await expect(programs.undoLogOutput(owner, 'GLOVE', logged.undo)).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'This build has output on other days. Remove that output first.',
    });
    // Nothing changed: the build and both days are still live.
    const kept = await one<{ live: number; deleted: boolean }>(
      `select (select count(*)::int from pm.build_output o where o.build_id = t.id and o.deleted_at is null) as live, t.deleted_at is not null as deleted from pm.tasks t where t.id = $1`,
      [created],
    );
    expect(kept).toEqual({ live: 2, deleted: false });
    // Once the other day is removed, time on the build still blocks the undo.
    await org.query(`update pm.build_output set deleted_at = now() where build_id = $1 and work_date = '2026-11-24'`, [created]);
    const entry = await one<{ id: string }>(
      `insert into pm.time_entries (org_id, project_id, task_id, user_id, started_at, ended_at, duration_minutes, billable, source)
       values ($1, $2, $3, $4, '2026-11-25T16:00:00Z', '2026-11-25T17:00:00Z', 60, true, 'manual') returning id::text as id`,
      [org.orgId, programId, created, owner.userId],
    );
    await expect(programs.undoLogOutput(owner, 'GLOVE', logged.undo)).rejects.toMatchObject({ code: 'CONFLICT', message: 'This build has time logged. Remove that time first.' });
    await org.query(`update pm.time_entries set deleted_at = now() where id = $1`, [entry.id]);
    await programs.undoLogOutput(owner, 'GLOVE', logged.undo);
    expect((await one<{ deleted: boolean }>(`select deleted_at is not null as deleted from pm.tasks where id = $1`, [created])).deleted).toBe(true);
  });

  it('tracks a program on a goal with its percent of target, capped at 100', async () => {
    const goals = await import('../goals');
    expect(goals.programGoalPercent(null)).toBe(0);
    expect(goals.programGoalPercent(4250)).toBe(42);
    expect(goals.programGoalPercent(13000)).toBe(100);
    const goal = await goals.createGoal(owner, { name: 'Glove revenue', progressMode: 'projects' });
    const linked = await goals.linkGoalProject(owner, goal.id, programId, true);
    const [item] = await programs.listPrograms(owner, { ids: [programId] });
    expect(item!.month.targetBp).not.toBeNull();
    expect(linked.progress).toBe(goals.programGoalPercent(item!.month.targetBp));
    // A viewer who cannot see money gets a units percent, never a percent of the money target.
    expect(goals.programGoalUnitsPercent('0', 10)).toBe(0);
    expect(goals.programGoalUnitsPercent('5', 10)).toBe(50);
    expect(goals.programGoalUnitsPercent('30', 10)).toBe(100);
    expect(goals.programGoalUnitsPercent('5', null)).toBe(0);
    const [hidden] = await programs.listPrograms(viewer, { ids: [programId] });
    expect(hidden!.moneyHidden).toBe(true);
    expect(hidden!.month.targetBp).toBeNull();
    await org.query(`update pm.program_settings set daily_target_units = 40 where program_id = $1`, [programId]);
    try {
      const { programMonthStats } = await import('./stats');
      const { workDaysInMonth } = await import('@kitstak/programs-engine/calendar');
      const { db } = await import('@/server/db');
      const settings = await one<{ timezone: string; monthly_target_cents: string | null }>(`select timezone, monthly_target_cents::text from pm.program_settings where program_id = $1`, [programId]);
      const stats = await programMonthStats(db, viewer, { id: programId }, { timezone: settings.timezone, monthlyTargetCents: settings.monthly_target_cents === null ? null : BigInt(settings.monthly_target_cents), dailyTargetUnits: '40.000' });
      const expected = goals.programGoalUnitsPercent(stats.result.units, 40 * workDaysInMonth(stats.calendar, stats.month).length);
      const seen = await goals.getGoal(viewer, goal.id);
      expect(seen.progress).toBe(expected);
    } finally {
      await org.query(`update pm.program_settings set daily_target_units = null where program_id = $1`, [programId]);
    }
  });

  it('lists the customer programs for the customer strip with the directory numbers', async () => {
    const customerId = randomUUID();
    await org.query(`insert into core.customers (id, org_id, code, name) values ($1, $2, 'GRIP', 'Gripwell')`, [customerId, org.orgId]);
    await org.query(`update pm.projects set crm_customer_id = $2 where id = $1`, [programId, customerId]);
    const { programsForCustomer } = await import('@/server/integrations/customer360');
    const [entry] = await programsForCustomer(owner, { customerId, accountId: null });
    const [item] = await programs.listPrograms(owner, { ids: [programId] });
    expect(entry?.key).toBe('GLOVE');
    expect(entry?.url).toBe('/programs/GLOVE');
    expect(entry?.monthUnits).toBe(item!.month.units);
    expect(entry?.revenueCents).toBe(item!.month.revenueCents);
    expect(entry?.revenueCents).not.toBeNull();
    const [hidden] = await programsForCustomer(member, { customerId, accountId: null });
    expect(hidden === undefined || (hidden.moneyHidden && hidden.revenueCents === null)).toBe(true);
  });

  it('keeps ledger rows posted to a job in a month closed in Pulse, after the job is gone', async () => {
    const hasPulse = (await org.query<{ ok: boolean }>(`select to_regclass('pulse.periods') is not null as ok`))[0]?.ok;
    if (!hasPulse) return;
    const jobId = randomUUID();
    // November was posted to a job and Pulse closed it; the program link is gone since (posting is `program` now).
    const setup = await one<{ id: string; ref: string }>(`select id::text, ref from pm.program_ledger where program_id = $1 and kind = 'setup' and deleted_at is null`, [programId]);
    await org.query(`update pm.program_ledger set posting = 'program_job', pulse_job_id = $2, cents = 999 where id = $1`, [setup.id, jobId]);
    const stale = await one<{ id: string }>(
      `insert into pm.program_ledger (org_id, program_id, ref, kind, charge_date, month, cents, quantity, unit_price, label, counts_toward_minimum, posting, pulse_job_id, computed_at)
       values ($1, $2, 'pmf:test:gone', 'adjustment', '2026-11-20', '2026-11-01', 500, 1, 5, 'Old job adjustment', false, 'program_job', $3, now()) returning id::text`,
      [org.orgId, programId, jobId],
    );
    await org.query(`insert into pulse.periods (org_id, period_month, status, closed_at) values ($1, '2026-11-01', 'closed', now())`, [org.orgId]);
    const { resetPulseLockCache } = await import('./locks');
    resetPulseLockCache();
    try {
      const b = await programs.createBuild(owner, 'GLOVE', { variantId: variant['S-YE'], buildDate: '2026-11-25', plannedQty: '5' });
      await programs.logOutput(owner, 'GLOVE', { date: '2026-11-25', entries: [{ buildId: b.id, mode: 'add', qty: '2' }] });
      const kept = await org.query<{ id: string; posting: string; cents: string; deleted: boolean }>(
        `select id::text, posting, cents::text, deleted_at is not null as deleted from pm.program_ledger where id = any($1::uuid[]) order by cents`,
        [[setup.id, stale.id]],
      );
      expect(kept).toEqual([
        { id: stale.id, posting: 'program_job', cents: '500', deleted: false },
        { id: setup.id, posting: 'program_job', cents: '999', deleted: false },
      ]);
    } finally {
      await org.query(`delete from pulse.periods where org_id = $1`, [org.orgId]);
      resetPulseLockCache();
    }
  });

  it('shows a program viewer no money keys in activity rows', async () => {
    const { listProjectActivity } = await import('../activity');
    const page = await listProjectActivity(viewer, programId, { verbs: ['build.output_logged'] });
    expect(page.items.length).toBeGreaterThan(0);
    for (const item of page.items) {
      expect(JSON.stringify(item.before ?? null)).not.toContain('money');
      expect(JSON.stringify(item.after ?? null)).not.toContain('money');
      expect(JSON.stringify(item.meta ?? null)).not.toContain('money');
    }
    const ownerPage = await listProjectActivity(owner, programId, { verbs: ['build.output_logged'] });
    expect(JSON.stringify(ownerPage.items[0]?.after)).toContain('money');
  });
});
