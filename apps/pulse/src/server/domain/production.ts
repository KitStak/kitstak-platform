/**
 * Daily production entries (SPEC 5.3): the Log work grid and the Work log of a job.
 * One row per job, day, shift and labor class. Every save stamps the row (rate, labor cost,
 * revenue, standard material), spreads time not on a job for the touched pool and rebuilds the
 * job's numbers, all in one transaction. Deletes are soft and can be restored (undo).
 */
import 'server-only';
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm';
import { db, type Executor } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { clients, dayReviews, jobStats, jobs, productionEntries } from '@/server/db/schema';
import { conflict, DomainError, forbidden, invalid, notFound } from '@/server/errors';
import { SUPERVISOR_EDIT_DAYS, type JobStatusValue, type StreamSource } from '@/lib/constants';
import { canPulse } from '@/lib/permissions';
import { addDays } from '@/lib/profit';
import type { LogGridDTO, LogGridRowDTO, PreviousCrewDTO, ProductionEntryDTO, SaveProductionResult } from '@/lib/types';
import { assertVersion, cleanText, defined, diff, inTx, iso, isoRequired, isUuid, moneyOut, monthStart, rows, todayInZone, type DomainContext } from './_shared';
import { requirePulse, type PulseAccess } from './access';
import { logActivity } from './activity';
import { getSiteRow, resolveSite } from './catalog';
import { getJobRow, type JobRow } from './jobs';
import { assertOpen, closedMonths, finishWrite, newTouched, restampFixedJob, restampProduction, touchDay, type Touched } from './recalc';
import { toDayReviewDTO } from './reviews';
import { listIndirect, listPaidHours } from './time';
import { loadSettings } from './settings';

type EntryRow = typeof productionEntries.$inferSelect;
type Access = Pick<PulseAccess, 'seesMoney'>;

export function toProductionDTO(row: EntryRow, job: { number: string; name: string }, access: Access, closed: ReadonlySet<string>): ProductionEntryDTO {
  const money = access.seesMoney;
  return {
    id: row.id,
    siteId: row.siteId,
    jobId: row.jobId,
    jobNumber: job.number,
    jobName: job.name,
    workDate: row.workDate,
    shift: row.shift,
    laborClassId: row.laborClassId,
    unitsGood: row.unitsGood,
    unitsScrap: row.unitsScrap,
    unitsRework: row.unitsRework,
    headcount: row.headcount,
    hours: row.hours,
    overtimeHours: row.overtimeHours,
    setupHours: row.setupHours,
    hoursConfirmed: row.hoursConfirmed,
    note: row.note,
    rateCents: moneyOut(money, row.rateCents),
    overtimeRateCents: moneyOut(money, row.overtimeRateCents),
    laborCostCents: moneyOut(money, row.laborCostCents),
    sharedCents: moneyOut(money, row.sharedCents),
    baseRevenueCents: moneyOut(money, row.baseRevenueCents),
    stdMaterialCents: moneyOut(money, row.stdMaterialCents),
    stdScrapCents: moneyOut(money, row.stdScrapCents),
    needsRate: row.needsRate,
    enteredBy: row.enteredBy,
    source: row.source as StreamSource,
    sourceRef: row.sourceRef,
    isSample: row.isSample,
    version: row.version,
    createdBy: row.createdBy,
    createdAt: isoRequired(row.createdAt),
    updatedAt: isoRequired(row.updatedAt),
    deletedAt: iso(row.deletedAt),
    locked: closed.has(monthStart(row.workDate)),
    moneyHidden: !money,
  };
}

/**
 * Who may change a day (SPEC section 3). Managers and up: any open day. Supervisors: the last
 * 7 days at the site, and only while the day is not marked complete.
 */
export const assertCanLogDay = scoped(async function assertCanLogDay(executor: Executor, ctx: DomainContext, access: Pick<PulseAccess, 'role'>, siteId: string, timezone: string, date: string): Promise<void> {
  if (canPulse(access.role, 'production:edit_any')) return;
  const reason = await dayLockReason(executor, ctx, access, siteId, timezone, date);
  if (reason) throw forbidden(reason);
}, 1);

/** The reason this reader may not change the day, or null when they may. */
export const dayLockReason = scoped(async function dayLockReason(executor: Executor, ctx: DomainContext, access: Pick<PulseAccess, 'role'>, siteId: string, timezone: string, date: string): Promise<string | null> {
  if (!canPulse(access.role, 'production:log')) return 'Your Pulse role cannot log work. Ask an admin of your workspace if you need it.';
  if (canPulse(access.role, 'production:edit_any')) return null;
  const today = todayInZone(timezone);
  if (date > today) return FUTURE_DAY;
  if (date < addDays(today, -SUPERVISOR_EDIT_DAYS)) return `You can change the last ${SUPERVISOR_EDIT_DAYS} days. Ask a manager to fix an older day.`;
  const [review] = await executor.select({ status: dayReviews.status }).from(dayReviews).where(and(eq(dayReviews.orgId, ctx.orgId), eq(dayReviews.siteId, siteId), eq(dayReviews.workDate, date)));
  if (review && review.status !== 'sent_back') return 'This day is marked complete. Ask a manager to send it back if it needs a fix.';
  return null;
}, 1);

