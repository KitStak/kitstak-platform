/** Shared helpers for the analytics builders: range parsing, app gate, scope, palette. */
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AppDb } from '@/server/api/db';
import type { AuthContext } from '@/server/auth/context';
import { isValidTimeZone, localMidnightUtc, localParts } from '@/server/scheduler/timezone';
import { inList } from './reports-grid';
import { RANGE_ORDER_MESSAGE } from './analytics-types';
import { dbGet } from '@/server/db/sql';

export { RANGE_ORDER_MESSAGE };

export const PALETTE = [
  '#2E5CE6',
  '#17874D',
  '#E0A500',
  '#621DB8',
  '#C2412A',
  '#0F8C7A',
  '#B07F00',
  '#50575C',
] as const;
export const DEFAULT_RANGE_DAYS = 30;
export const MAX_RANGE_DAYS = 366;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const idList = z
  .string()
  .max(4000)
  .optional()
  .transform((v) =>
    v
      ? v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 50)
      : [],
  );

export const analyticsQuerySchema = z
  .object({
    from: z.string().regex(DAY_RE).optional(),
    to: z.string().regex(DAY_RE).optional(),
    wh: idList,
    /** Client filter (comma-separated client ids); empty = every client in scope. */
    cl: idList,
  })
  .superRefine((q, ctx) => {
    if (q.from && q.to && q.from > q.to)
      ctx.addIssue({ code: 'custom', path: ['from'], message: RANGE_ORDER_MESSAGE });
  });
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

export interface Range {
  readonly from: string;
  readonly to: string;
  /** ISO bounds (inclusive start, exclusive end): local midnights in `tz`. */
  readonly fromIso: string;
  readonly toIso: string;
  readonly days: readonly string[];
  /** IANA zone the day bounds and buckets are computed in (the warehouse time zone). */
  readonly tz: string;
  /** UTC instant of local midnight for each day, plus the exclusive end (length = days + 1). */
  readonly bounds: readonly string[];
  /** Client filter; empty = all clients. */
  readonly clientIds: readonly string[];
  /** Labor self-only mode: task drilldowns are narrowed to this associate (Executed by user). */
  readonly executedBy?: string;
}

const dayOfUtc = (t: number) => new Date(t).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => dayOfUtc(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000);
const safeZone = (tz: string | undefined): string => (tz && isValidTimeZone(tz) ? tz : 'UTC');

/**
 * Inclusive YYYY-MM-DD range of LOCAL days in `tz` (the warehouse zone); defaults to the last
 * 30 days ending today in that zone; capped at 366 days. An inverted range never reaches here
 * from the API (the query schema rejects it with 400 VALIDATION); direct callers get a
 * RangeError instead of a silently rewritten range.
 */
export function parseRange(
  q: { from?: string; to?: string },
  now: Date = new Date(),
  tzIn?: string,
  clientIds: readonly string[] = [],
): Range {
  const tz = safeZone(tzIn);
  const today = localParts(now, tz).date;
  const toDay = q.to ?? (q.from && q.from > today ? q.from : today);
  let fromDay = q.from ?? addDays(toDay, -(DEFAULT_RANGE_DAYS - 1));
  if (fromDay > toDay) throw new RangeError(RANGE_ORDER_MESSAGE);
  const span =
    Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / 86_400_000) + 1;
  if (span > MAX_RANGE_DAYS) fromDay = addDays(toDay, -(MAX_RANGE_DAYS - 1));
  const days: string[] = [];
  for (let d = fromDay; d <= toDay; d = addDays(d, 1)) days.push(d);
  const bounds = [...days, addDays(toDay, 1)].map((d) => localMidnightUtc(d, tz).toISOString());
  return {
    from: fromDay,
    to: toDay,
    fromIso: bounds[0] as string,
    toIso: bounds[bounds.length - 1] as string,
    days,
    tz,
    bounds,
    clientIds,
  };
}

/** Local day (YYYY-MM-DD, in the range zone) of an ISO instant. */
export function localDayOf(iso: string, r: Pick<Range, 'tz'>): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? localParts(new Date(t), r.tz).date : iso.slice(0, 10);
}

