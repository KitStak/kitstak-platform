/**
 * Time punches (SPEC 5.3): one row per person, day and job or reason, from a time clock or a
 * payroll export. Punches are raw input. After every punch write, `rollupPunches` rebuilds three
 * kinds of derived rows for the touched days:
 *
 *  - production: per job, day and labor class. Labor hours and overtime are the sums, people is
 *    the number of different employees. A row that already exists keeps its units; only the
 *    hours, overtime and people are replaced (`meta.punch_fields` says which fields punches own).
 *  - time not on a job: per site, day, labor class and reason.
 *  - paid hours: per site, day and labor class, all punch hours of the day. The pay amount is
 *    filled in only when every punch of that group has one.
 *
 * A punch with no job and no reason lands only in paid hours, so it shows up as "Paid time not on
 * any job". Names are shown to managers and up; pay amounts need the right to see wages.
 */
import 'server-only';
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm';
import { db, type Executor } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { indirectEntries, jobs, paidHours, productionEntries, timePunches } from '@/server/db/schema';
import { invalid, notFound } from '@/server/errors';
import { INDIRECT_REASONS, type IndirectReason, type StreamSource } from '@/lib/constants';
import { canPulse } from '@/lib/permissions';
import type { PunchDTO, PunchRollupDTO } from '@/lib/types';
import {
  assertVersion,
  cleanText,
  inTx,
  iso,
  isoRequired,
  isUuid,
  moneyOut,
  monthStart,
  rows,
  type DomainContext,
} from './_shared';
import { requirePulse, type PulseAccess } from './access';
import { logActivity } from './activity';
import { getSiteRow, resolveSite } from './catalog';
import { getJobRow } from './jobs';
import { assertCanLogDay } from './production';
import {
  assertOpen,
  closedMonths,
  finishWrite,
  newTouched,
  restampFixedJob,
  restampIndirect,
  restampProduction,
  touchDay,
  type Touched,
} from './recalc';

type PunchRow = typeof timePunches.$inferSelect;
type Reader = Pick<PulseAccess, 'role' | 'seesWages'>;

const PUNCH_FIELDS = ['hours', 'overtimeHours', 'headcount'] as const;

function toPunchDTO(
  row: PunchRow,
  job: { number: string; name: string } | null,
  access: Reader,
  closed: ReadonlySet<string>,
): PunchDTO {
  return {
    id: row.id,
    siteId: row.siteId,
    source: row.source as StreamSource,
    sourceRef: row.sourceRef,
    isSample: row.isSample,
    version: row.version,
    note: null,
    createdBy: row.createdBy,
    createdAt: isoRequired(row.createdAt),
    updatedAt: isoRequired(row.updatedAt),
    deletedAt: iso(row.deletedAt),
    locked: closed.has(monthStart(row.workDate)),
    moneyHidden: !access.seesWages,
    workDate: row.workDate,
    employeeCode: row.employeeCode,
    employeeName: canPulse(access.role, 'production:edit_any') ? row.employeeName : null,
    jobId: row.jobId,
    jobNumber: job?.number ?? null,
    jobName: job?.name ?? null,
    reason: row.reason,
    laborClassId: row.laborClassId,
    hours: row.hours,
    overtimeHours: row.overtimeHours,
    payCents: moneyOut(access.seesWages, row.payCents),
  };
}

export interface PunchFilters {
  readonly siteId?: string | null;
  readonly jobId?: string | null;
  readonly employeeCode?: string | null;
  readonly from?: string | null;
  readonly to?: string | null;
  readonly includeDeleted?: boolean;
  readonly limit?: number;
}

/** Punches, newest day first, then by person. */
export const listPunches = scoped(async function listPunches(ctx: DomainContext, filters: PunchFilters = {}): Promise<PunchDTO[]> {
  const access = await requirePulse(ctx, 'pulse:read');
  const where: (SQL | undefined)[] = [eq(timePunches.orgId, ctx.orgId)];
  if (!filters.includeDeleted) where.push(isNull(timePunches.deletedAt));
  if (filters.siteId) where.push(eq(timePunches.siteId, filters.siteId));
  if (filters.jobId) where.push(eq(timePunches.jobId, filters.jobId));
  if (filters.employeeCode) where.push(eq(timePunches.employeeCode, filters.employeeCode));
  if (filters.from) where.push(gte(timePunches.workDate, filters.from));
  if (filters.to) where.push(lte(timePunches.workDate, filters.to));
  const closed = await closedMonths(db, ctx.orgId);
  const found = await db
    .select({ row: timePunches, number: jobs.number, name: jobs.name })
    .from(timePunches)
    .leftJoin(jobs, eq(jobs.id, timePunches.jobId))
    .where(and(...where))
    .orderBy(desc(timePunches.workDate), asc(timePunches.employeeCode), asc(timePunches.createdAt))
    .limit(Math.min(filters.limit ?? 1000, 10_000));
  return found.map((item) =>
    toPunchDTO(
      item.row,
      item.number && item.name ? { number: item.number, name: item.name } : null,
      access,
      closed,
    ),
  );
});