export interface ProductionInput {
  /** Edit this row. Without it the row is matched on job, day, shift and labor class, else created. */
  id?: string | null;
  jobId: string;
  workDate: string;
  shift?: string | null;
  laborClassId?: string | null;
  unitsGood?: string;
  unitsScrap?: string;
  unitsRework?: string;
  /** People. */
  headcount?: string | null;
  /** Total labor hours (people times hours each). */
  hours?: string;
  overtimeHours?: string;
  setupHours?: string;
  hoursConfirmed?: boolean;
  note?: string | null;
  /** The version the editor read (autosave). A mismatch is a CONFLICT. */
  version?: number | null;
  source?: StreamSource;
  sourceRef?: string | null;
  isSample?: boolean;
  importBatchId?: string | null;
}

export interface SaveOptions {
  /**
   * A save a person makes from a screen (PUT /api/v1/log/rows, the bulk save action): changing a
   * row that already exists needs the version the editor read. A missing or old version is a
   * CONFLICT, never an overwrite.
   */
  readonly requireVersion?: boolean;
}

const STALE_ROW = 'Someone else changed this row. Here is the new one.';
export const FUTURE_DAY = 'Work cannot be dated after today. Pick today or an earlier day.';
const ZERO_PEOPLE = 'Hours need people. Type how many people worked, or leave People empty.';
const SAME_LINE_TWICE = 'This labor class is already on this day. Put its people and hours on one line.';

/** Sources that copy a fact from another KitStak app. Their dates are not typed, so the future day rule skips them. */
const SYNCED_SOURCES: ReadonlySet<string> = new Set(['wms', 'projects', 'punch']);

/**
 * Work that was done cannot be dated after today at the site (SPEC 5.3). Every typed write path
 * ends here: the day form, the log grid, the bulk page and the API. Imports mark the row instead.
 */
export function assertNotFutureDay(timezone: string, workDate: string, field = 'workDate'): void {
  if (workDate > todayInZone(timezone)) throw invalid(FUTURE_DAY, { [field]: 'This day is after today.' });
}

/** One row per job, day, shift and labor type: the key two lines of one save may not share. */
const lineKey = (jobId: string, workDate: string, shift: string, laborClassId: string | null): string => `${jobId}|${workDate}|${shift}|${laborClassId ?? ''}`;

const num = (value: string | null | undefined): number => Number(value ?? 0);

function checkHours(hours: string, overtime: string, setup: string): void {
  if (num(overtime) > num(hours)) throw invalid('Overtime hours cannot be more than the labor hours.', { overtimeHours: 'More than the labor hours.' });
  if (num(setup) > num(hours)) throw invalid('Setup hours cannot be more than the labor hours.', { setupHours: 'More than the labor hours.' });
}

/** Fields a person changed on a synced row are remembered, so the next sync does not overwrite them. */
function lockedFields(row: EntryRow, changed: readonly string[]): Record<string, unknown> {
  if (row.source === 'manual' || row.source === 'csv' || row.source === 'sample') return row.meta ?? {};
  const prior = Array.isArray((row.meta ?? {}).locked_fields) ? ((row.meta ?? {}).locked_fields as string[]) : [];
  return { ...(row.meta ?? {}), locked_fields: [...new Set([...prior, ...changed])] };
}

interface Saved {
  row: EntryRow;
  job: JobRow;
  created: boolean;
}

