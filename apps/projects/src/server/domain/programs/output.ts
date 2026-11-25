/**
 * Output (docs/programs/SPEC.md 4.3.3): the log sheet for a day, `logOutput` (one transaction per
 * batch: lock checks, the settings row `FOR SHARE`, build rows `FOR UPDATE` in task id order,
 * add or set writes, price snapshots, auto start and done, Close the day, ledger refresh), undo,
 * delete and `repriceOpenDays`.
 */
import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { runId as engineRunId } from '@kitstak/programs-engine/runs';
import { monthOf } from '@kitstak/programs-engine/calendar';
import { fromScaled, maxCents, quantityToScaled, ZERO } from '@kitstak/programs-engine/money';
import { nextWorkDay } from '@kitstak/programs-engine/schedule';
import { db, type Executor } from '@/server/db';
import { builds, tasks, type Status } from '@/server/db/schema';
import { DomainError, forbidden, invalid, notFound } from '@/server/errors';
import { env } from '@/server/env';
import type { IsoDate, LogOutputInput, OutputSheetDTO, OutputSheetRow, UndoToken } from '@/lib/program-types';
import { taskKey } from '@/lib/task-key';
import type { DomainContext } from '../_shared';
import { logActivity, type ActivityEntry } from '../activity';
import { getPeople } from '../people';
import { applyTaskUpdate, projectStatuses } from '../tasks';
import { calendarFor, centsOut, lockSettings, pgError, todayInZone } from './_program';
import { closeShortIn, insertBuild, requireContainer, splitBuildIn, type BuildContainer } from './builds';
import { emitProgramsChanged } from './events';
import { refreshLedgerFor } from './ledger';
import { assertOpen, containerLocks, lockMessage, lockReason, type ProgramLocks } from './locks';
import { resolvePostings } from './postings';
import { restampOutput, snapshotFor, versionsFor } from './pricing';

const QTY = /^\d{1,8}(\.\d{1,3})?$/;
const qtyText = (scaled: bigint): string => fromScaled(scaled, 3);

// --- Sheet ---------------------------------------------------------------------------------------

interface SheetRaw {
  id: string;
  number: number;
  title: string;
  status_id: string;
  category: OutputSheetRow['statusCategory'];
  assignee_id: string | null;
  variant_id: string | null;
  variant_name: string | null;
  variant_color: string | null;
  variant_sku: string | null;
  variant_key: string | null;
  pack_qty: string | null;
  build_date: string;
  planned_qty: string;
  built_qty: string;
  unplanned: boolean;
  schedule_id: string | null;
  version: number;
  today_id: string | null;
  today_qty: string | null;
  today_scrap: string | null;
  today_version: number | null;
  today_price: string | null;
  today_source: string | null;
}

async function sheetRows(executor: Executor, ctx: DomainContext, containerId: string, date: IsoDate, runId: string | null): Promise<SheetRaw[]> {
  const result = await executor.execute(
    sql`select t.id::text as id, t.number, t.title, t.status_id::text as status_id, s.category, t.assignee_id::text as assignee_id,
               b.variant_id::text as variant_id, v.name as variant_name, v.color as variant_color, v.sku as variant_sku, v.key as variant_key,
               v.pack_qty::text as pack_qty, b.build_date::text as build_date, b.planned_qty::text as planned_qty, b.built_qty::text as built_qty,
               b.unplanned, b.schedule_id::text as schedule_id, b.version,
               o.id::text as today_id, o.qty::text as today_qty, o.scrap_qty::text as today_scrap, o.version as today_version,
               o.unit_price::text as today_price, o.price_source as today_source
          from pm.builds b
          join pm.tasks t on t.id = b.task_id and t.deleted_at is null
          join pm.statuses s on s.id = t.status_id
          left join pm.program_variants v on v.id = b.variant_id
          left join pm.build_output o on o.build_id = b.task_id and o.work_date = ${date}::date and o.deleted_at is null
         where b.org_id = ${ctx.orgId}::uuid and b.container_id = ${containerId}::uuid
           and (b.build_date = ${date}::date
                or o.id is not null
                or (b.build_date < ${date}::date and b.build_date >= (${date}::date - 31) and s.category in ('todo', 'in_progress') and b.built_qty < b.planned_qty))
         order by (b.build_date = ${date}::date) desc, v.position nulls last, t.position`,
  );
  const rows = (result as unknown as { rows: SheetRaw[] }).rows;
  if (!runId) return rows;
  return rows.filter((row) => engineRunId({ scheduleId: row.schedule_id, date: row.build_date }) === runId || (row.build_date !== date && runId.endsWith(`:${date}`)));
}

export async function getOutputSheet(ctx: DomainContext, key: string, date: IsoDate, options: { readonly runId?: string | null } = {}): Promise<OutputSheetDTO> {
  const container = await requireContainer(ctx, key);
  return outputSheet(db, ctx, container, date, options.runId ?? null);
}

