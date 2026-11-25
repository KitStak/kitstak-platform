/**
 * One program month as every read shows it (docs/programs/SPEC.md 3.5, 3.8, 4.3.1, 8.5): the
 * engine's month (from the shared loader), the forecast and health, and the stored revenue
 * (output snapshots plus the ledger). Summary, directory, Floor today and reports all read this,
 * so their numbers agree to the cent.
 */
import 'server-only';
import { sql } from 'drizzle-orm';
import { loadProgramMonthInputs } from '@kitstak/db/programs';
import { addDays, eachDay, firstDayOfMonth, isPlannableDay, lastDayOfMonth, monthOf } from '@kitstak/programs-engine/calendar';
import { forecastMonth, programHealth, type ForecastResult } from '@kitstak/programs-engine/forecast';
import { monthCharges, type MonthResult } from '@kitstak/programs-engine/month';
import { fromScaled, maxCents, quantityToScaled, ZERO } from '@kitstak/programs-engine/money';
import { resolveOrderCharge, resolveUnitPrice } from '@kitstak/programs-engine/price';
import type { Cents, IsoDate, IsoMonth, ProgramCalendar } from '@kitstak/programs-engine/types';
import type { Executor } from '@/server/db';
import type { Project, ProgramSettingsRow } from '@/server/db/schema';
import type { DomainContext } from '../_shared';
import { shared, todayInZone } from './_program';

export interface ProgramMonthStats {
  readonly month: IsoMonth;
  readonly asOf: IsoDate;
  readonly calendar: ProgramCalendar;
  readonly result: MonthResult;
  readonly forecast: ForecastResult;
  readonly health: { health: 'on_track' | 'at_risk' | 'off_track'; basis: 'money_target' | 'unit_target' | 'plan' } | null;
  /** Stored: output snapshots of the month. */
  readonly outputCents: Cents;
  /** Stored: live ledger rows of the month. */
  readonly ledgerCents: Cents;
  /** The headline: output plus ledger (4.2 `summary.ts`, never recomputed). */
  readonly revenueCents: Cents;
  /** The engine and the stored ledger disagree for this month (the summary schedules `settleDue`). */
  readonly ledgerBehind: boolean;
  readonly planned: readonly { readonly date: IsoDate; readonly qty: string }[];
}

async function rows<T>(executor: Executor, statement: ReturnType<typeof sql>): Promise<T[]> {
  return (await executor.execute(statement) as unknown as { rows: T[] }).rows;
}

