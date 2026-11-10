/**
 * Count grid definitions (M07): Count Plan, Location Details, SKU Details. Used by the
 * list endpoints, bulk confirms and the export providers.
 */
import { sql, type SQL } from "drizzle-orm";
import type { Scope } from "@/server/auth/scope";
import {
  COUNT_LINE_SORT_FIELDS, COUNT_LOCATION_FIELDS, COUNT_LOCATION_SEARCH_FIELDS, COUNT_PLAN_FIELDS, COUNT_PLAN_SEARCH_FIELDS,
  COUNT_PLAN_SORT_FIELDS, COUNT_SKU_FIELDS, COUNT_SKU_SEARCH_FIELDS,
} from "@/lib/grid-defs/counts/count-grids";
import type { CountLineListRow, CountPlanListRow } from "@/lib/grid-defs/counts/count-rows";

export type { CountLineListRow, CountPlanListRow } from "@/lib/grid-defs/counts/count-rows";
import { inList, raw, withBooleans, type GridSpec } from "./counts-grid";

const userName = (col: string): SQL => raw(`(SELECT u.name FROM users u WHERE u.id = ${col})`);

/* -------------------------------------------------------------- plans */
const PLAN_COLUMNS: Readonly<Record<string, SQL>> = {
  id: raw("p.id"),
  code: raw("p.code"),
  warehouseId: raw("p.warehouse_id"),
  warehouseCode: raw("w.code"),
  description: raw("p.description"),
  scheduledAt: raw("p.scheduled_at"),
  lockLocations: raw("p.lock_locations"),
  countType: raw("p.count_type"),
  operationType: raw("p.operation_type"),
  status: raw("p.status"),
  isAi: raw("p.is_ai"),
  jobCodes: raw("(SELECT group_concat(jc, ', ') FROM (SELECT DISTINCT j.code AS jc FROM jobs j WHERE j.count_plan_id = p.id ORDER BY j.code))"),
  startedAt: raw("p.started_at"),
  completedAt: raw("p.completed_at"),
  skuCount: raw(`(CASE WHEN p.count_type = 'SKU' THEN (SELECT COUNT(DISTINCT l.product_id) FROM count_plan_lines l WHERE l.plan_id = p.id AND l.status <> 'Cancelled')
    ELSE (SELECT COUNT(DISTINCT pid) FROM (
      SELECT e.product_id AS pid FROM count_line_entries e JOIN count_plan_lines l ON l.id = e.line_id WHERE l.plan_id = p.id
      UNION SELECT i.product_id FROM inventory i WHERE i.on_hand > 0 AND p.status NOT IN ('Inventory Updated', 'Cancelled')
        AND i.location_id IN (SELECT l2.location_id FROM count_plan_lines l2 WHERE l2.plan_id = p.id AND l2.status <> 'Cancelled'))) END)`),
  countedSkuCount: raw("(SELECT COUNT(DISTINCT e.product_id) FROM count_line_entries e JOIN count_plan_lines l ON l.id = e.line_id WHERE l.plan_id = p.id)"),
  locationCount: raw("(SELECT COUNT(DISTINCT l.location_id) FROM count_plan_lines l WHERE l.plan_id = p.id AND l.location_id IS NOT NULL AND l.status <> 'Cancelled')"),
  countedLocationCount: raw("(SELECT COUNT(DISTINCT l.location_id) FROM count_plan_lines l WHERE l.plan_id = p.id AND l.status IN ('Count Completed', 'Inventory Updated', 'Recount Created'))"),
  lineCount: raw("(SELECT COUNT(*) FROM count_plan_lines l WHERE l.plan_id = p.id AND l.status <> 'Cancelled')"),
  countedLineCount: raw("(SELECT COUNT(*) FROM count_plan_lines l WHERE l.plan_id = p.id AND l.status = 'Count Completed')"),
  countObject: raw(`(SELECT group_concat(c, ', ') FROM (SELECT DISTINCT COALESCE(pr.sku, lo.code) AS c FROM count_plan_lines l
    LEFT JOIN products pr ON pr.id = l.product_id LEFT JOIN locations lo ON lo.id = l.location_id
    WHERE l.plan_id = p.id AND COALESCE(pr.sku, lo.code) IS NOT NULL ORDER BY c LIMIT 3))`),
  countObjectTotal: raw("(SELECT COUNT(DISTINCT COALESCE(l.product_id, l.location_id)) FROM count_plan_lines l WHERE l.plan_id = p.id)"),
  createdAt: raw("p.created_at"),
  createdByName: userName("p.created_by"),
  inventoryUpdatedAt: raw("p.inventory_updated_at"),
  inventoryUpdatedByName: userName("p.inventory_updated_by"),
  version: raw("p.version"),
};


