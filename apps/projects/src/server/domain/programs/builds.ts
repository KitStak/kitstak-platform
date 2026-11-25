/**
 * Builds (docs/programs/SPEC.md D8, A1, A2, 4.2 `builds.ts`). A build is a `pm.tasks` row with
 * `kind = 'build'` plus its 1 to 1 `pm.builds` row. Builds live in a program or in an ordinary
 * project. Every write checks permissions and locks, runs in one transaction with activity rows,
 * refreshes the ledger when money can change, and tells Pulse after commit.
 */
import 'server-only';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { runId as engineRunId } from '@kitstak/programs-engine/runs';
import { addDays, monthOf } from '@kitstak/programs-engine/calendar';
import { buildRateProblem, resolveUnitPrice } from '@kitstak/programs-engine/price';
import { fromScaled, maxCents, mulQuantityPrice, quantityToScaled, ZERO } from '@kitstak/programs-engine/money';
import { nextWorkDay } from '@kitstak/programs-engine/schedule';
import { linkRecords } from '@kitstak/db/record-links';
import { db, type Executor } from '@/server/db';
import { builds, programVariants, statuses, tasks, type Build, type Project, type ProgramSettingsRow, type Status } from '@/server/db/schema';
import { invalid, locked, notFound } from '@/server/errors';
import { PLANNED_FROM_LABELS, type PlannedFrom } from '@/lib/constants';
import { routes } from '@/lib/routes';
import { taskKey } from '@/lib/task-key';
import type { BuildDTO, BuildsPageDTO, IsoDate } from '@/lib/program-types';
import type { DomainContext } from '../_shared';
import { requireProject, requireTask } from '../access';
import { logActivity } from '../activity';
import { notify } from '../notifications';
import { defaultStatus, insertTask, nextTaskNumber, projectStatuses } from '../tasks';
import { selectTaskSummaries } from '../task-queries';
import { calendarFor, centsOut, dayText, lockSettings, shared, todayInZone, versionConflict } from './_program';
import { requireProgram, seesMoney } from './access';
import { emitProgramsChanged } from './events';
import { refreshLedgerFor } from './ledger';
import { assertOpen, isLocked, programLocks, type ProgramLocks } from './locks';
import { jobPricesFor, resolvePostings } from './postings';
import { restampOutput, versionsFor } from './pricing';

const MAX_ROWS = 500;
const QTY = /^\d{1,8}(\.\d{1,3})?$/;

// --- Containers ----------------------------------------------------------------------------------

export interface BuildContainer {
  readonly project: Project;
  readonly settings: ProgramSettingsRow | null;
  readonly programId: string | null;
  readonly seesMoney: boolean;
  readonly timezone: string;
}

/** A program (by key) or a project (by key) that can hold builds, checked for `action`. */
export async function requireContainer(
  ctx: DomainContext,
  containerKey: string,
  action: 'project:read' | 'build:plan' | 'output:log' | 'task:create' | 'task:update' | 'task:delete' = 'project:read',
  executor: Executor = db,
): Promise<BuildContainer> {
  const { project } = await requireProject(ctx, /^[0-9a-f-]{36}$/i.test(containerKey) ? { id: containerKey } : { key: containerKey }, 'project:read', executor);
  if (project.kind === 'program') {
    const programAction = action === 'task:create' || action === 'task:update' ? 'build:plan' : action === 'task:delete' ? 'build:plan' : action;
    const access = await requireProgram(ctx, { id: project.id }, programAction, executor);
    return { project, settings: access.settings, programId: project.id, seesMoney: access.caps.seesMoney, timezone: access.settings.timezone };
  }
  const projectAction = action === 'build:plan' || action === 'output:log' ? 'task:update' : action;
  await requireProject(ctx, { id: project.id }, projectAction, executor);
  const zone = await executor.execute(sql`select timezone from pm.org_calendar where org_id = ${ctx.orgId}::uuid`);
  const timezone = (zone as unknown as { rows: { timezone: string }[] }).rows[0]?.timezone ?? 'America/Chicago';
  // Builds in a project carry no card; money there is the build rate and the job price.
  return { project, settings: null, programId: null, seesMoney: ctx.actorKind !== 'user' || ctx.orgRole === 'owner' || ctx.orgRole === 'admin' || project.ownerId === ctx.userId, timezone };
}

async function containerLocks(ctx: DomainContext, container: BuildContainer, executor: Executor): Promise<ProgramLocks | null> {
  return container.programId ? programLocks(ctx, container.project, executor) : null;
}

// --- Titles ----------------------------------------------------------------------------------------

/** `{variant} · {date}` with `{variant}`, `{date}`, `{qty}`, `{program}` and `{sku}`. */
export function buildTitle(pattern: string | null | undefined, values: { variant: string | null; date: IsoDate; qty: string; program: string; sku: string | null }): string {
  const text = (pattern || '{variant} · {date}')
    .replaceAll('{variant}', values.variant ?? 'Build')
    .replaceAll('{date}', dayText(values.date))
    .replaceAll('{qty}', fromScaled(quantityToScaled(values.qty), 3).replace(/\.?0+$/, ''))
    .replaceAll('{program}', values.program)
    .replaceAll('{sku}', values.sku ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s·]+|[\s·]+$/g, '')
    .trim();
  return text || `Build · ${dayText(values.date)}`;
}

// --- Insert ----------------------------------------------------------------------------------------

export interface InsertBuildInput {
  readonly variantId?: string | null;
  readonly buildDate: IsoDate;
  readonly plannedQty: string;
  readonly title?: string | null;
  readonly assigneeId?: string | null;
  readonly statusId?: string | null;
  readonly rateOverride?: string | null;
  readonly rateOverrideReason?: string | null;
  readonly plannedFrom?: PlannedFrom;
  readonly unplanned?: boolean;
  readonly scheduleId?: string | null;
  readonly scheduleDate?: IsoDate | null;
  readonly splitFromId?: string | null;
  readonly description?: string | null;
}

