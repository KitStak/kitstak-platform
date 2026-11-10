/**
 * Shipment-order change-log tidy pass (M01). The shared `recordUpdate` stores raw values,
 * so ISO timestamps read "2026-11-10T06:49:02.797Z", an empty side leaves a double space
 * ("Job is modified.  --> Job005302") and one priority edit writes two rows (Priority and
 * the internal Priority Rank). Orders commands run this pass in the same transaction, over
 * the rows they just wrote, so each user-visible field gets one readable entry:
 *   "Cancelled At is modified. — --> 11/10/2026 12:49:02 AM"
 *   "Priority is modified. 3 · High --> 5 · Urgent"
 * Datetimes are written in the order's warehouse time zone. Shared request: REQ-R3-1.
 */
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import { schema } from "@/server/db";

/** Same glyph as `EMPTY_VALUE` in `@/lib/format` (not imported: that module carries React context for components). */
const EMPTY_VALUE = "—";
import { effectiveRank, priorityFromRank } from "@/lib/grid-defs/orders/priority";

const cl = schema.changeLog;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/;
const DEFAULT_TZ = "America/Chicago";
/** A value this pass wrote before round 6: "11/10/2026 4:43:51 AM" (no zone label). */
const LEGACY_FORMATTED = /^\d{1,2}\/\d{1,2}\/\d{4} \d{1,2}:\d{2}:\d{2} [AP]M$/;

/** Short zone name ("CST", "CDT", "UTC") of `timeZone` on the day of a formatted value. */
function zoneAbbr(formatted: string, timeZone: string): string {
  const day = formatted.split(" ")[0] ?? "";
  const [m, d, y] = day.split("/").map(Number);
  const date = Number.isFinite(m) && Number.isFinite(d) && Number.isFinite(y) ? new Date(Date.UTC(y as number, (m as number) - 1, d as number, 12)) : new Date();
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(date).find((x) => x.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

/** Highest change_log rowid now; pass it to `tidyOrderChangeLog` after the command. */
export function changeLogMark(db: AppDb): number {
  return Number(db.get<{ m: number | null }>(sql`SELECT max(rowid) AS m FROM change_log`)?.m ?? 0);
}

/**
 * "M/D/YYYY h:mm:ss A TZ" in `timeZone`: Logiwa change-log style plus the zone abbreviation
 * ("11/10/2026 4:43:51 AM CST"). The drawer's OPERATION DATE column uses the viewer's zone, so the
 * label keeps both timestamps of one event unambiguous (critic r5). Non-ISO input is returned as is;
 * a value formatted before the label existed ("… 4:43:51 AM") gets the label appended.
 */
export function formatLogDateTime(value: string, timeZone: string = DEFAULT_TZ): string {
  if (LEGACY_FORMATTED.test(value)) return `${value} ${zoneAbbr(value, timeZone)}`.trimEnd();
  if (!ISO_DATETIME.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true, timeZoneName: "short" }).formatToParts(date);
  } catch {
    return formatLogDateTime(value, DEFAULT_TZ === timeZone ? "UTC" : DEFAULT_TZ);
  }
  const p = (t: Intl.DateTimeFormatPartTypes) => parts.find((x) => x.type === t)?.value ?? "";
  return `${p("month")}/${p("day")}/${p("year")} ${p("hour")}:${p("minute")}:${p("second")} ${p("dayPeriod").toUpperCase()} ${p("timeZoneName")}`.trimEnd();
}

/** One readable side of a change: formatted datetime, or the empty-value glyph. */
export function logSide(value: string | null | undefined, timeZone?: string): string {
  const v = (value ?? "").trim();
  return v === "" ? EMPTY_VALUE : formatLogDateTime(v, timeZone);
}

/** "3 · High" from a stored rank / level pair. */
export function priorityDisplay(rank: string | null | undefined, level: string | null | undefined): string {
  const r = rank != null && rank.trim() !== "" && Number.isFinite(Number(rank)) ? Number(rank) : null;
  const l = level && level.trim() !== "" ? level : null;
  if (r != null && r > 0) return `${r} · ${priorityFromRank(r)}`;
  if (l) return `${effectiveRank(l, 0)} · ${l}`;
  return r === 0 ? "0 · None" : EMPTY_VALUE;
}

/**
 * Business labels for fields whose auto label is a column name ("Merged Into Order Id").
 * Values on these rows are already codes (SO010907, BOX-CF-0909), so only the label changes.
 */
export const ORDER_LOG_LABELS: Readonly<Record<string, string>> = {
  mergedIntoOrderId: "Merged Into Order",
  shipmentPackageId: "Shipment Package",
  isMerged: "Merged",
  isUccLabelGenerated: "UCC Label Generated",
};

/** The label a reader sees: mapped business label, else the stored label without a trailing " Id". */
export function orderLogLabel(field: string | null, label: string): string {
  const mapped = field ? ORDER_LOG_LABELS[field] : undefined;
  if (mapped) return mapped;
  return label.replace(/ Id$/, "");
}

interface Row {
  readonly rowid: number;
  readonly entityId: string;
  readonly field: string | null;
  readonly fieldLabel: string | null;
  readonly fromValue: string | null;
  readonly toValue: string | null;
  readonly message: string;
}

const ROW_COLUMNS = { rowid: sql<number>`${cl}.rowid`, entityId: cl.entityId, field: cl.field, fieldLabel: cl.fieldLabel, fromValue: cl.fromValue, toValue: cl.toValue, message: cl.message };

