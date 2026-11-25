/**
 * Program summaries and statements (docs/programs/SPEC.md 4.2 `summary.ts`, 5.6, 5.20). The
 * summary reads output and the ledger (never recomputes past fees), runs the engine only for the
 * current month's preview items (the minimum gap so far) and the forecast, and schedules
 * `settleDue` after the response when the ledger is behind. Money is stripped when the reader
 * cannot see it. Statements come as JSON, CSV and PDF (pdf-lib).
 */
import 'server-only';
import { after } from 'next/server';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { readProgramMonth } from '@kitstak/db/programs';
import { addDays, firstDayOfMonth, isWorkDay, monthOf, monthsBetween, shortDate } from '@kitstak/programs-engine/calendar';
import { FORECAST_METHOD_LABELS } from '@kitstak/programs-engine/forecast';
import { formatCents, formatQty, formatUnitPrice } from '@kitstak/programs-engine/format';
import { fixedLineForMonth, minimumStatusLabel } from '@kitstak/programs-engine/month';
import { avgUnitPrice, rollupByDay, rollupByVariant } from '@kitstak/programs-engine/rollup';
import { fromScaled, quantityToScaled, ZERO } from '@kitstak/programs-engine/money';
import { getProgramPulse } from '@kitstak/pulse-bridge/programs';
import { db } from '@/server/db';
import { programCloses, programVariants } from '@/server/db/schema';
import { appUrls } from '@/server/env';
import type {
  DayRollupDTO,
  ForecastResultDTO,
  IsoDate,
  IsoMonth,
  MonthResultDTO,
  ProgramAlertDTO,
  ProgramRangeDTO,
  ProgramSummaryDTO,
  PulseParityDTO,
  StatementDTO,
  StatementLineDTO,
  TodayDTO,
  VariantRollupDTO,
} from '@/lib/program-types';
import type { DomainContext } from '../_shared';
import { bridge, calendarFor, centsOut, monthName } from './_program';
import { versionsFor } from './pricing';
import { assertMoney, requireProgram, type ProgramAccess } from './access';
import { listRuns } from './runs';
import { programMonthStats, type ProgramMonthStats } from './stats';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function resultDTO(stats: ProgramMonthStats, hidden: boolean): MonthResultDTO {
  const r = stats.result;
  const c = (v: bigint) => centsOut(v, hidden) as string;
  return {
    month: r.month,
    units: r.units,
    work: hidden ? null : { perUnitCents: c(r.work.perUnitCents), perOrderCents: c(r.work.perOrderCents), perHourCents: c(r.work.perHourCents), totalCents: c(r.work.totalCents) },
    fixed: hidden ? null : { monthlyFeeCents: c(r.fixed.monthlyFeeCents), setupCents: c(r.fixed.setupCents), totalCents: c(r.fixed.totalCents) },
    adjustments: hidden ? null : { totalCents: c(r.adjustments.totalCents), towardMinimumCents: c(r.adjustments.towardMinimumCents) },
    minimum: hidden ? null : { minimumCents: c(r.minimum.minimumCents), gapSoFarCents: c(r.minimum.gapSoFarCents), topUpCents: c(r.minimum.topUpCents), status: r.minimum.status, statusText: minimumStatusLabel(r.minimum.status) },
    totalCents: centsOut(stats.revenueCents, hidden),
    unpricedUnits: r.unpricedUnits,
  };
}

function forecastDTO(stats: ProgramMonthStats, hidden: boolean): ForecastResultDTO {
  const f = stats.forecast;
  return {
    actualCents: centsOut(stats.revenueCents, hidden),
    recentCents: centsOut(f.recentCents, hidden),
    plannedCents: centsOut(f.plannedCents, hidden),
    forecastCents: centsOut(f.forecastCents, hidden),
    method: f.method,
    methodText: FORECAST_METHOD_LABELS[f.method],
    remainingWorkDays: f.remainingWorkDays,
    avgDailyWorkCents: centsOut(f.avgDailyWorkCents, hidden),
    projectedGapCents: centsOut(f.projectedGapCents, hidden),
    targetGapCents: centsOut(f.targetGapCents, hidden),
    targetBp: hidden ? null : f.targetBp,
  };
}

