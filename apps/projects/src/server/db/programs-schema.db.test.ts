/**
 * Projects 0006 against the live database (docs/programs/SPEC.md 2.2 and 9.2): the Drizzle mirror
 * matches the tables, the guard triggers raise KP101 to KP105, the finish trigger follows the
 * status, and the money CHECKs and keys hold. Every case runs in a throwaway org.
 */
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestOrg, databaseReady, sqlState, type TestOrg } from '@/test/db';
import * as schema from './schema';

const ready = await databaseReady(['pm.projects', 'pm.builds', 'pm.build_output', 'pm.program_ledger', 'core.organization']);

interface Fixture {
  readonly programId: string;
  readonly otherProgramId: string;
  readonly projectId: string;
  readonly todo: string;
  readonly building: string;
  readonly done: string;
  readonly cancelled: string;
  readonly projectTodo: string;
  readonly variantId: string;
  readonly otherVariantId: string;
}

const MIRRORED: Record<string, PgTable> = {
  org_calendar: schema.orgCalendar,
  program_settings: schema.programSettings,
  program_attributes: schema.programAttributes,
  program_variants: schema.programVariants,
  price_card_versions: schema.priceCardVersions,
  price_card_rules: schema.priceCardRules,
  price_card_lines: schema.priceCardLines,
  program_one_time_charges: schema.programOneTimeCharges,
  build_schedules: schema.buildSchedules,
  build_schedule_lines: schema.buildScheduleLines,
  builds: schema.builds,
  build_output: schema.buildOutput,
  program_ledger: schema.programLedger,
  program_closes: schema.programCloses,
  wizard_drafts: schema.wizardDrafts,
  projects: schema.projects,
  tasks: schema.tasks,
  templates: schema.templates,
  saved_views: schema.savedViews,
};

