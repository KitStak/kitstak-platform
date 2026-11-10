/**
 * Purchase order status integrity (M05). A PO's status must agree with its receipts:
 *  - every line fully received through receipts  -> Completed (with Actual Receiving / Completed stamps)
 *  - some quantity received, lines still open      -> Started (never the ledger's transient "Receiving")
 * `poStatusDrift` lists violations (for `db:verify`); `repairPoStatusDrift` settles them
 * through the same path receiving uses, with change-log rows.
 */
import { eq, sql } from "drizzle-orm";
import { dayInZone } from "@/lib/grid-defs/receiving/po-schemas";
import type { AppDb } from "@/server/api/db";
import * as schema from "@/server/db/schema";
import type { DomainCtx } from "@/server/domain";
import { settleStatus } from "./purchase-orders-receive";

export interface PoStatusDrift {
  readonly id: string;
  readonly code: string;
  readonly status: string;
  readonly expected: "Completed" | "Started";
  readonly ordered: number;
  readonly received: number;
}

export function poStatusDrift(db: AppDb): PoStatusDrift[] {
  const rows = db.all<{ id: string; code: string; status: string; ordered: number; received: number; lineCount: number; openLines: number }>(sql`
    SELECT po.id, po.code, po.status, SUM(l.ordered_quantity) AS ordered, SUM(l.received_quantity) AS received, COUNT(l.id) AS lineCount,
           SUM(CASE WHEN l.received_quantity < l.ordered_quantity THEN 1 ELSE 0 END) AS openLines
    FROM purchase_orders po JOIN purchase_order_lines l ON l.purchase_order_id = po.id
    WHERE po.status IN ('Pending', 'Started', 'Receiving')
    GROUP BY po.id`);
  const out: PoStatusDrift[] = [];
  for (const r of rows) {
    const expected = r.openLines === 0 ? "Completed" : r.status === "Receiving" ? "Started" : null;
    if (expected) out.push({ id: r.id, code: r.code, status: r.status, expected, ordered: r.ordered, received: r.received });
  }
  return out;
}

/** Settles every drifted PO (status + stamps + change log). Returns the codes it fixed. */
export function repairPoStatusDrift(tx: AppDb, ctx: DomainCtx): string[] {
  const fixed: string[] = [];
  for (const d of poStatusDrift(tx)) {
    const row = tx.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, d.id)).get();
    if (!row) continue;
    const lastReceipt = tx.select({ at: sql<string | null>`MAX(${schema.receipts.receivedAt})` }).from(schema.receipts)
      .where(sql`${schema.receipts.purchaseOrderId} = ${d.id} AND ${schema.receipts.cancelledAt} IS NULL`).get()?.at ?? undefined;
    settleStatus(tx, ctx, d.id, row.status, lastReceipt);
    fixed.push(d.code);
  }
  return fixed;
}

/* ---------------- calendar-date normalisation ---------------- */

export interface CalendarDateFix {
  readonly table: "receipts" | "purchase_order_lines";
  readonly id: string;
  readonly field: "expiry_date" | "production_date";
  readonly from: string;
  readonly to: string;
}

/**
 * Lists receipt and PO-line expiry / production values stored as an instant (legacy rows such
 * as "2027-05-08T05:00:00.000Z") with the calendar day they meant: the day in the warehouse's
 * time zone. Current writes store YYYY-MM-DD (`dateOnly` / `toDay`).
 */
export function calendarDateDrift(db: AppDb): CalendarDateFix[] {
  const tz = new Map(db.select({ id: schema.warehouses.id, tz: schema.warehouses.timezone }).from(schema.warehouses).all().map((w) => [w.id, w.tz || "UTC"]));
  const out: CalendarDateFix[] = [];
  const scan = (table: CalendarDateFix["table"], rows: readonly { id: string; warehouseId: string; expiry: string | null; production: string | null }[]) => {
    for (const r of rows) {
      for (const [field, value] of [["expiry_date", r.expiry], ["production_date", r.production]] as const) {
        if (!value || /^\d{4}-\d{2}-\d{2}$/.test(value)) continue;
        const to = dayInZone(value, tz.get(r.warehouseId) ?? "UTC");
        if (to && to !== value) out.push({ table, id: r.id, field, from: value, to });
      }
    }
  };
  scan("receipts", db.all<{ id: string; warehouseId: string; expiry: string | null; production: string | null }>(sql`
    SELECT id, warehouse_id AS warehouseId, expiry_date AS expiry, production_date AS production FROM receipts
    WHERE expiry_date LIKE '%T%' OR production_date LIKE '%T%'`));
  scan("purchase_order_lines", db.all<{ id: string; warehouseId: string; expiry: string | null; production: string | null }>(sql`
    SELECT l.id, po.warehouse_id AS warehouseId, l.expiry_date AS expiry, l.production_date AS production
    FROM purchase_order_lines l JOIN purchase_orders po ON po.id = l.purchase_order_id
    WHERE l.expiry_date LIKE '%T%' OR l.production_date LIKE '%T%'`));
  return out;
}

/** Rewrites every drifted value to its calendar day. Returns the fixes applied. */
export function repairCalendarDates(tx: AppDb): CalendarDateFix[] {
  const fixes = calendarDateDrift(tx);
  for (const f of fixes) {
    if (f.table === "receipts") tx.run(sql`UPDATE receipts SET ${sql.raw(f.field)} = ${f.to} WHERE id = ${f.id}`);
    else tx.run(sql`UPDATE purchase_order_lines SET ${sql.raw(f.field)} = ${f.to} WHERE id = ${f.id}`);
  }
  return fixes;
}