async function variantNames(programId: string): Promise<Map<string, { name: string; color: string | null }>> {
  const rows = await db.select({ id: programVariants.id, name: programVariants.name, color: programVariants.color }).from(programVariants).where(eq(programVariants.programId, programId));
  return new Map(rows.map((row) => [row.id, { name: row.name, color: row.color }]));
}

/** Pulse parity per (program, job) for owners and admins (6.1). */
async function pulseParity(ctx: DomainContext, access: ProgramAccess, month: IsoMonth): Promise<PulseParityDTO | null> {
  const result = await getProgramPulse(bridge(db), { orgId: ctx.orgId, userId: ctx.userId }, { programId: access.program.id, month });
  if (!result.available) return { available: false, job: null, projectsCents: null, pulseCents: null, deltaCents: null, state: 'unavailable', text: 'Pulse is not available.', pendingSince: null, lastSyncAt: null };
  if (!result.job) return { available: true, job: null, projectsCents: null, pulseCents: null, deltaCents: null, state: 'no_job', text: 'No Pulse job is linked.', pendingSince: result.pendingSince, lastSyncAt: result.lastSyncAt };
  const hidden = !access.caps.seesMoney || result.moneyHidden;
  const read = await readProgramMonth(db as never, ctx.orgId, access.program.id, month);
  const projects = read.output.filter((row) => row.posting === 'program_job' && row.pulseJobId === result.job!.id).reduce((sum, row) => sum + BigInt(row.revenueCents), ZERO) + read.ledger.reduce((sum, row) => sum + row.cents, ZERO);
  const pulse = BigInt(result.stamped.totalCents);
  const deltaCents = pulse - projects;
  const pendingMinutes = result.pendingSince ? (Date.now() - Date.parse(result.pendingSince)) / 60000 : 0;
  const state: PulseParityDTO['state'] = deltaCents === ZERO ? 'matches' : result.pendingSync ? 'catching_up' : 'off';
  const absDelta = deltaCents < ZERO ? -deltaCents : deltaCents;
  const text = state === 'matches' ? 'Matches Pulse to the cent' : state === 'catching_up' ? 'Pulse is catching up' : `Pulse is ${formatCents(absDelta)} off`;
  return {
    available: true,
    job: { id: result.job.id, number: result.job.number, name: result.job.name, url: `${appUrls().pulse}${result.job.path}` },
    projectsCents: centsOut(projects, hidden),
    pulseCents: centsOut(pulse, hidden),
    deltaCents: centsOut(deltaCents, hidden),
    state: state === 'catching_up' && pendingMinutes < 10 && !access.caps.seesSync ? 'matches' : state,
    text,
    pendingSince: result.pendingSince,
    lastSyncAt: result.lastSyncAt,
  };
}

