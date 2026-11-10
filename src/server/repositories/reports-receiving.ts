/**
 * PO Receiving Report (spec 03/07) and User Performance Report (spec 07, Warehouse
 * Efficiency). Scoped to viewScope.
 */
import { sql, type SQL } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import type { AuthContext } from "@/server/auth/context";
import type { GridQuery } from "@/server/query/grid-query";
import { PERIOD_DAYS, PO_RECEIVING_DEF, USER_PERFORMANCE_DEF } from "@/lib/grid-defs/reports/receiving";
import { clientIn, inList, runReport, warehouseLabel, type ReportPage } from "./reports-grid";

type Row = Record<string, unknown>;

/** Received UOM − PO UOM; null when they match (the pill stays blank). */
export function receivingDifference(poUomQty: number, receivedUomQty: number): number | null {
  const diff = receivedUomQty - poUomQty;
  return diff === 0 ? null : diff;
}

export function poReceivingSql(auth: AuthContext): SQL {
  return sql`
    WITH lines AS (
      SELECT l.id AS lid, po.id AS poid, po.code AS po_code, po.status AS po_status, po.warehouse_id AS wid, po.client_id AS cid,
             l.product_id AS pid, l.pack_type AS pack, COALESCE(l.damaged_quantity, 0) AS damaged, l.ordered_quantity AS po_qty,
             COALESCE(NULLIF(l.uom_quantity, 0), l.ordered_quantity) AS po_uom,
             (SELECT COALESCE(SUM(r.uom_quantity), 0) FROM receipts r WHERE r.purchase_order_line_id = l.id AND r.cancelled_at IS NULL) AS rcv_uom
      FROM purchase_order_lines l JOIN purchase_orders po ON po.id = l.purchase_order_id
      WHERE ${inList(sql`po.warehouse_id`, auth.viewScope.warehouseIds)} AND ${clientIn(sql`po.client_id`, auth.viewScope.clientIds)}
        AND (po.status <> 'Pending' OR EXISTS (SELECT 1 FROM receipts r WHERE r.purchase_order_line_id = l.id))
    )
    SELECT x.lid AS "rowId", x.wid AS "warehouseId", ${warehouseLabel("w")} AS "warehouse", x.cid AS "clientId", c.name AS "client",
           x.po_code AS "poCode", '/receiving/' || x.poid AS "poHref", x.po_status AS "poStatus",
           p.sku AS "sku", p.name AS "productName", p.barcode AS "barcode", '/products/' || p.id AS "productHref",
           x.pack AS "packType", x.damaged AS "damagedQty", x.po_qty AS "poQty", x.po_uom AS "poUomQty", x.rcv_uom AS "receivedUomQty",
           NULLIF(x.rcv_uom - x.po_uom, 0) AS "difference", (x.rcv_uom <> x.po_uom) AS "hasDifference"
    FROM lines x JOIN products p ON p.id = x.pid JOIN clients c ON c.id = x.cid JOIN warehouses w ON w.id = x.wid`;
}

export function listPoReceiving(db: AppDb, auth: AuthContext, query: GridQuery): ReportPage<Row> {
  const page = runReport<Row>(db, poReceivingSql(auth), PO_RECEIVING_DEF, query);
  return { rows: page.rows.map((r) => ({ ...r, hasDifference: Boolean(r.hasDifference) })), total: page.total };
}

/* --------------------------------------------------------- user performance */

/**
 * Grain: warehouse × user × activity day (UTC). Every metric comes from the source
 * records: completed tasks (pick/pack/sort/replenish), receipts (PO + return),
 * count entries.
 */
