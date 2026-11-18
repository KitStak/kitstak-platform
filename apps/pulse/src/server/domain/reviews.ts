/**
 * Day reviews (SPEC 5.4). "Mark day complete" locks a day for supervisors and lists its odd rows;
 * a manager approves it or sends it back with a note, which unlocks it.
 */
import 'server-only';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { dayReviews } from '@/server/db/schema';
import { conflict, invalid } from '@/server/errors';
import type { DayReviewStatus } from '@/lib/constants';
import type { DayReviewDTO } from '@/lib/types';
import { cleanText, inTx, iso, rows, type DomainContext } from './_shared';
import { requirePulse } from './access';
import { logActivity } from './activity';
import { getSiteRow, resolveSite } from './catalog';
import { assertOpen } from './recalc';

type ReviewRow = typeof dayReviews.$inferSelect;

export function toDayReviewDTO(row: ReviewRow): DayReviewDTO {
  return {
    siteId: row.siteId,
    workDate: row.workDate,
    status: row.status as DayReviewStatus,
    flags: (row.flags ?? []) as Record<string, unknown>[],
    markedBy: row.markedBy,
    markedAt: iso(row.markedAt),
    reviewedBy: row.reviewedBy,
    reviewedAt: iso(row.reviewedAt),
    note: row.note,
  };
}

/**
 * The odd rows of a day: units with no hours, pace under 50% or over 200% of the target pace,
 * and more hours logged than paid. Numbers and ids only.
 */
export async function dayFlags(ctx: DomainContext, siteId: string, date: string): Promise<Record<string, unknown>[]> {
  const flags: Record<string, unknown>[] = [];
  const jobs = await rows<{ job_id: string; number: string; units: string; pace_hours: string; unconfirmed: boolean; target: string | null }>(
    db,
    sql`SELECT p.job_id, j.number, sum(p.units_good)::text AS units, sum(p.hours - p.setup_hours) FILTER (WHERE p.hours_confirmed)::text AS pace_hours,
               bool_or(p.units_good > 0 AND (NOT p.hours_confirmed OR p.hours = 0)) AS unconfirmed, COALESCE(st.standard_uph, j.standard_uph)::text AS target
          FROM pulse.production_entries p
          JOIN pulse.jobs j ON j.id = p.job_id
          LEFT JOIN pulse.job_stats st ON st.job_id = p.job_id
         WHERE p.org_id = ${ctx.orgId} AND p.site_id = ${siteId} AND p.work_date = ${date}::date AND p.deleted_at IS NULL
         GROUP BY p.job_id, j.number, st.standard_uph, j.standard_uph`,
  );
  for (const job of jobs) {
    const units = Number(job.units);
    const hours = Number(job.pace_hours ?? 0);
    if (units > 0 && hours <= 0) flags.push({ kind: 'units_no_hours', jobId: job.job_id, jobNumber: job.number, units });
    else if (units > 0 && hours > 0 && job.target) {
      const pace = units / hours;
      const share = pace / Number(job.target);
      if (share < 0.5) flags.push({ kind: 'pace_low', jobId: job.job_id, jobNumber: job.number, pace: Number(pace.toFixed(3)), target: Number(job.target) });
      if (share > 2) flags.push({ kind: 'pace_high', jobId: job.job_id, jobNumber: job.number, pace: Number(pace.toFixed(3)), target: Number(job.target) });
    }
  }
  const [day] = await rows<{ over_logged: boolean; direct_hours: string; indirect_hours: string; paid_hours: string }>(
    db,
    sql`SELECT over_logged, direct_hours::text, indirect_hours::text, paid_hours::text FROM pulse.company_days WHERE org_id = ${ctx.orgId} AND site_id = ${siteId} AND work_date = ${date}::date`,
  );
  if (day?.over_logged) flags.push({ kind: 'more_hours_than_paid', loggedHours: Number(day.direct_hours) + Number(day.indirect_hours), paidHours: Number(day.paid_hours) });
  return flags;
}

