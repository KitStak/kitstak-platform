/**
 * PO Receiving Report (spec 03/07) and User Performance Report (spec 07, Warehouse
 * Efficiency). Scoped to viewScope.
 */
import { sql, type SQL } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import type { AuthContext } from "@/server/auth/context";
import type { GridQuery } from "@/server/query/grid-query";
import { PERIOD_DAYS, PO_RECEIVING_DEF, USER_PERFORMANCE_DEF } from "@/lib/grid-defs/reports/receiving";
import { canAny } from "@/server/auth/permissions";
import { clientIn, inList, runReport, warehouseLabel, type ReportPage, type ReportQuery } from "./reports-grid";
import { LABOR_TEAM_PERMISSION } from "./analytics-types";
import { warehouseDateSql } from "./report-local-day";

type Row = Record<string, unknown>;

/** Received UOM − PO UOM; null when they match (the pill stays blank). */
export function receivingDifference(poUomQty: number, receivedUomQty: number): number | null {
  const diff = receivedUomQty - poUomQty;
  return diff === 0 ? null : diff;
}

/**
 * Units per pack of a PO line (alias `l`). `purchase_order_lines.uom_quantity` stores the
 * per-pack ratio (Case = 24, Each = 1), never the line total, so the authority is the
 * product's pack-type hierarchy (`product_pack_types.uom_qty` for the line's pack type).
 * The stored ratio is only a fallback for a pack type missing from the hierarchy.
 */
export const PO_LINE_RATIO_SQL = sql`COALESCE((SELECT NULLIF(pt.uom_qty, 0) FROM product_pack_types pt WHERE pt.product_id = l.product_id AND pt.pack_type = l.pack_type LIMIT 1), NULLIF(l.uom_quantity, 0), 1)`;

/** PO UOM Quantity = ordered quantity (in the line's pack type) × units per pack. */
export function poUomQuantity(orderedQty: number, unitsPerPack: number | null | undefined): number {
  const ratio = unitsPerPack && unitsPerPack > 0 ? unitsPerPack : 1;
  return orderedQty * ratio;
}

export function poReceivingSql(auth: AuthContext): SQL {
  return sql`
    WITH base AS (
      SELECT l.*, ${PO_LINE_RATIO_SQL} AS ratio FROM purchase_order_lines l
    ),
    lines AS (
      SELECT l.id AS lid, po.id AS poid, po.code AS po_code, po.status AS po_status, po.warehouse_id AS wid, po.client_id AS cid,
             l.product_id AS pid, l.pack_type AS pack, COALESCE(l.damaged_quantity, 0) AS damaged, l.ordered_quantity AS po_qty,
             l.ratio AS ratio, l.ordered_quantity * l.ratio AS po_uom,
             (SELECT COALESCE(SUM(r.uom_quantity), 0) FROM receipts r WHERE r.purchase_order_line_id = l.id AND r.cancelled_at IS NULL) AS rcv_uom
      FROM base l JOIN purchase_orders po ON po.id = l.purchase_order_id
      WHERE ${inList(sql`po.warehouse_id`, auth.viewScope.warehouseIds)} AND ${clientIn(sql`po.client_id`, auth.viewScope.clientIds)}
        AND (po.status <> 'Pending' OR EXISTS (SELECT 1 FROM receipts r WHERE r.purchase_order_line_id = l.id))
    )
    SELECT x.lid AS "rowId", x.wid AS "warehouseId", ${warehouseLabel("w")} AS "warehouse", x.cid AS "clientId", c.name AS "client",
           x.po_code AS "poCode", '/receiving/' || x.poid AS "poHref", x.po_status AS "poStatus",
           p.sku AS "sku", p.name AS "productName", p.barcode AS "barcode", '/products/' || p.id AS "productHref",
           x.pack AS "packType", x.damaged AS "damagedQty", x.po_qty AS "poQty", x.ratio AS "unitsPerPack", x.po_uom AS "poUomQty", x.rcv_uom AS "receivedUomQty",
           NULLIF(x.rcv_uom - x.po_uom, 0) AS "difference", (x.rcv_uom <> x.po_uom) AS "hasDifference"
    FROM lines x JOIN products p ON p.id = x.pid JOIN clients c ON c.id = x.cid JOIN warehouses w ON w.id = x.wid`;
}

export async function listPoReceiving(db: AppDb, auth: AuthContext, query: GridQuery): Promise<ReportPage<Row>> {
  const page = await runReport<Row>(db, poReceivingSql(auth), PO_RECEIVING_DEF, query);
  return { rows: page.rows.map((r) => ({ ...r, hasDifference: Boolean(r.hasDifference) })), total: page.total };
}

/* --------------------------------------------------------- user performance */

/**
 * One visibility policy for per-associate labor data (critic R5), the same rule as Labor
 * Analytics: viewers without the team permission (`settings.users.view`: supervisors and
 * admins) see only their own rows, in the grid AND in the Excel export (both run this SQL).
 */
export const seesTeamPerformance = (auth: Pick<AuthContext, "permissions">): boolean => canAny(auth, [LABOR_TEAM_PERMISSION]);