export async function getProgramSummary(ctx: DomainContext, key: string, options: { readonly month?: IsoMonth } = {}): Promise<ProgramSummaryDTO> {
  const access = await requireProgram(ctx, key);
  const { program, settings, caps } = access;
  const hidden = !caps.seesMoney;
  if (options.month && !MONTH.test(options.month)) throw new Error('bad month');
  const stats = await programMonthStats(db, ctx, program, settings, options.month);
  if (stats.ledgerBehind) {
    try {
      after(async () => {
        const { settleProgram } = await import('./sweep');
        await settleProgram(ctx, program.id);
      });
    } catch {
      // Outside a request (scripts and tests): nothing to schedule.
    }
  }
  const names = await variantNames(program.id);
  const byVariant: VariantRollupDTO[] = rollupByVariant(stats.result).map((row) => ({
    variantId: row.variantId,
    name: row.variantId ? (names.get(row.variantId)?.name ?? 'Removed variant') : 'Program hours',
    color: row.variantId ? (names.get(row.variantId)?.color ?? null) : null,
    units: row.units,
    builds: row.builds,
    perUnitCents: centsOut(row.perUnitCents, hidden),
    perOrderCents: centsOut(row.perOrderCents, hidden),
    perHourCents: centsOut(row.perHourCents, hidden),
    totalCents: centsOut(row.totalCents, hidden),
    avgUnitPrice: hidden ? null : row.avgUnitPrice,
  }));
  const byDay: DayRollupDTO[] = rollupByDay(stats.result, stats.planned).map((day) => ({
    date: day.date,
    units: day.units,
    plannedUnits: day.plannedUnits,
    workCents: centsOut(day.workCents, hidden),
    feeCents: centsOut(day.feeCents, hidden),
    cumulativeCents: centsOut(day.cumulativeCents, hidden),
  }));
  const today = stats.asOf;
  const runs = await listRuns(ctx, program.key, { from: today, to: today });
  const todayDTO: TodayDTO = {
    date: today,
    isWorkDay: isWorkDay(stats.calendar, today),
    builds: runs.reduce((s, r) => s + r.builds, 0),
    done: runs.reduce((s, r) => s + r.done, 0),
    plannedUnits: fromScaled(runs.reduce((s, r) => s + quantityToScaled(r.plannedUnits), ZERO), 3),
    builtUnits: fromScaled(runs.reduce((s, r) => s + quantityToScaled(r.builtUnits), ZERO), 3),
    revenueCents: hidden ? null : runs.reduce((s, r) => s + BigInt(r.revenueCents ?? '0'), ZERO).toString(),
    runs,
  };
  const alerts: ProgramAlertDTO[] = [];
  if (await hasNoCard(program.id)) alerts.push({ kind: 'no_price_card' });
  if (quantityToScaled(stats.result.unpricedUnits) > ZERO) alerts.push({ kind: 'unpriced_units', units: stats.result.unpricedUnits });
  if (!hidden && stats.forecast.projectedGapCents > ZERO) alerts.push({ kind: 'minimum_at_risk', projectedGapCents: stats.forecast.projectedGapCents.toString() });
  const yesterday = addDays(today, -1);
  const missed = await db.execute(
    sql`select count(*)::int as n from pm.builds b join pm.tasks t on t.id = b.task_id and t.deleted_at is null join pm.statuses s on s.id = t.status_id
         where b.program_id = ${program.id}::uuid and b.build_date = ${yesterday}::date and s.category <> 'cancelled' and b.built_qty = 0`,
  );
  const missedCount = Number((missed as unknown as { rows: { n: number }[] }).rows[0]?.n ?? 0);
  if (missedCount > 0 && isWorkDay(stats.calendar, yesterday)) alerts.push({ kind: 'no_output_yesterday', date: yesterday, builds: missedCount });
  const over = await db.execute(
    sql`select b.task_id::text as id, p.key || '-' || t.number::text as key, (b.built_qty - b.planned_qty)::text as over, b.build_date::text as date
          from pm.builds b join pm.tasks t on t.id = b.task_id and t.deleted_at is null join pm.projects p on p.id = t.project_id
         where b.program_id = ${program.id}::uuid and b.build_date > ${addDays(today, -7)}::date and b.built_qty > b.planned_qty and not b.unplanned
         order by b.build_date desc limit 5`,
  );
  for (const row of (over as unknown as { rows: { id: string; key: string; over: string; date: string }[] }).rows) alerts.push({ kind: 'over_plan', buildId: row.id, buildKey: row.key, overQty: row.over, date: row.date });
  if (settings.remindAt && isWorkDay(stats.calendar, today)) {
    const nowMinutes = Number(new Intl.DateTimeFormat('en-US', { timeZone: settings.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()).replace(':', ''));
    const remind = Number(settings.remindAt.slice(0, 5).replace(':', ''));
    if (nowMinutes >= remind && quantityToScaled(todayDTO.builtUnits) < quantityToScaled(todayDTO.plannedUnits)) alerts.push({ kind: 'behind_today', plannedUnits: todayDTO.plannedUnits, builtUnits: todayDTO.builtUnits });
  }
  const soon = await db.execute(sql`select number, effective_from::text as date from pm.price_card_versions where program_id = ${program.id}::uuid and status = 'published' and deleted_at is null and effective_from > ${today}::date and effective_from <= ${addDays(today, 7)}::date order by effective_from limit 1`);
  const next = (soon as unknown as { rows: { number: number; date: string }[] }).rows[0];
  if (next) alerts.push({ kind: 'version_starts_soon', versionNumber: Number(next.number), effectiveFrom: next.date });
  const pulse = caps.seesMoney ? await pulseParity(ctx, access, stats.month) : null;
  if (pulse && caps.seesSync && pulse.state === 'off') alerts.push({ kind: 'pulse_out_of_sync', deltaCents: pulse.deltaCents, reason: 'gap' });
  const { allLinkedWork } = await import('./links');
  const linkedWork = await allLinkedWork(ctx, program.key, stats.month).catch(() => null);
  return {
    month: stats.month,
    asOf: today,
    result: resultDTO(stats, hidden),
    forecast: forecastDTO(stats, hidden),
    byVariant,
    byDay,
    today: todayDTO,
    alerts,
    pulse,
    linkedWork,
    moneyHidden: hidden,
  };
}

async function hasNoCard(programId: string): Promise<boolean> {
  const result = await db.execute(sql`select 1 from pm.price_card_versions where program_id = ${programId}::uuid and status = 'published' and deleted_at is null limit 1`);
  return (result as unknown as { rows: unknown[] }).rows.length === 0;
}

/** Months and days of a range (trend chart), at most 24 months. */
export async function getProgramRange(ctx: DomainContext, key: string, range: { readonly from: IsoDate; readonly to: IsoDate }): Promise<ProgramRangeDTO> {
  const access = await requireProgram(ctx, key);
  const hidden = !access.caps.seesMoney;
  const months = monthsBetween(monthOf(range.from), monthOf(range.to)).slice(-24);
  const out: ProgramRangeDTO['months'][number][] = [];
  let units = ZERO;
  let total = ZERO;
  for (const month of months) {
    const read = await readProgramMonth(db as never, ctx.orgId, access.program.id, month);
    const work = read.output.reduce((sum, row) => sum + BigInt(row.revenueCents), ZERO);
    const fees = read.ledger.reduce((sum, row) => sum + row.cents, ZERO);
    const monthUnits = read.output.reduce((sum, row) => sum + quantityToScaled(row.qty), ZERO);
    units += monthUnits;
    total += work + fees;
    out.push({ month, units: fromScaled(monthUnits, 3), totalCents: centsOut(work + fees, hidden), workCents: centsOut(work, hidden), feeCents: centsOut(fees, hidden) });
  }
  const daily = await db.execute(
    sql`select work_date::text as date, coalesce(sum(qty), 0)::text as units, coalesce(sum(revenue_cents), 0)::text as cents from pm.build_output o join pm.tasks t on t.id = o.build_id and t.deleted_at is null
         where o.program_id = ${access.program.id}::uuid and o.deleted_at is null and o.work_date between ${range.from}::date and ${range.to}::date group by 1 order by 1`,
  );
  return {
    from: range.from,
    to: range.to,
    months: out,
    days: (daily as unknown as { rows: { date: string; units: string; cents: string }[] }).rows.map((row) => ({ date: row.date, units: row.units, workCents: centsOut(row.cents, hidden) })),
    totals: { units: fromScaled(units, 3), totalCents: centsOut(total, hidden) },
    moneyHidden: hidden,
  };
}

// --- Statements ------------------------------------------------------------------------------------

export async function getStatement(ctx: DomainContext, key: string, month: IsoMonth): Promise<StatementDTO> {
  if (!MONTH.test(month)) throw new Error('bad month');
  const access = await requireProgram(ctx, key, 'money:read');
  assertMoney(access);
  const { program, settings } = access;
  const stats = await programMonthStats(db, ctx, program, settings, month);
  const read = await readProgramMonth(db as never, ctx.orgId, program.id, month);
  const names = await variantNames(program.id);
  const [close] = await db.select().from(programCloses).where(and(eq(programCloses.programId, program.id), eq(programCloses.month, firstDayOfMonth(month)), isNull(programCloses.reopenedAt)));
  const perVariant = new Map<string | null, { units: bigint; cents: bigint }>();
  for (const row of read.output) {
    const entry = perVariant.get(row.variantId) ?? { units: ZERO, cents: ZERO };
    entry.units += quantityToScaled(row.qty);
    entry.cents += BigInt(row.revenueCents);
    perVariant.set(row.variantId, entry);
  }
  const work = [...perVariant.values()].reduce((sum, v) => sum + v.cents, ZERO);
  const adjustments = read.ledger.filter((row) => row.kind === 'adjustment').reduce((sum, row) => sum + row.cents, ZERO);
  const topUp = read.ledger.filter((row) => row.kind === 'minimum_top_up').reduce((sum, row) => sum + row.cents, ZERO);
  const fees = read.ledger.filter((row) => row.kind !== 'adjustment' && row.kind !== 'minimum_top_up').reduce((sum, row) => sum + row.cents, ZERO);
  const units = [...perVariant.values()].reduce((sum, v) => sum + v.units, ZERO);
  const customer = program.crmCustomerId ? await db.execute(sql`select name from core.customers where id = ${program.crmCustomerId}::uuid`) : null;
  const customerName = customer ? (customer as unknown as { rows: { name: string }[] }).rows[0]?.name : undefined;
  return {
    program: { id: program.id, key: program.key, name: program.name, customer: program.crmCustomerId && customerName ? { kind: 'core', id: program.crmCustomerId, name: customerName } : null, unit: { singular: settings.unitSingular, plural: settings.unitPlural } },
    month,
    asOf: stats.asOf,
    closed: Boolean(close),
    byVariant: [...perVariant.entries()].map(([variantId, v]) => ({ variantId, name: variantId ? (names.get(variantId)?.name ?? 'Removed variant') : 'No variant', units: fromScaled(v.units, 3), avgUnitPrice: avgUnitPrice(v.cents, fromScaled(v.units, 3)), cents: v.cents.toString() })),
    fees: await feeLines(ctx, program, month, read.ledger, names),
    totals: { units: fromScaled(units, 3), workCents: work.toString(), feesCents: fees.toString(), adjustmentsCents: adjustments.toString(), topUpCents: topUp.toString(), totalCents: (work + fees + adjustments + topUp).toString() },
    minimum: { minimumCents: stats.result.minimum.minimumCents.toString(), status: stats.result.minimum.status, statusText: minimumStatusLabel(stats.result.minimum.status) },
  };
}

type LedgerRead = Awaited<ReturnType<typeof readProgramMonth>>['ledger'];

/**
 * Statement charge lines. A monthly fee that changed during the month (a new price card version,
 * a pause) shows its pieces from the engine's `fixedLineForMonth(...).segments`: one line per run
 * of days at one amount, whose cents add up to the posted fee exactly (Appendix B.1.3).
 */
async function feeLines(ctx: DomainContext, program: ProgramAccess['program'], month: IsoMonth, ledger: LedgerRead, names: Map<string, { name: string }>): Promise<StatementLineDTO[]> {
  const out: StatementLineDTO[] = [];
  let pieces: ReturnType<typeof fixedLineForMonth> | null = null;
  for (const row of ledger) {
    const base: StatementLineDTO = { ref: row.ref, kind: row.kind, date: row.chargeDate, label: row.label, quantity: row.quantity, unitPrice: row.unitPrice, cents: row.cents.toString(), variantId: row.variantId, variantName: row.variantId ? (names.get(row.variantId)?.name ?? null) : null };
    if (row.kind !== 'flat_monthly') {
      out.push(base);
      continue;
    }
    pieces ??= fixedLineForMonth({ month, calendar: await calendarFor(db, ctx, program), versions: await versionsFor(db, ctx, program.id), kind: 'flat_monthly' });
    const segments = pieces.segments.filter((segment) => segment.cents !== ZERO);
    const sum = segments.reduce((total, segment) => total + segment.cents, ZERO);
    if (segments.length < 2 || sum !== row.cents) {
      out.push(base);
      continue;
    }
    segments.forEach((segment, index) => {
      const days = segment.from === segment.to ? shortDate(segment.from) : `${shortDate(segment.from)} to ${shortDate(segment.to)}`;
      out.push({ ...base, ref: `${row.ref}#${index + 1}`, date: segment.from, label: `${row.label}, ${days}`, cents: segment.cents.toString() });
    });
  }
  return out;
}

function csvCell(value: string | number | null): string {
  const text = value === null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const dollars = (cents: string): string => fromScaled(BigInt(cents), 2);

export async function statementCsv(ctx: DomainContext, key: string, month: IsoMonth): Promise<{ filename: string; body: string }> {
  const s = await getStatement(ctx, key, month);
  const rows: (string | number | null)[][] = [['Section', 'Date', 'Item', 'Qty', 'Unit price', 'Amount']];
  for (const v of s.byVariant) rows.push(['Work', '', v.name, v.units, v.avgUnitPrice, dollars(v.cents)]);
  for (const f of s.fees) rows.push(['Charges', f.date, f.label, f.quantity, f.unitPrice, dollars(f.cents)]);
  rows.push(['Total', '', `${monthName(month)} ${month.slice(0, 4)}`, s.totals.units, null, dollars(s.totals.totalCents)]);
  return { filename: `${s.program.key}-${month}-statement.csv`, body: `${rows.map((r) => r.map(csvCell).join(',')).join('\n')}\n` };
}

/** The statement as a one or more page PDF (Letter size). */
export async function statementPdf(ctx: DomainContext, key: string, month: IsoMonth): Promise<{ filename: string; body: Uint8Array }> {
  const s = await getStatement(ctx, key, month);
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([612, 792]);
  let y = 740;
  const ink = rgb(0.1, 0.1, 0.12);
  const muted = rgb(0.42, 0.42, 0.46);
  const text = (value: string, x: number, options: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; right?: boolean } = {}) => {
    const size = options.size ?? 10;
    const f = options.bold ? bold : font;
    const width = f.widthOfTextAtSize(value, size);
    page.drawText(value, { x: options.right ? x - width : x, y, size, font: f, color: options.color ?? ink });
  };
  const line = () => {
    page.drawLine({ start: { x: 48, y: y + 4 }, end: { x: 564, y: y + 4 }, thickness: 0.5, color: rgb(0.85, 0.85, 0.88) });
  };
  const next = (gap = 16) => {
    y -= gap;
    if (y < 72) {
      page = pdf.addPage([612, 792]);
      y = 740;
    }
  };
  text(`${s.program.name} (${s.program.key})`, 48, { size: 16, bold: true });
  next(20);
  text(`Statement for ${monthName(month)} ${month.slice(0, 4)}${s.program.customer ? ` · ${s.program.customer.name}` : ''}${s.closed ? ' · Closed' : ''}`, 48, { color: muted });
  next(28);
  text('Work', 48, { bold: true, size: 12 });
  next(18);
  text('Variant', 48, { color: muted });
  text(s.program.unit.plural, 360, { color: muted, right: true });
  text('Avg price', 460, { color: muted, right: true });
  text('Amount', 564, { color: muted, right: true });
  next();
  line();
  for (const v of s.byVariant) {
    text(v.name, 48);
    text(formatQty(v.units), 360, { right: true });
    text(v.avgUnitPrice ? formatUnitPrice(v.avgUnitPrice) : '', 460, { right: true });
    text(formatCents(v.cents), 564, { right: true });
    next();
  }
  next(10);
  text('Charges', 48, { bold: true, size: 12 });
  next(18);
  line();
  for (const f of s.fees) {
    text(shortDate(f.date), 48, { color: muted });
    text(f.label.slice(0, 60), 110);
    text(formatCents(f.cents), 564, { right: true });
    next();
  }
  if (s.fees.length === 0) {
    text('No charges this month.', 48, { color: muted });
    next();
  }
  next(10);
  line();
  text('Total', 48, { bold: true, size: 12 });
  text(formatCents(s.totals.totalCents), 564, { bold: true, size: 12, right: true });
  next(18);
  text(`${formatQty(s.totals.units)} ${s.program.unit.plural} · ${s.minimum.statusText}`, 48, { color: muted });
  const body = await pdf.save();
  return { filename: `${s.program.key}-${month}-statement.pdf`, body };
}