async function outputSheet(executor: Executor, ctx: DomainContext, container: BuildContainer, date: IsoDate, runId: string | null): Promise<OutputSheetDTO> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw invalid('Pick a valid date.', { date: 'Pick a valid date.' });
  const rows = await sheetRows(executor, ctx, container.project.id, date, runId);
  const locks = await containerLocks(ctx, container, executor);
  const postings = await resolvePostings(executor, ctx, { programId: container.programId, buildIds: rows.map((row) => row.id) });
  const versions = await versionsFor(executor, ctx, container.programId);
  const people = await getPeople(rows.map((row) => row.assignee_id).filter((id): id is string => Boolean(id)), executor);
  const hidden = !container.seesMoney;
  const goesToJob = [...postings.targets.values()].some((target) => target.posting === 'build_job' || target.posting === 'program_job');
  const reason = locks ? lockReason(locks, date, { goesToJob }) : null;
  const out: OutputSheetRow[] = [];
  for (const row of rows) {
    let unitPrice = row.today_price;
    let source = (row.today_source ?? 'none') as OutputSheetRow['priceSource'];
    if (!row.today_id) {
      const snap = await snapshotFor(executor, ctx, { buildId: row.id, variantId: row.variant_id, rateOverride: null, workDate: date, qty: '0', versions, postings });
      unitPrice = snap.unitPrice;
      source = snap.priceSource;
    }
    const builtToday = row.today_qty ?? '0.000';
    const builtBefore = qtyText(maxCents(ZERO, quantityToScaled(row.built_qty) - quantityToScaled(builtToday)));
    const assignee = row.assignee_id ? (people.get(row.assignee_id) ?? null) : null;
    out.push({
      buildId: row.id,
      key: taskKey(container.project.key, row.number),
      title: row.title,
      variant: row.variant_id ? { id: row.variant_id, name: row.variant_name ?? 'Variant', color: row.variant_color, sku: row.variant_sku } : null,
      buildDate: row.build_date,
      carriedOver: row.build_date < date,
      unplanned: row.unplanned,
      runId: engineRunId({ scheduleId: row.schedule_id, date: row.build_date }),
      statusId: row.status_id,
      statusCategory: row.category,
      plannedQty: row.planned_qty,
      builtBefore,
      builtToday,
      scrapToday: row.today_scrap ?? '0.000',
      outputId: row.today_id,
      outputVersion: row.today_version === null ? null : Number(row.today_version),
      unitPrice: hidden ? null : unitPrice,
      priceSource: source,
      assignee,
      version: Number(row.version),
    });
  }
  // Day revenue straight from the stored snapshots.
  const dayCents = await executor.execute(
    sql`select coalesce(sum(revenue_cents), 0)::text as cents from pm.build_output
         where container_id = ${container.project.id}::uuid and work_date = ${date}::date and deleted_at is null`,
  );
  const revenue = BigInt((dayCents as unknown as { rows: { cents: string }[] }).rows[0]?.cents ?? '0');
  const calendar = container.programId ? await calendarFor(executor, ctx, container.project, container.settings ?? undefined) : null;
  return {
    date,
    locked: reason !== null,
    lockReason: reason && locks ? lockMessage(locks, date, reason) : null,
    nextWorkDay: calendar ? nextWorkDay(calendar, date) : date,
    rows: out,
    totals: {
      plannedUnits: qtyText(out.filter((row) => !row.carriedOver).reduce((sum, row) => sum + quantityToScaled(row.plannedQty), ZERO)),
      builtUnits: qtyText(out.reduce((sum, row) => sum + quantityToScaled(row.builtToday), ZERO)),
      revenueCents: centsOut(revenue, hidden),
    },
    scanIndex: out.map((row) => {
      const raw = rows.find((r) => r.id === row.buildId);
      return { sku: raw?.variant_sku ?? null, variantKey: raw?.variant_key ?? null, buildKey: row.key, buildId: row.buildId, packQty: raw?.pack_qty ?? '1.000' };
    }),
    moneyHidden: hidden,
  };
}

// --- Log -----------------------------------------------------------------------------------------

type Entry = LogOutputInput['entries'][number];

function isNew(entry: Entry): entry is Extract<Entry, { newBuild: unknown }> {
  return 'newBuild' in entry;
}

async function statusList(tx: Executor, projectId: string): Promise<Status[]> {
  return projectStatuses(tx, projectId);
}

async function moveStatus(tx: Executor, ctx: DomainContext, container: BuildContainer, taskId: string, category: 'in_progress' | 'done', list: readonly Status[]): Promise<void> {
  const target = list.find((s) => s.category === category);
  if (!target) return;
  const [task] = await tx.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task || task.statusId === target.id) return;
  await applyTaskUpdate(tx, ctx, container.project, task, { statusId: target.id });
}

