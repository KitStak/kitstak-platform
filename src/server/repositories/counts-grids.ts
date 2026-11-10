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

/** Display name for a user column; legacy rows that stored the email (old seed) resolve too. */
const userName = (col: string): SQL => raw(`(SELECT u.name FROM users u WHERE u.id = ${col} OR u.email = ${col} LIMIT 1)`);

/** Line `l` waits to be counted but has no live count task (its job was cancelled). */
const orphanedLine = (idCol: string): string => `l.status IN ('Ready To Count', 'Count Started') AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.count_line_id = ${idCol} AND t.status IN ('Pending', 'Started'))`;
export const ORPHANED_LINE = orphanedLine("l.id");

/**
 * Location Details row set (`l` line, `p` plan): location lines only, never SKU-plan slices.
 * Shared by the grid and its status chips so every chip equals the filtered grid total.
 */
export const LOCATION_LINES_ONLY = "l.location_id IS NOT NULL AND l.product_id IS NULL AND p.count_type <> 'SKU'";

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
  waveRuleId: raw("p.wave_rule_id"),
  waveRuleName: raw("(SELECT wr.name FROM wave_rules wr WHERE wr.id = p.wave_rule_id)"),
  jobCodes: raw("(SELECT group_concat(jc, ', ') FROM (SELECT DISTINCT j.code AS jc FROM jobs j WHERE j.count_plan_id = p.id ORDER BY j.code))"),
  /** "id|code;id|code" so the grid can link each job (job codes contain neither separator). */
  jobRefs: raw("(SELECT group_concat(jr, ';') FROM (SELECT j.id || '|' || j.code AS jr FROM jobs j WHERE j.count_plan_id = p.id ORDER BY j.code))"),
  startedAt: raw("p.started_at"),
  completedAt: raw("p.completed_at"),
  skuCount: raw(`(CASE WHEN p.count_type = 'SKU' THEN (SELECT COUNT(DISTINCT l.product_id) FROM count_plan_lines l WHERE l.plan_id = p.id AND l.status <> 'Cancelled')
    ELSE (SELECT COUNT(DISTINCT pid) FROM (
      SELECT e.product_id AS pid FROM count_line_entries e JOIN count_plan_lines l ON l.id = e.line_id WHERE l.plan_id = p.id
      UNION SELECT i.product_id FROM inventory i WHERE i.on_hand > 0 AND p.status NOT IN ('Inventory Updated', 'Cancelled')
        AND EXISTS (SELECT 1 FROM count_plan_lines l2 WHERE l2.plan_id = p.id AND l2.status <> 'Cancelled' AND l2.location_id = i.location_id
          AND (l2.lp_id IS NULL OR l2.lp_id = i.lp_id)))) END)`),
  countedSkuCount: raw("(SELECT COUNT(DISTINCT e.product_id) FROM count_line_entries e JOIN count_plan_lines l ON l.id = e.line_id WHERE l.plan_id = p.id)"),
  locationCount: raw("(SELECT COUNT(DISTINCT l.location_id) FROM count_plan_lines l WHERE l.plan_id = p.id AND l.location_id IS NOT NULL AND l.status <> 'Cancelled')"),
  countedLocationCount: raw("(SELECT COUNT(DISTINCT l.location_id) FROM count_plan_lines l WHERE l.plan_id = p.id AND l.status IN ('Count Completed', 'Inventory Updated', 'Recount Created'))"),
  lineCount: raw("(SELECT COUNT(*) FROM count_plan_lines l WHERE l.plan_id = p.id AND l.status <> 'Cancelled')"),
  countedLineCount: raw("(SELECT COUNT(*) FROM count_plan_lines l WHERE l.plan_id = p.id AND l.status = 'Count Completed')"),
  orphanedLineCount: raw(`(SELECT COUNT(*) FROM count_plan_lines l WHERE l.plan_id = p.id AND ${ORPHANED_LINE})`),
  /** Cancelled lines are excluded from Number of SKU / Location / lines (they are never counted) and reported here. */
  cancelledLineCount: raw("(SELECT COUNT(*) FROM count_plan_lines l WHERE l.plan_id = p.id AND l.status = 'Cancelled')"),
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
  lineId: raw("l.id"),
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
  locationType: raw("lo.location_type"),
  locationGroup: raw("(SELECT lv.name FROM lookup_values lv WHERE lv.id = lo.location_group_id)"),
  lpType: raw("(SELECT t.code FROM license_plates n JOIN lp_types t ON t.id = n.lp_type_id WHERE n.id = l.lp_id)"),
  productType: raw("(SELECT lv.name FROM lookup_values lv WHERE lv.id = pr.product_type_id)"),
  productGroup: raw("(SELECT lv.name FROM lookup_values lv WHERE lv.id = pr.product_group_id)"),
  /** SKUs a line covers: its own SKU, else the counted SKUs, else the SKUs on hand in its location / LP. */
  skuList: raw(`(CASE WHEN l.product_id IS NOT NULL THEN pr.sku ELSE COALESCE(
    (SELECT group_concat(s, ', ') FROM (SELECT DISTINCT p2.sku AS s FROM count_line_entries e JOIN products p2 ON p2.id = e.product_id WHERE e.line_id = l.id ORDER BY p2.sku)),
    (SELECT group_concat(s, ', ') FROM (SELECT DISTINCT p2.sku AS s FROM inventory i JOIN products p2 ON p2.id = i.product_id
      WHERE i.location_id = l.location_id AND i.on_hand > 0 AND (l.lp_id IS NULL OR i.lp_id = l.lp_id) ORDER BY p2.sku))) END)`),
  lpId: raw("l.lp_id"),
  lpNumber: raw("(SELECT n.number FROM license_plates n WHERE n.id = l.lp_id)"),
  jobId: raw("l.job_id"),
  jobCode: raw("j.code"),
  operationType: raw("p.operation_type"),
  createdByName: userName("p.created_by"),
  startedAt: raw("l.started_at"),
  completedAt: raw("l.completed_at"),
  status: raw("l.status"),
  skuCount: raw(`(CASE WHEN l.product_id IS NOT NULL THEN 1 ELSE COALESCE(NULLIF((SELECT COUNT(DISTINCT e.product_id) FROM count_line_entries e WHERE e.line_id = l.id), 0),
    (SELECT COUNT(DISTINCT i.product_id) FROM inventory i WHERE i.location_id = l.location_id AND i.on_hand > 0 AND (l.lp_id IS NULL OR i.lp_id = l.lp_id))) END)`),
  approvedStockQty: raw("l.approved_stock_qty"),
  initialStockQty: raw("l.initial_stock_qty"),
  approvedCountQty: raw("l.approved_count_qty"),
  countedQty: raw("l.counted_qty"),
  isRecountLine: raw("l.is_recount_line"),
  recounted: raw("l.recounted"),
  ...recountLinkColumns("l.id"),
  orphaned: raw(`(CASE WHEN ${ORPHANED_LINE} THEN 1 ELSE 0 END)`),
  difference: raw(`(CASE WHEN l.counted_qty IS NULL THEN NULL WHEN COALESCE(l.approved_stock_qty, 0) = 0 THEN (CASE WHEN l.counted_qty = 0 THEN 0 ELSE 100 END)
    ELSE ROUND((l.counted_qty - l.approved_stock_qty) * 100.0 / l.approved_stock_qty, 2) END)`),
  countUserName: userName("l.count_user_id"),
  note: raw("l.note"),
  inventoryUpdatedAt: raw("l.inventory_updated_at"),
  inventoryUpdatedByName: userName("l.inventory_updated_by"),
  version: raw("l.version"),
};


