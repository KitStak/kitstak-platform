/**
 * Reports (docs/programs/SPEC.md 4.2 `reports.ts`, 5.19, 5.20): Trends (months by programs or
 * customers, units and revenue from stored output and the ledger), its CSV, the share report of a
 * run or a week (units by variant, charges only when asked and allowed) and the dashboard panels.
 */
import 'server-only';
import { sql } from 'drizzle-orm';
import { firstDayOfMonth, lastDayOfMonth, monthsBetween, addDays, startOfWeek } from '@kitstak/programs-engine/calendar';
import { fromScaled, quantityToScaled, ZERO } from '@kitstak/programs-engine/money';
import { formatCents } from '@kitstak/programs-engine/format';
import { parseRunId } from '@kitstak/programs-engine/runs';
import { db } from '@/server/db';
import { forbidden, invalid } from '@/server/errors';
import type { DashboardProgramsDTO, IsoMonth, TrendsDTO } from '@/lib/program-types';
import type { DomainContext } from '../_shared';
import { centsOut, todayInZone } from './_program';
import { requireProgram, seesMoneyFor } from './access';
import { listPrograms } from './programs';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function programTrends(ctx: DomainContext, input: { readonly from: IsoMonth; readonly to: IsoMonth; readonly groupBy: 'program' | 'customer' }): Promise<TrendsDTO> {
  if (!MONTH.test(input.from) || !MONTH.test(input.to) || input.from > input.to) throw invalid('Pick a valid range of months.');
  const months = monthsBetween(input.from, input.to).slice(-24);
  const programs = await listPrograms(ctx, { includeArchived: true });
  const ids = programs.map((p) => p.id);
  const money = await seesMoneyFor(ctx, ids);
  if (ids.length === 0) return { from: input.from, to: input.to, groupBy: input.groupBy, months, rows: [], totals: months.map((month) => ({ month, revenueCents: '0' })) };
  const list = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
  const from = firstDayOfMonth(months[0]!);
  const to = lastDayOfMonth(months.at(-1)!);
  const [output, ledger] = await Promise.all([
    db.execute(sql`select o.program_id::text as program_id, to_char(o.work_date, 'YYYY-MM') as month, sum(o.qty)::text as units, sum(o.revenue_cents)::text as cents
                     from pm.build_output o join pm.tasks t on t.id = o.build_id and t.deleted_at is null
                    where o.program_id in (${list}) and o.deleted_at is null and o.work_date between ${from}::date and ${to}::date group by 1, 2`),
    db.execute(sql`select program_id::text as program_id, to_char(month, 'YYYY-MM') as month, sum(cents)::text as cents from pm.program_ledger
                    where program_id in (${list}) and deleted_at is null and month between ${from}::date and ${to}::date group by 1, 2`),
  ]);
  const cell = new Map<string, { units: bigint; cents: bigint }>();
  for (const row of (output as unknown as { rows: { program_id: string; month: string; units: string; cents: string }[] }).rows) cell.set(`${row.program_id}|${row.month}`, { units: quantityToScaled(row.units), cents: BigInt(row.cents) });
  for (const row of (ledger as unknown as { rows: { program_id: string; month: string; cents: string }[] }).rows) {
    const entry = cell.get(`${row.program_id}|${row.month}`) ?? { units: ZERO, cents: ZERO };
    entry.cents += BigInt(row.cents);
    cell.set(`${row.program_id}|${row.month}`, entry);
  }
  const groups = new Map<string, { id: string; key: string | null; name: string; unit: string; programIds: string[] }>();
  for (const program of programs) {
    const groupId = input.groupBy === 'customer' ? (program.customer?.id ?? 'none') : program.id;
    const name = input.groupBy === 'customer' ? (program.customer?.name ?? 'No customer') : program.name;
    const group = groups.get(groupId) ?? { id: groupId, key: input.groupBy === 'program' ? program.key : null, name, unit: program.unit.plural, programIds: [] };
    group.programIds.push(program.id);
    groups.set(groupId, group);
  }
  const totals = new Map<string, bigint>();
  const rows = [...groups.values()].map((group) => {
    const hidden = group.programIds.some((id) => !money.has(id));
    let units = ZERO;
    let cents = ZERO;
    const cells = months.map((month) => {
      let u = ZERO;
      let c = ZERO;
      for (const id of group.programIds) {
        const entry = cell.get(`${id}|${month}`);
        if (!entry) continue;
        u += entry.units;
        c += entry.cents;
      }
      units += u;
      cents += c;
      if (!hidden) totals.set(month, (totals.get(month) ?? ZERO) + c);
      return { month, units: fromScaled(u, 3), revenueCents: centsOut(c, hidden) };
    });
    return { id: group.id, key: group.key, name: group.name, unit: group.unit, cells, totalUnits: fromScaled(units, 3), totalCents: centsOut(cents, hidden), moneyHidden: hidden };
  });
  return { from: input.from, to: input.to, groupBy: input.groupBy, months, rows: rows.sort((a, b) => a.name.localeCompare(b.name)), totals: months.map((month) => ({ month, revenueCents: (totals.get(month) ?? ZERO).toString() })) };
}