export interface LogOutputResult {
  readonly sheet: OutputSheetDTO;
  readonly undo: SignedUndoToken;
  readonly createdBuildIds: string[];
}

// --- Undo tokens ---------------------------------------------------------------------------------

/** How long the Undo of a batch stays good. */
export const UNDO_WINDOW_MS = 10 * 60_000;

/** One build of a batch as the batch left it: its output row version for the day and its status. */
export interface UndoAfter {
  readonly buildId: string;
  readonly version: number | null;
  readonly statusId: string | null;
}

/**
 * The Undo of one batch, signed by the server (HMAC with `BETTER_AUTH_SECRET`). The signature
 * binds the org, the container, the person who logged, the day, the before values, the builds the
 * batch made and the versions it left, so a client can only hand back a token this exact log call
 * issued, and only for a short while. `after` also stops a replay: once anything on those rows
 * changes (the undo itself included), the versions no longer match.
 */
export interface SignedUndoToken extends UndoToken {
  readonly after: readonly UndoAfter[];
  readonly issuedAt: number;
  readonly sig: string;
}

type UnsignedUndo = Omit<SignedUndoToken, 'sig' | 'issuedAt'>;

function undoActor(ctx: DomainContext): string {
  return ctx.actorKind === 'user' ? `user:${ctx.userId}` : ctx.actorKind;
}

function undoSignature(ctx: DomainContext, containerId: string, token: Omit<SignedUndoToken, 'sig'>): string {
  const body = JSON.stringify([
    'pm-output-undo-v1',
    ctx.orgId,
    containerId,
    undoActor(ctx),
    token.date,
    token.entries.map((entry) => [entry.buildId, entry.qty, entry.scrapQty, entry.statusId]),
    [...token.createdBuildIds],
    token.after.map((row) => [row.buildId, row.version, row.statusId]),
    token.issuedAt,
  ]);
  return createHmac('sha256', `${env.BETTER_AUTH_SECRET}:pm-output-undo`).update(body).digest('base64url');
}

function signUndo(ctx: DomainContext, containerId: string, token: UnsignedUndo): SignedUndoToken {
  const issued = { ...token, issuedAt: Date.now() };
  return { ...issued, sig: undoSignature(ctx, containerId, issued) };
}

/** Refuses a token this server did not issue for this container and person, or one that is too old. */
function verifyUndo(ctx: DomainContext, containerId: string, token: SignedUndoToken): void {
  const given = Buffer.from(typeof token.sig === 'string' ? token.sig : '');
  const expected = Buffer.from(undoSignature(ctx, containerId, token));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw forbidden('This undo does not belong to this sheet. Reload to see the latest output.');
  const age = Date.now() - Number(token.issuedAt);
  if (!Number.isFinite(age) || age < -60_000 || age > UNDO_WINDOW_MS) throw invalid('Undo has expired. Change the numbers on the sheet instead.');
}

const UNDO_STALE = 'Someone changed this output after it was logged. Change the numbers on the sheet instead.';

function checkLogInput(container: BuildContainer, input: LogOutputInput): IsoDate {
  const date = input.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw invalid('Pick a valid date.', { date: 'Pick a valid date.' });
  const today = todayInZone(container.timezone);
  if (date > today) throw invalid('Output can be logged for today or earlier.', { date: 'Pick today or an earlier day.' });
  for (const entry of input.entries) {
    if (!QTY.test(entry.qty)) throw invalid('Use a number with up to 3 decimals.', { qty: 'Use a number with up to 3 decimals.' });
    if (entry.scrapQty && !QTY.test(entry.scrapQty)) throw invalid('Use a number with up to 3 decimals.', { scrapQty: 'Use a number with up to 3 decimals.' });
  }
  return today;
}

/**
 * Settings row first, then the locks (4.3.3 step 2, M9, 8.4): a month close takes the same row
 * `FOR UPDATE`, so the locks read after it are the ones in force until this transaction ends. A
 * plain project has no settings row; its builds that bill to a Pulse job still answer to the Pulse
 * closed months.
 */
async function lockedProgramLocks(tx: Executor, ctx: DomainContext, container: BuildContainer): Promise<ProgramLocks> {
  if (container.programId) await lockSettings(tx, [container.programId], 'update');
  return containerLocks(ctx, container, tx);
}

/** Logs a batch of output for one day (4.3.3). */
export async function logOutput(ctx: DomainContext, key: string, input: LogOutputInput): Promise<LogOutputResult> {
  const container = await requireContainer(ctx, key, 'output:log');
  const today = checkLogInput(container, input);
  const outcome = await db.transaction((tx) => logOutputIn(tx, ctx, container, input, today));
  await emitProgramsChanged(ctx, [container.programId]);
  const sheet = await outputSheet(db, ctx, container, input.date, null);
  return { sheet, undo: signUndo(ctx, container.project.id, outcome.undo), createdBuildIds: outcome.createdBuildIds };
}

