/**
 * Orders-group reports (spec 07): Channel Sales and Order Inventory. Both are scoped to
 * the viewer's warehouse/client view scope (header context narrows it).
 */
import { sql, type SQL } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import type { AuthContext } from "@/server/auth/context";
import { serializeGridQuery, type GridFilter, type GridQuery } from "@/server/query/grid-query";
import { CHANNEL_SALES_DEF, ORDER_INVENTORY_DEF } from "@/lib/grid-defs/reports/orders";
import { clientIn, inList, runReport, warehouseLabel, type ReportPage } from "./reports-grid";

type Row = Record<string, unknown>;

const SHIPPED = sql.raw(`('Shipped','Partially Shipped','Delivered')`);

/**
 * Channel Sales: one row per Warehouse × Client × Channel × Store × SKU × pack type,
 * aggregated from shipped order lines; the Warehouse is the shipping warehouse (Logiwa
 * leaves it empty). Channel listings that never sold are rows with Has Sales = No and no
 * warehouse (none shipped them, so none is attributed); the page hides them by default.
 */
export function channelSalesSql(auth: AuthContext): SQL {
  const wh = auth.viewScope.warehouseIds;
  const cl = auth.viewScope.clientIds;
  return sql`
    WITH sales AS (
      SELECT o.warehouse_id AS wid, o.client_id AS cid, o.channel AS channel, COALESCE(o.store_name, '') AS store,
             l.product_id AS pid, l.pack_type AS pack,
             SUM(COALESCE(NULLIF(l.shipped_quantity, 0), l.quantity - COALESCE(l.cancelled_quantity, 0)) * COALESCE(l.uom_ratio, 1)) AS sold,
             COUNT(DISTINCT o.id) AS orders,
             ROUND(SUM(COALESCE(NULLIF(l.shipped_quantity, 0), l.quantity - COALESCE(l.cancelled_quantity, 0)) * COALESCE(l.unit_price, 0)), 2) AS revenue,
             MAX(o.shipped_at) AS last_at
      FROM shipment_orders o JOIN order_lines l ON l.order_id = o.id
      WHERE o.status IN ${SHIPPED} AND o.deleted_at IS NULL
        AND ${inList(sql`o.warehouse_id`, wh)} AND ${clientIn(sql`o.client_id`, cl)}
      GROUP BY 1, 2, 3, 4, 5, 6
    ),
    listings AS (
      SELECT pl.client_id AS cid, CASE cc.provider WHEN 'shopify' THEN 'Shopify' WHEN 'shipstation' THEN 'ShipStation' WHEN 'amazon' THEN 'Amazon'
               WHEN 'walmart' THEN 'Walmart' WHEN 'tiktok' THEN 'TikTok Shop' ELSE cc.provider END AS channel,
             cc.store_name AS store, pl.product_id AS pid
      FROM product_listings pl JOIN channel_connections cc ON cc.id = pl.channel_connection_id
      WHERE ${clientIn(sql`pl.client_id`, cl)}
    ),
    unsold AS (
      SELECT NULL AS wid, ls.cid, ls.channel, ls.store, ls.pid, p.uom AS pack, 0 AS sold, 0 AS orders, 0 AS revenue, NULL AS last_at
      FROM listings ls JOIN products p ON p.id = ls.pid
      WHERE NOT EXISTS (SELECT 1 FROM sales s WHERE s.cid = ls.cid AND s.pid = ls.pid AND lower(s.store) = lower(ls.store))
        AND ${wh.length > 0 ? sql`1 = 1` : sql`0 = 1`}
    ),
    rowsx AS (SELECT * FROM sales UNION ALL SELECT * FROM unsold)
    SELECT COALESCE(r.wid, '-') || ':' || r.cid || ':' || COALESCE(r.channel, '') || ':' || r.store || ':' || r.pid || ':' || r.pack AS "rowId",
           r.wid AS "warehouseId", CASE WHEN r.wid IS NULL THEN 'Not sold yet' ELSE ${warehouseLabel("w")} END AS "warehouse",
           CASE WHEN r.orders > 0 THEN 1 ELSE 0 END AS "hasSales",
           r.cid AS "clientId", c.name AS "client",
           NULLIF(r.channel, '') AS "channel", NULLIF(r.store, '') AS "storeName",
           p.sku AS "sku", p.name AS "productName", p.barcode AS "barcode", r.pack AS "packType",
           r.sold AS "soldQty", r.orders AS "shipmentOrderCount", r.revenue AS "revenue", r.last_at AS "lastShippedAt",
           '/products/' || p.id AS "productHref",
           r.orders AS "ordersForHref"
    FROM rowsx r
    LEFT JOIN warehouses w ON w.id = r.wid
    JOIN clients c ON c.id = r.cid
    JOIN products p ON p.id = r.pid`;
}