/**
 * Rewrites the Update rows written after `mark` for `orderIds`. Only rows whose message is
 * the default "<label> is modified. <from> --> <to>" are rewritten; custom sentences stay.
 */
export function tidyOrderChangeLog(db: AppDb, orderIds: readonly string[], mark: number): void {
  if (orderIds.length === 0) return;
  const rows = db.select(ROW_COLUMNS)
    .from(cl)
    .where(and(gt(sql`${cl}.rowid`, mark), eq(cl.entityType, "shipment_order"), eq(cl.type, "Update"), inArray(cl.entityId, [...orderIds])))
    .all() as Row[];
  tidyRows(db, rows);
}

/**
 * Rows another module wrote raw (jobs, shipping, merge, workflows): a double space from an
 * empty side, a raw ISO timestamp, or a column-name label. Cheap to find (no full scan per order:
 * change_log is indexed by entity), so the order detail can repair its own history on read and a
 * one-off backfill can repair everything (`repairOrderChangeLog(db)`).
 */
const NEEDS_REPAIR = sql`(${cl.message} LIKE '%.  -->%' OR ${cl.message} LIKE '% --> ' OR ${cl.fromValue} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*' OR ${cl.toValue} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*' OR ${cl.fromValue} GLOB '*[0-9]:[0-9][0-9]:[0-9][0-9] [AP]M' OR ${cl.toValue} GLOB '*[0-9]:[0-9][0-9]:[0-9][0-9] [AP]M' OR ${cl.fieldLabel} LIKE '% Id' OR ${cl.field} IN (${sql.join(Object.keys(ORDER_LOG_LABELS).map((k) => sql`${k}`), sql`, `)}))`;

/** Repairs raw Update rows on the given orders, or on every shipment order when `orderIds` is omitted. Returns rows rewritten. */
export function repairOrderChangeLog(db: AppDb, orderIds?: readonly string[]): number {
  if (orderIds && orderIds.length === 0) return 0;
  const base = and(eq(cl.entityType, "shipment_order"), eq(cl.type, "Update"), NEEDS_REPAIR);
  const where = orderIds ? and(base, inArray(cl.entityId, [...orderIds])) : base;
  const rows = db.select(ROW_COLUMNS).from(cl).where(where).all() as Row[];
  if (rows.length === 0) return 0;
  let changed = 0;
  db.transaction(() => {
    changed = tidyRows(db, rows);
  });
  return changed;
}

function tidyRows(db: AppDb, rows: readonly Row[]): number {
  if (rows.length === 0) return 0;
  let changed = 0;
  const tz = warehouseZones(db, [...new Set(rows.map((r) => r.entityId))]);
  const byOrder = new Map<string, Row[]>();
  for (const r of rows) byOrder.set(r.entityId, [...(byOrder.get(r.entityId) ?? []), r]);

  for (const [orderId, list] of byOrder) {
    const zone = tz.get(orderId);
    const level = list.find((r) => r.field === "priority");
    const rank = list.find((r) => r.field === "priorityRank");
    if (rank) {
      const current = db.select({ priority: schema.shipmentOrders.priority }).from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, orderId)).get();
      const from = priorityDisplay(rank.fromValue, level ? level.fromValue : current?.priority);
      const to = priorityDisplay(rank.toValue, level ? level.toValue : current?.priority);
      const target = level ?? rank;
      write(db, target.rowid, "priority", "Priority", from, to);
      changed++;
      if (level) db.delete(cl).where(sql`${cl}.rowid = ${rank.rowid}`).run();
    }
    for (const r of list) {
      if (r === rank || (rank && r === level)) continue;
      if (!r.fieldLabel || !isDefaultMessage(r)) continue;
      const from = logSide(r.fromValue, zone);
      const to = logSide(r.toValue, zone);
      const label = orderLogLabel(r.field, r.fieldLabel);
      if (from === (r.fromValue ?? "") && to === (r.toValue ?? "") && label === r.fieldLabel) continue;
      write(db, r.rowid, r.field, label, from, to);
      changed++;
    }
  }
  return changed;
}

function isDefaultMessage(r: Row): boolean {
  return r.message === `${r.fieldLabel} is modified. ${r.fromValue ?? ""} --> ${r.toValue ?? ""}`;
}

function write(db: AppDb, rowid: number, field: string | null, label: string, from: string, to: string): void {
  db.update(cl).set({ field, fieldLabel: label, fromValue: from, toValue: to, message: `${label} is modified. ${from} --> ${to}` })
    .where(sql`${cl}.rowid = ${rowid}`).run();
}

function warehouseZones(db: AppDb, orderIds: readonly string[]): Map<string, string> {
  const rows = db.select({ id: schema.shipmentOrders.id, tz: schema.warehouses.timezone }).from(schema.shipmentOrders)
    .leftJoin(schema.warehouses, eq(schema.warehouses.id, schema.shipmentOrders.warehouseId))
    .where(inArray(schema.shipmentOrders.id, [...orderIds])).all();
  return new Map(rows.map((r) => [r.id, r.tz ?? DEFAULT_TZ]));
}

/** Runs `fn`, then tidies the order change-log rows it wrote. */
export function withTidyLog<T>(db: AppDb, orderIds: readonly string[], fn: () => T): T {
  const mark = changeLogMark(db);
  const out = fn();
  tidyOrderChangeLog(db, orderIds, mark);
  return out;
}