/** The body of `logOutput`, in the caller's transaction (undo runs it with its own steps). */
async function logOutputIn(
  tx: Executor,
  ctx: DomainContext,
  container: BuildContainer,
  input: LogOutputInput,
  today: IsoDate,
): Promise<{ createdBuildIds: string[]; undo: UnsignedUndo; changedMonths: string[] }> {
  const date = input.date;
  const locks = await lockedProgramLocks(tx, ctx, container);
  const statuses = await statusList(tx, container.project.id);
  const createdBuildIds: string[] = [];
  // "Add a row": an unplanned build dated `date` with planned = qty.
  const resolved: { buildId: string; entry: Entry }[] = [];
  for (const entry of input.entries) {
    if (isNew(entry)) {
      if (quantityToScaled(entry.qty) <= ZERO) continue;
      const created = await insertBuild(tx, ctx, container, {
        variantId: entry.newBuild.variantId,
        buildDate: date,
        plannedQty: entry.qty,
        title: entry.newBuild.title ?? null,
        plannedFrom: 'unplanned',
        unplanned: true,
      });
      createdBuildIds.push(created.taskId);
      resolved.push({ buildId: created.taskId, entry: { buildId: created.taskId, mode: 'add', qty: entry.qty, scrapQty: entry.scrapQty, note: entry.note, markDone: entry.markDone } });
    } else {
      resolved.push({ buildId: entry.buildId, entry });
    }
  }
  const ids = [...new Set(resolved.map((row) => row.buildId))].sort();
  if (ids.length === 0 && !input.endOfDay?.decisions.length) return { createdBuildIds, undo: { date, entries: [], createdBuildIds, after: [] }, changedMonths: [] as string[] };
  const locked = ids.length
    ? await tx.select().from(builds).where(and(inArray(builds.taskId, ids), eq(builds.containerId, container.project.id))).orderBy(builds.taskId).for('update')
    : [];
  const byId = new Map(locked.map((row) => [row.taskId, row]));
  for (const id of ids) if (!byId.has(id)) throw notFound('That build');
  const postings = await resolvePostings(tx, ctx, { programId: container.programId, buildIds: ids });
  const versions = await versionsFor(tx, ctx, container.programId);
  const taskRows = ids.length ? await tx.select().from(tasks).where(inArray(tasks.id, ids)) : [];
  const taskById = new Map(taskRows.map((row) => [row.id, row]));
  const undo: UndoToken['entries'][number][] = [];
  const activity: ActivityEntry[] = [];
  for (const { buildId, entry } of resolved) {
    const build = byId.get(buildId)!;
    const task = taskById.get(buildId);
    if (!task || task.deletedAt) throw notFound('That build');
    const target = postings.targets.get(buildId);
    const goesToJob = target?.posting === 'build_job' || target?.posting === 'program_job';
    assertOpen(locks, date, { goesToJob });
    const e = entry as Extract<Entry, { buildId: string }>;
    const [existing] = await tx.execute(
      sql`select id::text as id, qty::text as qty, scrap_qty::text as scrap_qty, version, posting from pm.build_output
           where build_id = ${buildId}::uuid and work_date = ${date}::date and deleted_at is null`,
    ).then((r) => (r as unknown as { rows: { id: string; qty: string; scrap_qty: string; version: number; posting: string }[] }).rows);
    if (existing) assertOpen(locks, date, { goesToJob: existing.posting === 'program_job' || existing.posting === 'build_job' });
    const beforeQty = existing?.qty ?? '0.000';
    const beforeScrap = existing?.scrap_qty ?? '0.000';
    // The first entry of a build holds its before values; a later entry of the same build is not.
    if (!undo.some((row) => row.buildId === buildId)) undo.push({ buildId, qty: beforeQty, scrapQty: beforeScrap, statusId: task.statusId });
    const addQty = quantityToScaled(e.qty);
    const addScrap = quantityToScaled(e.scrapQty ?? '0');
    let nextQty: bigint;
    let nextScrap: bigint;
    if (e.mode === 'add') {
      nextQty = quantityToScaled(beforeQty) + addQty;
      nextScrap = quantityToScaled(beforeScrap) + addScrap;
    } else {
      const expected = e.expectedVersion ?? null;
      if (existing ? Number(existing.version) !== expected : expected !== null) throw new DomainError('CONFLICT', 'Someone else changed this. Reload to see their change.');
      nextQty = addQty;
      nextScrap = e.scrapQty !== undefined ? addScrap : quantityToScaled(beforeScrap);
    }
    const snap = await snapshotFor(tx, ctx, { buildId, variantId: build.variantId, rateOverride: build.rateOverride, workDate: date, qty: qtyText(nextQty), versions, postings });
    try {
      await tx.transaction(async (sp) => {
        if (e.mode === 'add') {
          await sp.execute(
            sql`insert into pm.build_output (org_id, container_id, program_id, build_id, variant_id, work_date, qty, scrap_qty, unit_price,
                                             price_source, card_version_id, revenue_cents, posting, pulse_job_id, source, note, entered_by)
                values (${ctx.orgId}::uuid, ${container.project.id}::uuid, ${container.programId}::uuid, ${buildId}::uuid, ${build.variantId}::uuid,
                        ${date}::date, ${e.qty}::numeric, ${e.scrapQty ?? '0'}::numeric, ${snap.unitPrice}::numeric, ${snap.priceSource},
                        ${snap.cardVersionId}::uuid, ${snap.revenueCents}::bigint, ${snap.posting}, ${snap.pulseJobId}::uuid, 'manual',
                        ${e.note ?? null}, ${ctx.actorKind === 'user' ? ctx.userId : null}::uuid)
                on conflict (build_id, work_date) where deleted_at is null do update set
                  qty = build_output.qty + excluded.qty, scrap_qty = build_output.scrap_qty + excluded.scrap_qty,
                  note = coalesce(excluded.note, build_output.note), version = build_output.version + 1, updated_at = now()`,
          );
          // Restamp from the stored total, so concurrent adds price the sum once (M1).
          await sp.execute(
            sql`update pm.build_output set unit_price = ${snap.unitPrice}::numeric, price_source = ${snap.priceSource},
                     card_version_id = ${snap.cardVersionId}::uuid, posting = ${snap.posting}, pulse_job_id = ${snap.pulseJobId}::uuid,
                     revenue_cents = round(qty * ${snap.unitPrice}::numeric * 100)::bigint
                 where build_id = ${buildId}::uuid and work_date = ${date}::date and deleted_at is null`,
          );
        } else if (existing) {
          if (nextQty === ZERO && nextScrap === ZERO) {
            const removed = await sp.execute(sql`update pm.build_output set deleted_at = now(), updated_at = now() where id = ${existing.id}::uuid and version = ${existing.version} and deleted_at is null returning id`);
            if ((removed as unknown as { rows: unknown[] }).rows.length === 0) throw new DomainError('CONFLICT', 'Someone else changed this. Reload to see their change.');
          } else {
            const updated = await sp.execute(
              sql`update pm.build_output set qty = ${qtyText(nextQty)}::numeric, scrap_qty = ${qtyText(nextScrap)}::numeric,
                       unit_price = ${snap.unitPrice}::numeric, price_source = ${snap.priceSource}, card_version_id = ${snap.cardVersionId}::uuid,
                       revenue_cents = ${snap.revenueCents}::bigint, posting = ${snap.posting}, pulse_job_id = ${snap.pulseJobId}::uuid,
                       note = coalesce(${e.note ?? null}, note), version = version + 1, updated_at = now()
                   where id = ${existing.id}::uuid and version = ${existing.version} returning id`,
            );
            if ((updated as unknown as { rows: unknown[] }).rows.length === 0) throw new DomainError('CONFLICT', 'Someone else changed this. Reload to see their change.');
          }
        } else if (nextQty > ZERO || nextScrap > ZERO) {
          await sp.execute(
            sql`insert into pm.build_output (org_id, container_id, program_id, build_id, variant_id, work_date, qty, scrap_qty, unit_price,
                                             price_source, card_version_id, revenue_cents, posting, pulse_job_id, source, note, entered_by)
                values (${ctx.orgId}::uuid, ${container.project.id}::uuid, ${container.programId}::uuid, ${buildId}::uuid, ${build.variantId}::uuid,
                        ${date}::date, ${qtyText(nextQty)}::numeric, ${qtyText(nextScrap)}::numeric, ${snap.unitPrice}::numeric, ${snap.priceSource},
                        ${snap.cardVersionId}::uuid, ${snap.revenueCents}::bigint, ${snap.posting}, ${snap.pulseJobId}::uuid, 'manual',
                        ${e.note ?? null}, ${ctx.actorKind === 'user' ? ctx.userId : null}::uuid)`,
          );
        }
      });
    } catch (error) {
      if (error instanceof DomainError) throw error;
      const pg = pgError(error);
      if (pg?.code === '23505' || pg?.code === '40001') throw new DomainError('CONFLICT', 'Someone else changed this. Reload to see their change.');
      throw error;
    }
    // built_qty follows the live output total under the row lock.
    const totals = await tx.execute(
      sql`update pm.builds set built_qty = coalesce((select sum(qty) from pm.build_output where build_id = ${buildId}::uuid and deleted_at is null), 0),
               scrap_qty = coalesce((select sum(scrap_qty) from pm.build_output where build_id = ${buildId}::uuid and deleted_at is null), 0),
               version = version + 1, updated_at = now()
           where task_id = ${buildId}::uuid returning built_qty::text as built_qty, planned_qty::text as planned_qty`,
    );
    const after = (totals as unknown as { rows: { built_qty: string; planned_qty: string }[] }).rows[0];
    // Status: auto start, then done when full or asked.
    const category = statuses.find((s) => s.id === task.statusId)?.category ?? 'todo';
    const built = quantityToScaled(after?.built_qty ?? '0');
    const full = built >= quantityToScaled(after?.planned_qty ?? '0') && built > ZERO;
    const autoDone = container.settings?.autoDoneWhenFull ?? true;
    const autoStart = container.settings?.autoStartOnOutput ?? true;
    if ((e.markDone || (autoDone && full)) && category !== 'done' && category !== 'cancelled') {
      await moveStatus(tx, ctx, container, buildId, 'done', statuses);
    } else if (autoStart && category === 'todo' && built > ZERO) {
      await moveStatus(tx, ctx, container, buildId, 'in_progress', statuses);
    }
    activity.push({
      verb: 'build.output_logged',
      entityType: 'task',
      entityId: buildId,
      projectId: container.project.id,
      taskId: buildId,
      before: { qty: beforeQty, date },
      after: {
        qty: qtyText(nextQty),
        date,
        variant: build.variantId,
        money: { revenueCents: snap.revenueCents, unitPrice: snap.unitPrice },
      },
    });
  }
  // Close the day.
  for (const decision of input.endOfDay?.decisions ?? []) {
    if (decision.action === 'leave_open') continue;
    const [task] = await tx.select({ id: tasks.id, projectId: tasks.projectId }).from(tasks).where(and(eq(tasks.id, decision.buildId), isNull(tasks.deletedAt)));
    if (!task || task.projectId !== container.project.id) throw notFound('That build');
    if (decision.action === 'close_short') {
      await closeShortIn(tx, ctx, container, decision.buildId, decision.reason ?? '');
    } else {
      const calendar = container.programId ? await calendarFor(tx, ctx, container.project, container.settings ?? undefined) : null;
      const toDate = decision.toDate ?? (calendar ? nextWorkDay(calendar, date) : date);
      await splitBuildIn(tx, ctx, container, decision.buildId, { toDate });
    }
  }
  await logActivity(tx, ctx, activity);
  const months = [monthOf(date), monthOf(today)];
  if (container.programId) await refreshLedgerFor(tx, ctx, { programIds: [container.programId], months });
  return { createdBuildIds, undo: { date, entries: undo, createdBuildIds, after: await afterState(tx, ctx, container, date, ids) }, changedMonths: months };
}

