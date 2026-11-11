/**
 * Add Location / Add Product pickers for the Create New Count wizard (M07): full grid
 * grammar (search mode, typed filters, sort, paging) over a warehouse's locations and
 * the viewer's products.
 */
import { sql } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import { notFoundError } from "@/server/api/errors";
import { hasWarehouse, type Scope } from "@/server/auth/scope";
import type { GridQuery } from "@/server/query/grid-query";
import { COUNT_LOCATION_PICKER_FIELDS, COUNT_LP_PICKER_FIELDS, COUNT_PICKER_SORT_FIELDS, COUNT_PRODUCT_PICKER_FIELDS } from "@/lib/grid-defs/counts/count-grids";
import { openCountForLocation, openCountForLp, openCountForProduct } from "./counts-conflicts";
import { inList, raw, runGrid, withBooleans, type GridPage, type GridSpec } from "./counts-grid";

export interface LocationPickRow {
  readonly id: string;
  readonly code: string;
  readonly locationType: string | null;
  readonly locationGroup: string | null;
  readonly zone: string;
  readonly areaType: string | null;
  readonly onHand: number;
  /** Units allocated to orders / work orders (a shortage below this shorts or blocks the posting). */
  readonly allocated: number;
  readonly skuCount: number;
  readonly isLocked: boolean;
  /** Code of the open count plan already holding the location (it can't be added to another). */
  readonly openCountCode: string | null;
}

/** Location types that never hold countable stock; hidden from the picker unless `includeAll`. */
export const NON_COUNTABLE_LOCATION_TYPES = ["BusinessStation", "Virtual"] as const;

export async function listPickLocations(db: AppDb, scope: Scope, warehouseId: string, query: GridQuery, includeAll = false, exceptPlanId: string | null = null): Promise<GridPage<LocationPickRow>> {
  if (!hasWarehouse(scope, warehouseId)) throw notFoundError("Warehouse");
  const spec: GridSpec = {
    from: sql`FROM locations lo LEFT JOIN lookup_values lg ON lg.id = lo.location_group_id LEFT JOIN clients dc ON dc.id = lo.dedicated_client_id LEFT JOIN (SELECT i.location_id AS lid, SUM(i.on_hand) AS on_hand, SUM(i.allocated) AS allocated, COUNT(DISTINCT i.product_id) AS skus FROM inventory i WHERE i.warehouse_id = ${warehouseId} AND i.on_hand > 0 GROUP BY i.location_id) inv ON inv.lid = lo.id
      LEFT JOIN (SELECT cl.location_id AS lid, MAX(COALESCE(cl.completed_at, cl.inventory_updated_at)) AS at FROM count_plan_lines cl WHERE cl.location_id IS NOT NULL AND cl.status IN ('Count Completed', 'Inventory Updated') GROUP BY cl.location_id) lc ON lc.lid = lo.id`,
    columns: {
      id: raw("lo.id"), code: raw("lo.code"), locationType: raw("lo.location_type"), locationGroup: raw("lg.name"),
      zone: raw("lo.zone"), aisle: raw("lo.aisle"), level: raw("lo.level"), rack: raw("lo.rack"), position: raw("lo.position"), column: raw("lo.\"column\""),
      areaType: raw("lo.area_type"), abcCode: raw("lo.abc_code"), displayMember: raw("lo.display_member"), barcode: raw("lo.barcode"),
      height: raw("lo.height"), volume: raw("lo.volume"), isLocked: raw("lo.is_locked"), preventAllocation: raw("lo.prevent_allocation"),
      replenishmentType: raw("lo.replenishment_type"), walkingPathPriority: raw("lo.walking_path_priority"),
      width: raw("lo.width"), length: raw("lo.length"), capacityType: raw("lo.capacity_type"), maxCapacityQty: raw("lo.max_capacity_qty"), maxSkuQty: raw("lo.max_sku_qty"),
      mezzanine: raw("lo.mezzanine"), colorCode: raw("lo.color_code"), clientName: raw("dc.name"), singleClient: raw("lo.single_client"),
      onlyOneSku: raw("lo.only_one_sku"), onlyOneLot: raw("lo.only_one_lot"), onlyOneLp: raw("lo.only_one_lp"), onlyDamaged: raw("lo.only_damaged"),
      preventInventorySync: raw("lo.prevent_inventory_sync"), customFields: raw("CAST(lo.custom_fields AS TEXT)"),
      onHand: raw("COALESCE(inv.on_hand, 0)"),
      allocated: raw("COALESCE(inv.allocated, 0)"),
      skuCount: raw("COALESCE(inv.skus, 0)"),
      hasInventory: raw("(CASE WHEN inv.lid IS NULL THEN 0 ELSE 1 END)"),
      openCountCode: openCountForLocation(exceptPlanId),
      inOpenCount: sql`(CASE WHEN ${openCountForLocation(exceptPlanId)} IS NULL THEN 0 ELSE 1 END)`,
      lastCountedAt: raw("lc.at"),
      stockClientName: sql`(SELECT string_agg(DISTINCT (sc.name)::text, ',') FROM inventory si JOIN clients sc ON sc.id = si.client_id WHERE si.location_id = lo.id AND si.on_hand > 0)`,
    },
    fields: COUNT_LOCATION_PICKER_FIELDS,
    sortable: COUNT_PICKER_SORT_FIELDS.filter((f) => !["sku", "name", "clientName"].includes(f)),
    search: ["code", "barcode"],
    base: [sql`lo.warehouse_id = ${warehouseId}`, raw("lo.is_active = true"), ...(includeAll ? [] : [raw(`lo.location_type NOT IN (${NON_COUNTABLE_LOCATION_TYPES.map((t) => `'${t}'`).join(", ")})`)])],
    defaultOrder: raw("lo.walking_path_priority, lo.code"),
  };
  const page = await runGrid<LocationPickRow & Record<string, unknown>>(db, spec, query);
  return { ...page, rows: page.rows.map((r) => withBooleans(r, ["isLocked", "preventAllocation", "hasInventory", "inOpenCount", "singleClient", "onlyOneSku", "onlyOneLot", "onlyOneLp", "onlyDamaged", "preventInventorySync"])) };
}