export async function programMonthStats(
  executor: Executor,
  ctx: DomainContext,
  program: Pick<Project, 'id'>,
  settings: Pick<ProgramSettingsRow, 'timezone' | 'monthlyTargetCents' | 'dailyTargetUnits'>,
  monthArg?: IsoMonth,
): Promise<ProgramMonthStats> {
  const today = todayInZone(settings.timezone);
  const month = monthArg ?? monthOf(today);
  const from = firstDayOfMonth(month);
  const to = lastDayOfMonth(month);
  const asOf = today < from ? from : today;
  const inputs = await loadProgramMonthInputs(shared(executor), ctx.orgId, program.id, month);
  const result = monthCharges({ ...inputs, asOf });
  const trailingFrom = addDays(asOf, -45);
  const [stored, trailing, plannedRows, oneTime, ledgerRows] = await Promise.all([
    rows<{ output: string; ledger: string }>(
      executor,
      sql`select (select coalesce(sum(revenue_cents), 0)::text from pm.build_output o join pm.tasks t on t.id = o.build_id and t.deleted_at is null
                   where o.program_id = ${program.id}::uuid and o.deleted_at is null and o.work_date between ${from}::date and ${to}::date) as output,
                 (select coalesce(sum(cents), 0)::text from pm.program_ledger where program_id = ${program.id}::uuid and deleted_at is null and month = ${from}::date) as ledger`,
    ),
    rows<{ date: string; units: string; cents: string }>(
      executor,
      sql`select d.date::text as date, coalesce(sum(d.units), 0)::text as units, coalesce(sum(d.cents), 0)::text as cents from (
            select o.work_date as date, o.qty as units, o.revenue_cents as cents from pm.build_output o join pm.tasks t on t.id = o.build_id and t.deleted_at is null
             where o.program_id = ${program.id}::uuid and o.deleted_at is null and o.work_date >= ${trailingFrom}::date and o.work_date < ${asOf}::date
            union all
            select l.charge_date, 0, l.cents from pm.program_ledger l
             where l.program_id = ${program.id}::uuid and l.deleted_at is null and l.kind in ('per_order', 'per_hour') and l.charge_date >= ${trailingFrom}::date and l.charge_date < ${asOf}::date
          ) d group by 1 order by 1`,
    ),
    rows<{ id: string; date: string; planned: string; built: string; variant_id: string | null; rate: string | null }>(
      executor,
      sql`select b.task_id::text as id, b.build_date::text as date, b.planned_qty::text as planned, b.built_qty::text as built, b.variant_id::text as variant_id, b.rate_override::text as rate
            from pm.builds b join pm.tasks t on t.id = b.task_id and t.deleted_at is null join pm.statuses s on s.id = t.status_id
           where b.program_id = ${program.id}::uuid and b.build_date between ${from}::date and ${to}::date and s.category <> 'cancelled'`,
    ),
    rows<{ id: string; kind: string; charge_on: string; amount_cents: string; label: string; variant_id: string | null; counts: boolean }>(
      executor,
      sql`select id::text as id, kind, charge_on::text as charge_on, amount_cents::text as amount_cents, label, variant_id::text as variant_id, counts_toward_minimum as counts
            from pm.program_one_time_charges where program_id = ${program.id}::uuid and deleted_at is null and charge_on between ${from}::date and ${to}::date`,
    ),
    rows<{ ref: string; cents: string }>(executor, sql`select ref, cents::text as cents from pm.program_ledger where program_id = ${program.id}::uuid and deleted_at is null and month = ${from}::date`),
  ]);
  const outputCents = BigInt(stored[0]?.output ?? '0');
  const ledgerCents = BigInt(stored[0]?.ledger ?? '0');
  const calendar = inputs.calendar;
  // Open builds from today to month end, at today's price (3.8).
  const planned = plannedRows
    .filter((row) => row.date >= asOf)
    .map((row) => {
      const remaining = maxCents(ZERO, quantityToScaled(row.planned) - quantityToScaled(row.built));
      let unitPrice = '0.0000';
      try {
        unitPrice = resolveUnitPrice({ workDate: row.date, variantId: row.variant_id, buildOverride: row.rate, versions: inputs.versions }).unitPrice;
      } catch {
        unitPrice = '0.0000';
      }
      const order = remaining > ZERO ? resolveOrderCharge(inputs.versions, row.variant_id, row.date) : null;
      return { buildId: row.id, date: row.date, remainingQty: fromScaled(remaining, 3), unitPrice, orderCents: order ? order.amountCents : null };
    })
    .filter((row) => quantityToScaled(row.remainingQty) > ZERO);
  const trailingDaily = trailing.filter((day) => isPlannableDay(calendar, day.date)).slice(-20).map((day) => ({ date: day.date, workCents: BigInt(day.cents), units: day.units }));
  const forecast = forecastMonth({
    month,
    asOf,
    calendar,
    versions: inputs.versions,
    result,
    trailingDaily,
    planned,
    oneTime: oneTime.map((row) => ({ id: row.id, kind: row.kind === 'adjustment' ? 'adjustment' : 'setup', chargeOn: row.charge_on, amountCents: row.amount_cents, label: row.label, variantId: row.variant_id, countsTowardMinimum: row.counts === true })),
    targetCents: settings.monthlyTargetCents ?? null,
  });
  // Health: money target, else unit target, else plan vs built over the last 5 work days with builds.
  const byDate = new Map<string, { planned: bigint; built: bigint }>();
  for (const row of plannedRows) {
    if (row.date >= asOf) continue;
    const day = byDate.get(row.date) ?? { planned: ZERO, built: ZERO };
    day.planned += quantityToScaled(row.planned);
    day.built += quantityToScaled(row.built);
    byDate.set(row.date, day);
  }
  const lastWorkDays = [...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, day]) => ({ planned: fromScaled(day.planned, 3), built: fromScaled(day.built, 3) }));
  const recentUnits = trailingDaily.slice(-10);
  const recentUnitsPerDay = recentUnits.length ? fromScaled(recentUnits.reduce((sum, d) => sum + quantityToScaled(d.units), ZERO) / BigInt(recentUnits.length), 3) : null;
  const health = programHealth({ targetBp: forecast.targetBp, dailyTargetUnits: settings.dailyTargetUnits ?? null, recentUnitsPerDay, lastWorkDays });
  // Is the stored ledger behind the engine for this month (a due charge not posted yet)?
  const engineRefs = new Map(result.charges.filter((c) => c.posted && c.kind !== 'per_unit' && c.cents !== ZERO).map((c) => [c.ref, c.cents]));
  const storedRefs = new Map(ledgerRows.map((r) => [r.ref, BigInt(r.cents)]));
  let ledgerBehind = engineRefs.size !== storedRefs.size;
  for (const [ref, cents] of engineRefs) if (storedRefs.get(ref) !== cents) ledgerBehind = true;
  const plannedByDay = new Map<string, bigint>();
  for (const row of plannedRows) plannedByDay.set(row.date, (plannedByDay.get(row.date) ?? ZERO) + quantityToScaled(row.planned));
  return {
    month,
    asOf,
    calendar,
    result,
    forecast,
    health,
    outputCents,
    ledgerCents,
    revenueCents: outputCents + ledgerCents,
    ledgerBehind,
    planned: eachDay(from, to).map((date) => ({ date, qty: fromScaled(plannedByDay.get(date) ?? ZERO, 3) })),
  };
}