function assertQty(qty: string, field = 'plannedQty'): void {
  if (!QTY.test(qty.trim())) throw invalid('Use a number with up to 3 decimals.', { [field]: 'Use a number with up to 3 decimals.' });
}

/** Inserts one build (task row and builds row) in `tx`. No permission check: callers check. */
export async function insertBuild(
  tx: Executor,
  ctx: DomainContext,
  container: BuildContainer,
  input: InsertBuildInput,
  options: { readonly statusList?: readonly Status[]; readonly quiet?: boolean; readonly logVerb?: string } = {},
): Promise<{ taskId: string; number: number }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.buildDate)) throw invalid('Pick a valid build date.', { buildDate: 'Pick a valid date.' });
  assertQty(input.plannedQty);
  if (input.rateOverride) {
    const problem = buildRateProblem(input.rateOverride);
    if (problem) throw invalid(problem, { rateOverride: problem });
  }
  let variant: { id: string; name: string; sku: string | null } | null = null;
  if (input.variantId) {
    if (!container.programId) throw invalid('Builds in a project have no variant.');
    const [row] = await tx
      .select({ id: programVariants.id, name: programVariants.name, sku: programVariants.sku, status: programVariants.status })
      .from(programVariants)
      .where(and(eq(programVariants.id, input.variantId), eq(programVariants.programId, container.programId), isNull(programVariants.deletedAt)));
    if (!row) throw invalid('That variant is not part of this program.', { variantId: 'Pick a variant of this program.' });
    variant = row;
  }
  const title =
    input.title?.trim() ||
    buildTitle(container.settings?.buildTitlePattern, { variant: variant?.name ?? null, date: input.buildDate, qty: input.plannedQty, program: container.project.key, sku: variant?.sku ?? null });
  const task = await insertTask(
    tx,
    ctx,
    container.project,
    {
      projectId: container.project.id,
      title,
      description: input.description ?? null,
      statusId: input.statusId ?? null,
      assigneeId: input.assigneeId ?? null,
      startDate: input.buildDate,
      dueDate: input.buildDate,
    },
    { kind: 'build', statusList: options.statusList, quiet: options.quiet, logVerb: options.logVerb },
  );
  await tx.insert(builds).values({
    taskId: task.id,
    orgId: ctx.orgId,
    containerId: container.project.id,
    programId: container.programId,
    variantId: variant?.id ?? null,
    buildDate: input.buildDate,
    plannedQty: input.plannedQty,
    plannedFrom: input.plannedFrom ?? 'manual',
    rateOverride: input.rateOverride ?? null,
    rateOverrideReason: input.rateOverride ? (input.rateOverrideReason ?? null) : null,
    unplanned: input.unplanned ?? false,
    scheduleId: input.scheduleId ?? null,
    scheduleDate: input.scheduleDate ?? null,
    occurrenceVariantId: input.scheduleId ? (variant?.id ?? null) : null,
    splitFromId: input.splitFromId ?? null,
  });
  return { taskId: task.id, number: task.number };
}

// --- Reads -----------------------------------------------------------------------------------------

interface FactsRow {
  task_id: string;
  container_kind: 'project' | 'program';
  program_id: string | null;
  variant_id: string | null;
  variant_name: string | null;
  variant_color: string | null;
  build_date: string;
  planned_qty: string;
  planned_from: PlannedFrom;
  built_qty: string;
  scrap_qty: string;
  unplanned: boolean;
  closed_short: boolean;
  close_reason: string | null;
  split_from_id: string | null;
  split_key: string | null;
  rate_override: string | null;
  rate_override_reason: string | null;
  finished_on: string | null;
  schedule_id: string | null;
  version: number;
  revenue_cents: string | null;
  status_category: string;
}

async function buildFacts(executor: Executor, ctx: DomainContext, ids: readonly string[]): Promise<Map<string, FactsRow>> {
  if (ids.length === 0) return new Map();
  const list = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
  const result = await executor.execute(
    sql`select b.task_id::text as task_id, p.kind as container_kind, b.program_id::text as program_id, b.variant_id::text as variant_id,
               v.name as variant_name, v.color as variant_color, b.build_date::text as build_date, b.planned_qty::text as planned_qty,
               b.planned_from, b.built_qty::text as built_qty, b.scrap_qty::text as scrap_qty, b.unplanned, b.closed_short, b.close_reason,
               b.split_from_id::text as split_from_id, sp.key || '-' || st.number::text as split_key,
               b.rate_override::text as rate_override, b.rate_override_reason, b.finished_on::text as finished_on,
               b.schedule_id::text as schedule_id, b.version, s.category as status_category,
               (select coalesce(sum(o.revenue_cents), 0)::text from pm.build_output o where o.build_id = b.task_id and o.deleted_at is null) as revenue_cents
          from pm.builds b
          join pm.tasks t on t.id = b.task_id
          join pm.projects p on p.id = t.project_id
          join pm.statuses s on s.id = t.status_id
          left join pm.program_variants v on v.id = b.variant_id
          left join pm.tasks st on st.id = b.split_from_id
          left join pm.projects sp on sp.id = st.project_id
         where b.org_id = ${ctx.orgId}::uuid and b.task_id in (${list})`,
  );
  return new Map((result as unknown as { rows: FactsRow[] }).rows.map((row) => [row.task_id, row]));
}