describe.skipIf(!ready)('Projects 0006 programs schema', () => {
  let org: TestOrg;
  let ownerId: string;
  let fx: Fixture;
  let taskNumber = 0;

  const one = async <T extends pg.QueryResultRow>(client: pg.PoolClient, text: string, values: unknown[] = []): Promise<T> =>
    (await client.query<T>(text, values)).rows[0] as T;

  /** Inserts a task (build or plain) and, for a build, its builds row, in one transaction. */
  const insertTask = async (
    client: pg.PoolClient,
    input: { projectId: string; statusId: string; kind?: 'task' | 'build'; parentId?: string | null; build?: { programId: string | null; variantId?: string | null; containerId?: string } | null },
  ): Promise<string> => {
    taskNumber += 1;
    const { rows } = await client.query<{ id: string }>(
      `insert into pm.tasks (org_id, project_id, number, title, status_id, position, kind, parent_task_id, due_date)
       values ($1, $2, $3, $4, $5, $6, $7, $8, '2026-11-25') returning id`,
      [org.orgId, input.projectId, taskNumber, `Task ${taskNumber}`, input.statusId, `p${String(taskNumber).padStart(5, '0')}`, input.kind ?? 'task', input.parentId ?? null],
    );
    const taskId = rows[0]!.id;
    if (input.build) {
      await client.query(
        `insert into pm.builds (task_id, org_id, container_id, program_id, variant_id, build_date, planned_qty)
         values ($1, $2, $3, $4, $5, '2026-11-25', 100)`,
        [taskId, org.orgId, input.build.containerId ?? input.projectId, input.build.programId, input.build.variantId ?? null],
      );
    }
    return taskId;
  };

  const newBuild = (programId = fx.programId, variantId: string | null = fx.variantId, statusId = fx.todo) =>
    org.tx((client) => insertTask(client, { projectId: programId, statusId, kind: 'build', build: { programId, variantId } }));

  const expectState = async (work: Promise<unknown>, code: string) => {
    let caught: unknown = null;
    try {
      await work;
    } catch (error) {
      caught = error;
    }
    expect(sqlState(caught)).toBe(code);
  };

  beforeAll(async () => {
    org = await createTestOrg('programs-schema');
    ownerId = (await org.member('owner')).userId;
    fx = await org.tx(async (client) => {
      const project = async (key: string, kind: string) =>
        (await one<{ id: string }>(client, `insert into pm.projects (org_id, key, name, kind, position, owner_id) values ($1, $2, $3, $4, 'a0', $5) returning id`, [org.orgId, key, key, kind, ownerId])).id;
      const programId = await project('GLOVE', 'program');
      const otherProgramId = await project('DUDE', 'program');
      const projectId = await project('FRA', 'project');
      const status = async (projectRow: string, name: string, category: string, isDefault = false) =>
        (await one<{ id: string }>(client, `insert into pm.statuses (org_id, project_id, name, category, position, is_default) values ($1, $2, $3, $4, 'a0', $5) returning id`, [org.orgId, projectRow, name, category, isDefault])).id;
      const todo = await status(programId, 'Planned', 'todo', true);
      const building = await status(programId, 'Building', 'in_progress');
      const done = await status(programId, 'Done', 'done');
      const cancelled = await status(programId, 'Cancelled', 'cancelled');
      await status(otherProgramId, 'Planned', 'todo', true);
      const projectTodo = await status(projectId, 'To do', 'todo', true);
      await client.query(`insert into pm.org_calendar (org_id) values ($1)`, [org.orgId]);
      await client.query(`insert into pm.program_settings (program_id, org_id, timezone) values ($1, $2, 'America/New_York'), ($3, $2, 'America/Chicago')`, [programId, org.orgId, otherProgramId]);
      const variant = async (programRow: string, key: string) =>
        (await one<{ id: string }>(client, `insert into pm.program_variants (org_id, program_id, key, name, position) values ($1, $2, $3, $3, 'a0') returning id`, [org.orgId, programRow, key])).id;
      const variantId = await variant(programId, 'S-BRN');
      const otherVariantId = await variant(otherProgramId, 'DUDE-1');
      return { programId, otherProgramId, projectId, todo, building, done, cancelled, projectTodo, variantId, otherVariantId };
    });
  });
  afterAll(async () => {
    await org?.destroy();
  });

  it('mirrors every column of the program tables and the kind and surface columns', async () => {
    for (const [table, mirror] of Object.entries(MIRRORED)) {
      const rows = await org.query<{ column_name: string }>(`select column_name from information_schema.columns where table_schema = 'pm' and table_name = $1`, [table]);
      const database = rows.map((row) => row.column_name).sort();
      const drizzle = getTableConfig(mirror).columns.map((column) => column.name).sort();
      expect({ table, columns: drizzle }).toEqual({ table, columns: database });
    }
  });

  it('defaults existing rows to project, task and work', async () => {
    const [row] = await org.query<{ kind: string }>(`select kind from pm.projects where id = $1`, [fx.projectId]);
    expect(row?.kind).toBe('project');
    const taskId = await org.tx((client) => insertTask(client, { projectId: fx.projectId, statusId: fx.projectTodo }));
    expect((await org.query<{ kind: string }>(`select kind from pm.tasks where id = $1`, [taskId]))[0]?.kind).toBe('task');
    const [view] = await org.query<{ surface: string }>(
      `insert into pm.saved_views (org_id, name, type, position) values ($1, 'Mine', 'list', 'a0') returning surface`,
      [org.orgId],
    );
    expect(view?.surface).toBe('work');
    const [template] = await org.query<{ kind: string }>(`insert into pm.templates (org_id, name, payload) values ($1, 'T', '{}'::jsonb) returning kind`, [org.orgId]);
    expect(template?.kind).toBe('project');
    await expectState(org.query(`update pm.saved_views set surface = 'nowhere' where org_id = $1`, [org.orgId]), '23514');
    await expectState(org.query(`insert into pm.projects (org_id, key, name, kind, position) values ($1, 'BAD', 'Bad', 'portfolio', 'a0')`, [org.orgId]), '23514');
  });

  it('accepts the program notification kind', async () => {
    await expect(
      org.query(`insert into pm.notifications (org_id, user_id, kind, title) values ($1, $2, 'program', 'GLOVE is below its minimum')`, [org.orgId, ownerId]),
    ).resolves.toBeDefined();
  });

  it('KP101: a build is never a subtask', async () => {
    const parent = await org.tx((client) => insertTask(client, { projectId: fx.programId, statusId: fx.todo }));
    await expectState(
      org.tx((client) => insertTask(client, { projectId: fx.programId, statusId: fx.todo, kind: 'build', parentId: parent, build: { programId: fx.programId } })),
      'KP101',
    );
    const build = await newBuild();
    await expectState(org.query(`update pm.tasks set parent_task_id = $2 where id = $1`, [build, parent]), 'KP101');
    // A subtask of a build is a task, which is fine.
    await expect(org.tx((client) => insertTask(client, { projectId: fx.programId, statusId: fx.todo, parentId: build }))).resolves.toBeTypeOf('string');
  });

  it('KP102: a project never changes kind', async () => {
    await expectState(org.query(`update pm.projects set kind = 'program' where id = $1`, [fx.projectId]), 'KP102');
    await expectState(org.query(`update pm.projects set kind = 'project' where id = $1`, [fx.programId]), 'KP102');
    await expect(org.query(`update pm.projects set kind = 'program', name = 'Same kind' where id = $1`, [fx.programId])).resolves.toBeDefined();
  });

  it('KP103: a task never changes kind', async () => {
    const taskId = await org.tx((client) => insertTask(client, { projectId: fx.programId, statusId: fx.todo }));
    await expectState(org.query(`update pm.tasks set kind = 'build' where id = $1`, [taskId]), 'KP103');
    const build = await newBuild();
    await expectState(org.query(`update pm.tasks set kind = 'task' where id = $1`, [build]), 'KP103');
  });

  it('KP104: a build moves only through the domain flag, and the builds row must follow', async () => {
    const build = await newBuild();
    await expectState(org.query(`update pm.tasks set project_id = $2 where id = $1`, [build, fx.projectId]), 'KP104');
    // With the flag but without moving the builds row: refused at commit (KP105).
    await expectState(
      org.tx(async (client) => {
        await client.query(`select set_config('pm.build_move', 'on', true)`);
        await client.query(`update pm.tasks set project_id = $2, status_id = $3 where id = $1`, [build, fx.projectId, fx.projectTodo]);
      }),
      'KP105',
    );
    // The domain path: flag, builds row first, then the task (deferred check at commit).
    await org.tx(async (client) => {
      await client.query(`select set_config('pm.build_move', 'on', true)`);
      await client.query(`update pm.builds set container_id = $2, program_id = null, variant_id = null where task_id = $1`, [build, fx.projectId]);
      await client.query(`update pm.tasks set project_id = $2, status_id = $3 where id = $1`, [build, fx.projectId, fx.projectTodo]);
    });
    const [moved] = await org.query<{ container_id: string; program_id: string | null }>(`select container_id, program_id from pm.builds where task_id = $1`, [build]);
    expect(moved).toEqual({ container_id: fx.projectId, program_id: null });
    // The flag is transaction local: the next plain update is refused again.
    await expectState(org.query(`update pm.tasks set project_id = $2 where id = $1`, [build, fx.programId]), 'KP104');
  });

  it('KP105: the builds row matches its task', async () => {
    // A build task with no builds row.
    await expectState(org.tx((client) => insertTask(client, { projectId: fx.programId, statusId: fx.todo, kind: 'build' })), 'KP105');
    // A builds row for a plain task.
    await expectState(org.tx((client) => insertTask(client, { projectId: fx.programId, statusId: fx.todo, kind: 'task', build: { programId: fx.programId } })), 'KP105');
    // Container is not the task's project.
    await expectState(
      org.tx((client) => insertTask(client, { projectId: fx.programId, statusId: fx.todo, kind: 'build', build: { programId: fx.programId, containerId: fx.otherProgramId } })),
      'KP105',
    );
    // In a program the program id must be the container.
    await expectState(org.tx((client) => insertTask(client, { projectId: fx.programId, statusId: fx.todo, kind: 'build', build: { programId: null } })), 'KP105');
    // In a project there is no program.
    await expectState(
      org.tx((client) => insertTask(client, { projectId: fx.projectId, statusId: fx.projectTodo, kind: 'build', build: { programId: fx.projectId, variantId: null } })),
      'KP105',
    );
    // A variant of another program.
    await expectState(newBuild(fx.programId, fx.otherVariantId), 'KP105');
    const build = await newBuild();
    await expectState(org.query(`update pm.builds set variant_id = $2 where task_id = $1`, [build, fx.otherVariantId]), 'KP105');
  });

  it('allows builds in a project with no program and no variant', async () => {
    const build = await org.tx((client) => insertTask(client, { projectId: fx.projectId, statusId: fx.projectTodo, kind: 'build', build: { programId: null } }));
    expect((await org.query(`select 1 from pm.builds where task_id = $1 and program_id is null`, [build])).length).toBe(1);
    await expectState(org.query(`update pm.builds set variant_id = $2 where task_id = $1`, [build, fx.variantId]), '23514');
  });

  it('refuses a recurrence on a build', async () => {
    const build = await newBuild();
    await expectState(org.query(`update pm.tasks set recurrence = '{"frequency":"daily","interval":1}'::jsonb where id = $1`, [build]), '23514');
  });

  it('finish trigger: done sets the finish days in the program zone, leaving done clears only finished_on', async () => {
    const build = await newBuild();
    const read = async () =>
      (await org.query<{ first: string | null; finished: string | null; today: string }>(
        `select first_finished_on::text as first, finished_on::text as finished, (now() at time zone 'America/New_York')::date::text as today from pm.builds where task_id = $1`,
        [build],
      ))[0]!;
    expect(await read()).toMatchObject({ first: null, finished: null });
    await org.query(`update pm.tasks set status_id = $2 where id = $1`, [build, fx.building]);
    expect((await read()).finished).toBeNull();
    await org.query(`update pm.tasks set status_id = $2, completed_at = now() where id = $1`, [build, fx.done]);
    const finished = await read();
    expect(finished.first).toBe(finished.today);
    expect(finished.finished).toBe(finished.today);
    await org.query(`update pm.tasks set status_id = $2, completed_at = null where id = $1`, [build, fx.todo]);
    expect(await read()).toMatchObject({ first: finished.today, finished: null });
    // Re finishing charges on the first finish day.
    await org.query(`update pm.builds set first_finished_on = '2026-10-30' where task_id = $1`, [build]);
    await org.query(`update pm.tasks set status_id = $2 where id = $1`, [build, fx.done]);
    expect(await read()).toMatchObject({ first: '2026-10-30', finished: '2026-10-30' });
    // Cancelled is not done.
    await org.query(`update pm.tasks set status_id = $2 where id = $1`, [build, fx.cancelled]);
    expect((await read()).finished).toBeNull();
  });

  it('finish trigger: a finish change bumps the builds version, so a stale write gets a conflict', async () => {
    const build = await newBuild();
    const version = async () => (await org.query<{ version: number }>(`select version from pm.builds where task_id = $1`, [build]))[0]!.version;
    const start = await version();
    await org.query(`update pm.tasks set status_id = $2 where id = $1`, [build, fx.building]);
    expect(await version()).toBe(start);
    await org.query(`update pm.tasks set status_id = $2 where id = $1`, [build, fx.done]);
    expect(await version()).toBe(start + 1);
    await org.query(`update pm.tasks set status_id = $2 where id = $1`, [build, fx.todo]);
    expect(await version()).toBe(start + 2);
    // A client still holding the first version writes nothing (8.4).
    const stale = await org.query(`update pm.builds set planned_qty = planned_qty where task_id = $1 and version = $2 returning task_id`, [build, start]);
    expect(stale).toHaveLength(0);
  });

  it('finish trigger: a build made in a done status starts finished', async () => {
    const build = await newBuild(fx.programId, fx.variantId, fx.done);
    const [row] = await org.query<{ first: string | null; finished: string | null; today: string }>(
      `select first_finished_on::text as first, finished_on::text as finished, (now() at time zone 'America/New_York')::date::text as today from pm.builds where task_id = $1`,
      [build],
    );
    expect(row?.first).toBe(row?.today);
    expect(row?.finished).toBe(row?.today);
  });

  it('build output: one live row per build day, add mode sums, money shape checks', async () => {
    const build = await newBuild();
    const add = (qty: number) =>
      org.query<{ qty: string; version: number }>(
        `insert into pm.build_output (org_id, container_id, program_id, build_id, variant_id, work_date, qty, unit_price, price_source, revenue_cents, posting)
         values ($1, $2, $2, $3, $4, '2026-11-24', $5, 1.95, 'card', round($5 * 1.95 * 100), 'program')
         on conflict (build_id, work_date) where deleted_at is null
         do update set qty = build_output.qty + excluded.qty, scrap_qty = build_output.scrap_qty + excluded.scrap_qty, version = build_output.version + 1
         returning qty::text as qty, version`,
        [org.orgId, fx.programId, build, fx.variantId, qty],
      );
    await add(60);
    const [sum] = await add(40);
    expect(sum).toEqual({ qty: '100.000', version: 2 });
    const insert = (fields: { posting: string; job: string | null; source?: string; price?: string; date?: string }) =>
      org.query(
        `insert into pm.build_output (org_id, container_id, program_id, build_id, work_date, qty, unit_price, price_source, posting, pulse_job_id)
         values ($1, $2, $2, $3, $4, 1, $5, $6, $7, $8)`,
        [org.orgId, fx.programId, build, fields.date ?? '2026-11-23', fields.price ?? '1.0000', fields.source ?? 'card', fields.posting, fields.job],
      );
    await expectState(insert({ posting: 'program_job', job: null }), '23514');
    await expectState(insert({ posting: 'program', job: '00000000-0000-4000-8000-000000000001' }), '23514');
    await expectState(insert({ posting: 'program', job: null, source: 'none', price: '1.0000' }), '23514');
    await expectState(insert({ posting: 'elsewhere', job: null }), '23514');
    await expect(insert({ posting: 'build_job', job: '00000000-0000-4000-8000-000000000001' })).resolves.toBeDefined();
  });

  it('ledger, card lines, one time charges and builds keep their CHECKs and keys', async () => {
    const ref = `pmf:${fx.programId}:monthly:2026-11`;
    const ledger = (month: string, posting = 'program', job: string | null = null) =>
      org.query(
        `insert into pm.program_ledger (org_id, program_id, ref, kind, charge_date, month, cents, label, posting, pulse_job_id)
         values ($1, $2, $3, 'flat_monthly', '2026-11-01', $4, 150000, 'Monthly fee', $5, $6)`,
        [org.orgId, fx.programId, ref, month, posting, job],
      );
    await expectState(ledger('2026-10-01'), '23514');
    await expectState(ledger('2026-11-01', 'program_job', null), '23514');
    await ledger('2026-11-01');
    await expectState(ledger('2026-11-01'), '23505');

    const [version] = await org.query<{ id: string }>(
      `insert into pm.price_card_versions (org_id, program_id, effective_from) values ($1, $2, '2026-12-01') returning id`,
      [org.orgId, fx.programId],
    );
    const line = (kind: string, fields: { unit?: string | null; rate?: number | null; amount?: number | null; variant?: string | null }) =>
      org.query(`insert into pm.price_card_lines (org_id, version_id, kind, unit_price, rate_cents, amount_cents, variant_id) values ($1, $2, $3, $4, $5, $6, $7)`, [
        org.orgId,
        version!.id,
        kind,
        fields.unit ?? null,
        fields.rate ?? null,
        fields.amount ?? null,
        fields.variant ?? null,
      ]);
    await expectState(line('per_unit', {}), '23514');
    await expectState(line('per_hour', { amount: 100 }), '23514');
    await expectState(line('flat_monthly', { amount: 150000, variant: fx.variantId }), '23514');
    await line('per_unit', { unit: '1.9500' });
    await line('per_unit', { unit: '2.2000', variant: fx.variantId });
    await expectState(line('per_unit', { unit: '1.9000' }), '23505');
    await line('monthly_minimum', { amount: 3000000 });
    await expectState(
      org.query(`update pm.price_card_versions set status = 'published' where id = $1`, [version!.id]),
      '23514',
    );
    await org.query(`update pm.price_card_versions set status = 'published', number = 3, published_at = now() where id = $1`, [version!.id]);
    await expectState(
      org.query(`insert into pm.price_card_versions (org_id, program_id, effective_from, status, number, published_at) values ($1, $2, '2026-12-01', 'published', 4, now())`, [org.orgId, fx.programId]),
      '23505',
    );

    const charge = (kind: string, amount: number, reason: string | null, counts = false) =>
      org.query(`insert into pm.program_one_time_charges (org_id, program_id, kind, charge_on, amount_cents, label, reason, counts_toward_minimum) values ($1, $2, $3, '2026-11-20', $4, 'Charge', $5, $6)`, [
        org.orgId,
        fx.programId,
        kind,
        amount,
        reason,
        counts,
      ]);
    await expectState(charge('setup', -100, null), '23514');
    await expectState(charge('adjustment', -20000, null), '23514');
    await expectState(charge('setup', 250000, null, true), '23514');
    await charge('adjustment', -20000, 'Credit for 200 bad kits', true);

    const build = await newBuild();
    await expectState(org.query(`update pm.builds set rate_override = 2.05 where task_id = $1`, [build]), '23514');
    await org.query(`update pm.builds set rate_override = 2.05, rate_override_reason = 'Rush order' where task_id = $1`, [build]);
    await expectState(org.query(`update pm.builds set closed_short = true where task_id = $1`, [build]), '23514');
  });

  it('a schedule occurrence makes one build only', async () => {
    const [schedule] = await org.query<{ id: string }>(
      `insert into pm.build_schedules (org_id, program_id, name, pattern, starts_on) values ($1, $2, 'Weekday glove run', 'weekdays', '2026-11-25') returning id`,
      [org.orgId, fx.programId],
    );
    const first = await newBuild();
    const second = await newBuild();
    const occurrence = (taskId: string) =>
      org.query(`update pm.builds set schedule_id = $2, schedule_date = '2026-11-30', occurrence_variant_id = $3 where task_id = $1`, [taskId, schedule!.id, fx.variantId]);
    await occurrence(first);
    await expectState(occurrence(second), '23505');
    await expectState(org.query(`update pm.builds set schedule_id = $2, schedule_date = null where task_id = $1`, [second, schedule!.id]), '23514');
    // Freeing the key (regenerateFuture) lets the occurrence be made again.
    await org.query(`update pm.builds set schedule_id = null, schedule_date = null, occurrence_variant_id = null where task_id = $1`, [first]);
    await occurrence(second);
  });

  it('a month closes once until it is reopened with a reason', async () => {
    const close = () =>
      org.query(`insert into pm.program_closes (org_id, program_id, month, total_cents, units, checklist, closed_by, closed_at) values ($1, $2, '2026-10-01', 3150000, 15300, '{}'::jsonb, $3, now()) returning id`, [
        org.orgId,
        fx.programId,
        ownerId,
      ]);
    const [closed] = await close();
    await expectState(close(), '23505');
    await expectState(org.query(`update pm.program_closes set reopened_at = now() where id = $1`, [closed!.id]), '23514');
    await org.query(`update pm.program_closes set reopened_at = now(), reopened_by = $2, reopen_reason = 'Late output' where id = $1`, [closed!.id, ownerId]);
    await expect(close()).resolves.toHaveLength(1);
    await expectState(
      org.query(`insert into pm.program_closes (org_id, program_id, month, total_cents, units, checklist, closed_by, closed_at) values ($1, $2, '2026-10-15', 0, 0, '{}'::jsonb, $3, now())`, [org.orgId, fx.programId, ownerId]),
      '23514',
    );
  });
});
