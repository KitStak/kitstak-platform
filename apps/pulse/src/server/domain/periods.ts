/**
 * Month close (SPEC 4.16). Closing a month stores a snapshot of its totals and locks every
 * stream row dated in it: the database trigger `pulse.guard_closed_month` refuses the write and
 * the domain layer says "October is closed. Ask the owner to reopen it." first.
 */
import 'server-only';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { periods } from '@/server/db/schema';
import { conflict, invalid } from '@/server/errors';
import { marginBp } from '@/lib/money';
import { endOfMonth } from '@/lib/profit';
import type { CloseChecklistDTO, PeriodDTO } from '@/lib/types';
import { cleanText, inTx, iso, jsonSafe, moneyOut, monthName, rows, type DomainContext } from './_shared';
import { requirePulse } from './access';
import { logActivity } from './activity';
import { getCompanyBridge, getProfit } from './profit';

type PeriodRow = typeof periods.$inferSelect;

const firstOfMonth = (month: string): string => {
  if (!/^\d{4}-\d{2}(-\d{2})?$/.test(month)) throw invalid('Pick a month.');
  return `${month.slice(0, 7)}-01`;
};

/** The stored close checklist, with every money field nulled for a reader without `money:read`. */
export function checklistOut(checklist: Readonly<Record<string, unknown>> | null, money: boolean): Readonly<Record<string, unknown>> | null {
  if (!checklist || money) return checklist;
  return Object.fromEntries(Object.entries(checklist).map(([key, value]) => [key, /cents$/i.test(key) ? null : value]));
}

function toDTO(row: PeriodRow, money: boolean): PeriodDTO {
  return {
    periodMonth: row.periodMonth,
    status: row.status as 'open' | 'closed',
    closedAt: iso(row.closedAt),
    closedBy: row.closedBy,
    reopenedAt: iso(row.reopenedAt),
    reopenedBy: row.reopenedBy,
    reopenReason: row.reopenReason,
    snapshot: money ? row.snapshot : null,
    checklist: checklistOut(row.checklist, money),
  };
}

/** Every month that has data or a period row, newest first, with its open or closed state. */
export async function listPeriods(ctx: DomainContext): Promise<PeriodDTO[]> {
  const access = await requirePulse(ctx, 'pulse:read');
  const stored = await db.select().from(periods).where(eq(periods.orgId, ctx.orgId)).orderBy(desc(periods.periodMonth));
  const months = await rows<{ m: string }>(db, sql`SELECT DISTINCT to_char(date_trunc('month', work_date), 'YYYY-MM-DD') AS m FROM pulse.fact_days WHERE org_id = ${ctx.orgId}`);
  const byMonth = new Map(stored.map((row) => [row.periodMonth, toDTO(row, access.seesMoney)]));
  for (const { m } of months) {
    if (!byMonth.has(m)) byMonth.set(m, { periodMonth: m, status: 'open', closedAt: null, closedBy: null, reopenedAt: null, reopenedBy: null, reopenReason: null, snapshot: null, checklist: null });
  }
  return [...byMonth.values()].sort((a, b) => (a.periodMonth < b.periodMonth ? 1 : -1));
}

/** True when the month that holds `date` is closed. */
export async function isMonthClosed(ctx: DomainContext, date: string): Promise<boolean> {
  const [row] = await db.select({ status: periods.status }).from(periods).where(and(eq(periods.orgId, ctx.orgId), eq(periods.periodMonth, firstOfMonth(date))));
  return row?.status === 'closed';
}

/** What the month close list checks: Things to fix, days not reviewed and the payroll check. */
export async function getCloseChecklist(ctx: DomainContext, month: string): Promise<CloseChecklistDTO> {
  const access = await requirePulse(ctx, 'pulse:read');
  const start = firstOfMonth(month);
  const end = endOfMonth(start);
  const [row] = await rows<{ needs_rate: number; no_hours: number; no_price: number; not_reviewed: number }>(
    db,
    sql`SELECT
          ((SELECT count(*) FROM pulse.production_entries WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL AND needs_rate AND work_date BETWEEN ${start}::date AND ${end}::date)
         + (SELECT count(*) FROM pulse.indirect_entries WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL AND needs_rate AND work_date BETWEEN ${start}::date AND ${end}::date)
         + (SELECT count(*) FROM pulse.vas_entries WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL AND needs_rate AND work_date BETWEEN ${start}::date AND ${end}::date))::int AS needs_rate,
          (SELECT count(*) FROM (SELECT job_id, work_date FROM pulse.production_entries
             WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL AND work_date BETWEEN ${start}::date AND ${end}::date
             GROUP BY job_id, work_date HAVING sum(units_good) > 0 AND COALESCE(sum(hours) FILTER (WHERE hours_confirmed), 0) = 0) d)::int AS no_hours,
          (SELECT count(*) FROM pulse.vas_entries WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL AND amount_cents IS NULL AND work_date BETWEEN ${start}::date AND ${end}::date)::int AS no_price,
          (SELECT count(*) FROM (SELECT DISTINCT p.site_id, p.work_date FROM pulse.production_entries p
             WHERE p.org_id = ${ctx.orgId} AND p.deleted_at IS NULL AND p.work_date BETWEEN ${start}::date AND ${end}::date
               AND NOT EXISTS (SELECT 1 FROM pulse.day_reviews r WHERE r.org_id = p.org_id AND r.site_id = p.site_id AND r.work_date = p.work_date AND r.status = 'approved')) d)::int AS not_reviewed`,
  );
  const bridge = await getCompanyBridge(ctx, { from: start, to: end });
  const needsRate = row?.needs_rate ?? 0;
  const noHours = row?.no_hours ?? 0;
  const noPrice = row?.no_price ?? 0;
  return {
    periodMonth: start,
    entriesNeedingRate: needsRate,
    daysWithUnitsNoHours: noHours,
    servicesNoPrice: noPrice,
    daysNotReviewed: row?.not_reviewed ?? 0,
    payrollGapCents: moneyOut(access.seesMoney, bridge.payrollGapCents),
    ready: needsRate === 0 && noHours === 0 && noPrice === 0,
  };
}