/** BuildDTOs for task ids of one container, in the order given. */
export async function loadBuildDTOs(executor: Executor, ctx: DomainContext, container: BuildContainer, ids: readonly string[], locks?: ProgramLocks | null): Promise<BuildDTO[]> {
  if (ids.length === 0) return [];
  const [summaries, facts] = await Promise.all([selectTaskSummaries(inArray(tasks.id, [...ids]), { executor }), buildFacts(executor, ctx, ids)]);
  const theLocks = locks === undefined ? await containerLocks(ctx, container, executor) : locks;
  const versions = await versionsFor(executor, ctx, container.programId);
  const postings = await resolvePostings(executor, ctx, { programId: container.programId, buildIds: [...ids] });
  const today = todayInZone(container.timezone);
  const hidden = !container.seesMoney;
  const byId = new Map(summaries.map((row) => [row.id, row]));
  const out: BuildDTO[] = [];
  for (const id of ids) {
    const summary = byId.get(id);
    const fact = facts.get(id);
    if (!summary || !fact) continue;
    const target = postings.targets.get(id) ?? { posting: 'unbilled' as const, jobId: null };
    const job = target.jobId ? (target.posting === 'build_job' ? postings.buildJobs.get(id) : postings.programJob) : null;
    let currentPrice: BuildDTO['build']['currentPrice'] = null;
    if (!hidden) {
      const jobPrices = await jobPricesFor(executor, ctx, postings, target.jobId);
      const day = fact.build_date > today ? fact.build_date : today;
      try {
        const price = resolveUnitPrice({ workDate: day, variantId: fact.variant_id, buildOverride: fact.rate_override, versions, jobPrices });
        currentPrice = { unitPrice: price.unitPrice, source: price.source };
      } catch {
        currentPrice = null;
      }
    }
    const goesToJob = target.posting === 'build_job' || target.posting === 'program_job';
    const remaining = maxCents(ZERO, quantityToScaled(fact.planned_qty) - quantityToScaled(fact.built_qty));
    out.push({
      ...summary,
      kind: 'build',
      build: {
        containerKind: fact.container_kind,
        programId: fact.program_id,
        variantId: fact.variant_id,
        variantName: fact.variant_name,
        variantColor: fact.variant_color,
        buildDate: fact.build_date,
        plannedQty: fact.planned_qty,
        plannedFrom: fact.planned_from,
        plannedFromText: PLANNED_FROM_LABELS[fact.planned_from] ?? 'Typed',
        builtQty: fact.built_qty,
        remainingQty: fromScaled(fact.status_category === 'done' || fact.status_category === 'cancelled' ? ZERO : remaining, 3),
        scrapQty: fact.scrap_qty,
        unplanned: fact.unplanned,
        closedShort: fact.closed_short,
        closeReason: fact.close_reason,
        splitFrom: fact.split_from_id && fact.split_key ? { id: fact.split_from_id, key: fact.split_key } : null,
        rateOverride: hidden ? null : fact.rate_override,
        rateOverrideReason: hidden ? null : fact.rate_override_reason,
        currentPrice,
        revenueCents: centsOut(fact.revenue_cents, hidden),
        posting: target.posting,
        pulseJob: job && target.jobId ? { id: target.jobId, number: job.facts?.number ?? '' } : null,
        finishedOn: fact.finished_on,
        batchFeeLocked: Boolean(fact.finished_on && theLocks && isLocked(theLocks, fact.finished_on, { goesToJob: postings.programJob?.live === true })),
        runId: engineRunId({ scheduleId: fact.schedule_id, date: fact.build_date }),
        scheduleId: fact.schedule_id,
        locked: Boolean(theLocks && isLocked(theLocks, fact.build_date, { goesToJob })),
        version: Number(fact.version),
      },
    });
  }
  return out;
}

export interface ListBuildsOptions {
  readonly from?: IsoDate;
  readonly to?: IsoDate;
  readonly status?: readonly string[];
  readonly variantIds?: readonly string[];
  readonly assigneeIds?: readonly string[];
  readonly runId?: string;
  readonly cursor?: string | null;
  readonly limit?: number;
}

/** Builds of a container in a date window (default today minus 14 to plus 14 days). */
export async function listBuilds(ctx: DomainContext, containerKey: string, options: ListBuildsOptions = {}): Promise<BuildsPageDTO> {
  const container = await requireContainer(ctx, containerKey);
  const today = todayInZone(container.timezone);
  let from = options.from ?? addDays(today, -14);
  let to = options.to ?? addDays(today, 14);
  if (options.runId) {
    const match = /^run:([^:]+):(\d{4}-\d{2}-\d{2})$/.exec(options.runId);
    if (match) {
      from = match[2]!;
      to = match[2]!;
    }
  }
  const limit = Math.min(Math.max(options.limit ?? 200, 1), MAX_ROWS);
  const conditions = [sql`b.org_id = ${ctx.orgId}::uuid`, sql`b.container_id = ${container.project.id}::uuid`, sql`t.deleted_at is null`, sql`b.build_date between ${from}::date and ${to}::date`];
  if (options.status?.length) {
    const categories = options.status.filter((value) => ['todo', 'in_progress', 'done', 'cancelled'].includes(value));
    const ids = options.status.filter((value) => /^[0-9a-f-]{36}$/i.test(value));
    const parts = [];
    if (categories.length) parts.push(sql`s.category in (${sql.join(categories.map((c) => sql`${c}`), sql`, `)})`);
    if (ids.length) parts.push(sql`t.status_id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`);
    if (parts.length) conditions.push(sql`(${sql.join(parts, sql` or `)})`);
  }
  if (options.variantIds?.length) conditions.push(sql`b.variant_id in (${sql.join(options.variantIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id)).map((id) => sql`${id}::uuid`), sql`, `)})`);
  if (options.assigneeIds?.length) {
    const ids = options.assigneeIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    const none = options.assigneeIds.includes('none');
    const parts = [];
    if (ids.length) parts.push(sql`t.assignee_id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`);
    if (none) parts.push(sql`t.assignee_id is null`);
    if (parts.length) conditions.push(sql`(${sql.join(parts, sql` or `)})`);
  }
  if (options.runId) {
    const match = /^run:([^:]+):/.exec(options.runId);
    if (match?.[1] === 'manual') conditions.push(sql`b.schedule_id is null`);
    else if (match?.[1]) conditions.push(sql`b.schedule_id = ${match[1]}::uuid`);
  }
  if (options.cursor) {
    const [date, id] = Buffer.from(options.cursor, 'base64url').toString('utf8').split('|');
    if (date && id && /^\d{4}-\d{2}-\d{2}$/.test(date)) conditions.push(sql`(b.build_date, b.task_id) > (${date}::date, ${id}::uuid)`);
  }
  const result = await db.execute(
    sql`select b.task_id::text as id, b.build_date::text as build_date
          from pm.builds b join pm.tasks t on t.id = b.task_id join pm.statuses s on s.id = t.status_id
         where ${sql.join(conditions, sql` and `)}
         order by b.build_date, b.task_id
         limit ${limit + 1}`,
  );
  const rows = (result as unknown as { rows: { id: string; build_date: string }[] }).rows;
  const page = rows.slice(0, limit);
  const items = await loadBuildDTOs(db, ctx, container, page.map((row) => row.id));
  const last = page.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last ? Buffer.from(`${last.build_date}|${last.id}`, 'utf8').toString('base64url') : null,
    window: { from, to },
    moneyHidden: !container.seesMoney,
  };
}