export interface PunchInput {
  /** Edit this punch. Without it the punch is matched on person, day, job or reason and labor class, else created. */
  id?: string | null;
  siteId?: string | null;
  workDate: string;
  employeeCode: string;
  employeeName?: string | null;
  /** Job id or job number. Leave out with a reason, or leave both out for paid time not on any job. */
  jobRef?: string | null;
  reason?: IndirectReason | null;
  laborClassId?: string | null;
  hours: string;
  overtimeHours?: string;
  payCents?: number | null;
  version?: number | null;
  source?: StreamSource;
  sourceRef?: string | null;
  isSample?: boolean;
  importBatchId?: string | null;
}

interface Day {
  readonly siteId: string;
  readonly date: string;
}

const dayKey = (day: Day): string => `${day.siteId}:${day.date}`;

function uniqueDays(days: readonly Day[]): Day[] {
  const seen = new Map<string, Day>();
  for (const day of days) seen.set(dayKey(day), day);
  return [...seen.values()];
}

/**
 * Rebuilds the production, time not on a job and paid hours rows that punches own for the given
 * site days. Runs inside the caller's transaction and records what it touched; the caller ends
 * with `finishWrite`. Exact: running it twice changes nothing.
 */
export const rollupPunches = scoped(async function rollupPunches(
  tx: Executor,
  ctx: DomainContext,
  days: readonly Day[],
  touched: Touched,
): Promise<PunchRollupDTO> {
  const out = { punches: 0, productionRows: 0, indirectRows: 0, paidRows: 0 };
  const productionIds: string[] = [];
  const indirectIds: string[] = [];
  const fixedJobs = new Set<string>();
  for (const day of uniqueDays(days)) {
    touchDay(touched, day.siteId, day.date);
    const scope = sql`org_id = ${ctx.orgId} AND site_id = ${day.siteId} AND work_date = ${day.date}::date AND deleted_at IS NULL`;

    /* production */
    const direct = await rows<{
      job_id: string;
      labor_class_id: string | null;
      hours: string;
      overtime: string;
      people: number;
      punches: number;
    }>(
      tx,
      sql`SELECT job_id, labor_class_id, sum(hours)::text AS hours, sum(overtime_hours)::text AS overtime, count(DISTINCT employee_code)::int AS people, count(*)::int AS punches
            FROM pulse.time_punches WHERE ${scope} AND job_id IS NOT NULL GROUP BY job_id, labor_class_id`,
    );
    const keep = new Set<string>();
    for (const group of direct) {
      out.punches += group.punches;
      const [job] = await tx
        .select()
        .from(jobs)
        .where(and(eq(jobs.orgId, ctx.orgId), eq(jobs.id, group.job_id)));
      if (!job) continue;
      const [existing] = await tx
        .select()
        .from(productionEntries)
        .where(
          and(
            eq(productionEntries.orgId, ctx.orgId),
            eq(productionEntries.jobId, job.id),
            eq(productionEntries.workDate, day.date),
            eq(productionEntries.shift, 'day'),
            group.labor_class_id
              ? eq(productionEntries.laborClassId, group.labor_class_id)
              : isNull(productionEntries.laborClassId),
            isNull(productionEntries.deletedAt),
          ),
        );
      let rowId: string;
      if (existing) {
        rowId = existing.id;
        const same =
          Number(existing.hours) === Number(group.hours) &&
          Number(existing.overtimeHours) === Number(group.overtime) &&
          Number(existing.headcount ?? -1) === group.people &&
          Array.isArray(existing.meta?.punch_fields);
        if (!same) {
          await tx
            .update(productionEntries)
            .set({
              hours: group.hours,
              overtimeHours: group.overtime,
              setupHours:
                Number(existing.setupHours) > Number(group.hours) ? group.hours : existing.setupHours,
              headcount: String(group.people),
              hoursConfirmed: true,
              // What a person typed before the punches took over, so it can come back if the punches go away.
              meta: {
                ...(existing.meta ?? {}),
                punch_fields: [...PUNCH_FIELDS],
                punch_prev: existing.meta?.punch_prev ?? {
                  hours: existing.hours,
                  overtimeHours: existing.overtimeHours,
                  headcount: existing.headcount,
                },
              },
              version: sql`version + 1`,
              updatedBy: ctx.userId,
              updatedAt: new Date(),
            })
            .where(eq(productionEntries.id, existing.id));
          out.productionRows += 1;
        }
      } else {
        const [row] = await tx
          .insert(productionEntries)
          .values({
            orgId: ctx.orgId,
            jobId: job.id,
            siteId: job.siteId,
            workDate: day.date,
            shift: 'day',
            laborClassId: group.labor_class_id,
            hours: group.hours,
            overtimeHours: group.overtime,
            headcount: String(group.people),
            hoursConfirmed: true,
            source: 'punch',
            sourceRef: `punch:${job.id}:${day.date}:${group.labor_class_id ?? 'none'}`,
            meta: { punch_fields: [...PUNCH_FIELDS] },
            createdBy: ctx.userId,
            updatedBy: ctx.userId,
          })
          .returning({ id: productionEntries.id });
        rowId = row!.id;
        out.productionRows += 1;
      }
      keep.add(rowId);
      productionIds.push(rowId);
      touched.jobIds.add(job.id);
      touchDay(touched, job.siteId, day.date);
      if (job.pricingModel === 'fixed') fixedJobs.add(job.id);
    }
    // Rows punches used to own, with no punches left: an empty punch row goes away, a typed row gets its own hours back.
    const owned = await rows<{
      id: string;
      job_id: string;
      source: string;
      units: string;
      pricing_model: string;
      prev: { hours?: string; overtimeHours?: string; headcount?: string | null } | null;
    }>(
      tx,
      sql`SELECT p.id, p.job_id, p.source, (p.units_good + p.units_scrap + p.units_rework)::text AS units, j.pricing_model, p.meta -> 'punch_prev' AS prev
            FROM pulse.production_entries p JOIN pulse.jobs j ON j.id = p.job_id
           WHERE p.org_id = ${ctx.orgId} AND p.site_id = ${day.siteId} AND p.work_date = ${day.date}::date AND p.deleted_at IS NULL AND p.meta ? 'punch_fields'`,
    );
    for (const row of owned) {
      if (keep.has(row.id)) continue;
      if (row.source === 'punch' && Number(row.units) === 0) {
        await tx
          .update(productionEntries)
          .set({
            deletedAt: new Date(),
            version: sql`version + 1`,
            updatedBy: ctx.userId,
            updatedAt: new Date(),
          })
          .where(eq(productionEntries.id, row.id));
      } else {
        const hours = row.source === 'punch' ? '0' : (row.prev?.hours ?? '0');
        const overtime = row.source === 'punch' ? '0' : (row.prev?.overtimeHours ?? '0');
        const headcount = row.source === 'punch' ? null : (row.prev?.headcount ?? null);
        await tx.execute(
          sql`UPDATE pulse.production_entries SET hours = ${hours}::numeric, overtime_hours = LEAST(${overtime}::numeric, ${hours}::numeric), setup_hours = LEAST(setup_hours, ${hours}::numeric), headcount = ${headcount}::numeric,
                     meta = meta - 'punch_fields' - 'punch_prev', version = version + 1, updated_by = ${ctx.userId}, updated_at = now() WHERE id = ${row.id}`,
        );
        productionIds.push(row.id);
      }
      out.productionRows += 1;
      touched.jobIds.add(row.job_id);
      if (row.pricing_model === 'fixed') fixedJobs.add(row.job_id);
    }

    /* time not on a job */
    const indirect = await rows<{
      labor_class_id: string | null;
      reason: string;
      hours: string;
      overtime: string;
      people: number;
      punches: number;
    }>(
      tx,
      sql`SELECT labor_class_id, reason, sum(hours)::text AS hours, sum(overtime_hours)::text AS overtime, count(DISTINCT employee_code)::int AS people, count(*)::int AS punches
            FROM pulse.time_punches WHERE ${scope} AND job_id IS NULL AND reason IS NOT NULL GROUP BY labor_class_id, reason`,
    );
    const refs: string[] = [];
    for (const group of indirect) {
      out.punches += group.punches;
      const ref = `punch:${day.siteId}:${day.date}:${group.labor_class_id ?? 'none'}:${group.reason}`;
      refs.push(ref);
      const [existing] = await tx
        .select()
        .from(indirectEntries)
        .where(
          and(
            eq(indirectEntries.orgId, ctx.orgId),
            eq(indirectEntries.source, 'punch'),
            eq(indirectEntries.sourceRef, ref),
            isNull(indirectEntries.deletedAt),
          ),
        );
      if (existing) {
        if (
          Number(existing.hours) === Number(group.hours) &&
          Number(existing.overtimeHours) === Number(group.overtime) &&
          Number(existing.headcount ?? -1) === group.people
        )
          continue;
        await tx
          .update(indirectEntries)
          .set({
            hours: group.hours,
            overtimeHours: group.overtime,
            headcount: String(group.people),
            version: sql`version + 1`,
            updatedBy: ctx.userId,
            updatedAt: new Date(),
          })
          .where(eq(indirectEntries.id, existing.id));
        indirectIds.push(existing.id);
      } else {
        // A file exported from Pulse holds this very row already (same day, class, reason and hours).
        // Take that row over, so importing the export and then the punches does not count the time twice.
        const [copy] = await rows<{ id: string }>(
          tx,
          sql`SELECT id FROM pulse.indirect_entries
               WHERE org_id = ${ctx.orgId} AND site_id = ${day.siteId} AND work_date = ${day.date} AND deleted_at IS NULL AND source = 'csv'
                 AND labor_class_id IS NOT DISTINCT FROM ${group.labor_class_id} AND reason = ${group.reason}
                 AND hours = ${group.hours}::numeric AND overtime_hours = ${group.overtime}::numeric
               ORDER BY created_at LIMIT 1`,
        );
        if (copy) {
          await tx
            .update(indirectEntries)
            .set({ source: 'punch', sourceRef: ref, headcount: String(group.people), version: sql`version + 1`, updatedBy: ctx.userId, updatedAt: new Date() })
            .where(eq(indirectEntries.id, copy.id));
          indirectIds.push(copy.id);
          out.indirectRows += 1;
          continue;
        }
        const [row] = await tx
          .insert(indirectEntries)
          .values({
            orgId: ctx.orgId,
            siteId: day.siteId,
            workDate: day.date,
            laborClassId: group.labor_class_id,
            reason: group.reason,
            headcount: String(group.people),
            hours: group.hours,
            overtimeHours: group.overtime,
            source: 'punch',
            sourceRef: ref,
            createdBy: ctx.userId,
            updatedBy: ctx.userId,
          })
          .returning({ id: indirectEntries.id });
        indirectIds.push(row!.id);
      }
      out.indirectRows += 1;
    }
    const staleIndirect = await tx
      .select({ id: indirectEntries.id, sourceRef: indirectEntries.sourceRef })
      .from(indirectEntries)
      .where(
        and(
          eq(indirectEntries.orgId, ctx.orgId),
          eq(indirectEntries.siteId, day.siteId),
          eq(indirectEntries.workDate, day.date),
          eq(indirectEntries.source, 'punch'),
          isNull(indirectEntries.deletedAt),
        ),
      );
    for (const row of staleIndirect) {
      if (row.sourceRef && refs.includes(row.sourceRef)) continue;
      await tx
        .update(indirectEntries)
        .set({
          deletedAt: new Date(),
          version: sql`version + 1`,
          updatedBy: ctx.userId,
          updatedAt: new Date(),
        })
        .where(eq(indirectEntries.id, row.id));
      out.indirectRows += 1;
    }

    /* paid hours */
    const paid = await rows<{
      labor_class_id: string | null;
      hours: string;
      pay: string | null;
      punches: number;
    }>(
      tx,
      sql`SELECT labor_class_id, sum(hours)::text AS hours, CASE WHEN bool_and(pay_cents IS NOT NULL) THEN sum(pay_cents)::text END AS pay, count(*)::int AS punches
            FROM pulse.time_punches WHERE ${scope} GROUP BY labor_class_id`,
    );
    const paidKeep = new Set<string>();
    for (const group of paid) {
      const [existing] = await tx
        .select()
        .from(paidHours)
        .where(
          and(
            eq(paidHours.orgId, ctx.orgId),
            eq(paidHours.siteId, day.siteId),
            eq(paidHours.workDate, day.date),
            group.labor_class_id
              ? eq(paidHours.laborClassId, group.labor_class_id)
              : isNull(paidHours.laborClassId),
            isNull(paidHours.deletedAt),
          ),
        );
      const pay = group.pay === null ? null : BigInt(group.pay);
      if (existing) {
        paidKeep.add(existing.id);
        if (
          Number(existing.paidHours) === Number(group.hours) &&
          existing.paidCents === pay &&
          existing.meta?.punch === true
        )
          continue;
        const prev =
          existing.meta?.punch === true
            ? existing.meta.punch_prev
            : {
                paidHours: existing.paidHours,
                paidCents: existing.paidCents === null ? null : existing.paidCents.toString(),
              };
        await tx
          .update(paidHours)
          .set({
            paidHours: group.hours,
            paidCents: pay,
            meta: { ...(existing.meta ?? {}), punch: true, punch_prev: prev },
            version: sql`version + 1`,
            updatedBy: ctx.userId,
            updatedAt: new Date(),
          })
          .where(eq(paidHours.id, existing.id));
      } else {
        const [row] = await tx
          .insert(paidHours)
          .values({
            orgId: ctx.orgId,
            siteId: day.siteId,
            workDate: day.date,
            laborClassId: group.labor_class_id,
            paidHours: group.hours,
            paidCents: pay,
            source: 'punch',
            sourceRef: `punch:${day.siteId}:${day.date}:${group.labor_class_id ?? 'none'}`,
            meta: { punch: true },
            createdBy: ctx.userId,
            updatedBy: ctx.userId,
          })
          .returning({ id: paidHours.id });
        paidKeep.add(row!.id);
      }
      out.paidRows += 1;
    }
    const ownedPaid = await rows<{ id: string; source: string }>(
      tx,
      sql`SELECT id, source FROM pulse.paid_hours WHERE ${scope} AND meta ->> 'punch' = 'true'`,
    );
    for (const row of ownedPaid) {
      if (paidKeep.has(row.id)) continue;
      if (row.source === 'punch')
        await tx
          .update(paidHours)
          .set({
            deletedAt: new Date(),
            version: sql`version + 1`,
            updatedBy: ctx.userId,
            updatedAt: new Date(),
          })
          .where(eq(paidHours.id, row.id));
      else
        // A typed row the punches had taken over gets its typed hours and pay back.
        await tx.execute(
          sql`UPDATE pulse.paid_hours SET paid_hours = COALESCE((meta -> 'punch_prev' ->> 'paidHours')::numeric, paid_hours), paid_cents = CASE WHEN meta -> 'punch_prev' ? 'paidCents' THEN (meta -> 'punch_prev' ->> 'paidCents')::bigint ELSE paid_cents END,
                     meta = meta - 'punch' - 'punch_prev', version = version + 1, updated_at = now() WHERE id = ${row.id}`,
        );
      out.paidRows += 1;
    }
  }
  if (productionIds.length > 0)
    await restampProduction(
      tx,
      ctx.orgId,
      sql`src.id IN (${sql.join(
        productionIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`,
    );
  if (indirectIds.length > 0)
    await restampIndirect(
      tx,
      ctx.orgId,
      sql`src.id IN (${sql.join(
        indirectIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`,
    );
  for (const jobId of fixedJobs) await restampFixedJob(tx, ctx, jobId);
  const [count] = uniqueDays(days).length
    ? await rows<{ n: number }>(
        tx,
        sql`SELECT count(*)::int AS n FROM pulse.time_punches WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL AND (${sql.join(
          uniqueDays(days).map((day) => sql`(site_id = ${day.siteId} AND work_date = ${day.date}::date)`),
          sql` OR `,
        )})`,
      )
    : [{ n: 0 }];
  out.punches = count?.n ?? 0;
  return out;
}, 1);

