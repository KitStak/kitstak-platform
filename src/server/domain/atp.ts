/**
 * Available To Promise (BUILD_PLAN F5, spec 04/07):
 *   Current ATP    = Undamaged − Open SO
 *   Planned ATP    = Current ATP + Open PO
 *   On Hand        = undamaged stock in sync-allowed locations
 *   Sellable       = On Hand − Open SO
 *   Pickable       = unallocated, undamaged Stock in allocatable, unlocked locations
 *   Unallocated SO = Open SO − Allocated SO
 *
 * `atpComponentsSql()` is the SQL builder reused by M06 (ATP grid) and M13 (reports).
 */
import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "./types";
import { dbAll } from "../db/sql";

/** SO statuses whose remaining quantity is demand. */
export const OPEN_SO_STATUSES = ["Open", "Shortage", "On Hold", "Ready to Pick", "Picking Started", "Ready to Sort",
  "Sorting Started", "Ready to Pack", "Packing Started", "Ready to Load", "Loading Started", "Ready to Ship", "Partially Shipped"] as const;
export const OPEN_PO_STATUSES = ["Pending", "Started", "Receiving"] as const;

export interface AtpComponents {
  readonly productId: string;
  readonly warehouseId: string;
  readonly clientId: string;
  readonly total: number;
  readonly damaged: number;
  readonly allocatedSo: number;
  readonly openSo: number;
  readonly openPo: number;
  readonly onHand: number;
  readonly pickable: number;
}

export interface AtpRow extends AtpComponents {
  readonly undamaged: number;
  readonly currentAtp: number;
  readonly plannedAtp: number;
  readonly sellable: number;
  readonly unallocatedSo: number;
}

export function computeAtp(c: AtpComponents): AtpRow {
  const undamaged = c.total - c.damaged;
  const currentAtp = undamaged - c.openSo;
  return {
    ...c,
    undamaged,
    currentAtp,
    plannedAtp: currentAtp + c.openPo,
    sellable: c.onHand - c.openSo,
    unallocatedSo: Math.max(0, c.openSo - c.allocatedSo),
  };
}

const list = (values: readonly string[]): SQL => sql.raw(values.map((v) => `'${v.replace(/'/g, "''")}'`).join(","));

export interface AtpFilter {
  readonly warehouseIds?: readonly string[];
  readonly clientIds?: readonly string[];
  readonly productIds?: readonly string[];
}

function inFilter(column: string, values: readonly string[] | undefined): SQL {
  if (!values) return sql``;
  if (values.length === 0) return sql` AND false`;
  return sql` AND ${sql.raw(column)} IN (${sql.join(values.map((v) => sql`${v}`), sql`, `)})`;
}

/**
 * One row per (product, warehouse) with the raw ATP components. Products with no stock,
 * no open SO and no open PO are omitted.
 */
export function atpComponentsSql(filter: AtpFilter = {}): SQL {
  return sql`
    WITH keys AS (
      SELECT product_id, warehouse_id FROM inventory WHERE on_hand > 0
      UNION SELECT l.product_id, o.warehouse_id FROM order_lines l JOIN shipment_orders o ON o.id = l.order_id
        WHERE o.deleted_at IS NULL AND o.status IN (${list(OPEN_SO_STATUSES)})
      UNION SELECT l.product_id, p.warehouse_id FROM purchase_order_lines l JOIN purchase_orders p ON p.id = l.purchase_order_id
        WHERE p.status IN (${list(OPEN_PO_STATUSES)})
    )
    SELECT k.product_id AS "productId", k.warehouse_id AS "warehouseId", pr.client_id AS "clientId",
      COALESCE((SELECT SUM(i.on_hand) FROM inventory i WHERE i.product_id = k.product_id AND i.warehouse_id = k.warehouse_id), 0) AS total,
      COALESCE((SELECT SUM(i.damaged) FROM inventory i WHERE i.product_id = k.product_id AND i.warehouse_id = k.warehouse_id), 0) AS damaged,
      COALESCE((SELECT SUM(a.qty) FROM inventory_allocations a JOIN inventory i ON i.id = a.inventory_id
        WHERE i.product_id = k.product_id AND i.warehouse_id = k.warehouse_id AND a.order_line_id IS NOT NULL
          AND a.status IN ('Allocated','Picked','Sorted','Packed','Loaded')), 0) AS "allocatedSo",
      COALESCE((SELECT SUM(l.quantity - l.cancelled_quantity - l.shipped_quantity) FROM order_lines l JOIN shipment_orders o ON o.id = l.order_id
        WHERE l.product_id = k.product_id AND o.warehouse_id = k.warehouse_id AND o.deleted_at IS NULL
          AND o.status IN (${list(OPEN_SO_STATUSES)})), 0) AS "openSo",
      COALESCE((SELECT SUM(GREATEST(l.ordered_quantity - l.received_quantity, 0) * l.uom_quantity) FROM purchase_order_lines l
        JOIN purchase_orders p ON p.id = l.purchase_order_id
        WHERE l.product_id = k.product_id AND p.warehouse_id = k.warehouse_id AND p.status IN (${list(OPEN_PO_STATUSES)})), 0) AS "openPo",
      COALESCE((SELECT SUM(i.on_hand - i.damaged) FROM inventory i JOIN locations loc ON loc.id = i.location_id
        WHERE i.product_id = k.product_id AND i.warehouse_id = k.warehouse_id AND NOT loc.prevent_inventory_sync), 0) AS "onHand",
      COALESCE((SELECT SUM(i.on_hand - i.allocated) FROM inventory i JOIN locations loc ON loc.id = i.location_id
        WHERE i.product_id = k.product_id AND i.warehouse_id = k.warehouse_id AND i.status = 'Stock' AND i.damage_reason IS NULL
          AND NOT loc.prevent_allocation AND NOT loc.is_locked AND loc.is_active), 0) AS pickable
    FROM keys k JOIN products pr ON pr.id = k.product_id
    WHERE true${inFilter("k.warehouse_id", filter.warehouseIds)}${inFilter("pr.client_id", filter.clientIds)}${inFilter("k.product_id", filter.productIds)}
    ORDER BY k.product_id, k.warehouse_id`;
}

export async function getAtp(tx: Tx, filter: AtpFilter = {}): Promise<AtpRow[]> {
  return (await dbAll<AtpComponents>(tx, atpComponentsSql(filter))).map((r) => computeAtp({
    ...r, total: Number(r.total), damaged: Number(r.damaged), allocatedSo: Number(r.allocatedSo), openSo: Number(r.openSo),
    openPo: Number(r.openPo), onHand: Number(r.onHand), pickable: Number(r.pickable),
  }));
}
