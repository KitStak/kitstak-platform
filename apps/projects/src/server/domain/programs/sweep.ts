/**
 * Lazy jobs (docs/programs/SPEC.md 4.9): no job runner. `scheduleProgramSweep(orgId)` runs in
 * `after()`, throttled to once per 5 minutes per org, from program page loads, the directory,
 * Floor today, notification reads and the cron route. Each step is idempotent: schedule
 * generation, settling due charges, the end of day reminder, job price watch, the minimum watch
 * and the version reminder. The sweep never edits prices or closes months.
 */
import 'server-only';
import { after } from 'next/server';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { addDays, isWorkDay, monthOf } from '@kitstak/programs-engine/calendar';
import { formatCents } from '@kitstak/programs-engine/format';
import { getJobPriceRows } from '@kitstak/pulse-bridge/programs';
import { priceFor } from '@kitstak/programs-engine/price';
import { priceToScaled, quantityToScaled, ZERO } from '@kitstak/programs-engine/money';
import { db } from '@/server/db';
import { projectMembers, projects } from '@/server/db/schema';
import { routes } from '@/lib/routes';
import { RUN_TRIGGER_TYPES } from '@/lib/automation-types';
import type { TaskEvent } from '@/server/automations/engine';
import { engineTaskFromSummary } from '../automation-sweep';
import { selectTaskSummary } from '../task-queries';
import type { DomainContext } from '../_shared';
import { notify } from '../notifications';
import { bridge, calendarFor, loadSettings, programNow, todayInZone } from './_program';
import { emitProgramChanged } from './events';
import { refreshLedgerFor, settleDue } from './ledger';
import { programLocks } from './locks';
import { restampOutput } from './pricing';
import { runsOfContainer } from './runs';
import { runScheduleGeneration } from './schedules';
import { programMonthStats } from './stats';

const THROTTLE_MS = 5 * 60_000;
const lastRun = new Map<string, number>();

/** Settles one program now (summaries call this after the response when the ledger is behind). */
export async function settleProgram(ctx: DomainContext, programId: string): Promise<void> {
  const system: DomainContext = { ...ctx, actorKind: 'system' };
  await db.transaction(async (tx) => {
    await settleDue(tx, system, programId);
    await emitProgramChanged(tx, system, programId);
  });
}

async function ownersOf(programId: string): Promise<string[]> {
  const rows = await db.select({ userId: projectMembers.userId }).from(projectMembers).where(and(eq(projectMembers.projectId, programId), eq(projectMembers.role, 'owner')));
  return rows.map((row) => row.userId);
}

/** Dedupe (4.9): true when no notification with this title and link went out since `since`. */
async function notSentSince(orgId: string, title: string, url: string, since: string): Promise<boolean> {
  const result = await db.execute(sql`select 1 from pm.notifications where org_id = ${orgId}::uuid and title = ${title} and url = ${url} and created_at >= ${since}::date limit 1`);
  return (result as unknown as { rows: unknown[] }).rows.length === 0;
}

