/**
 * Time not on a job (indirect entries) and paid hours (SPEC 4.5, 5.3). Both feed the shared
 * cost pool of their site and period, the payroll check and the company profit bridge.
 */
import 'server-only';
import { and, asc, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { db, type Executor } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { indirectEntries, paidHours } from '@/server/db/schema';
import { invalid, notFound } from '@/server/errors';
import type { IndirectReason, StreamSource } from '@/lib/constants';
import type { IndirectEntryDTO, PaidHoursDTO } from '@/lib/types';
import { assertVersion, cleanText, diff, inTx, iso, isoRequired, isUuid, moneyOut, monthStart, type DomainContext } from './_shared';
import { requirePulse, type PulseAccess } from './access';
import { logActivity } from './activity';
import { getSiteRow, resolveSite } from './catalog';
import { assertCanLogDay } from './production';
import { assertOpen, closedMonths, finishWrite, newTouched, restampIndirect, touchDay } from './recalc';

type IndirectRow = typeof indirectEntries.$inferSelect;
type PaidRow = typeof paidHours.$inferSelect;
type Access = Pick<PulseAccess, 'seesMoney'>;

const base = (row: IndirectRow | PaidRow, access: Access, closed: ReadonlySet<string>, date: string) => ({
  id: row.id,
  siteId: row.siteId,
  source: row.source as StreamSource,
  sourceRef: row.sourceRef,
  isSample: row.isSample,
  version: row.version,
  createdBy: row.createdBy,
  createdAt: isoRequired(row.createdAt),
  updatedAt: isoRequired(row.updatedAt),
  deletedAt: iso(row.deletedAt),
  locked: closed.has(monthStart(date)),
  moneyHidden: !access.seesMoney,
});

function toIndirectDTO(row: IndirectRow, access: Access, closed: ReadonlySet<string>): IndirectEntryDTO {
  return {
    ...base(row, access, closed, row.workDate),
    note: row.note,
    workDate: row.workDate,
    laborClassId: row.laborClassId,
    reason: row.reason as IndirectReason,
    headcount: row.headcount,
    hours: row.hours,
    overtimeHours: row.overtimeHours,
    rateCents: moneyOut(access.seesMoney, row.rateCents),
    costCents: moneyOut(access.seesMoney, row.costCents),
    needsRate: row.needsRate,
  };
}

function toPaidDTO(row: PaidRow, access: Access, closed: ReadonlySet<string>): PaidHoursDTO {
  return { ...base(row, access, closed, row.workDate), note: null, workDate: row.workDate, laborClassId: row.laborClassId, paidHours: row.paidHours, paidCents: moneyOut(access.seesMoney, row.paidCents) };
}

export interface DayRangeFilters {
  readonly siteId?: string | null;
  readonly from?: string | null;
  readonly to?: string | null;
  readonly includeDeleted?: boolean;
  readonly limit?: number;
}

export const listIndirect = scoped(async function listIndirect(ctx: DomainContext, filters: DayRangeFilters = {}): Promise<IndirectEntryDTO[]> {
  const access = await requirePulse(ctx, 'pulse:read');
  const closed = await closedMonths(db, ctx.orgId);
  const found = await db
    .select()
    .from(indirectEntries)
    .where(
      and(
        eq(indirectEntries.orgId, ctx.orgId),
        filters.includeDeleted ? undefined : isNull(indirectEntries.deletedAt),
        filters.siteId ? eq(indirectEntries.siteId, filters.siteId) : undefined,
        filters.from ? gte(indirectEntries.workDate, filters.from) : undefined,
        filters.to ? lte(indirectEntries.workDate, filters.to) : undefined,
      ),
    )
    .orderBy(desc(indirectEntries.workDate), asc(indirectEntries.createdAt))
    .limit(Math.min(filters.limit ?? 2000, 10_000));
  return found.map((row) => toIndirectDTO(row, access, closed));
});

export interface IndirectInput {
  id?: string | null;
  siteId?: string | null;
  workDate: string;
  laborClassId?: string | null;
  reason: IndirectReason;
  headcount?: string | null;
  hours: string;
  overtimeHours?: string;
  note?: string | null;
  version?: number | null;
  source?: StreamSource;
  sourceRef?: string | null;
  isSample?: boolean;
}

async function finishDay(tx: Executor, ctx: DomainContext, days: readonly { siteId: string; date: string }[]): Promise<void> {
  const touched = newTouched();
  for (const day of days) touchDay(touched, day.siteId, day.date);
  await finishWrite(tx, ctx, touched);
}

/** Creates or edits one entry of time not on a job, and spreads its cost over the pool again. */
export const saveIndirectEntry = scoped(async function saveIndirectEntry(ctx: DomainContext, input: IndirectInput): Promise<IndirectEntryDTO> {
  const access = await requirePulse(ctx, 'production:log');
  if (Number(input.overtimeHours ?? 0) > Number(input.hours)) throw invalid('Overtime hours cannot be more than the labor hours.', { overtimeHours: 'More than the labor hours.' });
  return inTx(async (tx) => {
    let existing: IndirectRow | undefined;
    if (input.id) {
      [existing] = isUuid(input.id) ? await tx.select().from(indirectEntries).where(and(eq(indirectEntries.orgId, ctx.orgId), eq(indirectEntries.id, input.id), isNull(indirectEntries.deletedAt))) : [];
      if (!existing) throw notFound('That entry');
      assertVersion(existing.version, input.version);
    }
    const site = existing && !input.siteId ? await getSiteRow(ctx, existing.siteId, tx) : await resolveSite(ctx, input.siteId, tx);
    await assertCanLogDay(tx, ctx, access, site.id, site.timezone, input.workDate);
    await assertOpen(tx, ctx.orgId, [input.workDate, existing?.workDate]);
    const values = {
      siteId: site.id,
      workDate: input.workDate,
      laborClassId: input.laborClassId === undefined ? (existing?.laborClassId ?? null) : input.laborClassId,
      reason: input.reason,
      headcount: input.headcount === undefined ? (existing?.headcount ?? null) : input.headcount,
      hours: input.hours,
      overtimeHours: input.overtimeHours ?? existing?.overtimeHours ?? '0',
      note: input.note === undefined ? (existing?.note ?? null) : cleanText(input.note),
    };
    let row: IndirectRow;
    if (existing) {
      const change = diff(existing as unknown as Record<string, unknown>, values as Record<string, unknown>);
      if (!change) return toIndirectDTO(existing, access, await closedMonths(tx, ctx.orgId));
      [row] = (await tx.update(indirectEntries).set({ ...values, version: sql`version + 1`, updatedBy: ctx.userId, updatedAt: new Date() }).where(eq(indirectEntries.id, existing.id)).returning()) as [IndirectRow];
      await logActivity(tx, ctx, { verb: 'indirect.edited', entityType: 'indirect', entityId: row.id, ...change, meta: { workDate: row.workDate } });
    } else {
      [row] = (await tx
        .insert(indirectEntries)
        .values({ orgId: ctx.orgId, ...values, source: input.source ?? 'manual', sourceRef: input.sourceRef ?? null, isSample: Boolean(input.isSample), createdBy: ctx.userId, updatedBy: ctx.userId })
        .returning()) as [IndirectRow];
      await logActivity(tx, ctx, { verb: 'indirect.logged', entityType: 'indirect', entityId: row.id, after: { workDate: row.workDate, reason: row.reason, hours: row.hours, laborClassId: row.laborClassId } });
    }
    await restampIndirect(tx, ctx.orgId, sql`src.id = ${row.id}`);
    await finishDay(tx, ctx, [{ siteId: row.siteId, date: row.workDate }, ...(existing ? [{ siteId: existing.siteId, date: existing.workDate }] : [])]);
    const [fresh] = await tx.select().from(indirectEntries).where(eq(indirectEntries.id, row.id));
    return toIndirectDTO(fresh!, access, await closedMonths(tx, ctx.orgId));
  });
});

async function toggleIndirect(ctx: DomainContext, id: string, restore: boolean): Promise<IndirectEntryDTO> {
  const access = await requirePulse(ctx, 'production:log');
  return inTx(async (tx) => {
    const [row] = isUuid(id) ? await tx.select().from(indirectEntries).where(and(eq(indirectEntries.orgId, ctx.orgId), eq(indirectEntries.id, id))) : [];
    if (!row || (row.deletedAt !== null) !== restore) throw notFound('That entry');
    const site = await getSiteRow(ctx, row.siteId, tx);
    await assertCanLogDay(tx, ctx, access, site.id, site.timezone, row.workDate);
    await assertOpen(tx, ctx.orgId, [row.workDate]);
    const [after] = await tx.update(indirectEntries).set({ deletedAt: restore ? null : new Date(), version: sql`version + 1`, updatedBy: ctx.userId, updatedAt: new Date() }).where(eq(indirectEntries.id, row.id)).returning();
    await logActivity(tx, ctx, { verb: restore ? 'indirect.restored' : 'indirect.deleted', entityType: 'indirect', entityId: row.id, before: restore ? undefined : { workDate: row.workDate, reason: row.reason, hours: row.hours }, meta: { workDate: row.workDate } });
    if (restore) await restampIndirect(tx, ctx.orgId, sql`src.id = ${row.id}`);
    await finishDay(tx, ctx, [{ siteId: row.siteId, date: row.workDate }]);
    return toIndirectDTO(after!, access, await closedMonths(tx, ctx.orgId));
  });
}

export const deleteIndirectEntry = scoped((ctx: DomainContext, id: string): Promise<IndirectEntryDTO> => toggleIndirect(ctx, id, false));
export const restoreIndirectEntry = scoped((ctx: DomainContext, id: string): Promise<IndirectEntryDTO> => toggleIndirect(ctx, id, true));

/* ---------------------------------------------------------------- paid hours */

export const listPaidHours = scoped(async function listPaidHours(ctx: DomainContext, filters: DayRangeFilters = {}): Promise<PaidHoursDTO[]> {
  const access = await requirePulse(ctx, 'pulse:read');
  const closed = await closedMonths(db, ctx.orgId);
  const found = await db
    .select()
    .from(paidHours)
    .where(
      and(
        eq(paidHours.orgId, ctx.orgId),
        filters.includeDeleted ? undefined : isNull(paidHours.deletedAt),
        filters.siteId ? eq(paidHours.siteId, filters.siteId) : undefined,
        filters.from ? gte(paidHours.workDate, filters.from) : undefined,
        filters.to ? lte(paidHours.workDate, filters.to) : undefined,
      ),
    )
    .orderBy(desc(paidHours.workDate), asc(paidHours.createdAt))
    .limit(Math.min(filters.limit ?? 2000, 10_000));
  return found.map((row) => toPaidDTO(row, access, closed));
});

export interface PaidHoursInput {
  siteId?: string | null;
  workDate: string;
  laborClassId?: string | null;
  paidHours: string;
  /** Real gross pay for the day. Only people who see money may set it. */
  paidCents?: number | null;
  version?: number | null;
  source?: StreamSource;
  sourceRef?: string | null;
  isSample?: boolean;
}

/** Sets the paid hours of a site, day and labor class (one row per key, so this is an upsert). */
export const savePaidHours = scoped(async function savePaidHours(ctx: DomainContext, input: PaidHoursInput): Promise<PaidHoursDTO> {
  const access = await requirePulse(ctx, 'production:log');
  return inTx(async (tx) => {
    const site = await resolveSite(ctx, input.siteId, tx);
    await assertCanLogDay(tx, ctx, access, site.id, site.timezone, input.workDate);
    await assertOpen(tx, ctx.orgId, [input.workDate]);
    const classId = input.laborClassId ?? null;
    const [existing] = await tx
      .select()
      .from(paidHours)
      .where(and(eq(paidHours.orgId, ctx.orgId), eq(paidHours.siteId, site.id), eq(paidHours.workDate, input.workDate), classId ? eq(paidHours.laborClassId, classId) : isNull(paidHours.laborClassId), isNull(paidHours.deletedAt)));
    if (existing) assertVersion(existing.version, input.version);
    const paidCents = !access.seesMoney || input.paidCents === undefined ? (existing?.paidCents ?? null) : input.paidCents === null ? null : BigInt(input.paidCents);
    let row: PaidRow;
    if (existing) {
      [row] = (await tx.update(paidHours).set({ paidHours: input.paidHours, paidCents, version: sql`version + 1`, updatedBy: ctx.userId, updatedAt: new Date() }).where(eq(paidHours.id, existing.id)).returning()) as [PaidRow];
      await logActivity(tx, ctx, { verb: 'paid_hours.edited', entityType: 'paid_hours', entityId: row.id, before: { paidHours: existing.paidHours, paidCents: existing.paidCents }, after: { paidHours: row.paidHours, paidCents: row.paidCents }, meta: { workDate: row.workDate } });
    } else {
      [row] = (await tx
        .insert(paidHours)
        .values({ orgId: ctx.orgId, siteId: site.id, workDate: input.workDate, laborClassId: classId, paidHours: input.paidHours, paidCents, source: input.source ?? 'manual', sourceRef: input.sourceRef ?? null, isSample: Boolean(input.isSample), createdBy: ctx.userId, updatedBy: ctx.userId })
        .returning()) as [PaidRow];
      await logActivity(tx, ctx, { verb: 'paid_hours.logged', entityType: 'paid_hours', entityId: row.id, after: { workDate: row.workDate, laborClassId: row.laborClassId, paidHours: row.paidHours, paidCents: row.paidCents } });
    }
    await finishDay(tx, ctx, [{ siteId: row.siteId, date: row.workDate }]);
    return toPaidDTO(row, access, await closedMonths(tx, ctx.orgId));
  });
});

async function togglePaid(ctx: DomainContext, id: string, restore: boolean): Promise<PaidHoursDTO> {
  const access = await requirePulse(ctx, 'production:log');
  return inTx(async (tx) => {
    const [row] = isUuid(id) ? await tx.select().from(paidHours).where(and(eq(paidHours.orgId, ctx.orgId), eq(paidHours.id, id))) : [];
    if (!row || (row.deletedAt !== null) !== restore) throw notFound('That row');
    const site = await getSiteRow(ctx, row.siteId, tx);
    await assertCanLogDay(tx, ctx, access, site.id, site.timezone, row.workDate);
    await assertOpen(tx, ctx.orgId, [row.workDate]);
    const [after] = await tx.update(paidHours).set({ deletedAt: restore ? null : new Date(), version: sql`version + 1`, updatedBy: ctx.userId, updatedAt: new Date() }).where(eq(paidHours.id, row.id)).returning();
    await logActivity(tx, ctx, { verb: restore ? 'paid_hours.restored' : 'paid_hours.deleted', entityType: 'paid_hours', entityId: row.id, meta: { workDate: row.workDate } });
    await finishDay(tx, ctx, [{ siteId: row.siteId, date: row.workDate }]);
    return toPaidDTO(after!, access, await closedMonths(tx, ctx.orgId));
  });
}

export const deletePaidHours = scoped((ctx: DomainContext, id: string): Promise<PaidHoursDTO> => togglePaid(ctx, id, false));
export const restorePaidHours = scoped((ctx: DomainContext, id: string): Promise<PaidHoursDTO> => togglePaid(ctx, id, true));