/** The recount line raised from a line (newest first) and its job, so the grids link the recount in its new job. */
function recountLinkColumns(lineRef: string): Record<string, SQL> {
  const newest = `FROM count_plan_lines r LEFT JOIN jobs rj ON rj.id = r.job_id WHERE r.recount_of_line_id = ${lineRef} ORDER BY r.created_at DESC LIMIT 1`;
  return {
    recountJobId: raw(`(SELECT r.job_id ${newest})`),
    recountJobCode: raw(`(SELECT rj.code ${newest})`),
    recountLineStatus: raw(`(SELECT r.status ${newest})`),
    recountOfJobCode: raw(`(SELECT oj.code FROM count_plan_lines o JOIN jobs oj ON oj.id = o.job_id WHERE o.id = (SELECT x.recount_of_line_id FROM count_plan_lines x WHERE x.id = ${lineRef}))`),
  };
}

export type LineGridKind = "locations" | "skus" | "plan";

/**
 * SKU Details source: one row per (line, SKU). SKU-type lines are used as is; location-type
 * lines contribute one synthetic row per counted product (aggregated from their entries),
 * plus, for uncounted lines (Pending … Count Started, and Cancelled-before-count), one row per
 * SKU on hand in the location (expected qty = on hand), so every in-scope SKU is listed with its
 * status, Cancelled included (Logiwa lists Cancelled rows on Count SKU Details). Synthetic
 * rows carry `line_id` = the real line, used by every line command.
 */