/**
 * Closes a month: stores the checklist and a snapshot of totals by client, job type and service
 * plus the company profit bridge, then locks every stream row dated in it.
 */
export async function closePeriod(ctx: DomainContext, month: string): Promise<PeriodDTO> {
  const access = await requirePulse(ctx, 'period:close');
  const start = firstOfMonth(month);
  const end = endOfMonth(start);
  const [existing] = await db.select().from(periods).where(and(eq(periods.orgId, ctx.orgId), eq(periods.periodMonth, start)));
  if (existing?.status === 'closed') throw conflict(`${monthName(start)} is already closed.`);
  const system = { ...ctx, actorKind: 'system' as const };
  const [checklist, byClient, byType, byService, bridge] = await Promise.all([
    getCloseChecklist(system, start),
    getProfit(system, 'client', { from: start, to: end }),
    getProfit(system, 'type', { from: start, to: end }),
    getProfit(system, 'service', { from: start, to: end }),
    getCompanyBridge(system, { from: start, to: end }),
  ]);
  // The company figures are saved with the job figures, so a closed month always shows what the company kept.
  const company = {
    jobProfitCents: bridge.workProfitCents,
    jobMarginBp: byClient.total.marginBp,
    companyProfitCents: bridge.companyProfitCents,
    companyMarginBp: bridge.companyProfitCents === null || byClient.total.revenueCents === null ? null : marginBp(bridge.companyProfitCents, byClient.total.revenueCents),
  };
  const snapshot = jsonSafe({ total: byClient.total, byClient: byClient.rows, byJobType: byType.rows, byService: byService.rows, bridge, company }) as Record<string, unknown>;
  return inTx(async (tx) => {
    const values = { status: 'closed', closedAt: new Date(), closedBy: ctx.userId, snapshot, checklist: jsonSafe(checklist) as Record<string, unknown>, updatedAt: new Date() };
    const [row] = await tx
      .insert(periods)
      .values({ orgId: ctx.orgId, periodMonth: start, ...values })
      .onConflictDoUpdate({ target: [periods.orgId, periods.periodMonth], set: values })
      .returning();
    await logActivity(tx, ctx, { verb: 'period.closed', entityType: 'period', entityId: row!.id, before: { status: 'open' }, after: { status: 'closed' }, meta: { periodMonth: start, profitCents: byClient.total.profitCents, companyProfitCents: bridge.companyProfitCents } });
    return toDTO(row!, access.seesMoney);
  });
}

/** Reopens a closed month. Needs the Pulse owner and a reason, and is logged. */
export async function reopenPeriod(ctx: DomainContext, month: string, reason: string): Promise<PeriodDTO> {
  const access = await requirePulse(ctx, 'period:reopen');
  const start = firstOfMonth(month);
  const why = cleanText(reason);
  if (!why) throw invalid('Say why the month is being reopened.', { reason: 'Add a short reason.' });
  return inTx(async (tx) => {
    const [existing] = await tx.select().from(periods).where(and(eq(periods.orgId, ctx.orgId), eq(periods.periodMonth, start)));
    if (!existing || existing.status !== 'closed') throw conflict(`${monthName(start)} is not closed.`);
    const [row] = await tx.update(periods).set({ status: 'open', reopenedAt: new Date(), reopenedBy: ctx.userId, reopenReason: why, updatedAt: new Date() }).where(eq(periods.id, existing.id)).returning();
    await logActivity(tx, ctx, { verb: 'period.reopened', entityType: 'period', entityId: existing.id, before: { status: 'closed' }, after: { status: 'open', reopenReason: why }, meta: { periodMonth: start } });
    return toDTO(row!, access.seesMoney);
  });
}
