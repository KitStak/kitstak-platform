/**
 * Month close (docs/programs/SPEC.md A9, 4.3.4): the checklist, close (lock plus a saved total)
 * and reopen (the latest closed month only, with a reason). Owners only (`program:close`).
 */
import 'server-only';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { readProgramMonth } from '@kitstak/db/programs';
import { firstDayOfMonth, lastDayOfMonth, monthOf, shiftMonth } from '@kitstak/programs-engine/calendar';
import { fromScaled, quantityToScaled, ZERO } from '@kitstak/programs-engine/money';
import { formatQty } from '@kitstak/programs-engine/format';
import { db } from '@/server/db';
import { programCloses, programOneTimeCharges, programSettings } from '@/server/db/schema';
import { conflict, invalid } from '@/server/errors';
import type { CloseChecklistDTO, CloseChecklistItemDTO, CloseDTO, IsoMonth } from '@/lib/program-types';
import { taskKey } from '@/lib/task-key';
import type { DomainContext } from '../_shared';
import { logActivity } from '../activity';
import { centsOut, lockSettings, monthName, shared, todayInZone } from './_program';
import { requireProgram, type ProgramAccess } from './access';
import { emitProgramChanged } from './events';
import { refreshLedgerFor } from './ledger';
import { programLocks } from './locks';
import { toOneTimeDTO } from './one-time';
import { programMonthStats } from './stats';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function assertMonth(month: string): void {
  if (!MONTH.test(month)) throw invalid('Pick a month.', { month: 'Pick a month.' });
}

async function checklist(ctx: DomainContext, access: ProgramAccess, month: IsoMonth, options: { readonly adjustmentsReviewed?: boolean } = {}): Promise<CloseChecklistDTO> {
  const { program, settings, caps } = access;
  const today = todayInZone(settings.timezone);
  const from = firstDayOfMonth(month);
  const to = lastDayOfMonth(month);
  const locks = await programLocks(ctx, program);
  const closed = locks.programClosed.includes(month);
  const [close] = await db.select().from(programCloses).where(and(eq(programCloses.programId, program.id), eq(programCloses.month, from), isNull(programCloses.reopenedAt)));
  const startMonth = program.startDate ? monthOf(program.startDate) : month;
  const earlierOpen: IsoMonth[] = [];
  for (let m = startMonth; m < month; m = shiftMonth(m, 1)) if (!locks.programClosed.includes(m)) earlierOpen.push(m);
  const open = await db.execute(
    sql`select b.task_id::text as id, t.number, t.title, b.build_date::text as build_date, b.planned_qty::text as planned_qty, b.built_qty::text as built_qty
          from pm.builds b join pm.tasks t on t.id = b.task_id and t.deleted_at is null join pm.statuses s on s.id = t.status_id
         where b.program_id = ${program.id}::uuid and b.build_date between ${from}::date and ${to}::date and s.category in ('todo', 'in_progress')
         order by b.build_date, t.position`,
  );
  const openBuilds = (open as unknown as { rows: { id: string; number: number; title: string; build_date: string; planned_qty: string; built_qty: string }[] }).rows;
  const stats = await programMonthStats(db, ctx, program, settings, month);
  const read = await readProgramMonth(shared(db), ctx.orgId, program.id, month);
  const units = read.output.reduce((sum, row) => sum + quantityToScaled(row.qty), ZERO);
  const total = read.output.reduce((sum, row) => sum + BigInt(row.revenueCents), ZERO) + read.ledger.reduce((sum, row) => sum + row.cents, ZERO);
  const adjustments = await db.select().from(programOneTimeCharges).where(and(eq(programOneTimeCharges.programId, program.id), eq(programOneTimeCharges.kind, 'adjustment'), isNull(programOneTimeCharges.deletedAt), sql`${programOneTimeCharges.chargeOn} between ${from}::date and ${to}::date`));
  const settled = Boolean(settings.settledThrough && settings.settledThrough >= to) && !stats.ledgerBehind;
  const items: CloseChecklistItemDTO[] = [
    { key: 'month_over', label: `${monthName(month)} has ended`, ok: today > to, required: true, detail: today > to ? null : `${monthName(month)} ends on the ${Number(to.slice(8))}th.` },
    { key: 'earlier_closed', label: 'Every month before it is closed', ok: earlierOpen.length === 0, required: true, detail: earlierOpen.length ? `Close ${earlierOpen.map((m) => monthName(m)).join(', ')} first.` : null },
    { key: 'open_builds', label: 'No open builds', ok: openBuilds.length === 0, required: true, detail: openBuilds.length ? `${openBuilds.length} ${openBuilds.length === 1 ? 'build is' : 'builds are'} still open.` : null },
    { key: 'unpriced', label: `Every ${settings.unitSingular} has a price`, ok: quantityToScaled(stats.result.unpricedUnits) === ZERO, required: true, detail: quantityToScaled(stats.result.unpricedUnits) === ZERO ? null : `${formatQty(stats.result.unpricedUnits)} ${settings.unitPlural} have no price.` },
    { key: 'settled', label: 'Monthly charges are added', ok: settled, required: true, detail: settled ? null : 'This happens on its own a few minutes after the month ends.' },
    { key: 'adjustments', label: 'Adjustments reviewed', ok: Boolean(options.adjustmentsReviewed) || adjustments.length === 0, required: true, detail: adjustments.length ? `${adjustments.length} ${adjustments.length === 1 ? 'adjustment' : 'adjustments'} this month.` : null },
  ];
  return {
    month,
    closed,
    closedAt: close ? close.closedAt.toISOString() : null,
    closedBy: close?.closedBy ?? null,
    canClose: caps.canClose && !closed && items.every((item) => item.ok || !item.required || item.key === 'adjustments'),
    canReopen: caps.canClose && closed && locks.programClosed.at(-1) === month,
    items,
    openBuilds: openBuilds.map((row) => ({ id: row.id, key: taskKey(program.key, row.number), title: row.title, buildDate: row.build_date, plannedQty: row.planned_qty, builtQty: row.built_qty })),
    adjustments: adjustments.map((row) => toOneTimeDTO(row, !caps.seesMoney, locks, false)),
    totalCents: centsOut(total, !caps.seesMoney),
    units: fromScaled(units, 3),
  };
}

