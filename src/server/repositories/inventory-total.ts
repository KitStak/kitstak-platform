/**
 * Total Inventory (spec 04 §1). One row per SKU × warehouse, or one per SKU with
 * Warehouse = "All Warehouses" when neither a Warehouse filter nor the header warehouse
 * context is set. Includes zero-stock products (Logiwa parity). Read-only.
 */
import { sql, type SQL } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import type { AuthContext } from "@/server/auth/context";
import { OPEN_SO_STATUSES } from "@/server/domain/atp";
import type { GridQuery } from "@/server/query/grid-query";
import { ALL_WAREHOUSES_LABEL, TOTAL_INVENTORY_DEF } from "@/lib/grid-defs/inventory/total-inventory";
import { clientIn, inList, runGrid, type GridPage } from "./inventory-grid";

export interface TotalInventoryRow {
  readonly rowId: string;
  readonly productId: string;
  readonly imageUrl: string | null;
  readonly warehouseId: string | null;
  readonly warehouse: string;
  readonly warehouseCode: string | null;
  readonly clientId: string;
  readonly client: string;
  readonly sku: string;
  readonly productName: string;
  readonly uomPackType: string;
  readonly uomQty: number;
  readonly availableQty: number;
  readonly totalQty: number;
  readonly openSoQty: number;
  readonly undamagedQty: number;
  readonly undamagedAvailableQty: number;
  readonly kitType: string | null;
  readonly productType: string | null;
  readonly productGroup: string | null;
  readonly damagedQty: number;
  /** Distinct locations holding stock (drives the "N locations" drilldown label). */
  readonly locationCount: number;
  /** Distinct warehouses holding stock (All Warehouses rows). */
  readonly warehouseCount: number;
}

const OPEN_SO_LIST: SQL = sql.join(OPEN_SO_STATUSES.map((s) => sql`${s}`), sql`, `);

/** True when the grid should show one row per warehouse. */
export function perWarehouse(query: GridQuery, auth: Pick<AuthContext, "context">): boolean {
  return Boolean(auth.context.warehouseId) || query.filters.some((f) => f.field === "warehouse");
}

export function totalInventorySql(warehouseIds: readonly string[], clientIds: readonly string[] | "all", split: boolean): SQL {
  const whInv = inList(sql`i.warehouse_id`, warehouseIds);
  const whSo = inList(sql`o.warehouse_id`, warehouseIds);
  const prodClients = clientIn(sql`p.client_id`, clientIds);
  const keys = split
    ? sql`SELECT p.id AS product_id, w.id AS warehouse_id FROM products p CROSS JOIN warehouses w WHERE ${prodClients} AND ${inList(sql`w.id`, warehouseIds)}`
    : sql`SELECT p.id AS product_id, NULL AS warehouse_id FROM products p WHERE ${prodClients}`;
  const invGroup = split ? sql`i.product_id, i.warehouse_id` : sql`i.product_id`;
  const soGroup = split ? sql`l.product_id, o.warehouse_id` : sql`l.product_id`;
  const join = (alias: string) => (split ? sql.raw(`${alias}.product_id = k.product_id AND ${alias}.warehouse_id = k.warehouse_id`) : sql.raw(`${alias}.product_id = k.product_id`));
  return sql`
    WITH keys AS (${keys}),
    inv AS (
      SELECT i.product_id, ${split ? sql`i.warehouse_id` : sql`NULL`} AS warehouse_id,
        SUM(i.on_hand) AS total, SUM(i.damaged) AS damaged,
        COUNT(DISTINCT i.location_id) AS locations, COUNT(DISTINCT i.warehouse_id) AS warehouses
      FROM inventory i WHERE i.on_hand > 0 AND ${whInv} GROUP BY ${invGroup}
    ),
    so AS (
      SELECT l.product_id, ${split ? sql`o.warehouse_id` : sql`NULL`} AS warehouse_id,
        SUM(MAX(l.quantity - l.cancelled_quantity - l.shipped_quantity, 0)) AS open_so
      FROM order_lines l JOIN shipment_orders o ON o.id = l.order_id
      WHERE o.deleted_at IS NULL AND o.status IN (${OPEN_SO_LIST}) AND ${whSo} GROUP BY ${soGroup}
    )
    SELECT
      p.id || ':' || COALESCE(k.warehouse_id, 'all') AS "rowId",
      p.id AS "productId", p.image_url AS "imageUrl",
      k.warehouse_id AS "warehouseId",
      ${split ? sql`CASE WHEN w.name LIKE w.code || '%' THEN w.name ELSE w.code || ' - ' || w.name END` : sql`${ALL_WAREHOUSES_LABEL}`} AS "warehouse",
      ${split ? sql`w.code` : sql`NULL`} AS "warehouseCode",
      p.client_id AS "clientId", c.name AS "client",
      p.sku AS "sku", p.name AS "productName", p.uom AS "uomPackType",
      COALESCE(inv.total, 0) AS "uomQty",
      COALESCE(inv.total, 0) - COALESCE(so.open_so, 0) AS "availableQty",
      COALESCE(inv.total, 0) AS "totalQty",
      COALESCE(so.open_so, 0) AS "openSoQty",
      COALESCE(inv.total, 0) - COALESCE(inv.damaged, 0) AS "undamagedQty",
      COALESCE(inv.total, 0) - COALESCE(inv.damaged, 0) - COALESCE(so.open_so, 0) AS "undamagedAvailableQty",
      p.kit_type AS "kitType",
      pt.name AS "productType", pg.name AS "productGroup",
      COALESCE(inv.damaged, 0) AS "damagedQty",
      COALESCE(inv.locations, 0) AS "locationCount",
      COALESCE(inv.warehouses, 0) AS "warehouseCount"
    FROM keys k
    JOIN products p ON p.id = k.product_id
    JOIN clients c ON c.id = p.client_id
    ${split ? sql`JOIN warehouses w ON w.id = k.warehouse_id` : sql``}
    LEFT JOIN inv ON ${join("inv")}
    LEFT JOIN so ON ${join("so")}
    LEFT JOIN lookup_values pt ON pt.id = p.product_type_id
    LEFT JOIN lookup_values pg ON pg.id = p.product_group_id`;
}

export function listTotalInventory(db: AppDb, auth: AuthContext, query: GridQuery): GridPage<TotalInventoryRow> {
  const split = perWarehouse(query, auth);
  const inner = totalInventorySql(auth.viewScope.warehouseIds, auth.viewScope.clientIds, split);
  return runGrid<TotalInventoryRow>(db, inner, TOTAL_INVENTORY_DEF, query, "rowId");
}