/**
 * SQL expression bucketing an ISO timestamp column into the range's local day. Exact across DST
 * changes: a CASE over the per-day local-midnight bounds (rows outside the range give NULL).
 */
export function daySql(expr: string, r: Pick<Range, 'days' | 'bounds'>): SQL {
  if (r.days.length === 0) return sql`NULL`;
  const col = sql.raw(expr);
  const parts: SQL[] = [sql`CASE`];
  r.days.forEach((d, i) =>
    parts.push(sql` WHEN ${col} >= ${r.bounds[i]} AND ${col} < ${r.bounds[i + 1]} THEN ${d}`),
  );
  parts.push(sql` ELSE NULL END`);
  return sql.join(parts, sql``);
}

/** `col IN (clients)` when a client filter is set, else TRUE. */
export function clIn(expr: string, r: Pick<Range, 'clientIds'>): SQL {
  return r.clientIds.length ? inList(sql.raw(expr), r.clientIds) : sql`1 = 1`;
}

/** Time zone of the first selected warehouse (the range zone). */
export async function zoneOf(db: AppDb, wh: readonly string[]): Promise<string> {
  const id = wh[0];
  if (!id) return 'UTC';
  return (
    (await dbGet<{ tz: string }>(db, sql`SELECT timezone AS tz FROM warehouses WHERE id = ${id}`))?.tz ??
    'UTC'
  );
}

export async function isAppActive(db: AppDb, key: string): Promise<boolean> {
  return Boolean(
    (await dbGet<{ a: number }>(db, sql`SELECT is_active AS a FROM apps WHERE key = ${key}`))?.a,
  );
}

/** Warehouses: the requested ones inside the viewer's scope, else the header context. */
export function warehousesFor(auth: AuthContext, requested: readonly string[]): readonly string[] {
  const ok = requested.filter((id) => auth.scope.warehouseIds.includes(id));
  return ok.length > 0 ? ok : auth.viewScope.warehouseIds;
}

/**
 * Clients: the requested ones inside the viewer's client scope. With no request, a
 * client-restricted viewer (or a header client selection) is limited to their clients;
 * an all-clients viewer gets [] (no filter).
 */
export function clientsFor(auth: AuthContext, requested: readonly string[]): readonly string[] {
  const allowed = auth.scope.clientIds;
  const ok = allowed === 'all' ? [...requested] : requested.filter((id) => allowed.includes(id));
  if (ok.length > 0) return ok;
  const view = auth.viewScope.clientIds;
  return view === 'all' ? [] : view.length ? [...view] : ['__none__'];
}

export function whIn(expr: string, ids: readonly string[]): SQL {
  return inList(sql.raw(expr), ids);
}

export const round = (n: number, dp = 1): number => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

export const fmtInt = (n: number): string => new Intl.NumberFormat('en-US').format(Math.round(n));
export const fmtMoney = (n: number): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

const endOf = (exclusiveIso: string) => new Date(Date.parse(exclusiveIso) - 1).toISOString();

/** `f.x=date:custom:<fromIso>..<toIso>` for drilldowns into grids (exact local-day bounds). */
export const rangeFilter = (field: string, r: Pick<Range, 'fromIso' | 'toIso'>): string =>
  `f.${field}=date:custom:${r.fromIso}..${endOf(r.toIso)}`;

/** One whole local day in the range zone, matching the `daySql` buckets of the builders. */
export const dayFilter = (field: string, day: string, r: Pick<Range, 'tz'>): string => {
  const start = localMidnightUtc(day, r.tz).toISOString();
  const next = localMidnightUtc(addDays(day, 1), r.tz).toISOString();
  return `f.${field}=date:custom:${start}..${endOf(next)}`;
};

/** One hour window, e.g. a heatmap cell. */
export const hourFilter = (field: string, hourStartIso: string): string => {
  const end = new Date(Date.parse(hourStartIso) + 3_600_000 - 1).toISOString();
  return `f.${field}=date:custom:${hourStartIso}..${end}`;
};
