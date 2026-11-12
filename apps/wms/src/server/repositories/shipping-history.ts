/**
 * Shipment History (M02): every ledger Shipment transaction and every remove-inventory
 * adjustment, one row per SKU × lot × LPN movement. Quantities are the ledger's own
 * (unsigned) amounts, so the report reconciles exactly with `inventory_transactions`.
 */
import { sql, type SQL } from "drizzle-orm";
import {
  SHIPMENT_HISTORY_FIELDS, SHIPMENT_HISTORY_SEARCH_FIELDS, SHIPMENT_HISTORY_SORT_FIELDS,
} from "@/lib/grid-defs/shipping/shipment-history";
import type { AppDb } from "@/server/api/db";
import type { AuthContext } from "@/server/auth/context";
import type { GridQuery } from "@/server/query/grid-query";
import { compileGrid, scopeSql, whereClause, type GridSpec } from "./shipping-grid";
import type { ListResult } from "./shipping";
import { dbAll, dbGet } from "@/server/db/sql";

const raw = (expr: string): SQL => sql.raw(expr);

/** Shipment, `ledger.remove` (from-only adjustment) and negative to-adjustments. */
export const HISTORY_TXN_WHERE = raw(`(t.type = 'Shipment' OR (t.type = 'Inventory Adjustment' AND ((t.from_inventory_id IS NOT NULL AND t.to_inventory_id IS NULL) OR t.uom_qty < 0)))`);

const FROM = raw(`
  inventory_transactions t
  LEFT JOIN shipment_orders o ON o.id = t.order_id
  LEFT JOIN shipment_orders mo ON mo.id = o.master_order_id
  LEFT JOIN order_lines ol ON ol.id = t.order_line_id
  LEFT JOIN products kp ON kp.id = ol.kit_product_id
  LEFT JOIN products p ON p.id = t.product_id
  LEFT JOIN shipments s ON s.id = t.shipment_id
  LEFT JOIN shipment_packages sp ON sp.id = s.shipment_package_id
  LEFT JOIN retailers r ON r.id = o.retailer_id
  LEFT JOIN clients c ON c.id = t.client_id
  LEFT JOIN warehouses w ON w.id = t.warehouse_id
  LEFT JOIN locations l ON l.id = COALESCE(t.from_location_id, t.to_location_id)
  LEFT JOIN license_plates lp ON lp.id = COALESCE(t.from_lp_id, t.to_lp_id)
  LEFT JOIN license_plates plp ON plp.id = COALESCE(t.from_parent_lp_id, t.to_parent_lp_id, lp.parent_lp_id)
  LEFT JOIN lp_types plt ON plt.id = plp.lp_type_id
  LEFT JOIN license_plates oplp ON oplp.id = lp.parent_lp_id
  LEFT JOIN inventory b ON b.id = COALESCE(t.from_inventory_id, t.to_inventory_id)
  LEFT JOIN lookup_values ar ON ar.id = t.adjustment_reason_id
`);

const SQL_FOR: Readonly<Record<string, SQL>> = {
  // Remove Inventory rows have no order: expose their ADJ-<seq> reference so API/CSV consumers never see null.
  orderCode: raw("COALESCE(o.code, 'ADJ-' || lpad((t.seq)::text, 6, '0'))"),
  originalOrderCode: raw("COALESCE(ol.original_order_code, mo.code)"),
  storeOrderNumber: raw("o.store_order_number"),
  sku: raw("p.sku"),
  productName: raw("p.name"),
  barcode: raw("p.barcode"),
  poNumber: raw("b.po_number"),
  lotNumber: raw("COALESCE(t.from_lot, t.to_lot)"),
  trackingNumber: raw("s.tracking_number"),
  expiryDate: raw("COALESCE(t.from_expiry, t.to_expiry)"),
  quantity: raw("ABS(t.uom_qty)"),
  packType: raw("COALESCE(t.from_pack_type, t.to_pack_type)"),
  uomPackType: raw("p.uom"),
  shipmentPackage: raw("sp.code"),
  kitSku: raw("kp.sku"),
  retailerName: raw("r.name"),
  packageWeight: raw("s.weight"),
  masterOrderCode: raw("mo.code"),
  isBackOrder: raw("o.is_back_order"),
  shipmentDate: raw("t.at"),
  reference: raw("(CASE WHEN t.type = 'Shipment' THEN o.code ELSE 'ADJ-' || lpad((t.seq)::text, 6, '0') END)"),
  adjustmentReason: raw("ar.name"),
  shipmentType: raw("(CASE WHEN t.type = 'Shipment' THEN 'Shipment Order' ELSE 'Remove Inventory' END)"),
  note: raw("t.note"),
  clientName: raw("c.name"),
  warehouseCode: raw("w.code"),
  locationCode: raw("l.code"),
  lpNumber: raw("lp.number"),
  originalLpNumber: raw("lp.original_number"),
  originalParentLp: raw("oplp.original_number"),
  parentLpNumber: raw("plp.number"),
  parentLpType: raw("plt.code"),
  receivingDate: raw("b.received_at"),
  productionDate: raw("COALESCE(t.from_production_date, t.to_production_date)"),
};

export const SHIPMENT_HISTORY_GRID: GridSpec = {
  fields: SHIPMENT_HISTORY_FIELDS,
  sqlFor: SQL_FOR,
  searchFields: SHIPMENT_HISTORY_SEARCH_FIELDS,
  sortFields: SHIPMENT_HISTORY_SORT_FIELDS,
  defaultSort: [{ field: "shipmentDate", dir: "desc" }],
  tiebreaker: raw("t.seq"),
};

const SELECT = sql.join(
  [raw("t.id AS id"), raw("t.order_id AS \"orderId\""), raw("t.product_id AS \"productId\""), raw("s.carrier_code AS \"carrierCode\""),
    ...Object.entries(SQL_FOR).map(([alias, expr]) => sql`${expr} AS ${sql.identifier(alias)}`)],
  sql`, `,
);

export type ShipmentHistoryRow = Readonly<Record<string, unknown>> & {
  readonly id: string;
  readonly orderId: string | null;
  readonly productId: string;
  readonly isBackOrder: boolean;
  readonly quantity: number;
};

export async function listShipmentHistory(db: AppDb, auth: AuthContext, query: GridQuery): Promise<ListResult<ShipmentHistoryRow>> {
  const base = sql`${HISTORY_TXN_WHERE} AND ${scopeSql(raw("t.warehouse_id"), raw("t.client_id"), auth.viewScope)}`;
  const grid = compileGrid(SHIPMENT_HISTORY_GRID, query, base);
  const rows = await dbAll<Readonly<Record<string, unknown>> & { id: string; orderId: string | null; productId: string; quantity: number; isBackOrder: number | null }>(db, sql`SELECT ${SELECT} FROM ${FROM} ${whereClause(grid.where)} ORDER BY ${sql.join(grid.orderBy, sql`, `)} LIMIT ${grid.pageSize} OFFSET ${grid.offset}`);
  const total = (await dbGet<{ n: number }>(db, sql`SELECT COUNT(*) AS n FROM ${FROM} ${whereClause(grid.where)}`))?.n ?? 0;
  return { rows: rows.map((r) => ({ ...r, isBackOrder: Boolean(r.isBackOrder) })), total };
}
