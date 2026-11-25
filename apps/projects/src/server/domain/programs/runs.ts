/**
 * Runs (docs/programs/SPEC.md A14, 3.10, 4.2 `runs.ts`). A run is computed, never stored: the
 * builds of one container on one date made by one schedule share `run:<scheduleId>:<date>`;
 * builds made by hand share `run:manual:<date>` ("Unscheduled"). Run actions are batch build
 * actions in one transaction.
 */
import 'server-only';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { groupRuns, parseRunId, type RunBuild } from '@kitstak/programs-engine/runs';
import { fromScaled, quantityToScaled, ZERO } from '@kitstak/programs-engine/money';
import { nextWorkDay } from '@kitstak/programs-engine/schedule';
import { db, type Executor } from '@/server/db';
import { buildSchedules, builds, projects, tasks } from '@/server/db/schema';
import { invalid, notFound } from '@/server/errors';
import type { FloorTodayDTO, IsoDate, RunDTO } from '@/lib/program-types';
import type { DomainContext } from '../_shared';
import { visibleProjectsWhere } from '../access';
import { logActivity } from '../activity';
import { applyTaskUpdate } from '../tasks';
import { calendarFor, centsOut, loadOrgCalendar, todayInZone } from './_program';
import { requireProgram, seesMoneyFor } from './access';
import { cancelBuilds, closeShortIn, copyDay, requireContainer, splitBuildIn, type BuildContainer } from './builds';
import { emitProgramsChanged } from './events';
import { refreshLedgerFor } from './ledger';
import { assertOpen, programLocks } from './locks';

interface RunRaw {
  id: string;
  container_id: string;
  build_date: string;
  schedule_id: string | null;
  schedule_name: string | null;
  category: RunBuild['statusCategory'];
  planned_qty: string;
  built_qty: string;
  closed_short: boolean;
  revenue: string;
  std_minutes: string | null;
}

async function runBuilds(executor: Executor, ctx: DomainContext, containerIds: readonly string[], from: IsoDate, to: IsoDate): Promise<RunRaw[]> {
  if (containerIds.length === 0) return [];
  const list = sql.join(containerIds.map((id) => sql`${id}::uuid`), sql`, `);
  const result = await executor.execute(
    sql`select b.task_id::text as id, b.container_id::text as container_id, b.build_date::text as build_date, b.schedule_id::text as schedule_id,
               sc.name as schedule_name, s.category, b.planned_qty::text as planned_qty, b.built_qty::text as built_qty, b.closed_short,
               (select coalesce(sum(o.revenue_cents), 0)::text from pm.build_output o where o.build_id = b.task_id and o.deleted_at is null) as revenue,
               v.std_minutes_per_unit::text as std_minutes
          from pm.builds b
          join pm.tasks t on t.id = b.task_id and t.deleted_at is null
          join pm.statuses s on s.id = t.status_id
          left join pm.build_schedules sc on sc.id = b.schedule_id
          left join pm.program_variants v on v.id = b.variant_id
         where b.org_id = ${ctx.orgId}::uuid and b.container_id in (${list}) and b.build_date between ${from}::date and ${to}::date
         order by b.build_date, t.position`,
  );
  return (result as unknown as { rows: RunRaw[] }).rows;
}

function toRuns(programKey: string, rows: readonly RunRaw[], hidden: boolean): RunDTO[] {
  const revenue = new Map(rows.map((row) => [row.id, BigInt(row.revenue)]));
  return groupRuns(
    rows.map((row) => ({
      buildId: row.id,
      containerId: row.container_id,
      buildDate: row.build_date,
      scheduleId: row.schedule_id,
      scheduleName: row.schedule_name,
      statusCategory: row.category,
      plannedQty: row.planned_qty,
      builtQty: row.built_qty,
      closedShort: row.closed_short,
    })),
  ).map((run) => ({
    id: run.id,
    programKey,
    date: run.date,
    name: run.name,
    scheduleId: run.scheduleId,
    state: run.state,
    builds: run.builds,
    done: run.done,
    cancelled: run.cancelled,
    plannedUnits: run.plannedUnits,
    builtUnits: run.builtUnits,
    revenueCents: centsOut(run.buildIds.reduce((sum, id) => sum + (revenue.get(id) ?? ZERO), ZERO), hidden),
    buildIds: run.buildIds,
  }));
}

/** Runs of one container over a range with money hidden (the sweep's run triggers read these). */
export async function runsOfContainer(executor: Executor, ctx: DomainContext, container: { readonly id: string; readonly key: string }, from: IsoDate, to: IsoDate): Promise<RunDTO[]> {
  return toRuns(container.key, await runBuilds(executor, ctx, [container.id], from, to), true);
}