export interface ProductPickRow {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly clientName: string;
  readonly productType: string | null;
  readonly productGroup: string | null;
  readonly onHand: number;
  /** Units allocated to orders / work orders (a shortage below this shorts or blocks the posting). */
  readonly allocated: number;
  readonly openCountCode: string | null;
}

export async function listPickProducts(db: AppDb, scope: Scope, warehouseId: string, query: GridQuery, exceptPlanId: string | null = null): Promise<GridPage<ProductPickRow>> {
  if (!hasWarehouse(scope, warehouseId)) throw notFoundError("Warehouse");
  const clientScope = scope.clientIds === "all" ? raw("1 = 1") : inList(raw("pr.client_id"), scope.clientIds);
  const spec: GridSpec = {
    from: sql`FROM products pr JOIN clients c ON c.id = pr.client_id LEFT JOIN lookup_values pt ON pt.id = pr.product_type_id LEFT JOIN lookup_values pg ON pg.id = pr.product_group_id LEFT JOIN (SELECT i.product_id AS pid, SUM(i.on_hand) AS on_hand, SUM(i.allocated) AS allocated FROM inventory i WHERE i.warehouse_id = ${warehouseId} AND i.on_hand > 0 GROUP BY i.product_id) inv ON inv.pid = pr.id
      LEFT JOIN (SELECT e.product_id AS pid, MAX(e.counted_at) AS at FROM count_line_entries e JOIN count_plan_lines cl ON cl.id = e.line_id WHERE cl.status IN ('Count Completed', 'Inventory Updated') GROUP BY e.product_id) lc ON lc.pid = pr.id`,
    columns: {
      id: raw("pr.id"), sku: raw("pr.sku"), name: raw("pr.name"), barcode: raw("pr.barcode"), clientName: raw("c.name"), fnsku: raw("pr.fnsku"),
      productType: raw("pt.name"), productGroup: raw("pg.name"), createdAt: raw("pr.created_at"),
      isFoldable: raw("pr.is_foldable"), isFragile: raw("pr.is_fragile"), isKit: raw("pr.is_kit"), isOversized: raw("pr.is_oversized"), price: raw("pr.price"),
      returnable: raw("(1 - (pr.is_non_returnable)::int)"), shelfLifeDays: raw("pr.shelf_life_days"), isStackable: raw("pr.is_stackable"), status: raw("pr.status"),
      trackExpiry: raw("pr.track_expiry"), trackLot: raw("pr.track_lot"), trackProductionDate: raw("pr.track_production_date"), trackSerial: raw("pr.track_serial"),
      onHand: raw("COALESCE(inv.on_hand, 0)"),
      allocated: raw("COALESCE(inv.allocated, 0)"),
      openCountCode: openCountForProduct(exceptPlanId),
      inOpenCount: sql`(CASE WHEN ${openCountForProduct(exceptPlanId)} IS NULL THEN 0 ELSE 1 END)`,
      hasInventory: raw("(CASE WHEN inv.pid IS NULL THEN 0 ELSE 1 END)"),
      category: raw("COALESCE(pr.product_category, pr.category)"), isHazmat: raw("pr.is_hazmat"), trackSecondarySerial: raw("pr.track_secondary_serial"),
      customFields: raw("CAST(pr.custom_fields AS TEXT)"), lastCountedAt: raw("lc.at"),
    },
    fields: COUNT_PRODUCT_PICKER_FIELDS,
    sortable: ["sku", "name", "clientName", "onHand"],
    search: ["sku", "barcode", "name"],
    base: [clientScope],
    defaultOrder: raw("pr.sku"),
  };
  const page = await runGrid<ProductPickRow & Record<string, unknown>>(db, spec, query);
  return { ...page, rows: page.rows.map((r) => withBooleans(r, ["isKit", "trackLot", "trackSerial", "trackExpiry", "hasInventory", "inOpenCount"])) };
}