/** One sweep pass for an org (every step idempotent). */
export async function runProgramSweep(ctx: DomainContext): Promise<{ generated: number; settled: number }> {
  const system: DomainContext = { ...ctx, actorKind: 'system', userName: 'KitStak' };
  const generated = (await runScheduleGeneration(system)).builds;
  const programs = await db.select().from(projects).where(and(eq(projects.orgId, ctx.orgId), eq(projects.kind, 'program'), isNull(projects.deletedAt)));
  let settled = 0;
  for (const program of programs) {
    const settings = await loadSettings(db, program.id).catch(() => null);
    if (!settings) continue;
    const today = todayInZone(settings.timezone);
    // 2. Settle due charges.
    await db.transaction(async (tx) => {
      const before = settings.settledThrough;
      const result = await settleDue(tx, system, program.id);
      if (result.settledThrough !== before) settled += 1;
    });
    // 5. Job price watch: rows priced from a job price that changed.
    const jobRows = await db.execute(sql`select distinct pulse_job_id::text as job_id from pm.build_output where program_id = ${program.id}::uuid and deleted_at is null and price_source = 'job' and pulse_job_id is not null`);
    for (const row of (jobRows as unknown as { rows: { job_id: string }[] }).rows) {
      const prices = await getJobPriceRows(bridge(db), ctx.orgId, row.job_id);
      const stale = await db.execute(sql`select work_date::text as work_date, unit_price::text as unit_price from pm.build_output where program_id = ${program.id}::uuid and pulse_job_id = ${row.job_id}::uuid and deleted_at is null and price_source = 'job' order by work_date`);
      const first = (stale as unknown as { rows: { work_date: string; unit_price: string }[] }).rows.find((r) => {
        const now = priceFor(prices, r.work_date)?.unitPrice ?? null;
        return now !== null && priceToScaled(now) !== priceToScaled(r.unit_price);
      });
      if (first) {
        await db.transaction(async (tx) => {
          const locks = await programLocks(system, program, tx);
          await restampOutput(tx, system, { containerId: program.id, programId: program.id, locks, from: first.work_date });
          await refreshLedgerFor(tx, system, { programIds: [program.id], months: [monthOf(first.work_date), monthOf(today)] });
          await emitProgramChanged(tx, system, program.id);
        });
      }
    }
    if (program.status !== 'active' || program.archivedAt) continue;
    const calendar = await calendarFor(db, ctx, program, settings);
    // 3. End of day reminder.
    if (settings.remindAt && isWorkDay(calendar, today)) {
      const now = new Intl.DateTimeFormat('en-US', { timeZone: settings.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
      if (now >= settings.remindAt.slice(0, 5)) {
        const result = await db.execute(
          sql`select coalesce(t.assignee_id, p.owner_id)::text as user_id, count(*)::int as n from pm.builds b join pm.tasks t on t.id = b.task_id and t.deleted_at is null
                join pm.statuses s on s.id = t.status_id join pm.projects p on p.id = t.project_id
               where b.program_id = ${program.id}::uuid and b.build_date = ${today}::date and s.category in ('todo', 'in_progress') and b.built_qty = 0 group by 1`,
        );
        for (const row of (result as unknown as { rows: { user_id: string | null; n: number }[] }).rows) {
          if (!row.user_id) continue;
          const title = `${row.n} ${program.key} ${row.n === 1 ? 'build has' : 'builds have'} no output logged today.`;
          const url = `${routes.programBuilds(program.key)}?log=${today}`;
          const sent = await db.execute(sql`select 1 from pm.notifications where org_id = ${ctx.orgId}::uuid and user_id = ${row.user_id}::uuid and url = ${url} limit 1`);
          if ((sent as unknown as { rows: unknown[] }).rows.length > 0) continue;
          await db.transaction((tx) => notify(tx, system, { recipients: [row.user_id!], kind: 'project', title, url, projectId: program.id }));
        }
      }
    }
    // 4. Run triggers: "All builds of a run are done" and "A run is below plan" (once per run per day per rule).
    await runTriggers(system, program, settings.timezone, today);
    // 6. Minimum watch: work days after the 15th, one note per program per week.
    if (Number(today.slice(8, 10)) > 15 && isWorkDay(calendar, today)) {
      const stats = await programMonthStats(db, system, program, settings);
      if (stats.forecast.projectedGapCents > BigInt(0)) {
        const week = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
        const title = `${program.key} may miss its ${formatCents(stats.result.minimum.minimumCents)} minimum by ${formatCents(stats.forecast.projectedGapCents)} this month.`;
        const url = routes.program(program.key);
        if (await weekQuiet(ctx.orgId, program.key, url, week)) {
          const owners = await ownersOf(program.id);
          await db.transaction((tx) => notify(tx, system, { recipients: owners, kind: 'project', title, url, projectId: program.id }));
        }
      }
    }
    // 7. Version reminder: the day before a published version starts.
    const tomorrow = addDays(today, 1);
    const versions = await db.execute(sql`select number from pm.price_card_versions where program_id = ${program.id}::uuid and status = 'published' and deleted_at is null and effective_from = ${tomorrow}::date`);
    for (const row of (versions as unknown as { rows: { number: number }[] }).rows) {
      const title = `Price card v${row.number} for ${program.key} starts tomorrow.`;
      const url = routes.programTab(program.key, 'price-card');
      if (!(await notSentSince(ctx.orgId, title, url, today))) continue;
      const owners = await ownersOf(program.id);
      await db.transaction((tx) => notify(tx, system, { recipients: owners, kind: 'project', title, url, projectId: program.id }));
    }
  }
  return { generated, settled };
}

/** Whole percent a run is below plan (0 at or over plan). Money free, exact on scaled units. */
export function runShortPercent(plannedUnits: string, builtUnits: string): number {
  const planned = quantityToScaled(plannedUnits);
  const built = quantityToScaled(builtUnits);
  if (planned <= ZERO || built >= planned) return 0;
  return Number(((planned - built) * BigInt(100)) / planned);
}

/**
 * Sweep step 4 (4.9, 5.17): evaluates `run_done` and `run_below_plan` rules of this program (and
 * workspace rules) per run. The event acts on the run's first build; the dedupe key makes each
 * rule run once per run (`run_done`) or once per run per day (`run_below_plan`).
 */
export async function runTriggers(ctx: DomainContext, program: { readonly id: string; readonly key: string }, timezone: string, today: string): Promise<number> {
  const rules = await db.execute(
    sql`select trigger ->> 'type' as type from pm.automations
         where org_id = ${ctx.orgId}::uuid and enabled and deleted_at is null
           and trigger ->> 'type' in (${sql.join(RUN_TRIGGER_TYPES.map((type) => sql`${type}`), sql`, `)})
           and (project_id is null or project_id = ${program.id}::uuid)`,
  );
  const types = new Set((rules as unknown as { rows: { type: string }[] }).rows.map((row) => row.type));
  if (types.size === 0) return 0;
  const localTime = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(programNow());
  // Done runs from the past week still fire once (a run finished late at night); below plan is about today.
  const runs = await runsOfContainer(db, ctx, program, addDays(today, -7), today);
  const events: TaskEvent[] = [];
  for (const run of runs) {
    const leadId = run.buildIds[0];
    if (!leadId) continue;
    const isDone = run.state === 'done' || run.state === 'short';
    const shortPercent = runShortPercent(run.plannedUnits, run.builtUnits);
    const wantDone = types.has('run_done') && isDone;
    const wantBelow = types.has('run_below_plan') && run.date === today && run.state !== 'cancelled' && shortPercent > 0;
    if (!wantDone && !wantBelow) continue;
    const summary = await selectTaskSummary(leadId);
    if (!summary) continue;
    const task = engineTaskFromSummary(summary);
    const facts = { id: run.id, name: `${program.key} ${run.name}`, date: run.date, plannedUnits: run.plannedUnits, builtUnits: run.builtUnits, shortPercent, localTime };
    if (wantDone) events.push({ type: 'run_done', task, run: facts, dedupeKey: `run_done:${run.id}` });
    if (wantBelow) events.push({ type: 'run_below_plan', task, run: facts, dedupeKey: `run_below_plan:${run.id}:${today}` });
  }
  if (events.length === 0) return 0;
  const { runAutomationsForEvents } = await import('../automations');
  await runAutomationsForEvents({ ...ctx, orgRole: 'owner', userName: 'Automation' }, events);
  return events.length;
}

/** One minimum note per program per week, whatever the amounts say. */
async function weekQuiet(orgId: string, key: string, url: string, week: string): Promise<boolean> {
  const result = await db.execute(sql`select 1 from pm.notifications where org_id = ${orgId}::uuid and url = ${url} and title like ${`${key} may miss its %`} and created_at >= ${week}::date limit 1`);
  return (result as unknown as { rows: unknown[] }).rows.length === 0;
}

/** Runs the sweep after the response, at most once per 5 minutes per org. Never throws. */
export function scheduleProgramSweep(ctx: DomainContext): void {
  const now = Date.now();
  if (now - (lastRun.get(ctx.orgId) ?? 0) < THROTTLE_MS) return;
  lastRun.set(ctx.orgId, now);
  try {
    after(async () => {
      try {
        await runProgramSweep(ctx);
      } catch (error) {
        console.warn('[projects] program sweep failed', error instanceof Error ? error.message : error);
      }
    });
  } catch {
    // Outside a request scope: run inline but never fail the caller.
    void runProgramSweep(ctx).catch(() => undefined);
  }
}

/** Test hook. */
export function resetProgramSweepThrottle(): void {
  lastRun.clear();
}