export async function listRuns(ctx: DomainContext, key: string, range: { readonly from: IsoDate; readonly to: IsoDate }): Promise<RunDTO[]> {
  const container = await requireContainer(ctx, key);
  return toRuns(container.project.key, await runBuilds(db, ctx, [container.project.id], range.from, range.to), !container.seesMoney);
}

function parse(runId: string): { scheduleId: string | null; date: IsoDate } {
  const parsed = parseRunId(runId);
  if (!parsed) throw invalid('That run is not valid.');
  return parsed;
}

async function runTaskIds(executor: Executor, containerId: string, runId: string, options: { readonly openOnly?: boolean } = {}): Promise<string[]> {
  const { scheduleId, date } = parse(runId);
  const schedule = scheduleId ? sql`b.schedule_id = ${scheduleId}::uuid` : sql`b.schedule_id is null`;
  const open = options.openOnly ? sql` and s.category in ('todo', 'in_progress')` : sql``;
  const result = await executor.execute(
    sql`select b.task_id::text as id from pm.builds b join pm.tasks t on t.id = b.task_id and t.deleted_at is null join pm.statuses s on s.id = t.status_id
         where b.container_id = ${containerId}::uuid and b.build_date = ${date}::date and ${schedule}${open} order by t.position`,
  );
  return (result as unknown as { rows: { id: string }[] }).rows.map((row) => row.id);
}

/** Finds the container of a run id inside the program the actor names, or any program (runs are keyed by program). */
async function containerOfRun(ctx: DomainContext, runId: string, key?: string): Promise<BuildContainer> {
  const { scheduleId } = parse(runId);
  if (key) return requireContainer(ctx, key, 'build:plan');
  if (scheduleId) {
    const [schedule] = await db.select({ programId: buildSchedules.programId }).from(buildSchedules).where(and(eq(buildSchedules.id, scheduleId), eq(buildSchedules.orgId, ctx.orgId)));
    if (!schedule) throw notFound('That run');
    return requireContainer(ctx, schedule.programId, 'build:plan');
  }
  throw invalid('Say which program this run belongs to.');
}

export async function getRun(ctx: DomainContext, runId: string, key?: string): Promise<RunDTO> {
  const container = await containerOfRun(ctx, runId, key);
  const { date } = parse(runId);
  const run = toRuns(container.project.key, await runBuilds(db, ctx, [container.project.id], date, date), !container.seesMoney).find((r) => r.id === runId);
  if (!run) throw notFound('That run');
  return run;
}

/** Moves every open build of a run to another day. */
export async function moveRun(ctx: DomainContext, runId: string, input: { readonly toDate: IsoDate; readonly key?: string }): Promise<{ changed: number }> {
  const container = await containerOfRun(ctx, runId, input.key);
  const changed = await db.transaction(async (tx) => {
    const ids = await runTaskIds(tx, container.project.id, runId, { openOnly: true });
    const locks = container.programId ? await programLocks(ctx, container.project, tx) : null;
    if (locks) {
      assertOpen(locks, parse(runId).date, { goesToJob: false });
      assertOpen(locks, input.toDate, { goesToJob: false });
    }
    for (const id of ids) {
      const [task] = await tx.select().from(tasks).where(eq(tasks.id, id));
      if (task) await applyTaskUpdate(tx, ctx, container.project, task, { startDate: input.toDate, dueDate: input.toDate });
    }
    await logActivity(tx, ctx, { verb: 'run.moved', entityType: 'project', entityId: container.project.id, projectId: container.project.id, before: { runId }, after: { toDate: input.toDate, builds: ids.length } });
    return ids.length;
  });
  await emitProgramsChanged(ctx, [container.programId]);
  return { changed };
}

export async function cancelRun(ctx: DomainContext, runId: string, input: { readonly key?: string } = {}): Promise<{ changed: number }> {
  const container = await containerOfRun(ctx, runId, input.key);
  const ids = await runTaskIds(db, container.project.id, runId, { openOnly: true });
  const result = await cancelBuilds(ctx, ids);
  await db.transaction((tx) => logActivity(tx, ctx, { verb: 'run.cancelled', entityType: 'project', entityId: container.project.id, projectId: container.project.id, after: { runId, builds: result.changed } }));
  return result;
}

export async function copyRun(ctx: DomainContext, runId: string, input: { readonly toDates: readonly IsoDate[]; readonly key?: string }): Promise<{ changed: number; createdIds: string[] }> {
  const container = await containerOfRun(ctx, runId, input.key);
  const { date } = parse(runId);
  const created = await copyDay(ctx, container.project.key, { fromDate: date, toDates: input.toDates, mode: 'planned' });
  await db.transaction((tx) => logActivity(tx, ctx, { verb: 'run.copied', entityType: 'project', entityId: container.project.id, projectId: container.project.id, after: { runId, toDates: input.toDates, builds: created.createdIds.length } }));
  return { changed: created.createdIds.length, createdIds: created.createdIds };
}

