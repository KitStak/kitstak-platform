/**
 * Count accuracy analytics (M07): inventory record accuracy over time from real count entries
 * (`count_line_entries` of counted lines, recount originals excluded). Bucket accuracy = share of
 * counted buckets whose counted qty matched the system qty. Breakdowns by SKU, location and
 * counter, plus a weekly trend.
 */
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AppDb } from '@/server/api/db';
import { notFoundError } from '@/server/api/errors';
import { hasWarehouse, type Scope } from '@/server/auth/scope';
import { inList, raw } from './counts-grid';
import { dbAll, dbGet } from '@/server/db/sql';

export const countAccuracyQuerySchema = z.object({
  warehouseId: z.string().min(1).max(64).optional(),
  days: z.coerce.number().int().min(7).max(365).default(90),
});

export interface AccuracyTotals {
  readonly buckets: number;
  readonly exactBuckets: number;
  readonly lines: number;
  readonly plans: number;
  readonly systemUnits: number;
  readonly countedUnits: number;
  readonly absVarianceUnits: number;
  readonly netVarianceUnits: number;
}

export interface AccuracyRow {
  readonly key: string;
  readonly label: string;
  readonly sub: string | null;
  readonly buckets: number;
  readonly exactBuckets: number;
  readonly absVarianceUnits: number;
  readonly netVarianceUnits: number;
}

export interface AccuracyWeek {
  readonly week: string;
  readonly buckets: number;
  readonly exactBuckets: number;
}

export interface CountAccuracy {
  readonly days: number;
  readonly totals: AccuracyTotals;
  readonly bySku: readonly AccuracyRow[];
  readonly byLocation: readonly AccuracyRow[];
  readonly byUser: readonly AccuracyRow[];
  readonly weekly: readonly AccuracyWeek[];
}

export async function countAccuracy(
  db: AppDb,
  scope: Scope,
  input: z.output<typeof countAccuracyQuerySchema>,
): Promise<CountAccuracy> {
  if (input.warehouseId && !hasWarehouse(scope, input.warehouseId)) throw notFoundError('Warehouse');
  const since = new Date(Date.now() - input.days * 86_400_000).toISOString();
  const wh: SQL = input.warehouseId
    ? sql`p.warehouse_id = ${input.warehouseId}`
    : inList(raw('p.warehouse_id'), scope.warehouseIds);
  const base = sql`FROM count_line_entries e JOIN count_plan_lines l ON l.id = e.line_id JOIN count_plans p ON p.id = l.plan_id
    WHERE ${wh} AND e.counted_at >= ${since} AND l.status IN ('Count Completed', 'Inventory Updated')`;
  const measures =
    raw(`COUNT(*) AS buckets, SUM(CASE WHEN e.counted_qty = e.system_qty THEN 1 ELSE 0 END) AS "exactBuckets",
    SUM(ABS(e.counted_qty - e.system_qty)) AS "absVarianceUnits", SUM(e.counted_qty - e.system_qty) AS "netVarianceUnits"`);
  const num = (v: unknown): number => Number(v ?? 0);
  const t =
    (await dbGet<Record<string, unknown>>(
      db,
      sql`SELECT ${measures}, COUNT(DISTINCT l.id) AS lines, COUNT(DISTINCT p.id) AS plans,
    SUM(e.system_qty) AS "systemUnits", SUM(e.counted_qty) AS "countedUnits" ${base}`,
    )) ?? {};
  const rows = async (
    keyExpr: string,
    labelExpr: string,
    subExpr: string,
    join = '',
  ): Promise<AccuracyRow[]> =>
    (
      await dbAll<Record<string, unknown>>(
        db,
        sql`SELECT ${raw(keyExpr)} AS key, ${raw(labelExpr)} AS label, ${raw(subExpr)} AS sub, ${measures}
      FROM count_line_entries e JOIN count_plan_lines l ON l.id = e.line_id JOIN count_plans p ON p.id = l.plan_id ${raw(join)}
      WHERE ${wh} AND e.counted_at >= ${since} AND l.status IN ('Count Completed', 'Inventory Updated')
      GROUP BY ${raw(keyExpr)}, ${raw(labelExpr)}, ${raw(subExpr)} ORDER BY "absVarianceUnits" DESC, buckets DESC LIMIT 10`,
      )
    ).map((r) => ({
      key: String(r.key ?? '—'),
      label: String(r.label ?? '—'),
      sub: r.sub === null || r.sub === undefined ? null : String(r.sub),
      buckets: num(r.buckets),
      exactBuckets: num(r.exactBuckets),
      absVarianceUnits: num(r.absVarianceUnits),
      netVarianceUnits: num(r.netVarianceUnits),
    }));
  const weekly = (
    await dbAll<Record<string, unknown>>(
      db,
      sql`SELECT to_char(date_trunc('week', ((e.counted_at)::timestamptz AT TIME ZONE 'UTC') - interval '1 day'), 'YYYY-MM-DD') AS week, COUNT(*) AS buckets,
      SUM(CASE WHEN e.counted_qty = e.system_qty THEN 1 ELSE 0 END) AS "exactBuckets" ${base} GROUP BY week ORDER BY week`,
    )
  ).map((r) => ({ week: String(r.week), buckets: num(r.buckets), exactBuckets: num(r.exactBuckets) }));
  return {
    days: input.days,
    totals: {
      buckets: num(t.buckets),
      exactBuckets: num(t.exactBuckets),
      lines: num(t.lines),
      plans: num(t.plans),
      systemUnits: num(t.systemUnits),
      countedUnits: num(t.countedUnits),
      absVarianceUnits: num(t.absVarianceUnits),
      netVarianceUnits: num(t.netVarianceUnits),
    },
    bySku: await rows('e.product_id', 'pr.sku', 'pr.name', 'JOIN products pr ON pr.id = e.product_id'),
    byLocation: await rows(
      'e.location_id',
      'lo.code',
      'lo.zone',
      'JOIN locations lo ON lo.id = e.location_id',
    ),
    byUser: await rows(
      'COALESCE(l.count_user_id, e.counted_by)',
      'COALESCE(u.name, e.counted_by)',
      'u.email',
      'LEFT JOIN users u ON u.id = l.count_user_id',
    ),
    weekly,
  };
}