/** "Mark day complete": locks the day for supervisors and stores its odd rows for the manager. */
export async function markDayComplete(ctx: DomainContext, input: { siteId?: string | null; date: string }): Promise<DayReviewDTO> {
  await requirePulse(ctx, 'production:log');
  const site = await resolveSite(ctx, input.siteId);
  await assertOpen(db, ctx.orgId, [input.date]);
  const flags = await dayFlags(ctx, site.id, input.date);
  return inTx(async (tx) => {
    const [existing] = await tx.select().from(dayReviews).where(and(eq(dayReviews.orgId, ctx.orgId), eq(dayReviews.siteId, site.id), eq(dayReviews.workDate, input.date)));
    if (existing?.status === 'approved') throw conflict('This day is already approved.');
    const values = { status: 'complete', flags, markedBy: ctx.userId, markedAt: new Date(), reviewedBy: null, reviewedAt: null, updatedAt: new Date() };
    const [row] = await tx
      .insert(dayReviews)
      .values({ orgId: ctx.orgId, siteId: site.id, workDate: input.date, ...values })
      .onConflictDoUpdate({ target: [dayReviews.orgId, dayReviews.siteId, dayReviews.workDate], set: values })
      .returning();
    await logActivity(tx, ctx, { verb: 'day.completed', entityType: 'day', after: { status: 'complete', flags: flags.length }, meta: { siteId: site.id, workDate: input.date } });
    return toDayReviewDTO(row!);
  });
}

/** A manager approves a completed day, or sends it back with a note (which unlocks it for the floor). */
export async function reviewDay(ctx: DomainContext, input: { siteId: string; date: string; decision: 'approve' | 'send_back' | 'reopen'; note?: string | null }): Promise<DayReviewDTO | null> {
  await requirePulse(ctx, 'day:review');
  const site = await getSiteRow(ctx, input.siteId);
  const note = cleanText(input.note);
  if (input.decision === 'send_back' && !note) throw invalid('Say what needs fixing, so the floor knows.', { note: 'Add a short note.' });
  return inTx(async (tx) => {
    const [existing] = await tx.select().from(dayReviews).where(and(eq(dayReviews.orgId, ctx.orgId), eq(dayReviews.siteId, site.id), eq(dayReviews.workDate, input.date)));
    if (input.decision === 'reopen') {
      if (!existing) return null;
      await tx.delete(dayReviews).where(and(eq(dayReviews.orgId, ctx.orgId), eq(dayReviews.siteId, site.id), eq(dayReviews.workDate, input.date)));
      await logActivity(tx, ctx, { verb: 'day.sent_back', entityType: 'day', before: { status: existing.status }, after: { status: null }, meta: { siteId: site.id, workDate: input.date, reopened: true } });
      return null;
    }
    const status: DayReviewStatus = input.decision === 'approve' ? 'approved' : 'sent_back';
    const values = { status, reviewedBy: ctx.userId, reviewedAt: new Date(), note: note ?? existing?.note ?? null, updatedAt: new Date() };
    const [row] = await tx
      .insert(dayReviews)
      .values({ orgId: ctx.orgId, siteId: site.id, workDate: input.date, flags: [], markedBy: ctx.userId, markedAt: new Date(), ...values })
      .onConflictDoUpdate({ target: [dayReviews.orgId, dayReviews.siteId, dayReviews.workDate], set: values })
      .returning();
    await logActivity(tx, ctx, { verb: status === 'approved' ? 'day.approved' : 'day.sent_back', entityType: 'day', before: { status: existing?.status ?? null }, after: { status, note }, meta: { siteId: site.id, workDate: input.date } });
    return toDayReviewDTO(row!);
  });
}

/** The manager queue (`/log/review`): days by status, newest first. */
export async function listDayReviews(ctx: DomainContext, filters: { siteId?: string | null; from?: string | null; to?: string | null; status?: DayReviewStatus | null } = {}): Promise<DayReviewDTO[]> {
  await requirePulse(ctx, 'pulse:read');
  const found = await db
    .select()
    .from(dayReviews)
    .where(
      and(
        eq(dayReviews.orgId, ctx.orgId),
        filters.siteId ? eq(dayReviews.siteId, filters.siteId) : undefined,
        filters.status ? eq(dayReviews.status, filters.status) : undefined,
        filters.from ? gte(dayReviews.workDate, filters.from) : undefined,
        filters.to ? lte(dayReviews.workDate, filters.to) : undefined,
      ),
    )
    .orderBy(desc(dayReviews.workDate))
    .limit(400);
  return found.map(toDayReviewDTO);
}