/** Closes a run: each open build closes short, moves the rest, or stays open (one transaction). */
export async function closeRun(
  ctx: DomainContext,
  runId: string,
  input: { readonly key?: string; readonly decisions: readonly { readonly buildId: string; readonly action: 'close_short' | 'move_rest' | 'leave_open'; readonly reason?: string; readonly toDate?: IsoDate }[] },
): Promise<{ changed: number; createdIds: string[] }> {
  const container = await containerOfRun(ctx, runId, input.key);
  const { date } = parse(runId);
  const result = await db.transaction(async (tx) => {
    const ids = new Set(await runTaskIds(tx, container.project.id, runId));
    const calendar = container.programId ? await calendarFor(tx, ctx, container.project, container.settings ?? undefined) : null;
    const createdIds: string[] = [];
    let changed = 0;
    for (const decision of input.decisions) {
      if (!ids.has(decision.buildId)) throw invalid('That build is not part of this run.');
      if (decision.action === 'leave_open') continue;
      if (decision.action === 'close_short') await closeShortIn(tx, ctx, container, decision.buildId, decision.reason ?? '');
      else createdIds.push(await splitBuildIn(tx, ctx, container, decision.buildId, { toDate: decision.toDate ?? (calendar ? nextWorkDay(calendar, date) : date) }));
      changed += 1;
    }
    if (container.programId) await refreshLedgerFor(tx, ctx, { programIds: [container.programId], dates: [date, todayInZone(container.timezone)] });
    await logActivity(tx, ctx, { verb: 'run.closed', entityType: 'project', entityId: container.project.id, projectId: container.project.id, after: { runId, changed } });
    return { changed, createdIds };
  });
  await emitProgramsChanged(ctx, [container.programId]);
  return result;
}

/** Every program's runs for a day, the org capacity, units and estimated hours (Floor today). */
export async function floorToday(ctx: DomainContext, options: { readonly date?: IsoDate } = {}): Promise<FloorTodayDTO> {
  const org = await loadOrgCalendar(db, ctx.orgId);
  const date = options.date ?? todayInZone(org.timezone);
  const rows = await db
    .select({ id: tasks.projectId })
    .from(builds)
    .innerJoin(tasks, eq(tasks.id, builds.taskId))
    .where(and(eq(builds.orgId, ctx.orgId), eq(builds.buildDate, date), isNull(tasks.deletedAt)))
    .groupBy(tasks.projectId);
  const containerIds = rows.map((row) => row.id);
  const visible = containerIds.length
    ? await db
        .select()
        .from(projects)
        .where(and(visibleProjectsWhere(ctx, { kind: 'program' }), sql`${projects.id} in (${sql.join(containerIds.map((id) => sql`${id}::uuid`), sql`, `)})`, isNull(projects.archivedAt)))
    : [];
  const money = await seesMoneyFor(ctx, visible.map((p) => p.id));
  const raw = await runBuilds(db, ctx, visible.map((p) => p.id), date, date);
  const unitTotals = new Map<string, bigint>();
  let totalBuilds = 0;
  let totalDone = 0;
  let totalMinutes = ZERO;
  let anyMinutes = false;
  const out: FloorTodayDTO['programs'][number][] = [];
  for (const program of visible.sort((a, b) => a.name.localeCompare(b.name))) {
    const access = await requireProgram(ctx, { id: program.id });
    const mine = raw.filter((row) => row.container_id === program.id);
    const runs = toRuns(program.key, mine, !money.has(program.id));
    let minutes = ZERO;
    let has = false;
    for (const row of mine) {
      if (!row.std_minutes) continue;
      has = true;
      const left = quantityToScaled(row.planned_qty) - quantityToScaled(row.built_qty);
      if (left > ZERO) minutes += (left * quantityToScaled(row.std_minutes)) / BigInt(1000);
    }
    if (has) {
      anyMinutes = true;
      totalMinutes += minutes;
    }
    for (const run of runs) {
      totalBuilds += run.builds;
      totalDone += run.done;
      const unit = access.settings.unitPlural;
      unitTotals.set(unit, (unitTotals.get(unit) ?? ZERO) + quantityToScaled(run.plannedUnits));
    }
    out.push({
      key: program.key,
      name: program.name,
      unit: { singular: access.settings.unitSingular, plural: access.settings.unitPlural },
      runs,
      estHours: has ? fromScaled((minutes * BigInt(100)) / BigInt(60000), 2) : null,
      moneyHidden: !money.has(program.id),
    });
  }
  return {
    date,
    capacityHours: org.dailyCapacityHours,
    programs: out,
    totals: {
      builds: totalBuilds,
      done: totalDone,
      plannedUnitsByUnit: [...unitTotals.entries()].map(([unit, units]) => ({ unit, units: fromScaled(units, 3) })),
      estHours: anyMinutes ? fromScaled((totalMinutes * BigInt(100)) / BigInt(60000), 2) : null,
    },
  };
}
