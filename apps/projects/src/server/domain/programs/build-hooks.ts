/**
 * Program rules inside the generic task paths (docs/programs/SPEC.md 4.1): status changes of
 * builds refresh the ledger in the same transaction, date edits keep `pm.builds.build_date`
 * equal to the task due date and respect locks, deletes and restores carry the build's output,
 * and time on program work respects locks and refreshes the per hour fees. `tasks.ts`,
 * `structure.ts` and `time.ts` call these; they never import the rest of the program domain.
 */
import 'server-only';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { monthOf } from '@kitstak/programs-engine/calendar';
import type { Executor } from '@/server/db';
import { builds, programSettings, projects, tasks, timeEntries, type Task } from '@/server/db/schema';
import { invalid, locked } from '@/server/errors';
import type { DomainContext } from '../_shared';
import { lockSettings, monthsOf, todayInZone } from './_program';
import { emitProgramChanged } from './events';
import { refreshLedgerFor } from './ledger';
import { assertOpen, isLocked, programLocks } from './locks';
import { buildJobIds, programJobId } from './postings';

interface BuildState {
  readonly taskId: string;
  readonly programId: string | null;
  readonly containerId: string;
  readonly buildDate: string;
  readonly finishedOn: string | null;
}

export async function buildState(executor: Executor, taskId: string): Promise<BuildState | null> {
  const [row] = await executor
    .select({ taskId: builds.taskId, programId: builds.programId, containerId: builds.containerId, buildDate: builds.buildDate, finishedOn: builds.finishedOn })
    .from(builds)
    .where(eq(builds.taskId, taskId));
  return row ?? null;
}

async function programOf(executor: Executor, ctx: DomainContext, programId: string) {
  const [row] = await executor
    .select({ id: projects.id, key: projects.key, timezone: programSettings.timezone })
    .from(projects)
    .innerJoin(programSettings, eq(programSettings.programId, projects.id))
    .where(and(eq(projects.id, programId), eq(projects.orgId, ctx.orgId)));
  return row ?? null;
}

/**
 * Before a generic update of a build task: date edits move `build_date` (refused on locked days).
 * Returns the state to pass to `afterBuildTaskUpdate`.
 */
export async function beforeBuildTaskUpdate(
  tx: Executor,
  ctx: DomainContext,
  current: Task,
  next: { readonly startDate?: unknown; readonly dueDate?: unknown },
): Promise<BuildState | null> {
  if (current.kind !== 'build') return null;
  const state = await buildState(tx, current.id);
  if (!state) return null;
  const due = next.dueDate !== undefined ? (next.dueDate as string | null) : undefined;
  if (due !== undefined && due !== state.buildDate) {
    if (!due) throw invalid('A build needs a build date.', { dueDate: 'A build needs a build date.' });
    if (state.programId) {
      const program = await programOf(tx, ctx, state.programId);
      if (program) {
        const locks = await programLocks(ctx, program, tx);
        assertOpen(locks, state.buildDate, { goesToJob: false });
        assertOpen(locks, due, { goesToJob: false });
      }
    }
    await tx.update(builds).set({ buildDate: due, version: sql`${builds.version} + 1`, updatedAt: new Date() }).where(eq(builds.taskId, current.id));
  }
  return state;
}

/** After a generic update of a build task: refresh the ledger when the finish state moved. */
export async function afterBuildTaskUpdate(tx: Executor, ctx: DomainContext, before: BuildState | null, statusChanged: boolean): Promise<void> {
  if (!before || !before.programId) return;
  const after = await buildState(tx, before.taskId);
  const finishMoved = (after?.finishedOn ?? null) !== (before.finishedOn ?? null);
  if (!statusChanged && !finishMoved && after?.buildDate === before.buildDate) return;
  const program = await programOf(tx, ctx, before.programId);
  if (!program) return;
  const months = monthsOf([before.finishedOn, after?.finishedOn, todayInZone(program.timezone)]);
  await refreshLedgerFor(tx, ctx, { programIds: [before.programId], months });
  await emitProgramChanged(tx, ctx, before.programId);
}

/** Builds whose status category changes because a status changed category or was deleted (structure.ts). */
export async function afterStatusCategoryChange(tx: Executor, ctx: DomainContext, projectId: string): Promise<void> {
  const [project] = await tx.select({ kind: projects.kind }).from(projects).where(eq(projects.id, projectId));
  if (project?.kind !== 'program') return;
  const program = await programOf(tx, ctx, projectId);
  if (!program) return;
  const result = await tx.execute(
    sql`select distinct to_char(finished_on, 'YYYY-MM') as month from pm.builds where program_id = ${projectId}::uuid and finished_on is not null
        union select to_char(${todayInZone(program.timezone)}::date, 'YYYY-MM')`,
  );
  const months = (result as unknown as { rows: { month: string }[] }).rows.map((row) => row.month);
  await refreshLedgerFor(tx, ctx, { programIds: [projectId], months });
  await emitProgramChanged(tx, ctx, projectId);
}

