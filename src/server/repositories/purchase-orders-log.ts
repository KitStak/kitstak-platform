/**
 * Change-log presentation for purchase orders (M05). The shared `changeLog.recordUpdate`
 * writes values verbatim, so PO snapshots are humanised here first: date-only fields as
 * `YYYY/MM/DD`, timestamps as `YYYY/MM/DD h:mm AM` in the warehouse timezone, and empty
 * values as "(empty)" so a message never reads "is modified.  --> x".
 */
import { eq } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import * as schema from "@/server/db/schema";
import { formatZoned } from "@/lib/grid-defs/receiving/zoned-time";

export const EMPTY_LOG_VALUE = "(empty)";

/** Calendar-date fields (no time component). */
const DATE_FIELDS = new Set(["poDate", "plannedReceivingDate", "plannedArrivalDate", "expiryDate", "productionDate"]);
/** Instant fields (shown with the time, in the warehouse timezone). */
const DATETIME_FIELDS = new Set(["receivedAt", "actualArrivalDate", "completedAt", "cancelledAt"]);

const isBlank = (v: unknown): boolean => v === null || v === undefined || v === "";

/** `2026-11-09` / `2026-11-09T…` → `2026/11/09` (no timezone shift for date-only values). */
export function logDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? `${m[1]}/${m[2]}/${m[3]}` : value;
}

/** ISO instant → `2026/11/09 9:51 PM CST` in `timeZone` (UTC when unknown or invalid); the module-wide rule (`formatZoned`). */
export function logDateTime(value: string, timeZone = "UTC"): string {
  return formatZoned(value, timeZone);
}

/** One snapshot value as it should read in the change log. */
export function logValue(field: string, value: unknown, timeZone?: string): unknown {
  if (isBlank(value)) return EMPTY_LOG_VALUE;
  if (typeof value !== "string") return value;
  if (DATE_FIELDS.has(field)) return logDate(value);
  if (DATETIME_FIELDS.has(field)) return logDateTime(value, timeZone);
  return value;
}

/** Humanises every field of a before/after snapshot (keys are kept, so diffs still line up). */
export function logSnapshot(snapshot: Readonly<Record<string, unknown>>, timeZone?: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(snapshot).map(([k, v]) => [k, logValue(k, v, timeZone)]));
}

export function warehouseTimeZone(db: AppDb, warehouseId: string): string {
  return db.select({ tz: schema.warehouses.timezone }).from(schema.warehouses).where(eq(schema.warehouses.id, warehouseId)).get()?.tz ?? "UTC";
}