/** Output row versions of the day and statuses of `ids`, as a batch leaves them (for Undo). */
async function afterState(tx: Executor, ctx: DomainContext, container: BuildContainer, date: IsoDate, ids: readonly string[]): Promise<UndoAfter[]> {
  if (ids.length === 0) return [];
  const versions = await liveVersions(tx, ctx, container, date, ids);
  const statusRows = await tx.select({ id: tasks.id, statusId: tasks.statusId }).from(tasks).where(inArray(tasks.id, [...ids]));
  const statusById = new Map(statusRows.map((row) => [row.id, row.statusId]));
  return [...ids].sort().map((buildId) => ({ buildId, version: versions.get(buildId) ?? null, statusId: statusById.get(buildId) ?? null }));
}

async function liveVersions(tx: Executor, ctx: DomainContext, container: BuildContainer, date: IsoDate, ids: readonly string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const result = await tx.execute(
    sql`select build_id::text as build_id, version from pm.build_output
         where org_id = ${ctx.orgId}::uuid and container_id = ${container.project.id}::uuid and work_date = ${date}::date and deleted_at is null
           and build_id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`,
  );
  return new Map((result as unknown as { rows: { build_id: string; version: number }[] }).rows.map((row) => [row.build_id, Number(row.version)]));
}

/**
 * Puts a batch back to its before values (from `logOutput`'s `undo`), in one transaction. The
 * token must be one this server signed for this container and this person, within
 * `UNDO_WINDOW_MS`; every row it names must still be as the batch left it. Only builds that batch
 * made are removed, and only their output on the batch's day.
 */