/** Before soft deleting tasks: builds with locked output are refused; open output goes with them. */
export async function beforeDeleteTasks(tx: Executor, ctx: DomainContext, taskIds: readonly string[]): Promise<{ programIds: string[]; months: string[] }> {
  if (taskIds.length === 0) return { programIds: [], months: [] };
  const rows = await tx
    .select({ taskId: builds.taskId, programId: builds.programId, finishedOn: builds.finishedOn })
    .from(builds)
    .where(inArray(builds.taskId, [...taskIds]));
  if (rows.length === 0) return { programIds: [], months: [] };
  // Every program's settings row first, in one sorted order (8.4), then the locks.
  await lockSettings(tx, rows.map((row) => row.programId).filter((id): id is string => Boolean(id)), 'update');
  const programIds = new Set<string>();
  const months = new Set<string>();
  for (const row of rows) {
    const output = await tx.execute(sql`select id::text as id, work_date::text as work_date, posting from pm.build_output where build_id = ${row.taskId}::uuid and deleted_at is null`);
    const outputRows = (output as unknown as { rows: { id: string; work_date: string; posting: string }[] }).rows;
    if (row.programId) {
      const program = await programOf(tx, ctx, row.programId);
      if (program) {
        const locks = await programLocks(ctx, program, tx);
        const lockedRow = outputRows.find((o) => isLocked(locks, o.work_date, { goesToJob: o.posting === 'program_job' || o.posting === 'build_job' }));
        const lockedFee = row.finishedOn && isLocked(locks, row.finishedOn, { goesToJob: false });
        if (lockedRow || lockedFee) throw locked('This build has output in a closed month. Cancel it instead.');
        programIds.add(row.programId);
        for (const o of outputRows) months.add(monthOf(o.work_date));
        if (row.finishedOn) months.add(monthOf(row.finishedOn));
        months.add(monthOf(todayInZone(program.timezone)));
      }
    }
    if (outputRows.length > 0) await tx.execute(sql`update pm.build_output set deleted_at = now(), updated_at = now() where build_id = ${row.taskId}::uuid and deleted_at is null`);
  }
  return { programIds: [...programIds], months: [...months] };
}

/** After soft deleting or restoring builds: refresh the ledger and tell Pulse. */
export async function afterBuildsChanged(tx: Executor, ctx: DomainContext, change: { programIds: readonly string[]; months: readonly string[] }): Promise<void> {
  if (change.programIds.length === 0) return;
  await refreshLedgerFor(tx, ctx, { programIds: change.programIds, months: change.months });
  for (const id of change.programIds) await emitProgramChanged(tx, ctx, id);
}

/** Restoring builds: bring back only output rows whose dates are still open. */
export async function restoreBuildOutput(tx: Executor, ctx: DomainContext, taskId: string): Promise<{ programIds: string[]; months: string[] }> {
  const state = await buildState(tx, taskId);
  if (!state) return { programIds: [], months: [] };
  const deleted = await tx.execute(
    sql`select distinct on (work_date) id::text as id, work_date::text as work_date, posting from pm.build_output
         where build_id = ${taskId}::uuid and deleted_at is not null order by work_date, deleted_at desc`,
  );
  const rows = (deleted as unknown as { rows: { id: string; work_date: string; posting: string }[] }).rows;
  const program = state.programId ? await programOf(tx, ctx, state.programId) : null;
  const locks = program ? await programLocks(ctx, program, tx) : null;
  const months = new Set<string>();
  for (const row of rows) {
    if (locks && isLocked(locks, row.work_date, { goesToJob: row.posting === 'program_job' || row.posting === 'build_job' })) continue;
    const live = await tx.execute(sql`select 1 from pm.build_output where build_id = ${taskId}::uuid and work_date = ${row.work_date}::date and deleted_at is null`);
    if ((live as unknown as { rows: unknown[] }).rows.length > 0) continue;
    await tx.execute(sql`update pm.build_output set deleted_at = null, updated_at = now() where id = ${row.id}::uuid`);
    months.add(monthOf(row.work_date));
  }
  // Keep the built_qty cache equal to the live output.
  await tx.execute(
    sql`update pm.builds set built_qty = coalesce((select sum(qty) from pm.build_output where build_id = ${taskId}::uuid and deleted_at is null), 0),
             scrap_qty = coalesce((select sum(scrap_qty) from pm.build_output where build_id = ${taskId}::uuid and deleted_at is null), 0),
             version = version + 1, updated_at = now()
         where task_id = ${taskId}::uuid`,
  );
  if (state.finishedOn) months.add(monthOf(state.finishedOn));
  if (program) months.add(monthOf(todayInZone(program.timezone)));
  return { programIds: state.programId ? [state.programId] : [], months: [...months] };
}

// --- Time on program work ---------------------------------------------------------------------------

export interface TimeScope {
  readonly programId: string | null;
  readonly timezone: string;
  /** Lock checks apply (the task is in a program, or a build that bills to a job). */
  readonly applies: boolean;
  readonly goesToJob: boolean;
  readonly key: string;
  /** New time defaults to billable (the program has a per hour line). */
  readonly billableDefault: boolean;
}