async function containerOfTask(ctx: DomainContext, taskId: string, action: Parameters<typeof requireContainer>[2], executor: Executor = db): Promise<{ container: BuildContainer; build: Build }> {
  const { task } = await requireTask(ctx, taskId, 'project:read', executor);
  if (task.kind !== 'build') throw notFound('That build');
  const [build] = await executor.select().from(builds).where(eq(builds.taskId, taskId));
  if (!build) throw notFound('That build');
  const container = await requireContainer(ctx, task.projectId, action, executor);
  return { container, build };
}

export async function getBuild(ctx: DomainContext, taskId: string): Promise<BuildDTO> {
  const { container } = await containerOfTask(ctx, taskId, 'project:read');
  const [dto] = await loadBuildDTOs(db, ctx, container, [taskId]);
  if (!dto) throw notFound('That build');
  return dto;
}

// --- Create ----------------------------------------------------------------------------------------

export interface CreateBuildInput {
  readonly variantId?: string | null;
  readonly buildDate: IsoDate;
  readonly plannedQty: string;
  readonly title?: string | null;
  readonly assigneeId?: string | null;
  readonly statusId?: string | null;
  readonly rateOverride?: string | null;
  readonly reason?: string | null;
  readonly plannedFrom?: PlannedFrom;
}

export async function createBuild(ctx: DomainContext, containerKey: string, input: CreateBuildInput): Promise<BuildDTO> {
  const container = await requireContainer(ctx, containerKey, 'build:plan');
  if (container.project.archivedAt) throw invalid('This program is archived. Restore it to add builds.');
  const created = await db.transaction(async (tx) => {
    const locks = await containerLocks(ctx, container, tx);
    if (locks) assertOpen(locks, input.buildDate, { goesToJob: false });
    return insertBuild(tx, ctx, container, {
      variantId: input.variantId ?? null,
      buildDate: input.buildDate,
      plannedQty: input.plannedQty,
      title: input.title,
      assigneeId: input.assigneeId,
      statusId: input.statusId,
      rateOverride: input.rateOverride ? input.rateOverride.replace(/[$,\s]/g, '') : null,
      rateOverrideReason: input.reason ?? null,
      plannedFrom: input.plannedFrom ?? 'manual',
    });
  });
  return getBuild(ctx, created.taskId);
}

export interface CreateBuildsRow {
  readonly variantId: string | null;
  readonly buildDate: IsoDate;
  readonly plannedQty: string;
  readonly assigneeId?: string | null;
  readonly title?: string | null;
}

/** Planner and imports: up to 500 rows in one transaction. Rows on locked days are skipped. */
export async function createBuilds(
  ctx: DomainContext,
  key: string,
  rows: readonly CreateBuildsRow[],
  options: { readonly plannedFrom?: PlannedFrom } = {},
): Promise<{ createdIds: string[]; skipped: { reason: string; variantId: string | null; date: IsoDate }[] }> {
  if (rows.length > MAX_ROWS) throw invalid(`Make up to ${MAX_ROWS} builds at a time.`);
  const container = await requireContainer(ctx, key, 'build:plan');
  const result = await db.transaction(async (tx) => {
    const locks = await containerLocks(ctx, container, tx);
    const statusList = await projectStatuses(tx, container.project.id);
    const createdIds: string[] = [];
    const skipped: { reason: string; variantId: string | null; date: IsoDate }[] = [];
    for (const row of rows) {
      if (!QTY.test(row.plannedQty) || quantityToScaled(row.plannedQty) <= ZERO) {
        skipped.push({ reason: 'The qty is 0, so this line plans nothing.', variantId: row.variantId, date: row.buildDate });
        continue;
      }
      if (locks && isLocked(locks, row.buildDate, { goesToJob: false })) {
        skipped.push({ reason: `${dayText(row.buildDate)} is in a closed month.`, variantId: row.variantId, date: row.buildDate });
        continue;
      }
      const created = await insertBuild(
        tx,
        ctx,
        container,
        { variantId: row.variantId, buildDate: row.buildDate, plannedQty: row.plannedQty, assigneeId: row.assigneeId, title: row.title, plannedFrom: options.plannedFrom ?? 'planner' },
        { statusList, quiet: true },
      );
      createdIds.push(created.taskId);
    }
    if (createdIds.length > 1) {
      await logActivity(tx, ctx, {
        verb: 'build.planned',
        entityType: 'project',
        entityId: container.project.id,
        projectId: container.project.id,
        after: { count: createdIds.length, from: rows.map((r) => r.buildDate).sort()[0] ?? null, to: rows.map((r) => r.buildDate).sort().at(-1) ?? null },
      });
    }
    return { createdIds, skipped };
  });
  return result;
}