function checkPunch(input: PunchInput): void {
  if (!cleanText(input.employeeCode))
    throw invalid('Each punch needs an employee id.', { employeeCode: 'This cannot be empty.' });
  if (!(Number(input.hours) >= 0))
    throw invalid('Hours must be 0 or more.', { hours: 'Type hours of 0 or more.' });
  if (Number(input.overtimeHours ?? 0) > Number(input.hours))
    throw invalid('Overtime hours cannot be more than the hours.', { overtimeHours: 'More than the hours.' });
  if (input.jobRef && input.reason)
    throw invalid('A punch is for a job or for a reason, not both.', {
      reason: 'Clear the job or the reason.',
    });
  if (input.reason && !(INDIRECT_REASONS as readonly string[]).includes(input.reason))
    throw invalid('That reason is not one Pulse knows.', {
      reason: `Use one of: ${INDIRECT_REASONS.join(', ')}.`,
    });
}

/**
 * Saves punches (typed, or a time clock or payroll file) in one transaction, then rebuilds the
 * rows they own. All or nothing, at most 5,000 at once.
 */
export const savePunches = scoped(async function savePunches(
  ctx: DomainContext,
  inputs: readonly PunchInput[],
): Promise<{ punches: PunchDTO[]; created: number; updated: number; rollup: PunchRollupDTO }> {
  const access = await requirePulse(ctx, 'production:log');
  if (inputs.length === 0) throw invalid('There are no punches to save.');
  if (inputs.length > 5000) throw invalid('That is more than 5,000 punches at once. Split the file.');
  inputs.forEach(checkPunch);
  return inTx(async (tx) => {
    const days: Day[] = [];
    const savedIds: string[] = [];
    let created = 0;
    const checked = new Set<string>();
    const jobCache = new Map<string, Awaited<ReturnType<typeof getJobRow>>>();
    for (const input of inputs) {
      let existing: PunchRow | undefined;
      if (input.id) {
        [existing] = isUuid(input.id)
          ? await tx
              .select()
              .from(timePunches)
              .where(
                and(
                  eq(timePunches.orgId, ctx.orgId),
                  eq(timePunches.id, input.id),
                  isNull(timePunches.deletedAt),
                ),
              )
          : [];
        if (!existing) throw notFound('That punch');
        assertVersion(existing.version, input.version);
      }
      let job = input.jobRef ? jobCache.get(input.jobRef) : undefined;
      if (input.jobRef && !job) {
        job = await getJobRow(ctx, input.jobRef, tx);
        jobCache.set(input.jobRef, job);
      }
      const site = input.siteId
        ? await getSiteRow(ctx, input.siteId, tx)
        : job
          ? await getSiteRow(ctx, job.siteId, tx)
          : existing
            ? await getSiteRow(ctx, existing.siteId, tx)
            : await resolveSite(ctx, null, tx);
      const day = { siteId: site.id, date: input.workDate };
      if (!checked.has(dayKey(day))) {
        await assertCanLogDay(tx, ctx, access, site.id, site.timezone, input.workDate);
        checked.add(dayKey(day));
      }
      const employeeCode = cleanText(input.employeeCode)!;
      const laborClassId = input.laborClassId ?? null;
      const reason = job ? null : (input.reason ?? null);
      if (!existing) {
        [existing] = await tx
          .select()
          .from(timePunches)
          .where(
            and(
              eq(timePunches.orgId, ctx.orgId),
              eq(timePunches.siteId, site.id),
              eq(timePunches.workDate, input.workDate),
              eq(timePunches.employeeCode, employeeCode),
              job ? eq(timePunches.jobId, job.id) : isNull(timePunches.jobId),
              reason ? eq(timePunches.reason, reason) : isNull(timePunches.reason),
              laborClassId ? eq(timePunches.laborClassId, laborClassId) : isNull(timePunches.laborClassId),
              isNull(timePunches.deletedAt),
            ),
          );
      }
      const values = {
        siteId: site.id,
        workDate: input.workDate,
        employeeCode,
        employeeName:
          input.employeeName === undefined ? (existing?.employeeName ?? null) : cleanText(input.employeeName),
        jobId: job?.id ?? null,
        reason,
        laborClassId,
        hours: input.hours,
        overtimeHours: input.overtimeHours ?? '0',
        payCents:
          input.payCents === undefined
            ? (existing?.payCents ?? null)
            : input.payCents === null
              ? null
              : BigInt(input.payCents),
      };
      if (existing) {
        days.push({ siteId: existing.siteId, date: existing.workDate });
        await tx
          .update(timePunches)
          .set({ ...values, version: sql`version + 1`, updatedBy: ctx.userId, updatedAt: new Date() })
          .where(eq(timePunches.id, existing.id));
        savedIds.push(existing.id);
      } else {
        const [row] = await tx
          .insert(timePunches)
          .values({
            orgId: ctx.orgId,
            ...values,
            source: input.source ?? 'manual',
            sourceRef: input.sourceRef ?? null,
            isSample: Boolean(input.isSample),
            importBatchId: input.importBatchId ?? null,
            createdBy: ctx.userId,
            updatedBy: ctx.userId,
          })
          .returning({ id: timePunches.id });
        savedIds.push(row!.id);
        created += 1;
      }
      days.push(day);
    }
    await assertOpen(
      tx,
      ctx.orgId,
      days.map((day) => day.date),
    );
    const touched = newTouched();
    const rollup = await rollupPunches(tx, ctx, days, touched);
    await logActivity(tx, ctx, {
      verb: 'production.logged',
      entityType: 'time_punch',
      meta: {
        punches: inputs.length,
        created,
        updated: inputs.length - created,
        days: uniqueDays(days).length,
        via: 'punches',
      },
    });
    await finishWrite(tx, ctx, touched);
    return {
      punches: await punchesByIds(tx, ctx, savedIds, access),
      created,
      updated: inputs.length - created,
      rollup,
    };
  });
});

