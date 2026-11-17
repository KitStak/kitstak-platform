/**
 * Daily production entries (SPEC 5.3): the Log work grid and the Work log of a job.
 * One row per job, day, shift and labor class. Every save stamps the row (rate, labor cost,
 * revenue, standard material), spreads time not on a job for the touched pool and rebuilds the
 * job's numbers, all in one transaction. Deletes are soft and can be restored (undo).
 */
import 'server-only';
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm';
import { db, type Executor } from '@/server/db';
import { clients, dayReviews, jobStats, jobs, productionEntries } from '@/server/db/schema';
import { conflict, forbidden, invalid, notFound } from '@/server/errors';
import { SUPERVISOR_EDIT_DAYS, type JobStatusValue, type StreamSource } from '@/lib/constants';
import { canPulse } from '@/lib/permissions';
import { addDays } from '@/lib/profit';
import type { LogGridDTO, LogGridRowDTO, ProductionEntryDTO, SaveProductionResult } from '@/lib/types';
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
export async function assertCanLogDay(executor: Executor, ctx: DomainContext, access: Pick<PulseAccess, 'role'>, siteId: string, timezone: string, date: string): Promise<void> {
  if (canPulse(access.role, 'production:edit_any')) return;
  const reason = await dayLockReason(executor, ctx, access, siteId, timezone, date);
  if (reason) throw forbidden(reason);
}

