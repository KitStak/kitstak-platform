/**
 * Add Location / Add Product pickers for the Create New Count wizard (M07): full grid
 * grammar (search mode, typed filters, sort, paging) over a warehouse's locations and
 * the viewer's products.
 */
import { sql, type SQL } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import { notFoundError } from "@/server/api/errors";
import { hasWarehouse, type Scope } from "@/server/auth/scope";
import type { GridQuery } from "@/server/query/grid-query";
import { COUNT_LOCATION_PICKER_FIELDS, COUNT_PICKER_SORT_FIELDS, COUNT_PRODUCT_PICKER_FIELDS } from "@/lib/grid-defs/counts/count-grids";
import { inList, raw, runGrid, withBooleans, type GridPage, type GridSpec } from "./counts-grid";

const lookupName = (col: string): SQL => raw(`(SELECT lv.name FROM lookup_values lv WHERE lv.id = ${col})`);

export interface LocationPickRow {
  readonly id: string;
  readonly code: string;
  readonly locationType: string | null;
  readonly locationGroup: string | null;
  readonly zone: string;
  readonly areaType: string | null;
  readonly onHand: number;
  readonly skuCount: number;
  readonly isLocked: boolean;
}

export function listPickLocations(db: AppDb, scope: Scope, warehouseId: string, query: GridQuery): GridPage<LocationPickRow> {
  if (!hasWarehouse(scope, warehouseId)) throw notFoundError("Warehouse");
  const spec: GridSpec = {
    from: raw("FROM locations lo"),
    columns: {
      id: raw("lo.id"), code: raw("lo.code"), locationType: raw("lo.location_type"), locationGroup: lookupName("lo.location_group_id"),
      zone: raw("lo.zone"), aisle: raw("lo.aisle"), level: raw("lo.level"), rack: raw("lo.rack"), position: raw("lo.position"), column: raw("lo.\"column\""),
      areaType: raw("lo.area_type"), abcCode: raw("lo.abc_code"), displayMember: raw("lo.display_member"), barcode: raw("lo.barcode"),
      height: raw("lo.height"), volume: raw("lo.volume"), isLocked: raw("lo.is_locked"), preventAllocation: raw("lo.prevent_allocation"),
      replenishmentType: raw("lo.replenishment_type"), walkingPathPriority: raw("lo.walking_path_priority"),
      onHand: raw("COALESCE((SELECT SUM(i.on_hand) FROM inventory i WHERE i.location_id = lo.id AND i.on_hand > 0), 0)"),
      skuCount: raw("(SELECT COUNT(DISTINCT i.product_id) FROM inventory i WHERE i.location_id = lo.id AND i.on_hand > 0)"),
      hasInventory: raw("(CASE WHEN EXISTS (SELECT 1 FROM inventory i WHERE i.location_id = lo.id AND i.on_hand > 0) THEN 1 ELSE 0 END)"),
    },
    fields: COUNT_LOCATION_PICKER_FIELDS,
    sortable: COUNT_PICKER_SORT_FIELDS.filter((f) => !["sku", "name", "clientName"].includes(f)),
    search: ["code", "barcode"],
    base: [sql`lo.warehouse_id = ${warehouseId}`, raw("lo.is_active = 1")],
    defaultOrder: raw("lo.walking_path_priority, lo.code"),
  };
  const page = runGrid<LocationPickRow & Record<string, unknown>>(db, spec, query);
  return { ...page, rows: page.rows.map((r) => withBooleans(r, ["isLocked", "preventAllocation", "hasInventory"])) };
}

export interface ProductPickRow {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly clientName: string;
  readonly productType: string | null;
  readonly productGroup: string | null;
  readonly onHand: number;
}

export function listPickProducts(db: AppDb, scope: Scope, warehouseId: string, query: GridQuery): GridPage<ProductPickRow> {
  if (!hasWarehouse(scope, warehouseId)) throw notFoundError("Warehouse");
  const clientScope = scope.clientIds === "all" ? raw("1 = 1") : inList(raw("pr.client_id"), scope.clientIds);
  const spec: GridSpec = {
    from: raw("FROM products pr JOIN clients c ON c.id = pr.client_id"),
    columns: {
      id: raw("pr.id"), sku: raw("pr.sku"), name: raw("pr.name"), barcode: raw("pr.barcode"), clientName: raw("c.name"), fnsku: raw("pr.fnsku"),
      productType: lookupName("pr.product_type_id"), productGroup: lookupName("pr.product_group_id"), createdAt: raw("pr.created_at"),
      isFoldable: raw("pr.is_foldable"), isFragile: raw("pr.is_fragile"), isKit: raw("pr.is_kit"), isOversized: raw("pr.is_oversized"), price: raw("pr.price"),
      returnable: raw("(1 - pr.is_non_returnable)"), shelfLifeDays: raw("pr.shelf_life_days"), isStackable: raw("pr.is_stackable"), status: raw("pr.status"),
      trackExpiry: raw("pr.track_expiry"), trackLot: raw("pr.track_lot"), trackProductionDate: raw("pr.track_production_date"), trackSerial: raw("pr.track_serial"),
      onHand: sql`COALESCE((SELECT SUM(i.on_hand) FROM inventory i WHERE i.product_id = pr.id AND i.warehouse_id = ${warehouseId} AND i.on_hand > 0), 0)`,
    },
    fields: COUNT_PRODUCT_PICKER_FIELDS,
    sortable: ["sku", "name", "clientName", "onHand"],
    search: ["sku", "barcode", "name"],
    base: [clientScope],
    defaultOrder: raw("pr.sku"),
  };
  return runGrid<ProductPickRow>(db, spec, query);
}