async function punchesByIds(
  executor: Executor,
  ctx: DomainContext,
  ids: readonly string[],
  access: Reader,
): Promise<PunchDTO[]> {
  if (ids.length === 0) return [];
  const closed = await closedMonths(executor, ctx.orgId);
  const found = await executor
    .select({ row: timePunches, number: jobs.number, name: jobs.name })
    .from(timePunches)
    .leftJoin(jobs, eq(jobs.id, timePunches.jobId))
    .where(and(eq(timePunches.orgId, ctx.orgId), inArray(timePunches.id, [...new Set(ids)])));
  return found.map((item) =>
    toPunchDTO(
      item.row,
      item.number && item.name ? { number: item.number, name: item.name } : null,
      access,
      closed,
    ),
  );
}

async function togglePunches(
  ctx: DomainContext,
  ids: readonly string[],
  restore: boolean,
): Promise<PunchDTO[]> {
  const access = await requirePulse(ctx, 'production:log');
  const unique = [...new Set(ids)].filter(isUuid);
  if (unique.length === 0) return [];
  return inTx(async (tx) => {
    const found = await tx
      .select()
      .from(timePunches)
      .where(and(eq(timePunches.orgId, ctx.orgId), inArray(timePunches.id, unique)));
    const targets = found.filter((row) => (row.deletedAt !== null) === restore);
    if (targets.length === 0) throw notFound(unique.length === 1 ? 'That punch' : 'Those punches');
    await assertOpen(
      tx,
      ctx.orgId,
      targets.map((row) => row.workDate),
    );
    const days = uniqueDays(targets.map((row) => ({ siteId: row.siteId, date: row.workDate })));
    for (const day of days) {
      const site = await getSiteRow(ctx, day.siteId, tx);
      await assertCanLogDay(tx, ctx, access, site.id, site.timezone, day.date);
    }
    await tx
      .update(timePunches)
      .set({
        deletedAt: restore ? null : new Date(),
        version: sql`version + 1`,
        updatedBy: ctx.userId,
        updatedAt: new Date(),
      })
      .where(
        inArray(
          timePunches.id,
          targets.map((row) => row.id),
        ),
      );
    const touched = newTouched();
    await rollupPunches(tx, ctx, days, touched);
    await logActivity(tx, ctx, {
      verb: restore ? 'production.restored' : 'production.deleted',
      entityType: 'time_punch',
      meta: { punches: targets.length, via: 'punches' },
    });
    await finishWrite(tx, ctx, touched);
    return punchesByIds(
      tx,
      ctx,
      targets.map((row) => row.id),
      access,
    );
  });
}

/** Removes punches (soft) and rebuilds the rows they owned. Pair with `restorePunches` for undo. */
export const deletePunches = scoped((ctx: DomainContext, ids: readonly string[]): Promise<PunchDTO[]> =>
  togglePunches(ctx, ids, false));
export const restorePunches = scoped((ctx: DomainContext, ids: readonly string[]): Promise<PunchDTO[]> =>
  togglePunches(ctx, ids, true));
