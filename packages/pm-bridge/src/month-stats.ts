/**
 * One program month as CRM and WMS show it (docs/programs/SPEC.md 3.8, 4.3.1, 6.2). This is the
 * pm-bridge copy of the Projects read `apps/projects/src/server/domain/programs/stats.ts`: the
 * same shared loader (`@kitstak/db/programs`), the same stored rows (output snapshots plus the
 * ledger, never recomputed) and the same engine forecast, so a CRM panel shows the cents the
 * program overview shows. Keep the two in lockstep; `programs.db.test.ts` compares them.
 */
import { sql } from 'drizzle-orm';
import { loadProgramBuilds, loadProgramMonthInputs, loadTrailingDays, type Executor as SharedExecutor } from '@kitstak/db/programs';
import { addDays, firstDayOfMonth, isPlannableDay, lastDayOfMonth, monthOf } from '@kitstak/programs-engine/calendar';
import { forecastMonth, type ForecastResult } from '@kitstak/programs-engine/forecast';
import { monthCharges, type MonthResult } from '@kitstak/programs-engine/month';
import { fromScaled, maxCents, quantityToScaled, ZERO } from '@kitstak/programs-engine/money';
import { resolveOrderCharge, resolveUnitPrice } from '@kitstak/programs-engine/price';
import type { Cents, CardVersion, IsoDate, IsoMonth } from '@kitstak/programs-engine/types';
import { query, type BridgeExecutor } from './executor';

export interface BridgeMonthStats {
  readonly month: IsoMonth;
  readonly asOf: IsoDate;
  readonly result: MonthResult;
  readonly forecast: ForecastResult;
  readonly versions: readonly CardVersion[];
  /** Stored output snapshots plus live ledger rows of the month (the program headline). */
  readonly revenueCents: Cents;
}

export const shared = (db: BridgeExecutor): SharedExecutor => db as unknown as SharedExecutor;

/** Stored revenue of a month: output snapshots of live builds plus live ledger rows. */
export async function storedMonthCents(db: BridgeExecutor, programId: string, month: IsoMonth): Promise<Cents> {
  const from = firstDayOfMonth(month);
  const to = lastDayOfMonth(month);
  const [row] = await query<{ output: string; ledger: string }>(
    db,
    sql`select (select coalesce(sum(o.revenue_cents), 0)::text from pm.build_output o join pm.tasks t on t.id = o.build_id and t.deleted_at is null
                 where o.program_id = ${programId}::uuid and o.deleted_at is null and o.work_date between ${from}::date and ${to}::date) as output,
               (select coalesce(sum(cents), 0)::text from pm.program_ledger where program_id = ${programId}::uuid and deleted_at is null and month = ${from}::date) as ledger`,
  );
  return BigInt(row?.output ?? '0') + BigInt(row?.ledger ?? '0');
}

/** Stored revenue per month for a range of months (`YYYY-MM` to cents), one query. */
export async function storedMonthsCents(db: BridgeExecutor, programId: string, from: IsoMonth, to: IsoMonth): Promise<Map<IsoMonth, Cents>> {
  const out = new Map<IsoMonth, Cents>();
  if (to < from) return out;
  const rows = await query<{ month: string; cents: string }>(
    db,
    sql`select m.month, coalesce(sum(m.cents), 0)::text as cents from (
          select to_char(o.work_date, 'YYYY-MM') as month, o.revenue_cents as cents
            from pm.build_output o join pm.tasks t on t.id = o.build_id and t.deleted_at is null
           where o.program_id = ${programId}::uuid and o.deleted_at is null
             and o.work_date between ${firstDayOfMonth(from)}::date and ${lastDayOfMonth(to)}::date
          union all
          select to_char(l.month, 'YYYY-MM'), l.cents from pm.program_ledger l
           where l.program_id = ${programId}::uuid and l.deleted_at is null
             and l.month between ${firstDayOfMonth(from)}::date and ${firstDayOfMonth(to)}::date
        ) m group by m.month`,
  );
  for (const row of rows) out.set(row.month, BigInt(row.cents));
  return out;
}

export async function programMonthStats(
  db: BridgeExecutor,
  orgId: string,
  program: { readonly id: string; readonly monthlyTargetCents: Cents | null },
  today: IsoDate,
  monthArg?: IsoMonth,
): Promise<BridgeMonthStats> {
  const month = monthArg ?? monthOf(today);
  const from = firstDayOfMonth(month);
  const to = lastDayOfMonth(month);
  const asOf = today < from ? from : today;
  const inputs = await loadProgramMonthInputs(shared(db), orgId, program.id, month);
  const result = monthCharges({ ...inputs, asOf });
  const trailingFrom = addDays(asOf, -45);
  const [revenueCents, trailing, plannedRows, oneTime] = await Promise.all([
    storedMonthCents(db, program.id, month),
    loadTrailingDays(shared(db), orgId, program.id, { from: trailingFrom, before: asOf }),
    loadProgramBuilds(shared(db), orgId, program.id, { from, to }).then((builds) => builds.map((build) => ({ id: build.id, date: build.date, planned: build.planned, built: build.built, variant_id: build.variantId, rate: build.rate }))),
    query<{ id: string; kind: string; charge_on: string; amount_cents: string; label: string; variant_id: string | null; counts: boolean }>(
      db,
      sql`select id::text as id, kind, charge_on::text as charge_on, amount_cents::text as amount_cents, label, variant_id::text as variant_id, counts_toward_minimum as counts
            from pm.program_one_time_charges where program_id = ${program.id}::uuid and deleted_at is null and charge_on between ${from}::date and ${to}::date`,
    ),
  ]);
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
  const trailingDaily = trailing
    .filter((day) => isPlannableDay(inputs.calendar, day.date))
    .slice(-20)
    .map((day) => ({ date: day.date, workCents: BigInt(day.cents), units: day.units }));
  const forecast = forecastMonth({
    month,
    asOf,
    calendar: inputs.calendar,
    versions: inputs.versions,
    result,
    trailingDaily,
    planned,
    oneTime: oneTime.map((row) => ({
      id: row.id,
      kind: row.kind === 'adjustment' ? 'adjustment' : 'setup',
      chargeOn: row.charge_on,
      amountCents: row.amount_cents,
      label: row.label,
      variantId: row.variant_id,
      countsTowardMinimum: row.counts === true,
    })),
    targetCents: program.monthlyTargetCents,
  });
  return { month, asOf, result, forecast, versions: inputs.versions, revenueCents };
}