export const SKU_LINES_SOURCE = `(
  SELECT l.id AS id, l.id AS line_id, l.plan_id, l.location_id, l.product_id, l.job_id, l.status, l.initial_stock_qty, l.counted_qty,
    l.approved_stock_qty, l.approved_count_qty, l.is_recount_line, l.recounted, l.count_user_id, l.note, l.started_at, l.completed_at,
    l.inventory_updated_at, l.inventory_updated_by, l.version, l.created_at, l.lp_id
  FROM count_plan_lines l WHERE l.product_id IS NOT NULL
  UNION ALL
  SELECT l.id || ':' || e.product_id, l.id, l.plan_id, COALESCE(l.location_id, MIN(e.location_id)), e.product_id, l.job_id, l.status,
    SUM(e.system_qty), SUM(e.counted_qty), SUM(e.system_qty), CASE WHEN l.approved_count_qty IS NULL THEN NULL ELSE SUM(e.counted_qty) END,
    l.is_recount_line, l.recounted, l.count_user_id, l.note, l.started_at, l.completed_at, l.inventory_updated_at, l.inventory_updated_by,
    l.version, l.created_at, l.lp_id
  FROM count_plan_lines l JOIN count_line_entries e ON e.line_id = l.id WHERE l.product_id IS NULL
  GROUP BY l.id, e.product_id
  UNION ALL
  SELECT l.id || ':' || i.product_id, l.id, l.plan_id, l.location_id, i.product_id, l.job_id, l.status,
    SUM(i.on_hand), NULL, NULL, NULL, l.is_recount_line, l.recounted, l.count_user_id, l.note, l.started_at, l.completed_at,
    l.inventory_updated_at, l.inventory_updated_by, l.version, l.created_at, l.lp_id
  FROM count_plan_lines l JOIN inventory i ON i.location_id = l.location_id AND i.on_hand > 0 AND (l.lp_id IS NULL OR i.lp_id = l.lp_id)
  WHERE l.product_id IS NULL AND l.status NOT IN ('Inventory Updated', 'Recount Created')
    AND NOT EXISTS (SELECT 1 FROM count_line_entries e WHERE e.line_id = l.id)
  GROUP BY l.id, i.product_id
)`;

export function lineGrid(scope: Scope, kind: LineGridKind, planId?: string): GridSpec {
  const base: SQL[] = [inList(raw("p.warehouse_id"), scope.warehouseIds)];
  if (planId) base.push(sql`l.plan_id = ${planId}`);
  // Location Details lists location lines only; SKU-count lines (no location) live on SKU Details.
  // Per-location slices of SKU-type plans are product lines too (Logiwa: location lines on
  // Location Details, product lines on SKU Details), so the two tabs never mix plan types.
  if (kind === "locations") base.push(raw(LOCATION_LINES_ONLY));
  return {
    from: raw(`FROM ${kind === "skus" ? `${SKU_LINES_SOURCE} l` : "count_plan_lines l"} JOIN count_plans p ON p.id = l.plan_id JOIN warehouses w ON w.id = p.warehouse_id
      LEFT JOIN locations lo ON lo.id = l.location_id LEFT JOIN products pr ON pr.id = l.product_id LEFT JOIN jobs j ON j.id = l.job_id`),
    columns: kind === "skus" ? { ...LINE_COLUMNS, lineId: raw("l.line_id"), ...recountLinkColumns("l.line_id"), orphaned: raw(`(CASE WHEN ${orphanedLine("l.line_id")} THEN 1 ELSE 0 END)`) } : LINE_COLUMNS,
    fields: kind === "skus" ? COUNT_SKU_FIELDS : COUNT_LOCATION_FIELDS,
    sortable: COUNT_LINE_SORT_FIELDS,
    search: kind === "skus" ? COUNT_SKU_SEARCH_FIELDS : COUNT_LOCATION_SEARCH_FIELDS,
    base,
    defaultOrder: kind === "plan" ? raw("lo.walking_path_priority, lo.code, pr.sku, l.is_recount_line, l.created_at") : raw("l.created_at DESC, lo.code, pr.sku"),
  };
}

export const lineRow = (row: CountLineListRow): CountLineListRow =>
  withBooleans(row as unknown as Record<string, unknown>, ["lockLocations", "isRecountLine", "recounted", "orphaned"]) as unknown as CountLineListRow;
