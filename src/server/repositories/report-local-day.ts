/**
 * Warehouse-local calendar day of an ISO timestamp, in SQL (M13 round 6).
 *
 * SQLite has no time-zone database, so a fixed `'-300 minutes'` shift would be wrong for half
 * the year. Instead each zone's UTC offset is resolved in JS (Intl) into segments between DST
 * transitions, and the SQL picks the segment's offset with a CASE over the transition
 * instants: exact across DST changes for every row in [MIN_YEAR, MAX_YEAR].
 */
import { sql, type SQL } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import { isValidTimeZone, zoneOffsetMs } from "@/server/scheduler/timezone";

const MIN_YEAR = 2018;
const MAX_YEAR = 2036;
/** Scan step: DST changes are months apart, so a weekly probe + binary search finds each one. */
const STEP_MS = 7 * 86_400_000;

export interface OffsetSegment {
  /** First instant (ISO) of the segment; the first segment starts at -infinity. */
  readonly from: string | null;
  /** Offset east of UTC, in minutes. */
  readonly offsetMinutes: number;
}

const cache = new Map<string, readonly OffsetSegment[]>();
const offsetMin = (t: number, tz: string): number => Math.round(zoneOffsetMs(new Date(t), tz) / 60_000);

/** Offset segments of `tz` (cached). A zone without DST yields one segment. */
export function offsetSegments(tzIn: string): readonly OffsetSegment[] {
  const tz = isValidTimeZone(tzIn) ? tzIn : "UTC";
  const hit = cache.get(tz);
  if (hit) return hit;
  const start = Date.UTC(MIN_YEAR, 0, 1);
  const end = Date.UTC(MAX_YEAR + 1, 0, 1);
  const out: OffsetSegment[] = [{ from: null, offsetMinutes: offsetMin(start, tz) }];
  let prev = out[0]!.offsetMinutes;
  for (let t = start + STEP_MS; t <= end; t += STEP_MS) {
    const cur = offsetMin(t, tz);
    if (cur === prev) continue;
    // Binary search the exact minute of the change inside (t - 1 week, t].
    let lo = t - STEP_MS;
    let hi = t;
    while (hi - lo > 60_000) {
      const mid = lo + Math.floor((hi - lo) / 120_000) * 60_000;
      if (offsetMin(mid, tz) === prev) lo = mid; else hi = mid;
    }
    out.push({ from: new Date(hi).toISOString(), offsetMinutes: cur });
    prev = cur;
  }
  cache.set(tz, out);
  return out;
}

const modifier = (m: number): string => `${m >= 0 ? "+" : ""}${m} minutes`;

/** `date(<col> shifted into tz)`: the local YYYY-MM-DD of an ISO timestamp column. */
export function zoneDateSql(colExpr: string, tz: string): SQL {
  const col = sql.raw(colExpr);
  const segs = offsetSegments(tz);
  if (segs.length === 1) return sql`date(${col}, ${modifier(segs[0]!.offsetMinutes)})`;
  const parts: SQL[] = [sql`CASE`];
  for (let i = 1; i < segs.length; i += 1) parts.push(sql` WHEN ${col} < ${segs[i]!.from} THEN ${modifier(segs[i - 1]!.offsetMinutes)}`);
  parts.push(sql` ELSE ${modifier(segs[segs.length - 1]!.offsetMinutes)} END`);
  return sql`date(${col}, ${sql.join(parts, sql``)})`;
}

/**
 * Local day of `colExpr` in the zone of the row's warehouse (`whExpr`). Warehouses are grouped
 * by zone, so two Eastern warehouses share one CASE. Unknown warehouses fall back to UTC.
 */
export function warehouseDateSql(db: AppDb, colExpr: string, whExpr: string, warehouseIds: readonly string[]): SQL {
  if (warehouseIds.length === 0) return sql`substr(${sql.raw(colExpr)}, 1, 10)`;
  const rows = db.all<{ id: string; tz: string | null }>(sql`SELECT id, timezone AS tz FROM warehouses
    WHERE id IN (${sql.join(warehouseIds.map((id) => sql`${id}`), sql`, `)})`);
  const byZone = new Map<string, string[]>();
  for (const r of rows) {
    const tz = r.tz && isValidTimeZone(r.tz) ? r.tz : "UTC";
    byZone.set(tz, [...(byZone.get(tz) ?? []), r.id]);
  }
  const zones = [...byZone.entries()];
  if (zones.length === 1) return zoneDateSql(colExpr, zones[0]![0]);
  const wh = sql.raw(whExpr);
  const parts: SQL[] = [sql`CASE`];
  for (const [tz, ids] of zones) parts.push(sql` WHEN ${wh} IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)}) THEN ${zoneDateSql(colExpr, tz)}`);
  parts.push(sql` ELSE substr(${sql.raw(colExpr)}, 1, 10) END`);
  return sql.join(parts, sql``);
}