/** Undo for planner and import creates: removes builds that still have no output, time or comments. */
export async function undoCreateBuilds(ctx: DomainContext, ids: readonly string[]): Promise<{ removed: number; kept: number }> {
  const unique = [...new Set(ids)].slice(0, MAX_ROWS);
  if (unique.length === 0) return { removed: 0, kept: 0 };
  let removed = 0;
  await db.transaction(async (tx) => {
    const list = sql.join(unique.map((id) => sql`${id}::uuid`), sql`, `);
    const result = await tx.execute(
      sql`select t.id::text as id, t.project_id::text as project_id from pm.tasks t
           where t.org_id = ${ctx.orgId}::uuid and t.id in (${list}) and t.kind = 'build' and t.deleted_at is null
             and not exists (select 1 from pm.build_output o where o.build_id = t.id and o.deleted_at is null)
             and not exists (select 1 from pm.time_entries te where te.task_id = t.id and te.deleted_at is null)
             and not exists (select 1 from pm.comments c where c.task_id = t.id and c.deleted_at is null)`,
    );
    const rows = (result as unknown as { rows: { id: string; project_id: string }[] }).rows;
    const checked = new Set<string>();
    for (const row of rows) {
      if (!checked.has(row.project_id)) {
        await requireContainer(ctx, row.project_id, 'build:plan', tx);
        checked.add(row.project_id);
      }
    }
    if (rows.length > 0) {
      const removeList = sql.join(rows.map((row) => sql`${row.id}::uuid`), sql`, `);
      await tx.execute(sql`update pm.tasks set deleted_at = now(), updated_at = now() where id in (${removeList})`);
      for (const projectId of checked) {
        await logActivity(tx, ctx, { verb: 'build.updated', entityType: 'project', entityId: projectId, projectId, after: { undone: rows.filter((r) => r.project_id === projectId).length } });
      }
    }
    removed = rows.length;
  });
  return { removed, kept: unique.length - removed };
}

// --- Update ----------------------------------------------------------------------------------------

export interface UpdateBuildPatch {
  readonly variantId?: string | null;
  readonly buildDate?: IsoDate;
  readonly plannedQty?: string;
  readonly rateOverride?: string | null;
  readonly rateOverrideReason?: string | null;
  readonly title?: string;
  readonly assigneeId?: string | null;
}

async function hasLockedOutput(tx: Executor, buildId: string, locks: ProgramLocks | null): Promise<boolean> {
  if (!locks) return false;
  const result = await tx.execute(sql`select work_date::text as work_date, posting from pm.build_output where build_id = ${buildId}::uuid and deleted_at is null`);
  return (result as unknown as { rows: { work_date: string; posting: string }[] }).rows.some((row) =>
    isLocked(locks, row.work_date, { goesToJob: row.posting === 'program_job' || row.posting === 'build_job' }),
  );
}

const LOCKED_OUTPUT_EDIT = 'This build has output in a closed month. Make a new build instead.';

export async function updateBuild(ctx: DomainContext, taskId: string, patch: UpdateBuildPatch, expectedVersion: number | null = null): Promise<BuildDTO> {
  const { container, build } = await containerOfTask(ctx, taskId, 'build:plan');
  await db.transaction(async (tx) => {
    if (container.programId) await lockSettings(tx, [container.programId], 'update');
    const [current] = await tx.select().from(builds).where(eq(builds.taskId, taskId)).for('update');
    if (!current) throw notFound('That build');
    if (expectedVersion !== null && current.version !== expectedVersion) throw versionConflict();
    const locks = await containerLocks(ctx, container, tx);
    const set: Partial<typeof builds.$inferInsert> = {};
    const entries: { field: string; before: unknown; after: unknown; money?: boolean }[] = [];
    let reprice = false;
    if (patch.variantId !== undefined && patch.variantId !== current.variantId) {
      if (!container.programId) throw invalid('Builds in a project have no variant.');
      if (patch.variantId) {
        const [variant] = await tx.select({ id: programVariants.id }).from(programVariants).where(and(eq(programVariants.id, patch.variantId), eq(programVariants.programId, container.programId), isNull(programVariants.deletedAt)));
        if (!variant) throw invalid('That variant is not part of this program.', { variantId: 'Pick a variant of this program.' });
      }
      if (await hasLockedOutput(tx, taskId, locks)) throw locked(LOCKED_OUTPUT_EDIT);
      set.variantId = patch.variantId;
      entries.push({ field: 'variant', before: current.variantId, after: patch.variantId });
      reprice = true;
    }
    if (patch.rateOverride !== undefined) {
      const next = patch.rateOverride ? patch.rateOverride.replace(/[$,\s]/g, '') : null;
      if (next) {
        const problem = buildRateProblem(next);
        if (problem) throw invalid(problem, { rateOverride: problem });
      }
      if ((next ?? null) !== (current.rateOverride ?? null)) {
        if (await hasLockedOutput(tx, taskId, locks)) throw locked(LOCKED_OUTPUT_EDIT);
        set.rateOverride = next;
        set.rateOverrideReason = next ? (patch.rateOverrideReason ?? current.rateOverrideReason ?? null) : null;
        entries.push({ field: 'rate_override', before: current.rateOverride, after: next, money: true });
        reprice = true;
      }
    } else if (patch.rateOverrideReason !== undefined && current.rateOverride) {
      set.rateOverrideReason = patch.rateOverrideReason;
    }
    if (patch.plannedQty !== undefined && patch.plannedQty !== current.plannedQty) {
      assertQty(patch.plannedQty);
      set.plannedQty = patch.plannedQty;
      entries.push({ field: 'planned_qty', before: current.plannedQty, after: patch.plannedQty });
    }
    const taskSet: Partial<typeof tasks.$inferInsert> = {};
    if (patch.buildDate !== undefined && patch.buildDate !== current.buildDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(patch.buildDate)) throw invalid('Pick a valid build date.', { buildDate: 'Pick a valid date.' });
      if (locks) {
        assertOpen(locks, current.buildDate, { goesToJob: false });
        assertOpen(locks, patch.buildDate, { goesToJob: false });
      }
      set.buildDate = patch.buildDate;
      taskSet.startDate = patch.buildDate;
      taskSet.dueDate = patch.buildDate;
      entries.push({ field: 'build_date', before: current.buildDate, after: patch.buildDate });
    }
    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (!title) throw invalid('Give the build a name.', { title: 'Give the build a name.' });
      taskSet.title = title.slice(0, 500);
    }
    if (patch.assigneeId !== undefined) taskSet.assigneeId = patch.assigneeId;
    if (Object.keys(set).length > 0) {
      await tx.update(builds).set({ ...set, version: sql`${builds.version} + 1`, updatedAt: new Date() }).where(eq(builds.taskId, taskId));
    }
    if (Object.keys(taskSet).length > 0) await tx.update(tasks).set({ ...taskSet, updatedAt: new Date() }).where(eq(tasks.id, taskId));
    let repriced = 0;
    if (reprice) repriced = await restampOutput(tx, ctx, { containerId: container.project.id, programId: container.programId, locks, buildIds: [taskId] });
    if (container.programId && (reprice || set.buildDate)) {
      const months = await outputMonths(tx, taskId);
      await refreshLedgerFor(tx, ctx, { programIds: [container.programId], months: [...months, monthOf(current.buildDate)] });
    }
    for (const entry of entries) {
      await logActivity(tx, ctx, {
        verb: entry.field === 'rate_override' ? 'build.rate_override_set' : 'build.updated',
        entityType: 'task',
        entityId: taskId,
        projectId: container.project.id,
        taskId,
        field: entry.field,
        before: entry.money ? { money: { rateOverride: entry.before } } : entry.before,
        after: entry.money ? { money: { rateOverride: entry.after }, repriced } : entry.after,
      });
    }
    if (repriced > 0) {
      await logActivity(tx, ctx, { verb: 'build.repriced', entityType: 'task', entityId: taskId, projectId: container.project.id, taskId, after: { rows: repriced } });
    }
  });
  await emitProgramsChanged(ctx, [container.programId]);
  void build;
  return getBuild(ctx, taskId);
}