function cell(value: string | null): string {
  const text = value ?? '';
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function trendsCsv(ctx: DomainContext, input: { readonly from: IsoMonth; readonly to: IsoMonth; readonly groupBy: 'program' | 'customer' }): Promise<{ filename: string; body: string }> {
  const trends = await programTrends(ctx, input);
  const header = ['Name', 'Unit', ...trends.months.flatMap((m) => [`${m} units`, `${m} revenue`]), 'Total units', 'Total revenue'];
  const lines = [header.map(cell).join(',')];
  for (const row of trends.rows) {
    lines.push([row.name, row.unit, ...row.cells.flatMap((c) => [c.units, c.revenueCents === null ? '' : fromScaled(BigInt(c.revenueCents), 2)]), row.totalUnits, row.totalCents === null ? '' : fromScaled(BigInt(row.totalCents), 2)].map((v) => cell(v)).join(','));
  }
  return { filename: `programs-trends-${input.from}-to-${input.to}.csv`, body: `${lines.join('\n')}\n` };
}

/** Units by variant for a run or a week; charges only when asked and allowed (5.20). */
export async function shareReport(ctx: DomainContext, input: { readonly key: string; readonly runId?: string | null; readonly week?: string | null; readonly includeCharges: boolean; readonly format: 'csv' | 'pdf' }): Promise<{ filename: string; body: string | Uint8Array; contentType: string }> {
  const access = await requireProgram(ctx, input.key);
  if (input.includeCharges && !access.caps.seesMoney) throw forbidden('Money is hidden for your role.');
  const today = todayInZone(access.settings.timezone);
  let from = startOfWeek(today);
  let to = addDays(from, 6);
  let schedule = sql``;
  let title = `Week of ${from}`;
  if (input.runId) {
    const run = parseRunId(input.runId);
    if (!run) throw invalid('That run is not valid.');
    from = run.date;
    to = run.date;
    schedule = run.scheduleId ? sql` and b.schedule_id = ${run.scheduleId}::uuid` : sql` and b.schedule_id is null`;
    title = `Run of ${run.date}`;
  } else if (input.week && /^\d{4}-\d{2}-\d{2}$/.test(input.week)) {
    from = startOfWeek(input.week);
    to = addDays(from, 6);
    title = `Week of ${from}`;
  }
  const result = await db.execute(
    sql`select coalesce(v.name, 'No variant') as name, sum(b.planned_qty)::text as planned, sum(b.built_qty)::text as built, sum(b.scrap_qty)::text as scrap,
               coalesce(sum((select sum(o.revenue_cents) from pm.build_output o where o.build_id = b.task_id and o.deleted_at is null)), 0)::text as cents
          from pm.builds b join pm.tasks t on t.id = b.task_id and t.deleted_at is null left join pm.program_variants v on v.id = b.variant_id
         where b.program_id = ${access.program.id}::uuid and b.build_date between ${from}::date and ${to}::date${schedule}
         group by v.name, v.position order by v.position nulls last`,
  );
  const rows = (result as unknown as { rows: { name: string; planned: string; built: string; scrap: string; cents: string }[] }).rows;
  const header = ['Variant', 'Planned', 'Built', 'Scrap', ...(input.includeCharges ? ['Revenue'] : [])];
  const body = [header, ...rows.map((r) => [r.name, r.planned, r.built, r.scrap, ...(input.includeCharges ? [fromScaled(BigInt(r.cents), 2)] : [])])];
  const name = `${access.program.key}-${input.runId ? from : `week-${from}`}-report`;
  if (input.format === 'csv') return { filename: `${name}.csv`, body: `${body.map((r) => r.map((v) => cell(v)).join(',')).join('\n')}\n`, contentType: 'text/csv; charset=utf-8' };
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([612, 792]);
  let y = 740;
  page.drawText(`${access.program.name} (${access.program.key})`, { x: 48, y, size: 16, font: bold, color: rgb(0.1, 0.1, 0.12) });
  y -= 20;
  page.drawText(title, { x: 48, y, size: 10, font, color: rgb(0.42, 0.42, 0.46) });
  y -= 28;
  const cols = [48, 300, 380, 460, 540];
  header.forEach((h, i) => page.drawText(h, { x: cols[i]!, y, size: 10, font: bold }));
  y -= 18;
  for (const row of body.slice(1)) {
    row.forEach((v, i) => page.drawText(i === 4 ? formatCents(BigInt(rows[body.indexOf(row) - 1]!.cents)) : String(v), { x: cols[i]!, y, size: 10, font }));
    y -= 16;
    if (y < 72) break;
  }
  return { filename: `${name}.pdf`, body: await pdf.save(), contentType: 'application/pdf' };
}

/** The three dashboard panels: today across programs, this month, programs at risk. */
export async function dashboardPrograms(ctx: DomainContext): Promise<DashboardProgramsDTO> {
  const programs = await listPrograms(ctx);
  const hidden = programs.some((p) => p.moneyHidden);
  let revenue = ZERO;
  let forecast = ZERO;
  let target = ZERO;
  for (const p of programs) {
    revenue += BigInt(p.month.revenueCents ?? '0');
    forecast += BigInt(p.month.forecastCents ?? '0');
    target += BigInt(p.month.targetCents ?? '0');
  }
  return {
    today: { builds: programs.reduce((s, p) => s + p.today.builds, 0), done: programs.reduce((s, p) => s + p.today.done, 0), programs: programs.filter((p) => p.today.builds > 0).length },
    month: { revenueCents: centsOut(revenue, hidden), forecastCents: centsOut(forecast, hidden), targetCents: centsOut(target, hidden) },
    atRisk: programs
      .filter((p) => p.health === 'at_risk' || p.health === 'off_track' || (p.month.projectedGapCents !== null && BigInt(p.month.projectedGapCents) > ZERO))
      .map((p) => ({ key: p.key, name: p.name, reason: p.month.projectedGapCents && BigInt(p.month.projectedGapCents) > ZERO && !p.moneyHidden ? `May miss its minimum by ${formatCents(p.month.projectedGapCents)}` : p.health === 'off_track' ? 'Off track' : 'At risk' })),
    moneyHidden: hidden,
  };
}