/** Writes one entry inside `tx` and records what it touched. Stamps and rollups run in `finishProduction`. */
async function writeEntry(tx: Executor, ctx: DomainContext, access: PulseAccess, input: ProductionInput, touched: Touched, fixedJobs: Set<string>, ids: string[], options: SaveOptions = {}, seen?: Map<string, number>, index = 0): Promise<Saved> {
  const at = (field: string): string => (seen ? `entries.${index}.${field}` : field);
  let existing: EntryRow | undefined;
  // Rows are read FOR UPDATE: a second save of the same row waits here, then sees the new version.
  if (input.id) {
    [existing] = isUuid(input.id) ? await tx.select().from(productionEntries).where(and(eq(productionEntries.orgId, ctx.orgId), eq(productionEntries.id, input.id), isNull(productionEntries.deletedAt))).for('update') : [];
    if (!existing) throw notFound('That entry');
  }
  const job = await getJobRow(ctx, input.jobId ?? existing?.jobId ?? '', tx);
  if (job.status === 'cancelled') throw conflict('This job is cancelled. Reopen it before you log work on it.');
  const site = await getSiteRow(ctx, job.siteId, tx);
  const shift = cleanText(input.shift) ?? existing?.shift ?? 'day';
  const laborClassId = input.laborClassId === undefined ? (existing?.laborClassId ?? null) : input.laborClassId;
  if (!existing) {
    [existing] = await tx
      .select()
      .from(productionEntries)
      .where(
        and(
          eq(productionEntries.orgId, ctx.orgId),
          eq(productionEntries.jobId, job.id),
          eq(productionEntries.workDate, input.workDate),
          eq(productionEntries.shift, shift),
          laborClassId ? eq(productionEntries.laborClassId, laborClassId) : isNull(productionEntries.laborClassId),
          isNull(productionEntries.deletedAt),
        ),
      )
      .for('update');
  }
  if (seen) {
    // Two lines of one save for the same job, day, shift and labor type would land on one row and
    // the first line's hours would be lost. Refuse, and say which line.
    const key = existing ? `id:${existing.id}` : lineKey(job.id, input.workDate, shift, laborClassId);
    const target = lineKey(job.id, input.workDate, shift, laborClassId);
    if (seen.has(key) || seen.has(target)) throw invalid(`Line ${index + 1}: ${SAME_LINE_TWICE}`, { [at('laborClassId')]: SAME_LINE_TWICE });
    seen.set(key, index);
    seen.set(target, index);
  }
  if (!SYNCED_SOURCES.has(input.source ?? existing?.source ?? 'manual')) assertNotFutureDay(site.timezone, input.workDate, at('workDate'));
  await assertCanLogDay(tx, ctx, access, site.id, site.timezone, input.workDate);
  if (existing && existing.workDate !== input.workDate) await assertCanLogDay(tx, ctx, access, site.id, site.timezone, existing.workDate);
  await assertOpen(tx, ctx.orgId, [input.workDate, existing?.workDate]);
  if (existing && options.requireVersion && (input.version === null || input.version === undefined)) throw conflict(STALE_ROW);
  if (existing) assertVersion(existing.version, input.version);
  const hours = input.hours ?? existing?.hours ?? '0';
  const overtimeHours = input.overtimeHours ?? existing?.overtimeHours ?? '0';
  const setupHours = input.setupHours ?? existing?.setupHours ?? '0';
  checkHours(hours, overtimeHours, setupHours);
  const people = input.headcount === undefined ? (existing?.headcount ?? null) : input.headcount;
  // "0 people" with hours is a typing slip that still costs money. Old rows can be edited on other fields.
  const wasZeroPeople = Boolean(existing && existing.headcount !== null && num(existing.headcount) === 0 && num(existing.hours) === num(hours));
  if (people !== null && num(people) === 0 && num(hours) > 0 && !wasZeroPeople)
    throw invalid(ZERO_PEOPLE, { [at('headcount')]: 'Type how many people worked.' });
  const values = {
    jobId: job.id,
    siteId: site.id,
    workDate: input.workDate,
    shift,
    laborClassId,
    unitsGood: input.unitsGood ?? existing?.unitsGood ?? '0',
    unitsScrap: input.unitsScrap ?? existing?.unitsScrap ?? '0',
    unitsRework: input.unitsRework ?? existing?.unitsRework ?? '0',
    headcount: people,
    hours,
    overtimeHours,
    setupHours,
    hoursConfirmed: input.hoursConfirmed ?? (existing ? existing.hoursConfirmed || num(hours) > 0 : true),
    note: input.note === undefined ? (existing?.note ?? null) : cleanText(input.note),
  };
  let row: EntryRow;
  let created = false;
  if (existing) {
    const change = diff(existing as unknown as Record<string, unknown>, values as Record<string, unknown>);
    if (!change) return { row: existing, job, created: false };
    [row] = (await tx
      .update(productionEntries)
      .set({ ...values, meta: lockedFields(existing, Object.keys(change.after)), version: sql`version + 1`, updatedBy: ctx.userId, updatedAt: new Date() })
      .where(and(eq(productionEntries.id, existing.id), eq(productionEntries.version, existing.version)))
      .returning()) as [EntryRow];
    if (!row) throw conflict(STALE_ROW);
    await logActivity(tx, ctx, { verb: 'production.edited', entityType: 'production', entityId: row.id, jobId: job.id, clientId: job.clientId, ...change, meta: { workDate: row.workDate } });
    touchDay(touched, existing.siteId, existing.workDate);
    if (existing.jobId !== job.id) touched.jobIds.add(existing.jobId);
  } else {
    created = true;
    [row] = (await tx
      .insert(productionEntries)
      .values({
        orgId: ctx.orgId,
        ...values,
        enteredBy: ctx.actorKind === 'user' ? ctx.userId : null,
        source: input.source ?? 'manual',
        sourceRef: input.sourceRef ?? null,
        isSample: Boolean(input.isSample),
        importBatchId: input.importBatchId ?? null,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning()) as [EntryRow];
    await logActivity(tx, ctx, {
      verb: 'production.logged',
      entityType: 'production',
      entityId: row.id,
      jobId: job.id,
      clientId: job.clientId,
      after: defined({ workDate: row.workDate, shift: row.shift, laborClassId: row.laborClassId, unitsGood: row.unitsGood, unitsScrap: row.unitsScrap, headcount: row.headcount, hours: row.hours, overtimeHours: row.overtimeHours, setupHours: row.setupHours }),
    });
  }
  touched.jobIds.add(job.id);
  touchDay(touched, row.siteId, row.workDate);
  if (job.pricingModel === 'fixed') fixedJobs.add(job.id);
  ids.push(row.id);
  return { row, job, created };
}

/** Stamps the written rows, restamps fixed price jobs, then runs the shared tail of every write. */
/**
 * Work has started: a planned job becomes active with its first logged entry, so it shows on the
 * day sheet from then on and gets a risk status. Logged in the activity feed like any stage change.
 */
async function startPlannedJobs(tx: Executor, ctx: DomainContext, jobIds: ReadonlySet<string>): Promise<void> {
  if (jobIds.size === 0) return;
  const started = await tx
    .update(jobs)
    .set({ status: 'active', activatedAt: sql`COALESCE(${jobs.activatedAt}, now())`, version: sql`version + 1`, updatedBy: ctx.userId, updatedAt: new Date() })
    .where(and(eq(jobs.orgId, ctx.orgId), inArray(jobs.id, [...jobIds]), eq(jobs.status, 'planned'), isNull(jobs.deletedAt), sql`EXISTS (SELECT 1 FROM pulse.production_entries e WHERE e.job_id = ${jobs.id} AND e.deleted_at IS NULL)`))
    .returning({ id: jobs.id, clientId: jobs.clientId });
  for (const job of started) {
    await logActivity(tx, ctx, { verb: 'job.status_changed', entityType: 'job', entityId: job.id, jobId: job.id, clientId: job.clientId, field: 'status', before: { status: 'planned' }, after: { status: 'active', reason: 'first work logged' } });
  }
}

async function finishProduction(tx: Executor, ctx: DomainContext, ids: readonly string[], fixedJobs: ReadonlySet<string>, touched: Touched): Promise<void> {
  if (ids.length > 0) await startPlannedJobs(tx, ctx, touched.jobIds);
  if (ids.length > 0) await restampProduction(tx, ctx.orgId, sql`src.id = ANY(${sql`ARRAY[${sql.join(ids.map((id) => sql`${id}`), sql`, `)}]::uuid[]`})`);
  for (const jobId of fixedJobs) await restampFixedJob(tx, ctx, jobId);
  await finishWrite(tx, ctx, touched);
}

async function reload(tx: Executor, ctx: DomainContext, id: string, access: Access): Promise<ProductionEntryDTO> {
  const [found] = await tx.select({ row: productionEntries, number: jobs.number, name: jobs.name }).from(productionEntries).innerJoin(jobs, eq(jobs.id, productionEntries.jobId)).where(and(eq(productionEntries.orgId, ctx.orgId), eq(productionEntries.id, id)));
  if (!found) throw notFound('That entry');
  return toProductionDTO(found.row, found, access, await closedMonths(tx, ctx.orgId));
}

/** Saves one entry (the autosave of one grid row, the Work log form, the kiosk). */
export const saveProductionEntry = scoped(async function saveProductionEntry(ctx: DomainContext, input: ProductionInput, options: SaveOptions = {}): Promise<SaveProductionResult> {
  const access = await requirePulse(ctx, 'production:log');
  return inTx(async (tx) => {
    const touched = newTouched();
    const fixedJobs = new Set<string>();
    const ids: string[] = [];
    const saved = await writeEntry(tx, ctx, access, input, touched, fixedJobs, ids, options);
    await finishProduction(tx, ctx, ids, fixedJobs, touched);
    return { entry: await reload(tx, ctx, saved.row.id, access), created: saved.created };
  });
});

/** Saves many entries in one transaction (paste from a spreadsheet, "Copy yesterday's crew", imports). All or nothing. */
export const saveProductionBulk = scoped(async function saveProductionBulk(ctx: DomainContext, inputs: readonly ProductionInput[], options: SaveOptions = {}): Promise<{ entries: ProductionEntryDTO[]; created: number; updated: number }> {
  const access = await requirePulse(ctx, 'production:log');
  if (inputs.length > 5000) throw invalid('That is more than 5,000 rows at once. Split the paste, or use Import.');
  return inTx(async (tx) => {
    const touched = newTouched();
    const fixedJobs = new Set<string>();
    const ids: string[] = [];
    let created = 0;
    const saved: string[] = [];
    const seen = new Map<string, number>();
    for (const [index, input] of inputs.entries()) {
      const result = await writeEntry(tx, ctx, access, input, touched, fixedJobs, ids, options, seen, index);
      if (result.created) created += 1;
      saved.push(result.row.id);
    }
    await finishProduction(tx, ctx, ids, fixedJobs, touched);
    const entries = await listByIds(tx, ctx, saved, access);
    return { entries, created, updated: ids.length - created };
  });
});

/** One labor type line of a day of work on a job. */
export interface ProductionDayLine {
  /** A row the editor read. Without it the line is new. */
  id?: string | null;
  laborClassId: string | null;
  /** Kept from the row when left out. New lines go on the day shift. */
  shift?: string | null;
  unitsGood?: string;
  unitsScrap?: string;
  unitsRework?: string;
  headcount?: string | null;
  hours?: string;
  overtimeHours?: string;
  setupHours?: string;
  hoursConfirmed?: boolean;
  note?: string | null;
}

export interface ProductionDayInput {
  jobId: string;
  /** The day the lines are saved on. */
  workDate: string;
  /**
   * `create`: the job must have no work on that day yet. `edit`: replace the day that was read,
   * and `read` must list every row of it with the version the editor saw.
   */
  mode: 'create' | 'edit';
  /** Edit only: the day that was opened. Differs from `workDate` when the day is moved. */
  fromDate?: string | null;
  /** Edit only: every row of the day as the editor read it. */
  read?: readonly { id: string; version: number }[];
  lines: readonly ProductionDayLine[];
}

/** Thrown inside the day save when the day is not what the editor thinks it is. Carries the day as it is now. */
export class DayConflict extends Error {
  constructor(
    readonly reason: 'day_exists' | 'stale',
    readonly workDate: string,
    readonly fresh: ProductionEntryDTO[],
  ) {
    super(reason);
  }
}

export const DAY_EXISTS = 'This day already has work on this job. Open that day to change it.';
export const DAY_STALE = 'Someone else changed this day. Here is the day as it is now.';

export interface SaveProductionDayResult {
  /** The day as it is now. */
  readonly entries: ProductionEntryDTO[];
  readonly created: number;
  readonly updated: number;
  /** Rows that were on the day and are gone now (soft deleted). */
  readonly removed: ProductionEntryDTO[];
}

async function dayRows(tx: Executor, ctx: DomainContext, jobId: string, workDate: string): Promise<EntryRow[]> {
  return tx
    .select()
    .from(productionEntries)
    .where(and(eq(productionEntries.orgId, ctx.orgId), eq(productionEntries.jobId, jobId), eq(productionEntries.workDate, workDate), isNull(productionEntries.deletedAt)))
    .orderBy(asc(productionEntries.shift), asc(productionEntries.createdAt))
    .for('update');
}

/**
 * Saves a whole day of work on one job (the Work log form): every labor type line, the lines that
 * were taken off, all in one transaction. It never overwrites a day by accident:
 *
 * - `create` is refused when the job already has work that day (`DayConflict` "day_exists").
 * - `edit` is refused when the rows are not the ones the editor read, by id and version
 *   (`DayConflict` "stale").
 *
 * Both carry the day as it is now, so the screen can show it (PUT /api/v1/log/days answers 409).
 * Two saves of one job and day wait on each other, so the second one always sees the first.
 */
export const saveProductionDay = scoped(async function saveProductionDay(ctx: DomainContext, input: ProductionDayInput): Promise<SaveProductionDayResult> {
  const access = await requirePulse(ctx, 'production:log');
  if (input.lines.length === 0) throw invalid('Add at least one labor type.', { lines: 'Add at least one labor type.' });
  if (input.lines.length > 50) throw invalid('That is more than 50 labor types on one day.', { lines: 'Keep a day to 50 labor types or fewer.' });
  const fromDate = input.mode === 'edit' ? (input.fromDate ?? input.workDate) : input.workDate;
  {
    return inTx(async (tx) => {
      const job = await getJobRow(ctx, input.jobId, tx);
      // One writer at a time for this job and day (and the day it moves from).
      for (const date of [...new Set([fromDate, input.workDate])].sort()) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`pulse:day:${job.id}:${date}`}, 0))`);
      const closed = await closedMonths(tx, ctx.orgId);
      const dto = (list: readonly EntryRow[]): ProductionEntryDTO[] => list.map((row) => toProductionDTO(row, job, access, closed));
      const current = await dayRows(tx, ctx, job.id, fromDate);
      if (input.mode === 'create') {
        if (current.length > 0) throw new DayConflict('day_exists', input.workDate, dto(current));
        if (input.lines.some((line) => line.id)) throw invalid('A new day cannot change a row that already exists.');
      } else {
        const read = new Map((input.read ?? []).map((item) => [item.id, item.version]));
        const same = current.length === read.size && current.every((row) => read.get(row.id) === row.version);
        if (!same) throw new DayConflict('stale', fromDate, dto(current));
        if (fromDate !== input.workDate) {
          const target = await dayRows(tx, ctx, job.id, input.workDate);
          if (target.length > 0) throw new DayConflict('day_exists', input.workDate, dto(target));
        }
        const known = new Set(current.map((row) => row.id));
        if (input.lines.some((line) => line.id && !known.has(line.id))) throw new DayConflict('stale', fromDate, dto(current));
      }
      const touched = newTouched();
      const fixedJobs = new Set<string>();
      const ids: string[] = [];
      const seen = new Map<string, number>();
      const byId = new Map(current.map((row) => [row.id, row]));
      let created = 0;
      // Rows taken off the day go first, so a line may take over the labor type of a removed row.
      const kept = new Set(input.lines.map((line) => line.id).filter((id): id is string => Boolean(id)));
      const gone = current.filter((row) => !kept.has(row.id));
      if (gone.length > 0) {
        await assertOpen(tx, ctx.orgId, gone.map((row) => row.workDate));
        for (const row of gone) {
          const site = await getSiteRow(ctx, row.siteId, tx);
          await assertCanLogDay(tx, ctx, access, site.id, site.timezone, row.workDate);
          touched.jobIds.add(row.jobId);
          touchDay(touched, row.siteId, row.workDate);
        }
        if (job.pricingModel === 'fixed') fixedJobs.add(job.id);
        await tx.update(productionEntries).set({ deletedAt: new Date(), version: sql`version + 1`, updatedBy: ctx.userId, updatedAt: new Date() }).where(inArray(productionEntries.id, gone.map((row) => row.id)));
        await logActivity(
          tx,
          ctx,
          gone.map((row) => ({ verb: 'production.deleted', entityType: 'production', entityId: row.id, jobId: row.jobId, clientId: job.clientId, before: { workDate: row.workDate, shift: row.shift, laborClassId: row.laborClassId, unitsGood: row.unitsGood, hours: row.hours }, meta: { workDate: row.workDate, via: 'day_edit' } })),
        );
      }
      for (const [index, line] of input.lines.entries()) {
        const row = line.id ? byId.get(line.id) : undefined;
        try {
          const saved = await writeEntry(
            tx,
            ctx,
            access,
            {
              id: row?.id ?? null,
              jobId: job.id,
              workDate: input.workDate,
              shift: line.shift ?? row?.shift ?? 'day',
              laborClassId: line.laborClassId,
              unitsGood: line.unitsGood,
              unitsScrap: line.unitsScrap,
              unitsRework: line.unitsRework,
              headcount: line.headcount,
              hours: line.hours,
              overtimeHours: line.overtimeHours,
              setupHours: line.setupHours,
              hoursConfirmed: line.hoursConfirmed,
              note: line.note,
              version: row?.version ?? null,
            },
            touched,
            fixedJobs,
            ids,
            { requireVersion: true },
            seen,
            index,
          );
          if (saved.created) created += 1;
        } catch (error) {
          // A labor type that another row of the day holds (another shift aside) hits the unique key.
          if ((error as { code?: string; cause?: { code?: string } }).code === '23505' || (error as { cause?: { code?: string } }).cause?.code === '23505')
            throw invalid(`Line ${index + 1}: ${SAME_LINE_TWICE}`, { [`entries.${index}.laborClassId`]: SAME_LINE_TWICE });
          // A row found by its key that the editor did not send: the day is not what the editor read.
          if (error instanceof DomainError && error.code === 'CONFLICT' && error.message === STALE_ROW) throw new DayConflict('stale', fromDate, dto(await dayRows(tx, ctx, job.id, fromDate)));
          throw error;
        }
      }
      await finishProduction(tx, ctx, ids, fixedJobs, touched);
      const after = await dayRows(tx, ctx, job.id, input.workDate);
      const removed = gone.length > 0 ? await listByIds(tx, ctx, gone.map((row) => row.id), access) : [];
      return { entries: dto(after), created, updated: ids.length - created, removed };
    });
  }
});

async function listByIds(executor: Executor, ctx: DomainContext, ids: readonly string[], access: Access): Promise<ProductionEntryDTO[]> {
  if (ids.length === 0) return [];
  const closed = await closedMonths(executor, ctx.orgId);
  const found = await executor.select({ row: productionEntries, number: jobs.number, name: jobs.name }).from(productionEntries).innerJoin(jobs, eq(jobs.id, productionEntries.jobId)).where(and(eq(productionEntries.orgId, ctx.orgId), inArray(productionEntries.id, [...new Set(ids)])));
  const byId = new Map(found.map((item) => [item.row.id, toProductionDTO(item.row, item, access, closed)]));
  return ids.map((id) => byId.get(id)).filter((entry): entry is ProductionEntryDTO => Boolean(entry));
}

async function removeEntries(ctx: DomainContext, ids: readonly string[], restore: boolean): Promise<ProductionEntryDTO[]> {
  const access = await requirePulse(ctx, 'production:log');
  const unique = [...new Set(ids)].filter(isUuid);
  if (unique.length === 0) return [];
  return inTx(async (tx) => {
    const found = await tx.select({ row: productionEntries, job: jobs }).from(productionEntries).innerJoin(jobs, eq(jobs.id, productionEntries.jobId)).where(and(eq(productionEntries.orgId, ctx.orgId), inArray(productionEntries.id, unique)));
    const targets = found.filter((item) => (restore ? item.row.deletedAt !== null : item.row.deletedAt === null));
    if (targets.length === 0) throw notFound(unique.length === 1 ? 'That entry' : 'Those entries');
    await assertOpen(tx, ctx.orgId, targets.map((item) => item.row.workDate));
    const touched = newTouched();
    const fixedJobs = new Set<string>();
    for (const { row, job } of targets) {
      const site = await getSiteRow(ctx, row.siteId, tx);
      await assertCanLogDay(tx, ctx, access, site.id, site.timezone, row.workDate);
      touched.jobIds.add(row.jobId);
      touchDay(touched, row.siteId, row.workDate);
      if (job.pricingModel === 'fixed') fixedJobs.add(job.id);
    }
    const targetIds = targets.map((item) => item.row.id);
    await tx.update(productionEntries).set({ deletedAt: restore ? null : new Date(), version: sql`version + 1`, updatedBy: ctx.userId, updatedAt: new Date() }).where(inArray(productionEntries.id, targetIds));
    await logActivity(
      tx,
      ctx,
      targets.map(({ row, job }) => ({
        verb: restore ? 'production.restored' : 'production.deleted',
        entityType: 'production',
        entityId: row.id,
        jobId: row.jobId,
        clientId: job.clientId,
        before: restore ? undefined : { workDate: row.workDate, shift: row.shift, laborClassId: row.laborClassId, unitsGood: row.unitsGood, hours: row.hours },
        meta: { workDate: row.workDate },
      })),
    );
    await finishProduction(tx, ctx, restore ? targetIds : [], fixedJobs, touched);
    return listByIds(tx, ctx, targetIds, access);
  });
}

/** Soft deletes entries. The returned rows carry what `restoreProductionEntries` needs for undo. */
export const deleteProductionEntries = scoped(async function deleteProductionEntries(ctx: DomainContext, ids: readonly string[]): Promise<ProductionEntryDTO[]> {
  return removeEntries(ctx, ids, false);
});

/** Undo of a delete. Fails with CONFLICT when a new entry took the same job, day, shift and labor class. */
export const restoreProductionEntries = scoped(async function restoreProductionEntries(ctx: DomainContext, ids: readonly string[]): Promise<ProductionEntryDTO[]> {
  return removeEntries(ctx, ids, true);
});

export interface ProductionFilters {
  readonly jobId?: string | null;
  readonly clientId?: string | null;
  readonly siteId?: string | null;
  readonly laborClassId?: string | null;
  readonly from?: string | null;
  readonly to?: string | null;
  readonly source?: StreamSource | null;
  readonly needsHours?: boolean;
  readonly includeDeleted?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

export const PRODUCTION_PAGE_DEFAULT = 1000;
export const PRODUCTION_PAGE_MAX = 10_000;

/** One page of entries and whether more are waiting (`GET /api/v1/production`). */
export interface ProductionPage {
  readonly rows: ProductionEntryDTO[];
  /** True when more rows match than this page holds. */
  readonly truncated: boolean;
  readonly limit: number;
  readonly offset: number;
  /** The `offset` of the next page, or null on the last page. */
  readonly nextOffset: number | null;
}

/** Entries across days, newest first, with a flag when the page stopped before the end. */
export const listProductionPage = scoped(async function listProductionPage(ctx: DomainContext, filters: ProductionFilters = {}): Promise<ProductionPage> {
  const limit = Math.max(1, Math.min(filters.limit ?? PRODUCTION_PAGE_DEFAULT, PRODUCTION_PAGE_MAX));
  const offset = Math.max(filters.offset ?? 0, 0);
  // One extra row tells us whether there is a next page.
  const found = await queryProduction(ctx, filters, limit + 1, offset);
  const truncated = found.length > limit;
  return { rows: truncated ? found.slice(0, limit) : found, truncated, limit, offset, nextOffset: truncated ? offset + limit : null };
});

/** Entries across days, newest first (`/log/entries`, a job's Work log, exports). */
export const listProduction = scoped(async function listProduction(ctx: DomainContext, filters: ProductionFilters = {}): Promise<ProductionEntryDTO[]> {
  return queryProduction(ctx, filters, Math.min(filters.limit ?? PRODUCTION_PAGE_DEFAULT, PRODUCTION_PAGE_MAX), Math.max(filters.offset ?? 0, 0));
});

async function queryProduction(ctx: DomainContext, filters: ProductionFilters, limit: number, offset: number): Promise<ProductionEntryDTO[]> {
  const access = await requirePulse(ctx, 'pulse:read');
  const where: (SQL | undefined)[] = [eq(productionEntries.orgId, ctx.orgId)];
  if (!filters.includeDeleted) where.push(isNull(productionEntries.deletedAt));
  // Entries of a deleted job are out of every number, so they stay out of the lists too (the job page is gone).
  if (!filters.includeDeleted && !filters.jobId) where.push(isNull(jobs.deletedAt));
  if (filters.jobId) where.push(eq(productionEntries.jobId, filters.jobId));
  if (filters.clientId) where.push(eq(jobs.clientId, filters.clientId));
  if (filters.siteId) where.push(eq(productionEntries.siteId, filters.siteId));
  if (filters.laborClassId) where.push(eq(productionEntries.laborClassId, filters.laborClassId));
  if (filters.from) where.push(gte(productionEntries.workDate, filters.from));
  if (filters.to) where.push(lte(productionEntries.workDate, filters.to));
  if (filters.source) where.push(eq(productionEntries.source, filters.source));
  if (filters.needsHours) where.push(eq(productionEntries.hoursConfirmed, false));
  const closed = await closedMonths(db, ctx.orgId);
  const found = await db
    .select({ row: productionEntries, number: jobs.number, name: jobs.name })
    .from(productionEntries)
    .innerJoin(jobs, eq(jobs.id, productionEntries.jobId))
    .where(and(...where))
    .orderBy(desc(productionEntries.workDate), asc(jobs.number), asc(productionEntries.shift), asc(productionEntries.createdAt))
    .limit(limit)
    .offset(offset);
  return found.map((item) => toProductionDTO(item.row, item, access, closed));
}

/**
 * The Log work day grid: one row per active job at the site (plus any job that already has an
 * entry that day), the day's other time and paid hours, the review state and the day totals.
 */
export const getLogGrid = scoped(async function getLogGrid(ctx: DomainContext, options: { date?: string | null; siteId?: string | null } = {}): Promise<LogGridDTO> {
  const access = await requirePulse(ctx, 'pulse:read');
  const settings = await loadSettings(ctx.orgId);
  const site = await resolveSite(ctx, options.siteId);
  const today = todayInZone(site.timezone);
  const date = options.date ?? today;
  const closed = await closedMonths(db, ctx.orgId);
  const entries = await db
    .select({ row: productionEntries, number: jobs.number, name: jobs.name })
    .from(productionEntries)
    .innerJoin(jobs, eq(jobs.id, productionEntries.jobId))
    .where(and(eq(productionEntries.orgId, ctx.orgId), eq(productionEntries.siteId, site.id), eq(productionEntries.workDate, date), isNull(productionEntries.deletedAt), isNull(jobs.deletedAt)))
    .orderBy(asc(productionEntries.shift), asc(productionEntries.createdAt));
  const withEntries = [...new Set(entries.map((item) => item.row.jobId))];
  const jobRows = await db
    .select({ job: jobs, clientName: clients.name, standardUph: jobStats.standardUph, unitsDone: jobStats.unitsGood })
    .from(jobs)
    .innerJoin(clients, eq(clients.id, jobs.clientId))
    .leftJoin(jobStats, eq(jobStats.jobId, jobs.id))
    .where(
      and(
        eq(jobs.orgId, ctx.orgId),
        eq(jobs.siteId, site.id),
        isNull(jobs.deletedAt),
        withEntries.length > 0
          ? sql`(${jobs.status} = 'active' AND (${jobs.startDate} IS NULL OR ${jobs.startDate} <= ${date}::date) OR ${inArray(jobs.id, withEntries)})`
          : sql`(${jobs.status} = 'active' AND (${jobs.startDate} IS NULL OR ${jobs.startDate} <= ${date}::date))`,
      ),
    )
    .orderBy(asc(clients.name), asc(jobs.number));
  const gridRows: LogGridRowDTO[] = jobRows.map(({ job, clientName, standardUph, unitsDone }) => ({
    jobId: job.id,
    jobNumber: job.number,
    jobName: job.name,
    clientName,
    unitLabel: job.unitLabel,
    status: job.status as JobStatusValue,
    defaultLaborClassId: job.defaultLaborClassId,
    usualCrew: job.usualCrew ?? [],
    targetUph: standardUph ?? job.standardUph ?? null,
    plannedUnits: job.plannedUnits,
    unitsDone: unitsDone ?? '0',
    entries: entries.filter((item) => item.row.jobId === job.id).map((item) => toProductionDTO(item.row, item, access, closed)),
  }));
  const [indirect, paid, reviewRows] = await Promise.all([
    listIndirect(ctx, { siteId: site.id, from: date, to: date }),
    listPaidHours(ctx, { siteId: site.id, from: date, to: date }),
    db.select().from(dayReviews).where(and(eq(dayReviews.orgId, ctx.orgId), eq(dayReviews.siteId, site.id), eq(dayReviews.workDate, date))),
  ]);
  const monthClosed = closed.has(monthStart(date));
  // A day after today is read only for everyone: work that was done cannot be dated ahead.
  const lockedReason = monthClosed ? 'This month is closed.' : date > today ? FUTURE_DAY : await dayLockReason(db, ctx, access, site.id, site.timezone, date);
  const sum = (values: readonly string[]): string => values.reduce((total, value) => total + Number(value), 0).toFixed(2);
  return {
    date,
    siteId: site.id,
    today,
    shiftHours: settings.defaultShiftHours,
    rows: gridRows,
    indirect,
    paid,
    review: reviewRows[0] ? toDayReviewDTO(reviewRows[0]) : null,
    monthClosed,
    canEdit: lockedReason === null,
    lockedReason,
    totals: {
      unitsGood: entries.reduce((total, item) => total + Number(item.row.unitsGood), 0).toFixed(3),
      hours: sum(entries.map((item) => item.row.hours)),
      indirectHours: sum(indirect.map((item) => item.hours)),
      paidHours: sum(paid.map((item) => item.paidHours)),
    },
  };
});

/** The crew lines of the most recent earlier day for each job at the site ("Copy yesterday's crew"). */
export const getPreviousCrew = scoped(async function getPreviousCrew(ctx: DomainContext, options: { date: string; siteId?: string | null }): Promise<PreviousCrewDTO[]> {
  await requirePulse(ctx, 'production:log');
  const site = await resolveSite(ctx, options.siteId);
  const found = await rows<{ job_id: string; work_date: string; labor_class_id: string | null; shift: string; headcount: string | null; hours: string }>(
    db,
    sql`SELECT p.job_id, to_char(p.work_date, 'YYYY-MM-DD') AS work_date, p.labor_class_id, p.shift, p.headcount::text, p.hours::text
          FROM pulse.production_entries p
          JOIN pulse.jobs pj ON pj.id = p.job_id AND pj.deleted_at IS NULL
          JOIN (
            SELECT job_id, max(work_date) AS d FROM pulse.production_entries
             WHERE org_id = ${ctx.orgId} AND site_id = ${site.id} AND deleted_at IS NULL AND hours > 0 AND work_date < ${options.date}::date AND work_date >= ${options.date}::date - 30
             GROUP BY job_id
          ) last ON last.job_id = p.job_id AND last.d = p.work_date
         WHERE p.org_id = ${ctx.orgId} AND p.site_id = ${site.id} AND p.deleted_at IS NULL AND p.hours > 0
         ORDER BY p.job_id, p.shift, p.created_at`,
  );
  const out = new Map<string, { jobId: string; workDate: string; lines: { laborClassId: string | null; shift: string; headcount: string | null; hours: string }[] }>();
  for (const row of found) {
    const entry = out.get(row.job_id) ?? { jobId: row.job_id, workDate: row.work_date, lines: [] };
    entry.lines.push({ laborClassId: row.labor_class_id, shift: row.shift, headcount: row.headcount, hours: row.hours });
    out.set(row.job_id, entry);
  }
  return [...out.values()];
});