async function outputMonths(tx: Executor, buildId: string): Promise<string[]> {
  const result = await tx.execute(sql`select distinct to_char(work_date, 'YYYY-MM') as month from pm.build_output where build_id = ${buildId}::uuid`);
  return (result as unknown as { rows: { month: string }[] }).rows.map((row) => row.month);
}

// --- Move, split, close short, duplicate, copy, cancel ---------------------------------------------

export async function moveBuild(ctx: DomainContext, taskId: string, input: { readonly toContainerKey: string; readonly variantId?: string | null }): Promise<BuildDTO> {
  const { container: source } = await containerOfTask(ctx, taskId, 'build:plan');
  const target = await requireContainer(ctx, input.toContainerKey, 'build:plan');
  if (target.project.id === source.project.id) {
    if (input.variantId !== undefined) return updateBuild(ctx, taskId, { variantId: input.variantId });
    return getBuild(ctx, taskId);
  }
  await db.transaction(async (tx) => {
    await lockSettings(tx, [source.programId, target.programId].filter((id): id is string => Boolean(id)), 'update');
    const [current] = await tx.select().from(builds).where(eq(builds.taskId, taskId)).for('update');
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, taskId));
    if (!current || !task) throw notFound('That build');
    const sourceLocks = await containerLocks(ctx, source, tx);
    const targetLocks = await containerLocks(ctx, target, tx);
    if (await hasLockedOutput(tx, taskId, sourceLocks)) throw locked('This build has output in a closed month. Copy it instead.');
    if (targetLocks) assertOpen(targetLocks, current.buildDate, { goesToJob: false });
    let variantId: string | null = null;
    if (input.variantId && target.programId) {
      const [variant] = await tx.select({ id: programVariants.id }).from(programVariants).where(and(eq(programVariants.id, input.variantId), eq(programVariants.programId, target.programId), isNull(programVariants.deletedAt)));
      if (!variant) throw invalid('That variant is not part of the program you picked.', { variantId: 'Pick a variant of that program.' });
      variantId = variant.id;
    }
    const [sourceStatuses, targetStatuses] = await Promise.all([projectStatuses(tx, source.project.id), projectStatuses(tx, target.project.id)]);
    const category = sourceStatuses.find((s) => s.id === task.statusId)?.category ?? 'todo';
    const statusId = (targetStatuses.find((s) => s.category === category) ?? defaultStatus(targetStatuses)).id;
    const number = await nextTaskNumber(tx, target.project.id);
    await tx.execute(sql`select set_config('pm.build_move', 'on', true)`);
    await tx.update(tasks).set({ projectId: target.project.id, number, statusId, sectionId: null, milestoneId: null, updatedAt: new Date() }).where(eq(tasks.id, taskId));
    await tx
      .update(builds)
      .set({ containerId: target.project.id, programId: target.programId, variantId, scheduleId: null, version: sql`${builds.version} + 1`, updatedAt: new Date() })
      .where(eq(builds.taskId, taskId));
    await tx.execute(sql`select set_config('pm.build_move', 'off', true)`);
    await tx.execute(sql`update pm.build_output set container_id = ${target.project.id}::uuid, program_id = ${target.programId}::uuid, variant_id = ${variantId}::uuid, updated_at = now() where build_id = ${taskId}::uuid and deleted_at is null`);
    await tx.execute(sql`update pm.time_entries set project_id = ${target.project.id}::uuid where task_id = ${taskId}::uuid`);
    await tx.execute(sql`update pm.comments set project_id = ${target.project.id}::uuid where task_id = ${taskId}::uuid`);
    await tx.execute(sql`update pm.attachments set project_id = ${target.project.id}::uuid where task_id = ${taskId}::uuid`);
    await restampOutput(tx, ctx, { containerId: target.project.id, programId: target.programId, locks: targetLocks, buildIds: [taskId] });
    const months = await outputMonths(tx, taskId);
    await refreshLedgerFor(tx, ctx, { programIds: [source.programId, target.programId], months: [...months, monthOf(current.buildDate)] });
    const before = { projectId: source.project.id, key: taskKey(source.project.key, task.number) };
    const after = { projectId: target.project.id, key: taskKey(target.project.key, number) };
    await logActivity(tx, ctx, [
      { verb: 'build.moved', entityType: 'task', entityId: taskId, projectId: source.project.id, taskId, before, after },
      { verb: 'build.moved', entityType: 'task', entityId: taskId, projectId: target.project.id, taskId, before, after },
    ]);
  });
  await emitProgramsChanged(ctx, [source.programId, target.programId]);
  return getBuild(ctx, taskId);
}