export async function getCloseChecklist(ctx: DomainContext, key: string, month: IsoMonth): Promise<CloseChecklistDTO> {
  assertMonth(month);
  return checklist(ctx, await requireProgram(ctx, key), month);
}

export async function closeMonth(ctx: DomainContext, key: string, month: IsoMonth, options: { readonly adjustmentsReviewed?: boolean } = {}): Promise<CloseDTO> {
  assertMonth(month);
  const access = await requireProgram(ctx, key, 'program:close');
  // Settle first so the minimum top up is in the ledger (A5).
  await db.transaction(async (tx) => {
    const { settleDue } = await import('./ledger');
    await settleDue(tx, { ...ctx, actorKind: 'system' }, access.program.id);
  });
  const fresh = await requireProgram(ctx, key, 'program:close');
  const list = await checklist(ctx, fresh, month, { adjustmentsReviewed: options.adjustmentsReviewed ?? true });
  if (list.closed) throw conflict(`${monthName(month)} is already closed.`);
  const failed = list.items.find((item) => item.required && !item.ok);
  if (failed) throw invalid(failed.detail ?? failed.label);
  const result = await db.transaction(async (tx) => {
    await lockSettings(tx, [access.program.id], 'update');
    await refreshLedgerFor(tx, ctx, { programIds: [access.program.id], months: [month] });
    const read = await readProgramMonth(shared(tx), ctx.orgId, access.program.id, month);
    const units = read.output.reduce((sum, row) => sum + quantityToScaled(row.qty), ZERO);
    const total = read.output.reduce((sum, row) => sum + BigInt(row.revenueCents), ZERO) + read.ledger.reduce((sum, row) => sum + row.cents, ZERO);
    await tx.insert(programCloses).values({
      orgId: ctx.orgId,
      programId: access.program.id,
      month: firstDayOfMonth(month),
      totalCents: total,
      units: fromScaled(units, 3),
      checklist: Object.fromEntries(list.items.map((item) => [item.key, item.ok])),
      closedBy: ctx.userId,
      closedAt: new Date(),
    });
    const through = lastDayOfMonth(month);
    const [settings] = await tx.select().from(programSettings).where(eq(programSettings.programId, access.program.id));
    const lockedThrough = !settings?.lockedThrough || settings.lockedThrough < through ? through : settings.lockedThrough;
    await tx.update(programSettings).set({ lockedThrough, updatedAt: new Date() }).where(eq(programSettings.programId, access.program.id));
    await logActivity(tx, ctx, { verb: 'program.month_closed', entityType: 'project', entityId: access.program.id, projectId: access.program.id, after: { month, units: fromScaled(units, 3), money: { totalCents: total.toString() } } });
    await emitProgramChanged(tx, ctx, access.program.id);
    return { lockedThrough, total, units };
  });
  return { month, closed: true, lockedThrough: result.lockedThrough, totalCents: centsOut(result.total, !access.caps.seesMoney), units: fromScaled(result.units, 3) };
}

/** Reopens the latest closed month only (A9), with a reason. */
export async function reopenMonth(ctx: DomainContext, key: string, month: IsoMonth, reason: string): Promise<CloseDTO> {
  assertMonth(month);
  const text = reason.trim();
  if (!text) throw invalid('Say why the month is reopened.', { reason: 'Say why the month is reopened.' });
  const access = await requireProgram(ctx, key, 'program:close');
  const result = await db.transaction(async (tx) => {
    await lockSettings(tx, [access.program.id], 'update');
    const live = await tx.select().from(programCloses).where(and(eq(programCloses.programId, access.program.id), isNull(programCloses.reopenedAt))).orderBy(desc(programCloses.month));
    const latest = live[0];
    if (!latest || monthOf(latest.month) !== month) throw invalid('Only the latest closed month can be reopened.');
    await tx.update(programCloses).set({ reopenedAt: new Date(), reopenedBy: ctx.userId, reopenReason: text.slice(0, 1000) }).where(eq(programCloses.id, latest.id));
    const previous = live[1];
    const lockedThrough = previous ? lastDayOfMonth(monthOf(previous.month)) : null;
    await tx.update(programSettings).set({ lockedThrough, updatedAt: new Date() }).where(eq(programSettings.programId, access.program.id));
    await logActivity(tx, ctx, { verb: 'program.month_reopened', entityType: 'project', entityId: access.program.id, projectId: access.program.id, after: { month, reason: text } });
    await emitProgramChanged(tx, ctx, access.program.id);
    return { lockedThrough };
  });
  return { month, closed: false, lockedThrough: result.lockedThrough, totalCents: null, units: '0.000' };
}