export function listChannelSales(db: AppDb, auth: AuthContext, query: GridQuery): ReportPage<Row> {
  const page = runReport<Row>(db, channelSalesSql(auth), CHANNEL_SALES_DEF, query);
  return {
    rows: page.rows.map(({ ordersForHref, ...r }) => ({ ...r, hasSales: Boolean(r.hasSales), ordersHref: Number(ordersForHref) > 0 ? channelSalesOrdersHref(r) : null })),
    total: page.total,
  };
}

/**
 * Drilldown for "# Shipment Orders": the shipped-orders grid filtered on the row's warehouse,
 * client, SKU, channel AND store, so the opened grid's total equals the cell even when a client
 * runs two stores on one channel. Values are escaped by the grid grammar (spaces, commas, &).
 */
export function channelSalesOrdersHref(r: Readonly<Record<string, unknown>>): string {
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const filters: GridFilter[] = [
    { field: "warehouseId", op: "in", values: [str(r.warehouseId)] },
    { field: "clientId", op: "in", values: [str(r.clientId)] },
    { field: "sku", op: "eq", value: str(r.sku) },
  ];
  if (str(r.channel)) filters.push({ field: "channel", op: "in", values: [str(r.channel)] });
  filters.push(str(r.storeName) ? { field: "storeName", op: "eq", value: str(r.storeName) } : { field: "storeName", op: "empty" });
  return `/orders/shipped?${serializeGridQuery({ filters })}`;
}

/** Order Inventory: one row per active allocation record (order line × inventory bucket). */
export function orderInventorySql(auth: AuthContext): SQL {
  return sql`
    SELECT a.id AS "rowId",
           o.code AS "orderCode", '/orders/' || o.id AS "orderHref",
           i.warehouse_id AS "warehouseId", ${warehouseLabel("w")} AS "warehouse",
           o.client_id AS "clientId", c.name AS "client",
           o.store_order_number AS "storeOrderNumber",
           j.code AS "jobCode", CASE WHEN j.id IS NOT NULL THEN '/jobs/' || j.id END AS "jobHref",
           wo.code AS "workOrderCode", CASE WHEN wo.id IS NOT NULL THEN '/work-orders/' || wo.id END AS "workOrderHref",
           COALESCE(wv.wave_no, j.wave_number) AS "waveNo", CASE WHEN COALESCE(wv.wave_no, j.wave_number) IS NOT NULL THEN '/jobs/wave-log?f.waveNo=eq:' || COALESCE(wv.wave_no, j.wave_number) END AS "waveHref",
           p.sku AS "sku", '/products/' || p.id AS "productHref",
           COALESCE(ol.pack_type, i.pack_type) AS "packType", p.uom AS "uomPackType", p.barcode AS "barcode",
           a.qty AS "allocatedUomQty",
           CAST(a.qty / MAX(COALESCE(ol.uom_ratio, 1), 1) AS INTEGER) AS "allocatedPackQty",
           i.status AS "inventoryStatus",
           loc.code AS "location", '/locations/' || loc.id AS "locationHref",
           lp.number AS "lpNumber", plp.number AS "parentLp",
           lp.original_number AS "originalLp", plp.original_number AS "originalParentLp",
           plt.code AS "parentLpType",
           i.lot_number AS "lotNumber", i.expiry_date AS "expiryDate", i.damage_reason AS "damageReason",
           i.po_number AS "poNumber", i.production_date AS "productionDate", i.received_at AS "receivedAt",
           lp.weight AS "lpWeight", lp.height AS "lpHeight", lp.length AS "lpLength", lp.width AS "lpWidth"
    FROM inventory_allocations a
    JOIN inventory i ON i.id = a.inventory_id
    LEFT JOIN shipment_orders o ON o.id = a.order_id
    LEFT JOIN order_lines ol ON ol.id = a.order_line_id
    LEFT JOIN work_orders wo ON wo.id = a.work_order_id
    LEFT JOIN jobs j ON j.id = a.job_id
    LEFT JOIN waves wv ON wv.id = a.wave_id
    JOIN products p ON p.id = i.product_id
    JOIN clients c ON c.id = COALESCE(o.client_id, i.client_id)
    JOIN warehouses w ON w.id = i.warehouse_id
    JOIN locations loc ON loc.id = i.location_id
    LEFT JOIN license_plates lp ON lp.id = i.lp_id
    LEFT JOIN license_plates plp ON plp.id = lp.parent_lp_id
    LEFT JOIN lp_types plt ON plt.id = plp.lp_type_id
    WHERE a.status NOT IN ('Shipped', 'Cancelled') AND (o.id IS NOT NULL OR wo.id IS NOT NULL)
      AND ${inList(sql`i.warehouse_id`, auth.viewScope.warehouseIds)} AND ${clientIn(sql`COALESCE(o.client_id, i.client_id)`, auth.viewScope.clientIds)}`;
}

export function listOrderInventory(db: AppDb, auth: AuthContext, query: GridQuery): ReportPage<Row> {
  return runReport<Row>(db, orderInventorySql(auth), ORDER_INVENTORY_DEF, query);
}