async function statusOf(tx: Executor, projectId: string, category: 'done' | 'cancelled' | 'todo'): Promise<Status> {
  const list = await projectStatuses(tx, projectId);
  const status = category === 'todo' ? defaultStatus(list) : list.find((s) => s.category === category);
  if (!status) throw invalid(category === 'done' ? 'This program has no Done status. Add one in Settings.' : 'This program has no Cancelled status. Add one in Settings.');
  return status;
}

/** Sets a build's status through the generic task path (so the finish trigger, ledger and automations run). */
async function setStatus(tx: Executor, ctx: DomainContext, container: BuildContainer, taskId: string, status: Status): Promise<void> {
  const { applyTaskUpdate } = await import('../tasks');
  const [task] = await tx.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task || task.statusId === status.id) return;
  await applyTaskUpdate(tx, ctx, container.project, task, { statusId: status.id });
}

export async function closeShortIn(tx: Executor, ctx: DomainContext, container: BuildContainer, taskId: string, reason: string): Promise<void> {
  const text = reason.trim();
  if (!text) throw invalid('Say why the build closed short.', { reason: 'Say why the build closed short.' });
  await tx.update(builds).set({ closedShort: true, closeReason: text.slice(0, 500), version: sql`${builds.version} + 1`, updatedAt: new Date() }).where(eq(builds.taskId, taskId));
  await setStatus(tx, ctx, container, taskId, await statusOf(tx, container.project.id, 'done'));
  await logActivity(tx, ctx, { verb: 'build.closed_short', entityType: 'task', entityId: taskId, projectId: container.project.id, taskId, after: { reason: text } });
}

export async function closeShort(ctx: DomainContext, taskId: string, input: { readonly reason: string }): Promise<BuildDTO> {
  const { container } = await containerOfTask(ctx, taskId, 'output:log');
  await db.transaction(async (tx) => {
    await closeShortIn(tx, ctx, container, taskId, input.reason);
    if (container.programId) await refreshLedgerFor(tx, ctx, { programIds: [container.programId], dates: [todayInZone(container.timezone)] });
  });
  await emitProgramsChanged(ctx, [container.programId]);
  return getBuild(ctx, taskId);
}

/** Moves what is left of a build to a new build on `toDate`; the original closes at its built qty. */
export async function splitBuildIn(tx: Executor, ctx: DomainContext, container: BuildContainer, taskId: string, input: { readonly qty?: string | null; readonly toDate: IsoDate }): Promise<string> {
  const [current] = await tx.select().from(builds).where(eq(builds.taskId, taskId)).for('update');
  const [task] = await tx.select().from(tasks).where(eq(tasks.id, taskId));
  if (!current || !task) throw notFound('That build');
  const left = quantityToScaled(current.plannedQty) - quantityToScaled(current.builtQty);
  const qty = input.qty ? quantityToScaled(input.qty) : left;
  if (qty <= ZERO) throw invalid('Nothing is left to move on this build.');
  const locks = await containerLocks(ctx, container, tx);
  if (locks) assertOpen(locks, input.toDate, { goesToJob: false });
  const qtyText = fromScaled(qty, 3);
  const created = await insertBuild(tx, ctx, container, {
    variantId: current.variantId,
    buildDate: input.toDate,
    plannedQty: qtyText,
    assigneeId: task.assigneeId,
    rateOverride: current.rateOverride,
    rateOverrideReason: current.rateOverrideReason,
    plannedFrom: 'split',
    splitFromId: taskId,
  });
  const newPlanned = quantityToScaled(current.builtQty);
  await tx
    .update(builds)
    .set({ plannedQty: fromScaled(newPlanned > ZERO ? newPlanned : ZERO, 3), closedShort: false, closeReason: `Moved ${qtyText.replace(/\.?0+$/, '')} to ${dayText(input.toDate)}`, version: sql`${builds.version} + 1`, updatedAt: new Date() })
    .where(eq(builds.taskId, taskId));
  const doneOrCancel = quantityToScaled(current.builtQty) > ZERO ? 'done' : 'cancelled';
  await setStatus(tx, ctx, container, taskId, await statusOf(tx, container.project.id, doneOrCancel));
  try {
    await linkRecords(shared(tx), { orgId: ctx.orgId, from: { type: 'pm_build', id: created.taskId }, to: { type: 'pm_build', id: taskId }, relation: 'created_from', createdBy: ctx.userId });
  } catch {
    // The split_from_id column already records where it came from.
  }
  await logActivity(tx, ctx, {
    verb: 'build.split',
    entityType: 'task',
    entityId: taskId,
    projectId: container.project.id,
    taskId,
    after: { qty: qtyText, toDate: input.toDate, newBuildId: created.taskId, newKey: taskKey(container.project.key, created.number) },
  });
  return created.taskId;
}

export async function splitBuild(ctx: DomainContext, taskId: string, input: { readonly qty?: string | null; readonly toDate: IsoDate }): Promise<{ newBuildId: string }> {
  const { container } = await containerOfTask(ctx, taskId, 'build:plan');
  const newBuildId = await db.transaction(async (tx) => {
    const id = await splitBuildIn(tx, ctx, container, taskId, input);
    if (container.programId) await refreshLedgerFor(tx, ctx, { programIds: [container.programId], dates: [todayInZone(container.timezone)] });
    return id;
  });
  await emitProgramsChanged(ctx, [container.programId]);
  return { newBuildId };
}