/**
 * Grain: warehouse × user × activity day, the day being the WAREHOUSE-LOCAL calendar day (the
 * day Labor Analytics buckets by, so a drilldown's rows match the chart it came from). Every
 * metric comes from the source records: completed tasks (pick/pack/sort/replenish), receipts
 * (PO + return), count entries. Without `db` the day falls back to the UTC date (unit tests).
 */
export async function userPerformanceSql(auth: AuthContext, sinceIso: string | null, db?: AppDb): Promise<SQL> {
  const since = (expr: string): SQL => (sinceIso ? sql`${sql.raw(expr)} >= ${sinceIso}` : sql`1 = 1`);
  const wh = (expr: string): SQL => inList(sql.raw(expr), auth.viewScope.warehouseIds);
  const cl = (expr: string): SQL => clientIn(sql.raw(expr), auth.viewScope.clientIds);
  const day = async (colExpr: string, whExpr: string): Promise<SQL> => (db ? await warehouseDateSql(db, colExpr, whExpr, auth.viewScope.warehouseIds) : sql`substr(${sql.raw(colExpr)}, 1, 10)`);
  const self = seesTeamPerformance(auth) ? sql`1 = 1` : sql`ev.uid = ${auth.user.id}`;
  return sql`
    WITH ev AS (
      SELECT t.warehouse_id AS wid, t.executed_by_user_id AS uid, ${await day("t.finished_at", "t.warehouse_id")} AS d, t.task_type AS kind,
             t.order_id AS oid, t.order_line_id AS lid, COALESCE(t.actual_qty, t.planned_qty, 0) AS qty,
             COALESCE(t.target_lp_id, t.source_lp_id) AS lp, NULL AS loc, NULL AS rid,
             CASE WHEN t.started_at IS NOT NULL AND t.started_at < t.finished_at THEN 1 ELSE 0 END AS timed,
             CASE WHEN t.started_at IS NOT NULL AND t.started_at < t.finished_at
                  THEN LEAST((EXTRACT(EPOCH FROM ((t.finished_at)::timestamptz - (t.started_at)::timestamptz)) / 86400.0::float8) * 1440.0::float8, 30) END AS mins
      FROM tasks t
      WHERE t.status = 'Completed' AND t.executed_by_user_id IS NOT NULL AND t.finished_at IS NOT NULL
        AND t.task_type IN ('Picking', 'Packing', 'Sorting', 'Replenishment') AND ${since("t.finished_at")} AND ${wh("t.warehouse_id")} AND ${cl("t.client_id")}
      UNION ALL
      SELECT r.warehouse_id, u.id, ${await day("r.received_at", "r.warehouse_id")}, CASE WHEN r.return_order_id IS NOT NULL OR r.type = 'Return' THEN 'Return' ELSE 'Receive' END,
             NULL, NULL, r.uom_quantity, r.lp_id, NULL, r.return_order_id, NULL, NULL
      FROM receipts r JOIN users u ON u.email = r.received_by OR u.id = r.received_by
      WHERE r.cancelled_at IS NULL AND ${since("r.received_at")} AND ${wh("r.warehouse_id")} AND ${cl("r.client_id")}
      UNION ALL
      SELECT cp.warehouse_id, u.id, ${await day("e.counted_at", "cp.warehouse_id")}, 'Count', NULL, NULL, e.counted_qty, NULL, e.location_id, NULL, NULL, NULL
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
           COUNT(DISTINCT CASE WHEN kind = 'Return' THEN rid END) AS "returnedOrderQty",
           SUM(CASE WHEN timed IS NOT NULL THEN 1 ELSE 0 END) AS "taskQty",
           CASE WHEN SUM(CASE WHEN timed IS NOT NULL THEN 1 ELSE 0 END) > 0
                THEN ROUND((SUM(COALESCE(timed, 0)) * 100.0::float8 / SUM(CASE WHEN timed IS NOT NULL THEN 1 ELSE 0 END))::numeric, 0)::float8 END AS "timedTaskPct",
           ROUND((COALESCE(SUM(mins), 0))::numeric, 1)::float8 AS "timedMinutes"
    FROM ev JOIN users u ON u.id = ev.uid JOIN warehouses w ON w.id = ev.wid
    WHERE ${self}
    GROUP BY ev.wid, ev.uid, ev.d, w.id, u.id`;
}

/**
 * `Period` chip → ISO lower bound: local midnight (warehouse offset, minutes east of UTC) of
 * the day N-1 days back, so "Last 7 days" is today plus the 6 local days before it.
 */
export function periodSince(query: ReportQuery, now: Date = new Date()): string | null {
  const f = query.filters.find((x) => x.field === "period");
  if (!f || f.op !== "in") return null;
  const days = Math.max(...f.values.map((v) => PERIOD_DAYS[v] ?? 0));
  if (!days) return null;
  const off = (query.tzOffsetMinutes ?? 0) * 60_000;
  const local = new Date(now.getTime() + off);
  const startLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - (days - 1));
  return new Date(startLocal - off).toISOString();
}

export async function listUserPerformance(db: AppDb, auth: AuthContext, query: ReportQuery): Promise<ReportPage<Row>> {
  return await runReport<Row>(db, await userPerformanceSql(auth, periodSince(query), db), USER_PERFORMANCE_DEF, query, ["period"]);
}