/** How program rules apply to time on a task. Null for ordinary project tasks. */
export async function timeScope(executor: Executor, ctx: DomainContext, taskId: string): Promise<TimeScope | null> {
  const [task] = await executor
    .select({ id: tasks.id, kind: tasks.kind, projectId: tasks.projectId, projectKind: projects.kind, key: projects.key })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(eq(tasks.id, taskId), isNull(tasks.deletedAt)));
  if (!task) return null;
  if (task.projectKind === 'program') {
    const program = await programOf(executor, ctx, task.projectId);
    const timezone = program?.timezone ?? 'America/Chicago';
    const jobs = task.kind === 'build' ? await buildJobIds(executor, ctx, [task.id]) : new Map<string, string>();
    const programJob = await programJobId(executor, ctx, task.projectId);
    const hourly = await executor.execute(
      sql`select exists (select 1 from pm.price_card_lines l join pm.price_card_versions v on v.id = l.version_id
                          where v.program_id = ${task.projectId}::uuid and v.status = 'published' and v.deleted_at is null and l.kind = 'per_hour') as ok`,
    );
    return {
      programId: task.projectId,
      timezone,
      applies: true,
      goesToJob: Boolean(jobs.get(task.id) ?? programJob),
      key: task.key,
      billableDefault: (hourly as unknown as { rows: { ok: boolean }[] }).rows[0]?.ok === true,
    };
  }
  if (task.kind === 'build') {
    const jobs = await buildJobIds(executor, ctx, [task.id]);
    if (jobs.size > 0) return { programId: null, timezone: 'America/Chicago', applies: true, goesToJob: true, key: task.key, billableDefault: false };
  }
  return null;
}

/** The day of a time entry in the program zone. */
export function timeDay(scope: Pick<TimeScope, 'timezone'>, startedAt: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: scope.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(startedAt);
}

/** Refuses a time write on a locked day of the task's program (or its billed job). */
export async function assertTimeOpen(executor: Executor, ctx: DomainContext, scope: TimeScope | null, days: readonly Date[]): Promise<void> {
  if (!scope?.applies || !scope.programId) return;
  const program = await programOf(executor, ctx, scope.programId);
  if (!program) return;
  const locks = await programLocks(ctx, program, executor);
  for (const day of days) assertOpen(locks, timeDay(scope, day), { goesToJob: scope.goesToJob });
}

/**
 * Time writes run in one transaction (4.3.2): lock every touched program's settings row first
 * (sorted), then `assertTimeOpen`, the write, and `refreshTimeLedger`.
 */
export async function lockTimeScopes(tx: Executor, scopes: readonly (TimeScope | null)[]): Promise<void> {
  await lockSettings(tx, scopes.map((scope) => scope?.programId).filter((id): id is string => Boolean(id)), 'update');
}

/** After a time write on program work: refresh the per hour fees of the touched months, in the same transaction. */
export async function refreshTimeLedger(tx: Executor, ctx: DomainContext, scope: TimeScope | null, days: readonly Date[]): Promise<void> {
  if (!scope?.programId) return;
  await refreshLedgerFor(tx, ctx, { programIds: [scope.programId], dates: days.map((day) => timeDay(scope, day)) });
  await emitProgramChanged(tx, ctx, scope.programId);
}

/**
 * Moving a task into or out of a program: refused when it has time on a locked day of either side
 * (4.1). Returns the program ids whose per hour ledger the move touches.
 */
export async function assertTaskMoveTime(tx: Executor, ctx: DomainContext, taskIds: readonly string[], sourceProjectId: string, targetProjectId: string): Promise<{ programIds: string[]; months: string[] }> {
  const sides = await tx
    .select({ id: projects.id, key: projects.key, kind: projects.kind, timezone: programSettings.timezone })
    .from(projects)
    .leftJoin(programSettings, eq(programSettings.programId, projects.id))
    .where(inArray(projects.id, [sourceProjectId, targetProjectId]));
  const programs = sides.filter((side) => side.kind === 'program');
  if (programs.length === 0 || taskIds.length === 0) return { programIds: [], months: [] };
  await lockSettings(tx, programs.map((p) => p.id), 'update');
  const entries = await tx
    .select({ startedAt: timeEntries.startedAt })
    .from(timeEntries)
    .where(and(inArray(timeEntries.taskId, [...taskIds]), isNull(timeEntries.deletedAt)));
  const months = new Set<string>();
  for (const program of programs) {
    const locks = await programLocks(ctx, program, tx);
    for (const entry of entries) {
      const day = timeDay({ timezone: program.timezone ?? 'America/Chicago' }, entry.startedAt);
      if (isLocked(locks, day, { goesToJob: false })) throw locked('This task has time in a closed month. Copy it instead.');
      months.add(monthOf(day));
    }
  }
  return { programIds: programs.map((p) => p.id), months: [...months] };
}