export async function duplicateBuild(ctx: DomainContext, taskId: string, input: { readonly to: 'here' | 'tomorrow' | 'next_scheduled' | IsoDate }): Promise<BuildDTO> {
  const { container, build } = await containerOfTask(ctx, taskId, 'build:plan');
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task) throw notFound('That build');
  let date = build.buildDate;
  if (input.to === 'tomorrow') date = addDays(todayInZone(container.timezone), 1);
  else if (input.to === 'next_scheduled' && container.programId) {
    const calendar = await calendarFor(db, ctx, container.project, container.settings ?? undefined);
    date = nextWorkDay(calendar, build.buildDate);
  } else if (input.to !== 'here' && /^\d{4}-\d{2}-\d{2}$/.test(input.to)) date = input.to;
  const created = await db.transaction(async (tx) => {
    const locks = await containerLocks(ctx, container, tx);
    if (locks) assertOpen(locks, date, { goesToJob: false });
    return insertBuild(tx, ctx, container, {
      variantId: build.variantId,
      buildDate: date,
      plannedQty: build.plannedQty,
      assigneeId: task.assigneeId,
      rateOverride: build.rateOverride,
      rateOverrideReason: build.rateOverrideReason,
      title: input.to === 'here' ? `${task.title} (copy)` : null,
      plannedFrom: 'manual',
    });
  });
  return getBuild(ctx, created.taskId);
}

/** Copies the builds of one day to other days, with planned qty or what was built. */
export async function copyDay(ctx: DomainContext, key: string, input: { readonly fromDate: IsoDate; readonly toDates: readonly IsoDate[]; readonly mode: 'planned' | 'built' }): Promise<{ createdIds: string[] }> {
  const container = await requireContainer(ctx, key, 'build:plan');
  const result = await db.execute(
    sql`select b.variant_id::text as variant_id, b.planned_qty::text as planned_qty, b.built_qty::text as built_qty, t.assignee_id::text as assignee_id
          from pm.builds b join pm.tasks t on t.id = b.task_id join pm.statuses s on s.id = t.status_id
         where b.container_id = ${container.project.id}::uuid and t.deleted_at is null and b.build_date = ${input.fromDate}::date and s.category <> 'cancelled'
         order by t.position`,
  );
  const source = (result as unknown as { rows: { variant_id: string | null; planned_qty: string; built_qty: string; assignee_id: string | null }[] }).rows;
  const rows: CreateBuildsRow[] = [];
  for (const date of [...new Set(input.toDates)].slice(0, 31)) {
    for (const row of source) {
      const qty = input.mode === 'built' ? row.built_qty : row.planned_qty;
      if (quantityToScaled(qty) <= ZERO) continue;
      rows.push({ variantId: row.variant_id, buildDate: date, plannedQty: qty, assigneeId: row.assignee_id });
    }
  }
  const created = await createBuilds(ctx, key, rows, { plannedFrom: 'planner' });
  return { createdIds: created.createdIds };
}

/** Cancels builds: logged output and its per unit revenue stay; no batch fee (A7). */
export async function cancelBuilds(ctx: DomainContext, ids: readonly string[]): Promise<{ changed: number }> {
  return changeBuildStatus(ctx, ids, 'cancelled');
}

/** Brings cancelled builds back to the first to do status. */
export async function restoreBuilds(ctx: DomainContext, ids: readonly string[]): Promise<{ changed: number }> {
  return changeBuildStatus(ctx, ids, 'todo');
}

async function changeBuildStatus(ctx: DomainContext, ids: readonly string[], category: 'cancelled' | 'todo'): Promise<{ changed: number }> {
  const unique = [...new Set(ids)].slice(0, MAX_ROWS);
  const programs = new Set<string>();
  let changed = 0;
  const groups = new Map<string, string[]>();
  for (const id of unique) {
    const [row] = await db.select({ projectId: tasks.projectId, kind: tasks.kind }).from(tasks).where(and(eq(tasks.id, id), eq(tasks.orgId, ctx.orgId), isNull(tasks.deletedAt)));
    if (!row || row.kind !== 'build') continue;
    groups.set(row.projectId, [...(groups.get(row.projectId) ?? []), id]);
  }
  for (const [projectId, taskIds] of groups) {
    const container = await requireContainer(ctx, projectId, 'build:plan');
    await db.transaction(async (tx) => {
      const status = await statusOf(tx, projectId, category);
      const statusRows = await tx.select({ id: statuses.id, category: statuses.category }).from(statuses).where(eq(statuses.projectId, projectId));
      const categoryOf = new Map(statusRows.map((row) => [row.id, row.category]));
      const months = new Set<string>();
      for (const taskId of taskIds) {
        const [task] = await tx.select().from(tasks).where(eq(tasks.id, taskId));
        if (!task) continue;
        const was = categoryOf.get(task.statusId);
        if (category === 'todo' && was !== 'cancelled') continue;
        if (category === 'cancelled' && was === 'cancelled') continue;
        const [current] = await tx.select({ finishedOn: builds.finishedOn, buildDate: builds.buildDate }).from(builds).where(eq(builds.taskId, taskId));
        if (current?.finishedOn) months.add(monthOf(current.finishedOn));
        if (current?.buildDate) months.add(monthOf(current.buildDate));
        await setStatus(tx, ctx, container, taskId, status);
        changed += 1;
      }
      if (container.programId && months.size > 0) {
        await refreshLedgerFor(tx, ctx, { programIds: [container.programId], months: [...months] });
        programs.add(container.programId);
      }
    });
  }
  await emitProgramsChanged(ctx, programs);
  return { changed };
}

// --- Notifications ---------------------------------------------------------------------------------

/** One summary notification for generated builds assigned to a person. */
export async function notifyGenerated(tx: Executor, ctx: DomainContext, container: BuildContainer, byAssignee: ReadonlyMap<string, number>): Promise<void> {
  for (const [userId, count] of byAssignee) {
    if (count === 0) continue;
    await notify(tx, ctx, {
      recipients: [userId],
      kind: 'assigned',
      title: `${count} ${container.project.key} ${count === 1 ? 'build was' : 'builds were'} planned for you`,
      url: routes.programBuilds(container.project.key),
      projectId: container.project.id,
    });
  }
}

/** Per unit revenue a qty would earn at a price (for previews). */
export function previewCents(qty: string, unitPrice: string): string {
  return mulQuantityPrice(qty, unitPrice).toString();
}

export { seesMoney };
