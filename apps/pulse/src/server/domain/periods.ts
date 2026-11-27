/**
 * Month close (SPEC 4.16). Closing a month stores a snapshot of its totals and locks every
 * stream row dated in it: the database trigger `pulse.guard_closed_month` refuses the write and
 * the domain layer says "October 2026 is closed. Ask the owner to reopen it." first.
 */
import 'server-only';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { periods } from '@/server/db/schema';
import { conflict, invalid } from '@/server/errors';
import { marginBp } from '@/lib/money';
import { endOfMonth } from '@/lib/profit';
import type { CloseChecklistDTO, PeriodDTO } from '@/lib/types';
import { cleanText, countServiceEntriesNoPrice, inTx, iso, jsonSafe, moneyOut, monthName, monthYear, rows, type DomainContext } from './_shared';
import { requirePulse } from './access';
import { logActivity } from './activity';
import { getCompanyBridge, getProfit } from './profit';
import { readPrograms } from '@/server/integrations/programs';
import { syncIfStale } from './sync';
import { pendingProgramEvents } from './sync-programs';

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
export const listPeriods = scoped(async function listPeriods(ctx: DomainContext): Promise<PeriodDTO[]> {
  const access = await requirePulse(ctx, 'pulse:read');
  const stored = await db.select().from(periods).where(eq(periods.orgId, ctx.orgId)).orderBy(desc(periods.periodMonth));
  const months = await rows<{ m: string }>(db, sql`SELECT DISTINCT to_char(date_trunc('month', work_date), 'YYYY-MM-DD') AS m FROM pulse.fact_days WHERE org_id = ${ctx.orgId}`);
  const byMonth = new Map(stored.map((row) => [row.periodMonth, toDTO(row, access.seesMoney)]));
  for (const { m } of months) {
    if (!byMonth.has(m)) byMonth.set(m, { periodMonth: m, status: 'open', closedAt: null, closedBy: null, reopenedAt: null, reopenedBy: null, reopenReason: null, snapshot: null, checklist: null });
  }
  return [...byMonth.values()].sort((a, b) => (a.periodMonth < b.periodMonth ? 1 : -1));
});

/** True when the month that holds `date` is closed. */
export const isMonthClosed = scoped(async function isMonthClosed(ctx: DomainContext, date: string): Promise<boolean> {
  const [row] = await db.select({ status: periods.status }).from(periods).where(and(eq(periods.orgId, ctx.orgId), eq(periods.periodMonth, firstOfMonth(date))));
  return row?.status === 'closed';
});

/** The counts behind the close checklist for one month. `toFix` is how many checklist steps are in the "fix" state. */
export interface CloseFixCounts {
  readonly needsRate: number;
  readonly noHours: number;
  readonly noPrice: number;
  readonly notReviewed: number;
  readonly toFix: number;
}

/**
 * One place for the "fix this first" counts of a month, so the month list, the month card and the
 * checklist always show the same status.
 */