export function planGrid(scope: Scope): GridSpec {
  return {
    from: raw("FROM count_plans p JOIN warehouses w ON w.id = p.warehouse_id"),
    columns: PLAN_COLUMNS,
    fields: COUNT_PLAN_FIELDS,
    sortable: COUNT_PLAN_SORT_FIELDS,
    search: COUNT_PLAN_SEARCH_FIELDS,
    base: [inList(raw("p.warehouse_id"), scope.warehouseIds)],
    defaultOrder: raw("p.created_at DESC, p.code DESC"),
  };
}

export const planRow = (row: CountPlanListRow): CountPlanListRow => withBooleans(row as unknown as Record<string, unknown>, ["lockLocations", "isAi"]) as unknown as CountPlanListRow;

/* -------------------------------------------------------------- lines */
const LINE_COLUMNS: Readonly<Record<string, SQL>> = {
  id: raw("l.id"),
  planId: raw("p.id"),
  planCode: raw("p.code"),
  planStatus: raw("p.status"),
  countType: raw("p.count_type"),
  lockLocations: raw("p.lock_locations"),
  warehouseId: raw("p.warehouse_id"),
  warehouseCode: raw("w.code"),
  locationId: raw("l.location_id"),
  locationCode: raw("lo.code"),
  productId: raw("l.product_id"),
  sku: raw("pr.sku"),
  productName: raw("pr.name"),
  jobId: raw("l.job_id"),
  jobCode: raw("j.code"),
  operationType: raw("p.operation_type"),
  createdByName: userName("p.created_by"),
  startedAt: raw("l.started_at"),
  completedAt: raw("l.completed_at"),
  status: raw("l.status"),
  skuCount: raw(`(CASE WHEN l.product_id IS NOT NULL THEN 1 ELSE COALESCE(NULLIF((SELECT COUNT(DISTINCT e.product_id) FROM count_line_entries e WHERE e.line_id = l.id), 0),
    (SELECT COUNT(DISTINCT i.product_id) FROM inventory i WHERE i.location_id = l.location_id AND i.on_hand > 0)) END)`),
  approvedStockQty: raw("l.approved_stock_qty"),
  initialStockQty: raw("l.initial_stock_qty"),
  approvedCountQty: raw("l.approved_count_qty"),
  countedQty: raw("l.counted_qty"),
  isRecountLine: raw("l.is_recount_line"),
  recounted: raw("l.recounted"),
  difference: raw(`(CASE WHEN l.counted_qty IS NULL THEN NULL WHEN COALESCE(l.approved_stock_qty, 0) = 0 THEN (CASE WHEN l.counted_qty = 0 THEN 0 ELSE 100 END)
    ELSE ROUND((l.counted_qty - l.approved_stock_qty) * 100.0 / l.approved_stock_qty, 2) END)`),
  countUserName: userName("l.count_user_id"),
  note: raw("l.note"),
  inventoryUpdatedAt: raw("l.inventory_updated_at"),
  inventoryUpdatedByName: userName("l.inventory_updated_by"),
  version: raw("l.version"),
};


export type LineGridKind = "locations" | "skus" | "plan";

export function lineGrid(scope: Scope, kind: LineGridKind, planId?: string): GridSpec {
  const base: SQL[] = [inList(raw("p.warehouse_id"), scope.warehouseIds)];
  if (kind === "skus") base.push(raw("l.product_id IS NOT NULL"));
  if (planId) base.push(sql`l.plan_id = ${planId}`);
  return {
    from: raw(`FROM count_plan_lines l JOIN count_plans p ON p.id = l.plan_id JOIN warehouses w ON w.id = p.warehouse_id
      LEFT JOIN locations lo ON lo.id = l.location_id LEFT JOIN products pr ON pr.id = l.product_id LEFT JOIN jobs j ON j.id = l.job_id`),
    columns: LINE_COLUMNS,
    fields: kind === "skus" ? COUNT_SKU_FIELDS : COUNT_LOCATION_FIELDS,
    sortable: COUNT_LINE_SORT_FIELDS,
    search: kind === "skus" ? COUNT_SKU_SEARCH_FIELDS : COUNT_LOCATION_SEARCH_FIELDS,
    base,
    defaultOrder: kind === "plan" ? raw("lo.walking_path_priority, lo.code, pr.sku, l.is_recount_line, l.created_at") : raw("l.created_at DESC, lo.code, pr.sku"),
  };
}

export const lineRow = (row: CountLineListRow): CountLineListRow =>
  withBooleans(row as unknown as Record<string, unknown>, ["lockLocations", "isRecountLine", "recounted"]) as unknown as CountLineListRow;
