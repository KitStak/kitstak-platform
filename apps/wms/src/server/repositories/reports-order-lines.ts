/**
 * Order Line Progress (M13 round 9): one row per order line behind the dashboard's
 * "Order Lines" progress row. The order predicate is `dashboardLinesWhere` and the line
 * state is `LINE_STATE_SQL` — the exact expressions the dashboard counts with — so a
 * dashboard part and this grid's Total can never disagree.
 */
import { sql, type SQL } from 'drizzle-orm';
import type { AppDb } from '@/server/api/db';
import type { AuthContext } from '@/server/auth/context';
import { BACKLOG_VIEW_STATUSES } from '@/lib/grid-defs/orders/shipment-orders';
import { ORDER_LINES_DEF } from '@/lib/grid-defs/reports/order-lines';
import {
  dashboardDays,
  dashboardLinesWhere,
  dashboardZone,
  LINE_STATE_SQL,
  type DashboardDays,
} from './dashboard-live';
import { runReport, warehouseLabel, type ReportPage, type ReportQuery } from './reports-grid';

type Row = Record<string, unknown>;

/** A backlog-view order is "Backlog" (Partially Shipped included); anything else matched the shipped-today half. */
const BACKLOG_IN = sql.raw(`(${BACKLOG_VIEW_STATUSES.map((s) => `'${s.replace(/'/g, "''")}'`).join(', ')})`);

export function orderLinesSql(auth: AuthContext, days: DashboardDays = dashboardDays('UTC')): SQL {
  const need = sql.raw('(l.quantity - COALESCE(l.cancelled_quantity, 0))');
  return sql`
    SELECT l.id AS "rowId", shipment_orders.id AS "orderId", shipment_orders.code AS "orderCode", '/orders/' || shipment_orders.id AS "orderHref",
           shipment_orders.status AS "orderStatus",
           CASE WHEN shipment_orders.status IN ${BACKLOG_IN} THEN 'Backlog' ELSE 'Shipped Today' END AS "progressScope",
           shipment_orders.warehouse_id AS "warehouseId", ${warehouseLabel('w')} AS "warehouse",
           shipment_orders.client_id AS "clientId", c.name AS "client",
           p.sku AS "sku", p.name AS "productName", '/products/' || p.id AS "productHref", l.pack_type AS "packType",
           ${need} AS "requiredQty", l.picked_quantity AS "pickedQty", l.packed_quantity AS "packedQty",
           GREATEST(${need} - l.picked_quantity, 0) AS "remainingToPick", GREATEST(${need} - l.packed_quantity, 0) AS "remainingToPack",
           ${LINE_STATE_SQL} AS "lineState",
           shipment_orders.order_date AS "orderDate", shipment_orders.expected_ship_date AS "expectedShipDate"
    FROM order_lines l
    JOIN shipment_orders ON shipment_orders.id = l.order_id
    JOIN products p ON p.id = l.product_id
    JOIN warehouses w ON w.id = shipment_orders.warehouse_id
    LEFT JOIN clients c ON c.id = shipment_orders.client_id
    WHERE ${dashboardLinesWhere(auth.viewScope, [], days)}`;
}

/**
 * The business day of "Shipped Today": the zone of the warehouses the grid is filtered to (the
 * dashboard drilldown always carries its selection), else of the viewer's warehouses — the
 * same rule as the dashboard, so a part and the grid it opens agree after 7-8 PM local too.
 */
export async function orderLinesDays(
  db: AppDb,
  auth: AuthContext,
  query: ReportQuery,
  now: Date = new Date(),
): Promise<DashboardDays> {
  const f = query.filters.find((x) => x.field === 'warehouseId' && x.op === 'in');
  const picked = f && f.op === 'in' ? f.values.filter((id) => auth.viewScope.warehouseIds.includes(id)) : [];
  return dashboardDays(
    (await dashboardZone(db, picked.length ? picked : auth.viewScope.warehouseIds)).tz,
    now,
  );
}

export async function listOrderLines(
  db: AppDb,
  auth: AuthContext,
  query: ReportQuery,
): Promise<ReportPage<Row>> {
  return await runReport<Row>(
    db,
    orderLinesSql(auth, await orderLinesDays(db, auth, query)),
    ORDER_LINES_DEF,
    query,
  );
}