export const closeFixCounts = scoped(async function closeFixCounts(ctx: DomainContext, month: string): Promise<CloseFixCounts> {
  await requirePulse(ctx, 'pulse:read');
  const orgId = ctx.orgId;
  const start = firstOfMonth(month);
  const end = endOfMonth(start);
  const [row] = await rows<{ needs_rate: number; no_hours: number; not_reviewed: number }>(
    db,
    sql`SELECT
          ((SELECT count(*) FROM pulse.production_entries WHERE org_id = ${orgId} AND deleted_at IS NULL AND needs_rate AND work_date BETWEEN ${start}::date AND ${end}::date)
         + (SELECT count(*) FROM pulse.indirect_entries WHERE org_id = ${orgId} AND deleted_at IS NULL AND needs_rate AND work_date BETWEEN ${start}::date AND ${end}::date)
         + (SELECT count(*) FROM pulse.vas_entries WHERE org_id = ${orgId} AND deleted_at IS NULL AND needs_rate AND work_date BETWEEN ${start}::date AND ${end}::date))::int AS needs_rate,
          (SELECT count(*) FROM (SELECT pe.job_id, pe.work_date FROM pulse.production_entries pe
             WHERE pe.org_id = ${orgId} AND pe.deleted_at IS NULL AND pe.work_date BETWEEN ${start}::date AND ${end}::date
               -- A job a program feeds gets its units during the day and its hours at the end of it: the site's today is still open.
               AND NOT (pe.work_date >= (SELECT (now() AT TIME ZONE s.timezone)::date FROM pulse.jobs j JOIN pulse.sites s ON s.id = j.site_id WHERE j.id = pe.job_id)
                        AND EXISTS (SELECT 1 FROM pulse.job_links jl WHERE jl.org_id = pe.org_id AND jl.job_id = pe.job_id AND jl.target_type IN ('pm_program', 'pm_build')))
             GROUP BY pe.job_id, pe.work_date HAVING sum(pe.units_good) > 0 AND COALESCE(sum(pe.hours) FILTER (WHERE pe.hours_confirmed), 0) = 0) d)::int AS no_hours,
          (SELECT count(*) FROM (SELECT DISTINCT p.site_id, p.work_date FROM pulse.production_entries p
             WHERE p.org_id = ${orgId} AND p.deleted_at IS NULL AND p.work_date BETWEEN ${start}::date AND ${end}::date
               AND NOT EXISTS (SELECT 1 FROM pulse.day_reviews r WHERE r.org_id = p.org_id AND r.site_id = p.site_id AND r.work_date = p.work_date AND r.status = 'approved')) d)::int AS not_reviewed`,
  );
  const needsRate = row?.needs_rate ?? 0;
  const noHours = row?.no_hours ?? 0;
  // The same count Home shows under "Things to fix", for the days of this month.
  const noPrice = await countServiceEntriesNoPrice(db, orgId, { from: start, to: end });
  // KitStak programs feeding jobs here: their month must be settled and synced first (A5).
  const programs = await programCloseCheck(ctx, start);
  const programSteps = programs.programs.length === 0 ? 0 : (programs.unsettled.length > 0 ? 1 : 0) + (programs.synced ? 0 : 1);
  return { needsRate, noHours, noPrice, notReviewed: row?.not_reviewed ?? 0, toFix: [needsRate, noHours, noPrice].filter((count) => count > 0).length + programSteps };
});

/** One program feeding a job of the org, and whether it added the month's charges (A5). */
export interface ProgramSettleRow {
  readonly programId: string;
  readonly key: string;
  readonly name: string;
  readonly settledThrough: string | null;
  readonly settled: boolean;
  readonly path: string;
}

export interface ProgramCloseCheck {
  /** Programs that feed a job of this workspace. Empty when none do (the rows are left out). */
  readonly programs: readonly ProgramSettleRow[];
  readonly unsettled: readonly ProgramSettleRow[];
  /** Program change notes still waiting for the sync. */
  readonly pending: number;
  /** The last good Projects sync, ISO. */
  readonly lastSyncAt: string | null;
  /** No notes waiting and the last Projects sync ran after the month ended. */
  readonly synced: boolean;
}

/**
 * The program rows of the month close (docs/programs/SPEC.md 6.1): every program feeding a job of
 * the org has settled the month (`settled_through` on or after its last day), and the program
 * sync caught up after the month ended. Fail soft to "nothing to check" only when Projects is away.
 */