export interface LpPickRow {
  readonly id: string;
  readonly number: string;
  readonly lpType: string | null;
  readonly locationCode: string | null;
  readonly clientName: string | null;
  readonly onHand: number;
  /** Units allocated to orders / work orders (a shortage below this shorts or blocks the posting). */
  readonly allocated: number;
  readonly skuCount: number;
  readonly openCountCode: string | null;
}

/** Add License Plate picker (LP count type): placed LPs of the warehouse in the viewer's client scope. */
export async function listPickLps(db: AppDb, scope: Scope, warehouseId: string, query: GridQuery, exceptPlanId: string | null = null): Promise<GridPage<LpPickRow>> {
  if (!hasWarehouse(scope, warehouseId)) throw notFoundError("Warehouse");
  const clientScope = scope.clientIds === "all" ? raw("1 = 1") : sql`(lp.client_id IS NULL OR ${inList(raw("lp.client_id"), scope.clientIds)})`;
  const spec: GridSpec = {
    from: sql`FROM license_plates lp JOIN locations lo ON lo.id = lp.location_id LEFT JOIN lp_types t ON t.id = lp.lp_type_id LEFT JOIN clients c ON c.id = lp.client_id LEFT JOIN (SELECT i.lp_id AS lid, SUM(i.on_hand) AS on_hand, SUM(i.allocated) AS allocated, COUNT(DISTINCT i.product_id) AS skus FROM inventory i WHERE i.warehouse_id = ${warehouseId} AND i.on_hand > 0 AND i.lp_id IS NOT NULL GROUP BY i.lp_id) inv ON inv.lid = lp.id`,
    columns: {
      id: raw("lp.id"), number: raw("lp.number"), lpType: raw("t.code"), locationCode: raw("lo.code"), clientName: raw("c.name"),
      walkingPathPriority: raw("lo.walking_path_priority"),
      onHand: raw("COALESCE(inv.on_hand, 0)"),
      allocated: raw("COALESCE(inv.allocated, 0)"),
      skuCount: raw("COALESCE(inv.skus, 0)"),
      openCountCode: openCountForLp(exceptPlanId),
    },
    fields: COUNT_LP_PICKER_FIELDS,
    sortable: ["number", "lpType", "locationCode", "clientName", "onHand", "skuCount"],
    search: ["number", "locationCode"],
    base: [sql`lp.warehouse_id = ${warehouseId}`, clientScope],
    defaultOrder: raw("lo.walking_path_priority, lo.code, lp.number"),
  };
  return await runGrid<LpPickRow>(db, spec, query);
}