export async function undoLogOutput(ctx: DomainContext, key: string, undo: SignedUndoToken): Promise<OutputSheetDTO> {
  const container = await requireContainer(ctx, key, 'output:log');
  verifyUndo(ctx, container.project.id, undo);
  const createdIds = [...new Set(undo.createdBuildIds)];
  const created = new Set(createdIds);
  const entries = undo.entries.filter((entry) => !created.has(entry.buildId));
  const today = checkLogInput(container, { date: undo.date, entries: entries.map((entry) => ({ buildId: entry.buildId, mode: 'set' as const, qty: entry.qty, scrapQty: entry.scrapQty, expectedVersion: null })) });
  if (entries.length === 0 && createdIds.length === 0) return outputSheet(db, ctx, container, undo.date, null);
  const afterById = new Map(undo.after.map((row) => [row.buildId, row]));
  await db.transaction(async (tx) => {
    const locks = await lockedProgramLocks(tx, ctx, container);
    // One lock order for every build row this undo touches (8.4).
    const allIds = [...new Set([...entries.map((entry) => entry.buildId), ...createdIds])].sort();
    const owned = await tx
      .select({ taskId: builds.taskId, unplanned: builds.unplanned, plannedFrom: builds.plannedFrom })
      .from(builds)
      .where(and(inArray(builds.taskId, allIds), eq(builds.containerId, container.project.id), eq(builds.orgId, ctx.orgId)))
      .orderBy(builds.taskId)
      .for('update');
    const ownedById = new Map(owned.map((row) => [row.taskId, row]));
    for (const id of allIds) if (!ownedById.has(id)) throw notFound('That build');
    for (const id of createdIds) {
      const row = ownedById.get(id)!;
      if (!row.unplanned || row.plannedFrom !== 'unplanned') throw notFound('That build');
    }
    // Every row is still as the batch left it (no later log, edit or undo).
    const live = await liveVersions(tx, ctx, container, undo.date, allIds);
    for (const id of allIds) {
      const after = afterById.get(id);
      if (!after || (live.get(id) ?? null) !== after.version) throw new DomainError('CONFLICT', UNDO_STALE);
    }
    if (entries.length > 0) {
      const ids = entries.map((entry) => entry.buildId);
      const statusRows = await tx.select({ id: tasks.id, statusId: tasks.statusId }).from(tasks).where(and(inArray(tasks.id, ids), eq(tasks.projectId, container.project.id), isNull(tasks.deletedAt)));
      const statusNow = new Map(statusRows.map((row) => [row.id, row.statusId]));
      await logOutputIn(
        tx,
        ctx,
        container,
        {
          date: undo.date,
          entries: entries.map((entry) => ({ buildId: entry.buildId, mode: 'set' as const, qty: entry.qty, scrapQty: entry.scrapQty, expectedVersion: live.get(entry.buildId) ?? null })),
        },
        today,
      );
      for (const entry of entries) {
        // A status someone set by hand since the batch stays.
        if (statusNow.get(entry.buildId) !== afterById.get(entry.buildId)?.statusId) continue;
        const [task] = await tx.select().from(tasks).where(and(eq(tasks.id, entry.buildId), eq(tasks.projectId, container.project.id), isNull(tasks.deletedAt)));
        if (task && task.statusId !== entry.statusId) await applyTaskUpdate(tx, ctx, container.project, task, { statusId: entry.statusId });
      }
    }
    if (createdIds.length > 0) {
      const list = sql.join(createdIds.map((id) => sql`${id}::uuid`), sql`, `);
      const liveTasks = await tx.execute(sql`select id from pm.tasks where org_id = ${ctx.orgId}::uuid and project_id = ${container.project.id}::uuid and id in (${list}) and deleted_at is null`);
      if ((liveTasks as unknown as { rows: unknown[] }).rows.length !== createdIds.length) throw notFound('That build');
      // Undo removes the whole build, so it may only remove what this batch made. Output on
      // another day (maybe a closed day) or time on the build would silently drop with it.
      const otherDays = await tx.execute(
        sql`select 1 from pm.build_output
             where org_id = ${ctx.orgId}::uuid and build_id in (${list})
               and work_date <> ${undo.date}::date and deleted_at is null
             limit 1`,
      );
      if ((otherDays as unknown as { rows: unknown[] }).rows.length > 0) {
        throw new DomainError('CONFLICT', 'This build has output on other days. Remove that output first.');
      }
      const time = await tx.execute(
        sql`select 1 from pm.time_entries
             where org_id = ${ctx.orgId}::uuid and task_id in (${list}) and deleted_at is null
             limit 1`,
      );
      if ((time as unknown as { rows: unknown[] }).rows.length > 0) {
        throw new DomainError('CONFLICT', 'This build has time logged. Remove that time first.');
      }
      const rows = await tx.execute(
        sql`select posting from pm.build_output
             where org_id = ${ctx.orgId}::uuid and container_id = ${container.project.id}::uuid and build_id in (${list})
               and work_date = ${undo.date}::date and deleted_at is null`,
      );
      for (const row of (rows as unknown as { rows: { posting: string }[] }).rows) {
        assertOpen(locks, undo.date, { goesToJob: row.posting === 'program_job' || row.posting === 'build_job' });
      }
      assertOpen(locks, undo.date, { goesToJob: false });
      await tx.execute(
        sql`update pm.build_output set deleted_at = now(), updated_at = now()
             where org_id = ${ctx.orgId}::uuid and container_id = ${container.project.id}::uuid and build_id in (${list})
               and deleted_at is null and work_date = ${undo.date}::date`,
      );
      await tx.execute(
        sql`update pm.builds b set built_qty = coalesce((select sum(o.qty) from pm.build_output o where o.build_id = b.task_id and o.deleted_at is null), 0),
                 scrap_qty = coalesce((select sum(o.scrap_qty) from pm.build_output o where o.build_id = b.task_id and o.deleted_at is null), 0),
                 version = b.version + 1, updated_at = now()
             where b.org_id = ${ctx.orgId}::uuid and b.container_id = ${container.project.id}::uuid and b.task_id in (${list})`,
      );
      await tx.execute(
        sql`update pm.tasks set deleted_at = now(), updated_at = now()
             where org_id = ${ctx.orgId}::uuid and project_id = ${container.project.id}::uuid and id in (${list}) and deleted_at is null`,
      );
      await logActivity(
        tx,
        ctx,
        createdIds.map((id) => ({ verb: 'build.output_undone', entityType: 'task', entityId: id, projectId: container.project.id, taskId: id, after: { date: undo.date, removedBuild: true } })),
      );
      if (container.programId) await refreshLedgerFor(tx, ctx, { programIds: [container.programId], dates: [undo.date, today] });
    }
  });
  await emitProgramsChanged(ctx, [container.programId]);
  return outputSheet(db, ctx, container, undo.date, null);
}

