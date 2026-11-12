/**
 * Available To Promise (spec 04 §3, 07 §ATP). Reuses the foundation component SQL
 * (`atpComponentsSql`) so the grid, the reports and the channel sync agree; the derived
 * columns repeat `computeAtp()` in SQL so they can be filtered and sorted server-side.
 * Defaults to the header warehouse context (viewScope) instead of an empty grid.
 */
import { sql, type SQL } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import type { AuthContext } from "@/server/auth/context";
import { atpComponentsSql } from "@/server/domain/atp";
import type { GridQuery } from "@/server/query/grid-query";
import { ATP_DEF } from "@/lib/grid-defs/inventory/atp";
import { runGrid, type GridPage } from "./inventory-grid";

export interface AtpGridRow {
  readonly rowId: string;
  readonly productId: string;
  readonly warehouseId: string;
  readonly warehouse: string;
  readonly clientId: string;
  readonly client: string;
  readonly sku: string;
  readonly productName: string;
  readonly barcode: string;
  readonly kitType: string | null;
  readonly totalQty: number;
  readonly damagedQty: number;
  readonly undamagedQty: number;
  readonly allocatedSoQty: number;
  readonly openSoQty: number;
  readonly openPoQty: number;
  readonly currentAtp: number;
  readonly plannedAtp: number;
  readonly onHandQty: number;
  readonly sellableQty: number;
  readonly pickableQty: number;
  readonly unallocatedSoQty: number;
}

export function atpGridSql(warehouseIds: readonly string[], clientIds: readonly string[] | "all"): SQL {
  const components = atpComponentsSql({ warehouseIds, clientIds: clientIds === "all" ? undefined : clientIds });
  return sql`
    SELECT
      a."productId" || ':' || a."warehouseId" AS "rowId",
      a."productId" AS "productId", a."warehouseId" AS "warehouseId", CASE WHEN w.name ILIKE w.code || '%' THEN w.name ELSE w.code || ' - ' || w.name END AS "warehouse",
      a."clientId" AS "clientId", c.name AS "client",
      p.sku AS "sku", p.name AS "productName", p.barcode AS "barcode", p.kit_type AS "kitType",
      a.total AS "totalQty", a.damaged AS "damagedQty", (a.total - a.damaged) AS "undamagedQty",
      a."allocatedSo" AS "allocatedSoQty", a."openSo" AS "openSoQty", a."openPo" AS "openPoQty",
      (a.total - a.damaged - a."openSo") AS "currentAtp",
      (a.total - a.damaged - a."openSo" + a."openPo") AS "plannedAtp",
      a.total AS "onHandQty",
      (a."onHand" - a."openSo") AS "sellableQty",
      a.pickable AS "pickableQty",
      GREATEST(a."openSo" - a."allocatedSo", 0) AS "unallocatedSoQty"
    FROM (${components}) a
    JOIN products p ON p.id = a."productId"
    JOIN clients c ON c.id = a."clientId"
    JOIN warehouses w ON w.id = a."warehouseId"`;
}

export async function listAtp(db: AppDb, auth: AuthContext, query: GridQuery): Promise<GridPage<AtpGridRow>> {
  return await runGrid<AtpGridRow>(db, atpGridSql(auth.viewScope.warehouseIds, auth.viewScope.clientIds), ATP_DEF, query, "rowId");
}