export const programCloseCheck = scoped(async function programCloseCheck(ctx: DomainContext, month: string): Promise<ProgramCloseCheck> {
  const start = firstOfMonth(month);
  const end = endOfMonth(start);
  const mirrors = await rows<{ target_type: string; target_id: string; meta: Record<string, unknown> | null }>(
    db,
    sql`SELECT l.target_type, l.target_id, l.meta FROM pulse.job_links l JOIN pulse.jobs j ON j.id = l.job_id AND j.deleted_at IS NULL
         WHERE l.org_id = ${ctx.orgId} AND l.target_type IN ('pm_program', 'pm_build')`,
  );
  const ids = [...new Set(mirrors.map((row) => (row.target_type === 'pm_program' ? row.target_id : typeof row.meta?.programId === 'string' ? row.meta.programId : null)).filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return { programs: [], unsettled: [], pending: 0, lastSyncAt: null, synced: true };
  const found = await readPrograms(ctx, ids);
  const programs = [...found.values()]
    .filter((program) => !program.deleted && (!program.startDate || program.startDate <= end))
    .map((program) => ({ programId: program.id, key: program.key, name: program.name, settledThrough: program.settledThrough, settled: program.settledThrough !== null && program.settledThrough >= end, path: program.path }))
    .sort((a, b) => a.key.localeCompare(b.key));
  const events = await pendingProgramEvents(db, ctx);
  const [state] = await rows<{ last_ok_at: string | null; after_end: boolean | null }>(
    db,
    sql`SELECT to_char(last_ok_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_ok_at, (last_ok_at > (${end}::date + 1)::timestamp) AS after_end
          FROM pulse.sync_state WHERE org_id = ${ctx.orgId} AND source = 'projects'`,
  );
  return { programs, unsettled: programs.filter((program) => !program.settled), pending: events.pending, lastSyncAt: state?.last_ok_at ?? null, synced: events.pending === 0 && Boolean(state?.after_end) };
});

/** What the month close list checks: Things to fix, days not reviewed and the payroll check. */
export const getCloseChecklist = scoped(async function getCloseChecklist(ctx: DomainContext, month: string): Promise<CloseChecklistDTO> {
  const access = await requirePulse(ctx, 'pulse:read');
  const start = firstOfMonth(month);
  const end = endOfMonth(start);
  const counts = await closeFixCounts(ctx, start);
  const bridge = await getCompanyBridge(ctx, { from: start, to: end });
  const programs = await programCloseCheck(ctx, start);
  return {
    periodMonth: start,
    entriesNeedingRate: counts.needsRate,
    daysWithUnitsNoHours: counts.noHours,
    servicesNoPrice: counts.noPrice,
    daysNotReviewed: counts.notReviewed,
    payrollGapCents: moneyOut(access.seesMoney, bridge.payrollGapCents),
    programsFeeding: programs.programs.length,
    programsUnsettled: programs.unsettled.map((program) => program.key),
    programsSynced: programs.synced,
    programsPending: programs.pending,
    ready: counts.toFix === 0,
  };
});

/**
 * Closes a month: stores the checklist and a snapshot of totals by client, job type and service
 * plus the company profit bridge, then locks every stream row dated in it.
 */
export const closePeriod = scoped(async function closePeriod(ctx: DomainContext, month: string): Promise<PeriodDTO> {
  const access = await requirePulse(ctx, 'period:close');
  const start = firstOfMonth(month);
  const end = endOfMonth(start);
  const [existing] = await db.select().from(periods).where(and(eq(periods.orgId, ctx.orgId), eq(periods.periodMonth, start)));
  if (existing?.status === 'closed') throw conflict(`${monthYear(start)} is already closed.`);
  // Programs first: bring in what Projects changed, then refuse while a change is still on its way (A5).
  const programs0 = await programCloseCheck(ctx, start);
  if (programs0.programs.length > 0) {
    await syncIfStale(ctx, 'page');
    const programs = await programCloseCheck(ctx, start);
    if (programs.pending > 0) throw conflict('Programs are still syncing. Try again in a minute.');
    const late = programs.unsettled[0];
    if (late) throw conflict(`${late.key} has not added ${monthName(start)}'s monthly charges yet. This happens on its own a few minutes after the month ends.`);
    if (!programs.synced) throw conflict('Programs have not synced since the month ended. Open Connected apps and sync Projects, then close the month.');
  }
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
});

/** Reopens a closed month. Needs the Pulse owner and a reason, and is logged. */
export const reopenPeriod = scoped(async function reopenPeriod(ctx: DomainContext, month: string, reason: string): Promise<PeriodDTO> {
  const access = await requirePulse(ctx, 'period:reopen');
  const start = firstOfMonth(month);
  const why = cleanText(reason);
  if (!why) throw invalid('Say why the month is being reopened.', { reason: 'Add a short reason.' });
  return inTx(async (tx) => {
    const [existing] = await tx.select().from(periods).where(and(eq(periods.orgId, ctx.orgId), eq(periods.periodMonth, start)));
    if (!existing || existing.status !== 'closed') throw conflict(`${monthYear(start)} is not closed.`);
    const [row] = await tx.update(periods).set({ status: 'open', reopenedAt: new Date(), reopenedBy: ctx.userId, reopenReason: why, updatedAt: new Date() }).where(eq(periods.id, existing.id)).returning();
    await logActivity(tx, ctx, { verb: 'period.reopened', entityType: 'period', entityId: existing.id, before: { status: 'closed' }, after: { status: 'open', reopenReason: why }, meta: { periodMonth: start } });
    return toDTO(row!, access.seesMoney);
  });
});
