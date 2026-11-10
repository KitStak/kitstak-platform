/**
 * Inventory by Location (spec 04 §2): one row per ledger bucket with on-hand > 0,
 * plus the bucket drawer read model (attributes, allocations, last 50 transactions).
 */
import { sql, type SQL } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import { notFoundError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { assertInScope } from "@/server/auth/scope";
import type { GridQuery } from "@/server/query/grid-query";
import { BY_LOCATION_DEF } from "@/lib/grid-defs/inventory/by-location";
import { clientIn, inList, runGrid, type GridPage } from "./inventory-grid";

export interface BucketRow {
  readonly id: string;
  readonly version: number;
  readonly imageUrl: string | null;
  readonly productId: string;
  readonly clientId: string;
  readonly client: string;
  readonly sku: string;
  readonly barcode: string;
  readonly productName: string;
  readonly unitsPerPack: number;
  readonly totalPackQty: number;
  readonly allocatedPackQty: number;
  readonly allocatedQty: number;
  readonly freePackQty: number;
  readonly freeQty: number;
  readonly packType: string;
  readonly uomPackType: string;
  readonly totalQty: number;
  readonly damagedQty: number;
  readonly lotNumber: string | null;
  readonly expiryDate: string | null;
  readonly productType: string | null;
  readonly productGroup: string | null;
  readonly warehouseId: string;
  readonly warehouse: string;
  readonly warehouseCode: string;
  readonly locationId: string;
  readonly location: string;
  readonly locationGroup: string | null;
  readonly locationZone: string | null;
  readonly locationType: string | null;
  readonly areaType: string | null;
  readonly replenishmentType: string | null;
  readonly walkingPathPriority: number;
  readonly poNumber: string | null;
  readonly lpId: string | null;
  readonly lpNumber: string | null;
  readonly parentLpNumber: string | null;
  readonly originalLpNumber: string | null;
  readonly lpType: string | null;
  readonly parentLpType: string | null;
  readonly originalParentLpNumber: string | null;
  readonly mobileCart: string | null;
  readonly status: string;
  readonly damageReason: string | null;
  readonly receivedAt: string;
  readonly productionDate: string | null;
  readonly trackLot: number;
  readonly trackExpiry: number;
  readonly trackProductionDate: number;
}

export interface BucketFilter {
  readonly warehouseIds: readonly string[];
  readonly clientIds: readonly string[] | "all";
  readonly ids?: readonly string[];
}

export function bucketSql(filter: BucketFilter): SQL {
  const ids = filter.ids ? sql` AND ${inList(sql`i.id`, filter.ids)}` : sql``;
  return sql`
    SELECT
      i.id AS "id", i.version AS "version", p.image_url AS "imageUrl", i.product_id AS "productId",
      i.client_id AS "clientId", c.name AS "client",
      p.sku AS "sku", p.barcode AS "barcode", p.name AS "productName",
      COALESCE(ppt.uom_qty, 1) AS "unitsPerPack",
      (i.on_hand / COALESCE(NULLIF(ppt.uom_qty, 0), 1)) AS "totalPackQty",
      (i.allocated / COALESCE(NULLIF(ppt.uom_qty, 0), 1)) AS "allocatedPackQty",
      i.allocated AS "allocatedQty",
      ((i.on_hand - i.allocated) / COALESCE(NULLIF(ppt.uom_qty, 0), 1)) AS "freePackQty",
      (i.on_hand - i.allocated) AS "freeQty",
      i.pack_type AS "packType", p.uom AS "uomPackType", i.on_hand AS "totalQty", i.damaged AS "damagedQty",
      i.lot_number AS "lotNumber", i.expiry_date AS "expiryDate",
      pt.name AS "productType", pg.name AS "productGroup",
      i.warehouse_id AS "warehouseId", CASE WHEN w.name LIKE w.code || '%' THEN w.name ELSE w.code || ' - ' || w.name END AS "warehouse", w.code AS "warehouseCode",
      i.location_id AS "locationId", l.code AS "location",
      lg.name AS "locationGroup", lz.name AS "locationZone",
      l.location_type AS "locationType", l.area_type AS "areaType", l.replenishment_type AS "replenishmentType",
      l.walking_path_priority AS "walkingPathPriority",
      i.po_number AS "poNumber",
      i.lp_id AS "lpId", lp.number AS "lpNumber", plp.number AS "parentLpNumber", lp.original_number AS "originalLpNumber",
      lpt.code AS "lpType", plpt.code AS "parentLpType", plp.original_number AS "originalParentLpNumber",
      mc.code AS "mobileCart",
      i.status AS "status", i.damage_reason AS "damageReason",
      i.received_at AS "receivedAt", i.production_date AS "productionDate",
      p.track_lot AS "trackLot", p.track_expiry AS "trackExpiry", p.track_production_date AS "trackProductionDate"
    FROM inventory i
    JOIN products p ON p.id = i.product_id
    JOIN warehouses w ON w.id = i.warehouse_id
    JOIN locations l ON l.id = i.location_id
    LEFT JOIN clients c ON c.id = i.client_id
    LEFT JOIN product_pack_types ppt ON ppt.product_id = i.product_id AND ppt.pack_type = i.pack_type
    LEFT JOIN lookup_values pt ON pt.id = p.product_type_id
    LEFT JOIN lookup_values pg ON pg.id = p.product_group_id
    LEFT JOIN lookup_values lg ON lg.id = l.location_group_id
    LEFT JOIN lookup_values lz ON lz.id = l.location_zone_id
    LEFT JOIN license_plates lp ON lp.id = i.lp_id
    LEFT JOIN license_plates plp ON plp.id = lp.parent_lp_id
    LEFT JOIN lp_types lpt ON lpt.id = lp.lp_type_id
    LEFT JOIN lp_types plpt ON plpt.id = plp.lp_type_id
    LEFT JOIN mobile_carts mc ON mc.id = i.mobile_cart_id
    WHERE i.on_hand > 0
      AND ${inList(sql`i.warehouse_id`, filter.warehouseIds)}
      AND (i.client_id IS NULL OR ${clientIn(sql`i.client_id`, filter.clientIds)})${ids}`;
}

export function listBuckets(db: AppDb, auth: AuthContext, query: GridQuery): GridPage<BucketRow> {
  const inner = bucketSql({ warehouseIds: auth.viewScope.warehouseIds, clientIds: auth.viewScope.clientIds });
  return runGrid<BucketRow>(db, inner, BY_LOCATION_DEF, query, "id");
}

/** One bucket in the user's full scope (cross-scope → 404). */
export function getBucketRow(db: AppDb, auth: AuthContext, id: string): BucketRow {
  const row = db.get<BucketRow>(sql`SELECT * FROM (${bucketSql({ warehouseIds: auth.scope.warehouseIds, clientIds: auth.scope.clientIds, ids: [id] })}) t`);
  if (!row) throw notFoundError("Inventory");
  assertInScope(auth.scope, row, "Inventory");
  return row;
}

export interface BucketAllocation {
  readonly id: string;
  readonly qty: number;
  readonly status: string;
  readonly orderId: string | null;
  readonly orderCode: string | null;
  readonly jobId: string | null;
  readonly jobCode: string | null;
  readonly workOrderId: string | null;
  readonly workOrderCode: string | null;
  readonly createdAt: string;
}

export interface BucketTransaction {
  readonly id: string;
  readonly seq: number;
  readonly type: string;
  readonly qty: number;
  readonly direction: "in" | "out" | "adjust" | "neutral";
  readonly fromLocation: string | null;
  readonly toLocation: string | null;
  readonly fromStatus: string | null;
  readonly toStatus: string | null;
  readonly reason: string | null;
  readonly note: string | null;
  readonly orderCode: string | null;
  readonly jobCode: string | null;
  readonly user: string | null;
  readonly source: string;
  readonly at: string;
}

export interface BucketDetail {
  readonly bucket: BucketRow;
  readonly allocations: readonly BucketAllocation[];
  readonly transactions: readonly BucketTransaction[];
}

const TXN_LIMIT = 50;

interface RawTxn extends Omit<BucketTransaction, "direction"> {
  readonly fromInventoryId: string | null;
  readonly toInventoryId: string | null;
}

function directionOf(t: RawTxn, bucketId: string): BucketTransaction["direction"] {
  if (t.fromInventoryId === bucketId && t.toInventoryId === bucketId) return "neutral";
  if (t.toInventoryId === bucketId && t.fromInventoryId === null) return t.qty < 0 ? "out" : t.type === "Inventory Adjustment" || t.type === "Count" ? "adjust" : "in";
  if (t.toInventoryId === bucketId) return "in";
  return "out";
}

export function getBucketDetail(db: AppDb, auth: AuthContext, id: string): BucketDetail {
  const bucket = getBucketRow(db, auth, id);
  const allocations = db.all<BucketAllocation>(sql`
    SELECT a.id AS "id", a.qty AS "qty", a.status AS "status", a.order_id AS "orderId", o.code AS "orderCode",
      a.job_id AS "jobId", j.code AS "jobCode", a.work_order_id AS "workOrderId", wo.code AS "workOrderCode", a.created_at AS "createdAt"
    FROM inventory_allocations a
    LEFT JOIN shipment_orders o ON o.id = a.order_id
    LEFT JOIN jobs j ON j.id = a.job_id
    LEFT JOIN work_orders wo ON wo.id = a.work_order_id
    WHERE a.inventory_id = ${id} AND a.status NOT IN ('Shipped', 'Cancelled')
    ORDER BY a.created_at DESC`);
  const raw = db.all<RawTxn>(sql`
    SELECT t.id AS "id", t.seq AS "seq", t.type AS "type", t.uom_qty AS "qty",
      t.from_inventory_id AS "fromInventoryId", t.to_inventory_id AS "toInventoryId",
      fl.code AS "fromLocation", tl.code AS "toLocation", t.from_status AS "fromStatus", t.to_status AS "toStatus",
      r.name AS "reason", t.note AS "note", o.code AS "orderCode", j.code AS "jobCode",
      u.name AS "user", t.source AS "source", t.at AS "at"
    FROM inventory_transactions t
    LEFT JOIN locations fl ON fl.id = t.from_location_id
    LEFT JOIN locations tl ON tl.id = t.to_location_id
    LEFT JOIN lookup_values r ON r.id = t.adjustment_reason_id
    LEFT JOIN shipment_orders o ON o.id = t.order_id
    LEFT JOIN jobs j ON j.id = t.job_id
    LEFT JOIN users u ON u.id = t.user_id
    WHERE t.from_inventory_id = ${id} OR t.to_inventory_id = ${id}
    ORDER BY t.seq DESC LIMIT ${TXN_LIMIT}`);
  const transactions = raw.map(({ fromInventoryId, toInventoryId, ...t }) => ({
    ...t,
    direction: directionOf({ ...t, fromInventoryId, toInventoryId }, id),
  }));
  return { bucket, allocations, transactions };
}