/** Removes one output row (a day of a build). */
export async function deleteOutput(ctx: DomainContext, outputId: string, expectedVersion: number): Promise<void> {
  const [row] = await db
    .execute(sql`select id::text as id, build_id::text as build_id, container_id::text as container_id, work_date::text as work_date, version, posting, qty::text as qty from pm.build_output where id = ${outputId}::uuid and org_id = ${ctx.orgId}::uuid and deleted_at is null`)
    .then((r) => (r as unknown as { rows: { id: string; build_id: string; container_id: string; work_date: string; version: number; posting: string; qty: string }[] }).rows);
  if (!row) throw notFound('That output');
  const container = await requireContainer(ctx, row.container_id, 'output:log');
  await db.transaction(async (tx) => {
    assertOpen(await lockedProgramLocks(tx, ctx, container), row.work_date, { goesToJob: row.posting === 'program_job' || row.posting === 'build_job' });
    await tx.select({ id: builds.taskId }).from(builds).where(eq(builds.taskId, row.build_id)).for('update');
    const removed = await tx.execute(sql`update pm.build_output set deleted_at = now(), updated_at = now() where id = ${outputId}::uuid and version = ${expectedVersion} and deleted_at is null returning id`);
    if ((removed as unknown as { rows: unknown[] }).rows.length === 0) throw new DomainError('CONFLICT', 'Someone else changed this. Reload to see their change.');
    await tx.execute(
      sql`update pm.builds set built_qty = coalesce((select sum(qty) from pm.build_output where build_id = ${row.build_id}::uuid and deleted_at is null), 0),
               scrap_qty = coalesce((select sum(scrap_qty) from pm.build_output where build_id = ${row.build_id}::uuid and deleted_at is null), 0),
               version = version + 1, updated_at = now() where task_id = ${row.build_id}::uuid`,
    );
    await logActivity(tx, ctx, { verb: 'build.output_deleted', entityType: 'task', entityId: row.build_id, projectId: container.project.id, taskId: row.build_id, before: { qty: row.qty, date: row.work_date } });
    if (container.programId) await refreshLedgerFor(tx, ctx, { programIds: [container.programId], dates: [row.work_date, todayInZone(container.timezone)] });
  });
  await emitProgramsChanged(ctx, [container.programId]);
}

/**
 * Re-resolves open output prices from a date (after a publish, a build rate, a variant, a job price
 * or a posting change). Internal: callers hold the transaction and refresh the ledger.
 */
export async function repriceOpenDays(tx: Executor, ctx: DomainContext, program: { id: string; key: string }, from: IsoDate | null): Promise<number> {
  const locks = await containerLocks(ctx, { project: program, programId: program.id }, tx);
  return restampOutput(tx, ctx, { containerId: program.id, programId: program.id, locks, from });
}

/** Units logged per variant for a program over a range (forecasts and previews). */
export async function variantUnits(executor: Executor, programId: string, from: IsoDate, to: IsoDate): Promise<Map<string | null, string>> {
  const result = await executor.execute(
    sql`select variant_id::text as variant_id, coalesce(sum(qty), 0)::text as units from pm.build_output
         where program_id = ${programId}::uuid and deleted_at is null and work_date between ${from}::date and ${to}::date group by 1`,
  );
  return new Map((result as unknown as { rows: { variant_id: string | null; units: string }[] }).rows.map((row) => [row.variant_id, row.units]));
}
