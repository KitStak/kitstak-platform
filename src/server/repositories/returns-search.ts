/**
 * Shipped-order search for Create RMA and Return Manually ("Choose a shipped order").
 * Most recently shipped first, with the units still returnable (shipped − on other returns).
 */
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { AppDb } from "@/server/api/db";
import type { Scope } from "@/server/auth/scope";
import { idSchema } from "./platform-common";
import { RETURNABLE_ORDER_STATUSES } from "./returns";

export const SHIPPED_SEARCH_LIMIT = 50;

export const shippedSearchSchema = z.object({
  q: z.string().trim().max(100).optional(),
  clientId: idSchema.optional(),
  warehouseId: idSchema.optional(),
});

export interface ShippedOrderHit {
  readonly id: string;
  readonly code: string;
  readonly status: string;
  readonly customerName: string;
  readonly storeOrderNumber: string | null;
  readonly clientName: string;
  readonly shippedAt: string | null;
  readonly shippedUnits: number;
  readonly returnableUnits: number;
  /** Shipped with no active outbound label (every label voided): flagged so the RMA is checked first (R6 data integrity). */
  readonly outboundLabelVoided: number;
}

function inList(column: string, values: readonly string[]): SQL {
  if (values.length === 0) return sql`0 = 1`;
  return sql`${sql.raw(column)} IN (${sql.join(values.map((v) => sql`${v}`), sql`, `)})`;
}

/** Scoped search over code, store order # and customer (case-insensitive contains; `instr`, so % and _ are literal). */
export function searchShippedOrders(db: AppDb, scope: Scope, input: z.output<typeof shippedSearchSchema>): ShippedOrderHit[] {
  const parts: SQL[] = [
    inList("o.status", RETURNABLE_ORDER_STATUSES),
    sql`o.deleted_at IS NULL`,
    inList("o.warehouse_id", scope.warehouseIds),
    scope.clientIds === "all" ? sql`1 = 1` : inList("o.client_id", scope.clientIds),
  ];
  if (input.clientId) parts.push(sql`o.client_id = ${input.clientId}`);
  if (input.warehouseId) parts.push(sql`o.warehouse_id = ${input.warehouseId}`);
  if (input.q) {
    const needle = input.q.toLowerCase();
    parts.push(sql`(instr(lower(o.code), ${needle}) > 0 OR instr(lower(COALESCE(o.store_order_number, '')), ${needle}) > 0 OR instr(lower(o.customer_name), ${needle}) > 0)`);
  }
  // Pick the page of ids first, then compute the unit sums for those rows only (SQLite would
  // otherwise evaluate the correlated sums for every candidate order before sorting).
  return db.all<ShippedOrderHit>(sql`
    WITH hits AS (
      SELECT o.id, COALESCE(o.shipped_at, o.updated_at) AS sortAt FROM shipment_orders o
      WHERE ${sql.join(parts, sql` AND `)}
      ORDER BY sortAt DESC, o.code DESC
      LIMIT ${SHIPPED_SEARCH_LIMIT}
    )
    SELECT o.id, o.code, o.status, o.customer_name AS customerName, o.store_order_number AS storeOrderNumber, c.name AS clientName, o.shipped_at AS shippedAt,
      COALESCE((SELECT SUM(l.shipped_quantity) FROM order_lines l WHERE l.order_id = o.id), 0) AS shippedUnits,
      MAX(0, COALESCE((SELECT SUM(l.shipped_quantity) FROM order_lines l WHERE l.order_id = o.id), 0) - COALESCE((
        SELECT SUM(CASE WHEN ro.status = 'Completed' THEN rl.returned_qty ELSE MAX(rl.requested_qty, rl.returned_qty) END)
        FROM return_order_lines rl JOIN return_orders ro ON ro.id = rl.return_order_id
        WHERE ro.shipment_order_id = o.id AND ro.status <> 'Cancelled'), 0)) AS returnableUnits,
      (EXISTS (SELECT 1 FROM shipments s WHERE s.order_id = o.id AND s.label_type = 'Shipping Label' AND s.label_status = 'Voided')
        AND NOT EXISTS (SELECT 1 FROM shipments s WHERE s.order_id = o.id AND s.label_type = 'Shipping Label' AND s.label_status = 'Active')) AS outboundLabelVoided
    FROM hits h JOIN shipment_orders o ON o.id = h.id JOIN clients c ON c.id = o.client_id
    ORDER BY h.sortAt DESC, o.code DESC`);
}