/** The reason this reader may not change the day, or null when they may. */
export async function dayLockReason(executor: Executor, ctx: DomainContext, access: Pick<PulseAccess, 'role'>, siteId: string, timezone: string, date: string): Promise<string | null> {
  if (!canPulse(access.role, 'production:log')) return 'Your Pulse role cannot log work. Ask an admin of your workspace if you need it.';
  if (canPulse(access.role, 'production:edit_any')) return null;
  const today = todayInZone(timezone);
  if (date > today) return 'You can log work for today or earlier. Ask a manager to plan ahead.';
  if (date < addDays(today, -SUPERVISOR_EDIT_DAYS)) return `You can change the last ${SUPERVISOR_EDIT_DAYS} days. Ask a manager to fix an older day.`;
  const [review] = await executor.select({ status: dayReviews.status }).from(dayReviews).where(and(eq(dayReviews.orgId, ctx.orgId), eq(dayReviews.siteId, siteId), eq(dayReviews.workDate, date)));
  if (review && review.status !== 'sent_back') return 'This day is marked complete. Ask a manager to send it back if it needs a fix.';
  return null;
}

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
async function writeEntry(tx: Executor, ctx: DomainContext, access: PulseAccess, input: ProductionInput, touched: Touched, fixedJobs: Set<string>, ids: string[]): Promise<Saved> {
  let existing: EntryRow | undefined;
  if (input.id) {
    [existing] = isUuid(input.id) ? await tx.select().from(productionEntries).where(and(eq(productionEntries.orgId, ctx.orgId), eq(productionEntries.id, input.id), isNull(productionEntries.deletedAt))) : [];
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
      );
  }
  await assertCanLogDay(tx, ctx, access, site.id, site.timezone, input.workDate);
  if (existing && existing.workDate !== input.workDate) await assertCanLogDay(tx, ctx, access, site.id, site.timezone, existing.workDate);
  await assertOpen(tx, ctx.orgId, [input.workDate, existing?.workDate]);
  if (existing) assertVersion(existing.version, input.version);
  const hours = input.hours ?? existing?.hours ?? '0';
  const overtimeHours = input.overtimeHours ?? existing?.overtimeHours ?? '0';
  const setupHours = input.setupHours ?? existing?.setupHours ?? '0';
  checkHours(hours, overtimeHours, setupHours);
  const values = {
    jobId: job.id,
    siteId: site.id,
    workDate: input.workDate,
    shift,
    laborClassId,
    unitsGood: input.unitsGood ?? existing?.unitsGood ?? '0',
    unitsScrap: input.unitsScrap ?? existing?.unitsScrap ?? '0',
    unitsRework: input.unitsRework ?? existing?.unitsRework ?? '0',
    headcount: input.headcount === undefined ? (existing?.headcount ?? null) : input.headcount,
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
      .where(eq(productionEntries.id, existing.id))
      .returning()) as [EntryRow];
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
async function finishProduction(tx: Executor, ctx: DomainContext, ids: readonly string[], fixedJobs: ReadonlySet<string>, touched: Touched): Promise<void> {
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
export async function saveProductionEntry(ctx: DomainContext, input: ProductionInput): Promise<SaveProductionResult> {
  const access = await requirePulse(ctx, 'production:log');
  return inTx(async (tx) => {
    const touched = newTouched();
    const fixedJobs = new Set<string>();
    const ids: string[] = [];
    const saved = await writeEntry(tx, ctx, access, input, touched, fixedJobs, ids);
    await finishProduction(tx, ctx, ids, fixedJobs, touched);
    return { entry: await reload(tx, ctx, saved.row.id, access), created: saved.created };
  });
}

/** Saves many entries in one transaction (paste from a spreadsheet, "Copy yesterday's crew", imports). All or nothing. */
export async function saveProductionBulk(ctx: DomainContext, inputs: readonly ProductionInput[]): Promise<{ entries: ProductionEntryDTO[]; created: number; updated: number }> {
  const access = await requirePulse(ctx, 'production:log');
  if (inputs.length > 5000) throw invalid('That is more than 5,000 rows at once. Split the paste, or use Import.');
  return inTx(async (tx) => {
    const touched = newTouched();
    const fixedJobs = new Set<string>();
    const ids: string[] = [];
    let created = 0;
    const saved: string[] = [];
    for (const input of inputs) {
      const result = await writeEntry(tx, ctx, access, input, touched, fixedJobs, ids);
      if (result.created) created += 1;
      saved.push(result.row.id);
    }
    await finishProduction(tx, ctx, ids, fixedJobs, touched);
    const entries = await listByIds(tx, ctx, saved, access);
    return { entries, created, updated: ids.length - created };
  });
}

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
export async function deleteProductionEntries(ctx: DomainContext, ids: readonly string[]): Promise<ProductionEntryDTO[]> {
  return removeEntries(ctx, ids, false);
}

/** Undo of a delete. Fails with CONFLICT when a new entry took the same job, day, shift and labor class. */
export async function restoreProductionEntries(ctx: DomainContext, ids: readonly string[]): Promise<ProductionEntryDTO[]> {
  return removeEntries(ctx, ids, true);
}

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

/** Entries across days, newest first (`/log/entries`, a job's Work log, exports). */
export async function listProduction(ctx: DomainContext, filters: ProductionFilters = {}): Promise<ProductionEntryDTO[]> {
  const access = await requirePulse(ctx, 'pulse:read');
  const where: (SQL | undefined)[] = [eq(productionEntries.orgId, ctx.orgId)];
  if (!filters.includeDeleted) where.push(isNull(productionEntries.deletedAt));
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
    .limit(Math.min(filters.limit ?? 1000, 10_000))
    .offset(Math.max(filters.offset ?? 0, 0));
  return found.map((item) => toProductionDTO(item.row, item, access, closed));
}

/**
 * The Log work day grid: one row per active job at the site (plus any job that already has an
 * entry that day), the day's other time and paid hours, the review state and the day totals.
 */
export async function getLogGrid(ctx: DomainContext, options: { date?: string | null; siteId?: string | null } = {}): Promise<LogGridDTO> {
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
    .where(and(eq(productionEntries.orgId, ctx.orgId), eq(productionEntries.siteId, site.id), eq(productionEntries.workDate, date), isNull(productionEntries.deletedAt)))
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
  const lockedReason = monthClosed ? 'This month is closed.' : await dayLockReason(db, ctx, access, site.id, site.timezone, date);
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
}

/** The crew lines of the most recent earlier day for each job at the site ("Copy yesterday's crew"). */
export async function getPreviousCrew(ctx: DomainContext, options: { date: string; siteId?: string | null }): Promise<{ jobId: string; workDate: string; lines: { laborClassId: string | null; shift: string; headcount: string | null; hours: string }[] }[]> {
  await requirePulse(ctx, 'production:log');
  const site = await resolveSite(ctx, options.siteId);
  const found = await rows<{ job_id: string; work_date: string; labor_class_id: string | null; shift: string; headcount: string | null; hours: string }>(
    db,
    sql`SELECT p.job_id, to_char(p.work_date, 'YYYY-MM-DD') AS work_date, p.labor_class_id, p.shift, p.headcount::text, p.hours::text
          FROM pulse.production_entries p
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
}