export function userPerformanceSql(auth: AuthContext, sinceIso: string | null): SQL {
  const since = (expr: string): SQL => (sinceIso ? sql`${sql.raw(expr)} >= ${sinceIso}` : sql`1 = 1`);
  const wh = (expr: string): SQL => inList(sql.raw(expr), auth.viewScope.warehouseIds);
  const cl = (expr: string): SQL => clientIn(sql.raw(expr), auth.viewScope.clientIds);
  return sql`
    WITH ev AS (
      SELECT t.warehouse_id AS wid, t.executed_by_user_id AS uid, substr(t.finished_at, 1, 10) AS d, t.task_type AS kind,
             t.order_id AS oid, t.order_line_id AS lid, COALESCE(t.actual_qty, t.planned_qty, 0) AS qty,
             COALESCE(t.target_lp_id, t.source_lp_id) AS lp, NULL AS loc, NULL AS rid
      FROM tasks t
      WHERE t.status = 'Completed' AND t.executed_by_user_id IS NOT NULL AND t.finished_at IS NOT NULL
        AND t.task_type IN ('Picking', 'Packing', 'Sorting', 'Replenishment') AND ${since("t.finished_at")} AND ${wh("t.warehouse_id")} AND ${cl("t.client_id")}
      UNION ALL
      SELECT r.warehouse_id, u.id, substr(r.received_at, 1, 10), CASE WHEN r.return_order_id IS NOT NULL OR r.type = 'Return' THEN 'Return' ELSE 'Receive' END,
             NULL, NULL, r.uom_quantity, r.lp_id, NULL, r.return_order_id
      FROM receipts r JOIN users u ON u.email = r.received_by OR u.id = r.received_by
      WHERE r.cancelled_at IS NULL AND ${since("r.received_at")} AND ${wh("r.warehouse_id")} AND ${cl("r.client_id")}
      UNION ALL
      SELECT cp.warehouse_id, u.id, substr(e.counted_at, 1, 10), 'Count', NULL, NULL, e.counted_qty, NULL, e.location_id, NULL
      FROM count_line_entries e JOIN count_plan_lines cl ON cl.id = e.line_id JOIN count_plans cp ON cp.id = cl.plan_id
      JOIN users u ON u.email = e.counted_by OR u.id = e.counted_by
      WHERE e.counted_at IS NOT NULL AND ${since("e.counted_at")} AND ${wh("cp.warehouse_id")}
    )
    SELECT ev.wid || ':' || ev.uid || ':' || ev.d AS "rowId", ev.wid AS "warehouseId", ${warehouseLabel("w")} AS "warehouse",
           ev.uid AS "userId", u.name AS "user", ev.d AS "activityDate",
           COUNT(DISTINCT CASE WHEN kind = 'Picking' THEN oid END) AS "pickedOrderQty",
           COUNT(DISTINCT CASE WHEN kind = 'Picking' THEN lid END) AS "pickedLineQty",
           COALESCE(SUM(CASE WHEN kind = 'Picking' THEN qty END), 0) AS "pickedItemQty",
           COUNT(DISTINCT CASE WHEN kind = 'Packing' THEN oid END) AS "packedOrderQty",
           COUNT(DISTINCT CASE WHEN kind = 'Packing' THEN lid END) AS "packedLineQty",
           COALESCE(SUM(CASE WHEN kind = 'Packing' THEN qty END), 0) AS "packedItemQty",
           COALESCE(SUM(CASE WHEN kind = 'Replenishment' THEN qty END), 0) AS "replenishedItemQty",
           COUNT(DISTINCT CASE WHEN kind = 'Replenishment' THEN lp END) AS "replenishedLpQty",
           COALESCE(SUM(CASE WHEN kind = 'Receive' THEN qty END), 0) AS "receivedItemQty",
           COUNT(DISTINCT CASE WHEN kind = 'Sorting' THEN oid END) AS "sortedOrderQty",
           COUNT(DISTINCT CASE WHEN kind = 'Sorting' THEN lid END) AS "sortedLineQty",
           COALESCE(SUM(CASE WHEN kind = 'Sorting' THEN qty END), 0) AS "sortedItemQty",
           COUNT(DISTINCT CASE WHEN kind = 'Receive' THEN lp END) AS "receivedLpQty",
           COALESCE(SUM(CASE WHEN kind = 'Count' THEN qty END), 0) AS "countedItemQty",
           COUNT(DISTINCT CASE WHEN kind = 'Count' THEN loc END) AS "countedLocationQty",
           COALESCE(SUM(CASE WHEN kind = 'Return' THEN qty END), 0) AS "returnedItemQty",
           COUNT(DISTINCT CASE WHEN kind = 'Return' THEN rid END) AS "returnedOrderQty"
    FROM ev JOIN users u ON u.id = ev.uid JOIN warehouses w ON w.id = ev.wid
    GROUP BY ev.wid, ev.uid, ev.d`;
}

/** `Period` chip → ISO lower bound (start of the UTC day N days back). */
export function periodSince(query: GridQuery, now: Date = new Date()): string | null {
  const f = query.filters.find((x) => x.field === "period");
  if (!f || f.op !== "in") return null;
  const days = Math.max(...f.values.map((v) => PERIOD_DAYS[v] ?? 0));
  if (!days) return null;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1)));
  return start.toISOString();
}

export function listUserPerformance(db: AppDb, auth: AuthContext, query: GridQuery): ReportPage<Row> {
  return runReport<Row>(db, userPerformanceSql(auth, periodSince(query)), USER_PERFORMANCE_DEF, query, ["period"]);
}
