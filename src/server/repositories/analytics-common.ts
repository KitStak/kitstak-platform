/** Shared helpers for the analytics builders: range parsing, app gate, scope, palette. */
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { AppDb } from "@/server/api/db";
import type { AuthContext } from "@/server/auth/context";
import { inList } from "./reports-grid";
import { RANGE_ORDER_MESSAGE } from "./analytics-types";

export { RANGE_ORDER_MESSAGE };

export const PALETTE = ["#2E5CE6", "#17874D", "#E0A500", "#621DB8", "#C2412A", "#0F8C7A", "#B07F00", "#50575C"] as const;
export const DEFAULT_RANGE_DAYS = 30;
export const MAX_RANGE_DAYS = 366;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const analyticsQuerySchema = z.object({
  from: z.string().regex(DAY_RE).optional(),
  to: z.string().regex(DAY_RE).optional(),
  wh: z.string().max(4000).optional().transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 50) : [])),
}).superRefine((q, ctx) => {
  if (q.from && q.to && q.from > q.to) ctx.addIssue({ code: "custom", path: ["from"], message: RANGE_ORDER_MESSAGE });
});
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

export interface Range {
  readonly from: string;
  readonly to: string;
  /** ISO bounds (inclusive start, exclusive end). */
  readonly fromIso: string;
  readonly toIso: string;
  readonly days: readonly string[];
}

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Inclusive YYYY-MM-DD range; defaults to the last 30 days; capped at 366 days. An inverted
 * range never reaches here from the API (the query schema rejects it with 400 VALIDATION);
 * direct callers get a RangeError instead of a silently rewritten range.
 */
export function parseRange(q: { from?: string; to?: string }, now: Date = new Date()): Range {
  const today = dayOf(now);
  const toDay = q.to ?? (q.from && q.from > today ? q.from : today);
  const defaultFrom = new Date(Date.parse(`${toDay}T00:00:00Z`) - (DEFAULT_RANGE_DAYS - 1) * 86_400_000);
  let fromDay = q.from ?? dayOf(defaultFrom);
  if (fromDay > toDay) throw new RangeError(RANGE_ORDER_MESSAGE);
  const span = Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / 86_400_000) + 1;
  if (span > MAX_RANGE_DAYS) fromDay = dayOf(new Date(Date.parse(`${toDay}T00:00:00Z`) - (MAX_RANGE_DAYS - 1) * 86_400_000));
  const days: string[] = [];
  for (let t = Date.parse(`${fromDay}T00:00:00Z`); t <= Date.parse(`${toDay}T00:00:00Z`); t += 86_400_000) days.push(dayOf(new Date(t)));
  return { from: fromDay, to: toDay, fromIso: `${fromDay}T00:00:00.000Z`, toIso: new Date(Date.parse(`${toDay}T00:00:00Z`) + 86_400_000).toISOString(), days };
}

export function isAppActive(db: AppDb, key: string): boolean {
  return Boolean(db.get<{ a: number }>(sql`SELECT is_active AS a FROM apps WHERE key = ${key}`)?.a);
}

/** Warehouses: the requested ones inside the viewer's scope, else the header context. */
export function warehousesFor(auth: AuthContext, requested: readonly string[]): readonly string[] {
  const ok = requested.filter((id) => auth.scope.warehouseIds.includes(id));
  return ok.length > 0 ? ok : auth.viewScope.warehouseIds;
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

export const fmtInt = (n: number): string => new Intl.NumberFormat("en-US").format(Math.round(n));
export const fmtMoney = (n: number): string => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

/** `&f.x=date:custom:from..to` for drilldowns into grids. */
export const rangeFilter = (field: string, r: Range): string => `f.${field}=date:custom:${r.from}..${r.to}`;

/** One whole (UTC) day, matching the `substr(x, 1, 10)` day buckets of the builders. */
export const dayFilter = (field: string, day: string): string => `f.${field}=date:custom:${day}..${day}`;

/** One UTC hour window, e.g. a heatmap cell. */
export const hourFilter = (field: string, hourStartIso: string): string => {
  const end = new Date(Date.parse(hourStartIso) + 3_600_000 - 1).toISOString();
  return `f.${field}=date:custom:${hourStartIso}..${end}`;
};
