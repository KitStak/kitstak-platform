/**
 * Export providers for the count grids (M07): Count Plans, Location Details, SKU Details.
 * Location / SKU Details with `detail=1` ("More Details") export one row per counted
 * bucket (SKU / lot / LP) instead of one row per line.
 */
import { sql } from "drizzle-orm";
import type { ExportColumn, ExportContext, ExportPage, ExportProvider } from "@/server/exports/types";
import { lineGrid, lineRow, planGrid, planRow, type CountLineListRow, type CountPlanListRow, type LineGridKind } from "./counts-grids";
import { runGrid, whereOf } from "./counts-grid";

const PLAN_COLUMNS: readonly ExportColumn[] = [
  { key: "code", label: "Count Code" }, { key: "warehouseCode", label: "Warehouse" }, { key: "jobCodes", label: "Job Code" },
  { key: "startedAt", label: "Count Started Time", type: "datetime" }, { key: "completedAt", label: "Count Completed Time", type: "datetime" },
  { key: "skuCount", label: "Number of SKU", type: "integer" }, { key: "countedSkuCount", label: "Counted SKU", type: "integer" },
  { key: "locationCount", label: "Number of Location", type: "integer" }, { key: "countedLocationCount", label: "Counted Locations", type: "integer" },
  { key: "createdAt", label: "Created Time", type: "datetime" }, { key: "status", label: "Status" }, { key: "countType", label: "Count Type" },
  { key: "isAi", label: "AI Count Plan", type: "boolean" }, { key: "operationType", label: "Count Operation Type" }, { key: "createdByName", label: "Created By" },
  { key: "countObject", label: "Count Object" }, { key: "lockLocations", label: "Lock Locations", type: "boolean" },
  { key: "scheduledAt", label: "Scheduled Count Date", type: "datetime" },
  { key: "inventoryUpdatedAt", label: "Inventory Updated Date Time", type: "datetime" }, { key: "inventoryUpdatedByName", label: "Inventory Update User" },
];

const LINE_COLUMNS = (kind: LineGridKind): readonly ExportColumn[] => [
  ...(kind === "skus" ? [{ key: "sku", label: "SKU Code" }, { key: "productName", label: "Product Name" }] : []),
  { key: "locationCode", label: "Location" }, { key: "warehouseCode", label: "Warehouse" }, { key: "jobCode", label: "Job Code" },
  { key: "planCode", label: "Count Code" }, { key: "operationType", label: "Count Operation Type" }, { key: "createdByName", label: "Created By" },
  { key: "startedAt", label: "Count Started Time", type: "datetime" }, { key: "completedAt", label: "Count Completed Time", type: "datetime" },
  { key: "status", label: "Status" }, ...(kind === "skus" ? [] : [{ key: "skuCount", label: "Num. of SKU", type: "integer" as const }]),
  { key: "approvedStockQty", label: "Approved Stock Qty", type: "integer" }, { key: "initialStockQty", label: "Initial Stock Qty", type: "integer" },
  { key: "approvedCountQty", label: "Approved Count Qty", type: "integer" }, { key: "countedQty", label: "Counted Qty", type: "integer" },
  { key: "isRecountLine", label: "Recount Line", type: "boolean" }, { key: "recounted", label: kind === "skus" ? "Recounted SKU" : "Recounted Location", type: "boolean" },
  { key: "difference", label: "% Difference", type: "number" }, { key: "countUserName", label: "Count User" }, { key: "note", label: "Note" },
  { key: "inventoryUpdatedAt", label: "Inventory Updated Date Time", type: "datetime" }, { key: "inventoryUpdatedByName", label: "Inventory Update User" },
];

export const countPlansExport: ExportProvider = {
  columns: PLAN_COLUMNS,
  fetchPage(ctx: ExportContext, page: number, pageSize: number): ExportPage {
    const res = runGrid<CountPlanListRow>(ctx.db, planGrid(ctx.auth.viewScope), { ...ctx.query, page, pageSize });
    return { rows: res.rows.map((r) => ({ ...planRow(r) }) as Record<string, unknown>), total: res.total };
  },
};

function detailPage(ctx: ExportContext, kind: LineGridKind, page: number, pageSize: number): ExportPage {
  const spec = lineGrid(ctx.auth.viewScope, kind);
  const where = whereOf(spec, ctx.query);
  const from = sql`${spec.from} JOIN count_line_entries e ON e.line_id = ${kind === "skus" ? sql`l.line_id AND e.product_id = l.product_id` : sql`l.id`} JOIN products epr ON epr.id = e.product_id JOIN locations elo ON elo.id = e.location_id LEFT JOIN license_plates elp ON elp.id = e.lp_id`;
  const total = ctx.db.get<{ n: number }>(sql`SELECT COUNT(*) AS n ${from} WHERE ${where}`)?.n ?? 0;
  const rows = ctx.db.all<Record<string, unknown>>(sql`
    SELECT p.code AS planCode, j.code AS jobCode, elo.code AS locationCode, epr.sku AS sku, epr.name AS productName, elp.number AS lpNumber,
      e.lot_number AS lotNumber, e.expiry_date AS expiryDate, e.pack_type AS packType, e.system_qty AS systemQty, e.counted_qty AS countedQty,
      e.counted_qty - e.system_qty AS difference, l.status AS lineStatus, l.is_recount_line AS isRecountLine, COALESCE((SELECT u.name FROM users u WHERE lower(u.email) = lower(e.counted_by)), e.counted_by) AS countedBy, e.counted_at AS countedAt
    ${from} WHERE ${where} ORDER BY p.code, elo.code, epr.sku LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`);
  return { rows: rows.map((r) => ({ ...r, isRecountLine: r.isRecountLine === 1 })), total };
}

function lineProvider(kind: LineGridKind): ExportProvider {
  return {
    columns: LINE_COLUMNS(kind),
    fetchPage(ctx, page, pageSize) {
      if (new URLSearchParams(ctx.rawQuery).get("detail") === "1") return detailPage(ctx, kind, page, pageSize);
      const res = runGrid<CountLineListRow>(ctx.db, lineGrid(ctx.auth.viewScope, kind), { ...ctx.query, page, pageSize });
      return { rows: res.rows.map((r) => ({ ...lineRow(r) }) as Record<string, unknown>), total: res.total };
    },
  };
}

export const countLocationsExport: ExportProvider = lineProvider("locations");
export const countSkusExport: ExportProvider = lineProvider("skus");
