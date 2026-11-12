/**
 * Inventory-group reports (spec 07): Serial Number Report (Tracking, Shipment History,
 * Receiving History), Dynamic Replenishment and Inventory Snapshot. Scoped to viewScope.
 */
import { sql, type SQL } from 'drizzle-orm';
import type { AppDb } from '@/server/api/db';
import type { AuthContext } from '@/server/auth/context';
import type { GridQuery } from '@/server/query/grid-query';
import { BACKLOG_VIEW_STATUSES } from '@/lib/grid-defs/orders/shipment-orders';
import {
  REPLENISHMENT_DEF,
  SERIAL_RECEIPTS_DEF,
  SERIAL_SHIPMENTS_DEF,
  SERIAL_TRACKING_DEF,
  SNAPSHOT_DEF,
} from '@/lib/grid-defs/reports/inventory';
import { isValidTimeZone, localParts } from '@/server/scheduler/timezone';
import { clientIn, inList, runReport, warehouseLabel, type ReportPage } from './reports-grid';
import { dbAll } from '@/server/db/sql';

type Row = Record<string, unknown>;

const scoped = (auth: AuthContext, wh: string, cl: string): SQL =>
  sql`${inList(sql.raw(wh), auth.viewScope.warehouseIds)} AND ${clientIn(sql.raw(cl), auth.viewScope.clientIds)}`;

const OPEN_STATUSES = sql.raw(
  `(${BACKLOG_VIEW_STATUSES.map((s) => `'${s.replace(/'/g, "''")}'`).join(', ')})`,
);

/* ------------------------------------------------------------------ serials */

export function serialTrackingSql(auth: AuthContext): SQL {
  return sql`
    SELECT s.id AS "rowId", s.warehouse_id AS "warehouseId", ${warehouseLabel('w')} AS "warehouse",
           s.client_id AS "clientId", c.name AS "client",
           p.sku AS "sku", p.name AS "productName", '/products/' || p.id AS "productHref",
           s.primary_serial AS "primarySerial", s.secondary_serial AS "secondarySerial",
           CASE WHEN s.status IN ('Shipped') THEN NULL ELSE loc.code END AS "location",
           CASE WHEN s.status IN ('Shipped') OR loc.id IS NULL THEN NULL ELSE '/locations/' || loc.id END AS "locationHref",
           COALESCE(so.code, po.code, CASE WHEN r.id IS NOT NULL THEN 'Receipt ' || r.master_id END) AS "lastReference",
           CASE WHEN so.id IS NOT NULL THEN '/orders/' || so.id WHEN po.id IS NOT NULL THEN '/receiving/' || po.id END AS "referenceHref",
           s.entry_at AS "entryAt", s.status AS "status"
    FROM serial_numbers s
    JOIN products p ON p.id = s.product_id
    JOIN clients c ON c.id = s.client_id
    JOIN warehouses w ON w.id = s.warehouse_id
    LEFT JOIN inventory i ON i.id = s.inventory_id
    LEFT JOIN locations loc ON loc.id = i.location_id
    LEFT JOIN shipments sh ON sh.id = s.shipment_id
    LEFT JOIN shipment_orders so ON so.id = sh.order_id
    LEFT JOIN receipts r ON r.id = s.receipt_id
    LEFT JOIN purchase_orders po ON po.id = r.purchase_order_id
    WHERE ${scoped(auth, 's.warehouse_id', 's.client_id')}`;
}

export function serialShipmentsSql(auth: AuthContext): SQL {
  return sql`
    SELECT st.id AS "rowId", p.sku AS "sku", p.name AS "productName", '/products/' || p.id AS "productHref",
           s.primary_serial AS "primarySerial", s.secondary_serial AS "secondarySerial",
           o.code AS "orderCode", '/orders/' || o.id AS "orderHref", o.store_order_number AS "storeOrderNumber",
           t.from_lot AS "lotNumber", t.from_expiry AS "expiryDate", t.from_pack_type AS "packType", p.barcode AS "barcode",
           COALESCE(sh.actual_shipment_at, o.shipped_at, st.at) AS "shippedAt",
           COALESCE(ot.name, o.order_type) AS "orderType", o.note AS "note",
           t.warehouse_id AS "warehouseId", ${warehouseLabel('w')} AS "warehouse", t.client_id AS "clientId", c.name AS "client",
           fl.code AS "location", flp.number AS "lpNumber", fplp.number AS "parentLp",
           COALESCE(sh.carrier_code, o.carrier) AS "carrier", COALESCE(sh.tracking_number, o.tracking_number) AS "trackingNumber"
    FROM serial_transactions st
    JOIN inventory_transactions t ON t.id = st.inventory_transaction_id
    JOIN serial_numbers s ON s.id = st.serial_id
    JOIN products p ON p.id = s.product_id
    JOIN clients c ON c.id = t.client_id
    JOIN warehouses w ON w.id = t.warehouse_id
    LEFT JOIN shipments sh ON sh.id = t.shipment_id
    LEFT JOIN shipment_orders o ON o.id = COALESCE(t.order_id, sh.order_id)
    LEFT JOIN lookup_values ot ON ot.id = o.order_type_id
    LEFT JOIN locations fl ON fl.id = t.from_location_id
    LEFT JOIN license_plates flp ON flp.id = t.from_lp_id
    LEFT JOIN license_plates fplp ON fplp.id = t.from_parent_lp_id
    WHERE t.type = 'Shipment' AND ${scoped(auth, 't.warehouse_id', 't.client_id')}`;
}

export function serialReceiptsSql(auth: AuthContext): SQL {
  return sql`
    SELECT st.id AS "rowId", CAST(r.master_id AS TEXT) AS "receiptId",
           p.sku AS "sku", p.name AS "productName", p.barcode AS "barcode", '/products/' || p.id AS "productHref",
           po.code AS "poCode", CASE WHEN po.id IS NOT NULL THEN '/receiving/' || po.id END AS "poHref",
           s.primary_serial AS "primarySerial", s.secondary_serial AS "secondarySerial",
           r.lot_number AS "lotNumber", r.expiry_date AS "expiryDate", r.pack_type AS "packType",
           r.type AS "receivingType", r.received_at AS "receivedAt", po.po_type AS "poType", COALESCE(r.line_note, r.note) AS "note",
           r.warehouse_id AS "warehouseId", ${warehouseLabel('w')} AS "warehouse", r.client_id AS "clientId", c.name AS "client",
           loc.code AS "location", lp.number AS "lpNumber", plp.number AS "parentLp", r.damage_reason AS "damageReason",
           COALESCE(u.name, r.received_by) AS "receivedBy", COALESCE(v.display_name, po.vendor_name) AS "vendor"
    FROM serial_transactions st
    JOIN inventory_transactions t ON t.id = st.inventory_transaction_id
    JOIN receipts r ON r.id = t.receipt_id
    JOIN serial_numbers s ON s.id = st.serial_id
    JOIN products p ON p.id = s.product_id
    JOIN clients c ON c.id = r.client_id
    JOIN warehouses w ON w.id = r.warehouse_id
    LEFT JOIN purchase_orders po ON po.id = r.purchase_order_id
    LEFT JOIN vendors v ON v.id = po.vendor_id
    LEFT JOIN locations loc ON loc.id = r.location_id
    LEFT JOIN license_plates lp ON lp.id = r.lp_id
    LEFT JOIN license_plates plp ON plp.id = r.parent_lp_id
    LEFT JOIN users u ON u.email = r.received_by OR u.id = r.received_by
    WHERE t.type IN ('Receiving', 'Return Receiving') AND ${scoped(auth, 'r.warehouse_id', 'r.client_id')}`;
}

export const listSerialTracking = async (
  db: AppDb,
  auth: AuthContext,
  q: GridQuery,
): Promise<ReportPage<Row>> => await runReport<Row>(db, serialTrackingSql(auth), SERIAL_TRACKING_DEF, q);
export const listSerialShipments = async (
  db: AppDb,
  auth: AuthContext,
  q: GridQuery,
): Promise<ReportPage<Row>> => await runReport<Row>(db, serialShipmentsSql(auth), SERIAL_SHIPMENTS_DEF, q);
export const listSerialReceipts = async (
  db: AppDb,
  auth: AuthContext,
  q: GridQuery,
): Promise<ReportPage<Row>> => await runReport<Row>(db, serialReceiptsSql(auth), SERIAL_RECEIPTS_DEF, q);

/* ------------------------------------------------------------ replenishment */

/**
 * Dynamic Replenishment (spec 07): one row per product × warehouse with replenishment
 * levels. ToReplenish = Max + OpenOrderQty − TargetAvailable − OpenReplenishTaskQty (≥ 0).
 */
export function replenishmentSql(auth: AuthContext): SQL {
  return sql`
    WITH base AS (
      SELECT rl.product_id AS pid, rl.warehouse_id AS wid, p.client_id AS cid, rl.min_level AS min_level, rl.max_level AS max_level,
        (SELECT COALESCE(SUM(i.on_hand), 0) FROM inventory i JOIN locations l ON l.id = i.location_id
          WHERE i.product_id = rl.product_id AND i.warehouse_id = rl.warehouse_id AND l.type = 'Reserve') AS src_total,
        (SELECT COALESCE(SUM(GREATEST(i.on_hand - i.allocated - i.damaged, 0)), 0) FROM inventory i JOIN locations l ON l.id = i.location_id
          WHERE i.product_id = rl.product_id AND i.warehouse_id = rl.warehouse_id AND l.type = 'Reserve' AND i.status = 'Stock') AS src_free,
        (SELECT COALESCE(SUM(GREATEST(i.on_hand - i.allocated - i.damaged, 0)), 0) FROM inventory i JOIN locations l ON l.id = i.location_id
          WHERE i.product_id = rl.product_id AND i.warehouse_id = rl.warehouse_id AND l.type = 'Picking' AND i.status = 'Stock') AS tgt_avail,
        (SELECT COALESCE(SUM(GREATEST(ol.quantity - COALESCE(ol.shipped_quantity, 0) - COALESCE(ol.cancelled_quantity, 0), 0) * COALESCE(ol.uom_ratio, 1)), 0)
          FROM order_lines ol JOIN shipment_orders o ON o.id = ol.order_id
          WHERE ol.product_id = rl.product_id AND o.warehouse_id = rl.warehouse_id AND o.deleted_at IS NULL AND o.status IN ${OPEN_STATUSES}) AS open_qty,
        (SELECT COALESCE(SUM(t.planned_qty), 0) FROM tasks t
          WHERE t.product_id = rl.product_id AND t.warehouse_id = rl.warehouse_id AND t.task_type = 'Replenishment' AND t.status IN ('Pending', 'Started')) AS task_qty,
        p.status = 'Active' AS is_active
      FROM product_replenishment_levels rl JOIN products p ON p.id = rl.product_id
      WHERE ${inList(sql`rl.warehouse_id`, auth.viewScope.warehouseIds)} AND ${clientIn(sql`p.client_id`, auth.viewScope.clientIds)}
    )
    SELECT b.pid || ':' || b.wid AS "rowId", b.wid AS "warehouseId", ${warehouseLabel('w')} AS "warehouse",
           b.cid AS "clientId", c.name AS "client", p.sku AS "sku", p.name AS "productName", '/products/' || p.id AS "productHref",
           b.min_level AS "minLevel", b.max_level AS "maxLevel", b.src_total AS "sourceTotalQty", b.src_free AS "sourceFreeQty",
           b.tgt_avail AS "targetAvailableQty", b.open_qty AS "openOrderQty", b.task_qty AS "openReplenishTaskQty",
           GREATEST(b.max_level + b.open_qty - b.tgt_avail - b.task_qty, 0) AS "toReplenishQty", b.is_active AS "isActive"
    FROM base b JOIN products p ON p.id = b.pid JOIN clients c ON c.id = b.cid JOIN warehouses w ON w.id = b.wid`;
}

export function computeToReplenish(input: {
  max: number;
  openOrderQty: number;
  targetAvailable: number;
  openTaskQty: number;
}): number {
  return Math.max(input.max + input.openOrderQty - input.targetAvailable - input.openTaskQty, 0);
}

export const listReplenishment = async (
  db: AppDb,
  auth: AuthContext,
  q: GridQuery,
): Promise<ReportPage<Row>> => await runReport<Row>(db, replenishmentSql(auth), REPLENISHMENT_DEF, q);

/* ----------------------------------------------------------------- snapshot */

/** One snapshot run of one warehouse, stamped with its warehouse-local business day. */
export interface SnapshotRun {
  readonly warehouseId: string;
  readonly snapshotAt: string;
  /** YYYY-MM-DD in the warehouse's time zone (a late catch-up run keeps its own day). */
  readonly businessDate: string;
  /** A later run exists for the same warehouse and business day: its rows are never counted. */
  readonly superseded: boolean;
  /** The warehouse's most recent business day (the default "Latest Snapshot" view). */
  readonly latest: boolean;
}

/**
 * Classifies raw snapshot runs. Pure. One canonical run per warehouse × business day (the
 * latest of that day), so a point-in-time or billing reconciliation never counts a bucket
 * twice, and the newest business day per warehouse is flagged `latest`.
 */
export function classifySnapshotRuns(
  raw: readonly { warehouseId: string; snapshotAt: string; timezone: string | null }[],
): SnapshotRun[] {
  const withDay = raw.map((r) => {
    const zone = r.timezone && isValidTimeZone(r.timezone) ? r.timezone : 'UTC';
    const at = new Date(r.snapshotAt);
    return {
      ...r,
      businessDate: Number.isNaN(at.getTime()) ? r.snapshotAt.slice(0, 10) : localParts(at, zone).date,
    };
  });
  const canonical = new Map<string, string>();
  const latestDay = new Map<string, string>();
  for (const r of withDay) {
    const key = `${r.warehouseId}|${r.businessDate}`;
    if ((canonical.get(key) ?? '') < r.snapshotAt) canonical.set(key, r.snapshotAt);
    if ((latestDay.get(r.warehouseId) ?? '') < r.businessDate) latestDay.set(r.warehouseId, r.businessDate);
  }
  return withDay.map((r) => ({
    warehouseId: r.warehouseId,
    snapshotAt: r.snapshotAt,
    businessDate: r.businessDate,
    superseded: canonical.get(`${r.warehouseId}|${r.businessDate}`) !== r.snapshotAt,
    latest: latestDay.get(r.warehouseId) === r.businessDate,
  }));
}

/** Business days with no snapshot between a warehouse's first and last run (scheduler gaps). */
export function missingSnapshotDays(runs: readonly SnapshotRun[], warehouseId: string): string[] {
  const days = [
    ...new Set(runs.filter((r) => r.warehouseId === warehouseId).map((r) => r.businessDate)),
  ].sort();
  const out: string[] = [];
  for (let i = 1; i < days.length; i += 1) {
    const prev = Date.parse(`${days[i - 1]}T00:00:00Z`);
    const next = Date.parse(`${days[i]}T00:00:00Z`);
    for (let t = prev + 86_400_000; t < next; t += 86_400_000)
      out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

export async function snapshotRuns(db: AppDb, auth: AuthContext): Promise<SnapshotRun[]> {
  const raw = await dbAll<{ warehouseId: string; snapshotAt: string; timezone: string | null }>(
    db,
    sql`
    SELECT s.warehouse_id AS "warehouseId", s.snapshot_at AS "snapshotAt", w.timezone AS "timezone"
    FROM inventory_snapshots s JOIN warehouses w ON w.id = s.warehouse_id
    WHERE ${inList(sql.raw('s.warehouse_id'), auth.viewScope.warehouseIds)}
    GROUP BY s.warehouse_id, s.snapshot_at, w.timezone ORDER BY s.warehouse_id, s.snapshot_at`,
  );
  return classifySnapshotRuns(raw);
}

/** Inline table of the canonical runs (warehouse, run time, business day, latest flag). */
function runsTable(runs: readonly SnapshotRun[]): SQL {
  const kept = runs.filter((r) => !r.superseded);
  if (kept.length === 0)
    return sql`SELECT NULL AS warehouse_id, NULL AS snapshot_at, NULL AS business_date, 0 AS latest WHERE 0 = 1`;
  return sql.join(
    kept.map(
      (r) =>
        sql`SELECT ${r.warehouseId} AS warehouse_id, ${r.snapshotAt} AS snapshot_at, ${r.businessDate} AS business_date, ${r.latest ? 1 : 0} AS latest`,
    ),
    sql` UNION ALL `,
  );
}

export function snapshotSql(auth: AuthContext, runs: readonly SnapshotRun[] = []): SQL {
  return sql`
    SELECT s.id AS "rowId", s.warehouse_id AS "warehouseId", ${warehouseLabel('w')} AS "warehouse",
           s.client_id AS "clientId", c.name AS "client", s.snapshot_at AS "snapshotAt",
           r.business_date AS "businessDate", r.latest AS "latest",
           p.sku AS "sku", '/products/' || p.id AS "productHref",
           loc.code AS "location", '/locations/' || loc.id AS "locationHref", lp.number AS "lpNumber",
           s.uom_qty AS "uomQty", s.pack_qty AS "packQty", s.lot_number AS "lotNumber", s.expiry_date AS "expiryDate",
           s.damage_reason AS "damageReason", plp.number AS "parentLp", p.uom AS "uomPackType", s.pack_type AS "packType",
           s.status AS "status", s.production_date AS "productionDate",
           p.height_in AS "productHeight", p.length_in AS "productLength", ROUND((p.weight_oz)::numeric, 2)::float8 AS "productWeight", p.width_in AS "productWidth"
    FROM inventory_snapshots s
    JOIN (${runsTable(runs)}) r ON r.warehouse_id = s.warehouse_id AND r.snapshot_at = s.snapshot_at
    JOIN products p ON p.id = s.product_id
    JOIN clients c ON c.id = s.client_id
    JOIN warehouses w ON w.id = s.warehouse_id
    JOIN locations loc ON loc.id = s.location_id
    LEFT JOIN license_plates lp ON lp.id = s.lp_id
    LEFT JOIN license_plates plp ON plp.id = s.parent_lp_id
    WHERE ${scoped(auth, 's.warehouse_id', 's.client_id')}`;
}

export const listSnapshot = async (db: AppDb, auth: AuthContext, q: GridQuery): Promise<ReportPage<Row>> =>
  await runReport<Row>(db, snapshotSql(auth, await snapshotRuns(db, auth)), SNAPSHOT_DEF, q);

export interface SnapshotCoverage {
  readonly warehouseId: string;
  readonly warehouse: string;
  readonly latestDay: string | null;
  readonly days: number;
  /** Business days (last 30) between the first and latest run that have no snapshot. */
  readonly missingDays: readonly string[];
}

export async function snapshotCoverage(db: AppDb, auth: AuthContext): Promise<SnapshotCoverage[]> {
  const runs = await snapshotRuns(db, auth);
  const names = new Map(
    (
      await dbAll<{ id: string; label: string }>(
        db,
        sql`
    SELECT w.id AS "id", ${warehouseLabel('w')} AS "label" FROM warehouses w
    WHERE ${inList(sql.raw('w.id'), auth.viewScope.warehouseIds)}`,
      )
    ).map((w) => [w.id, w.label]),
  );
  return [...new Set(runs.map((r) => r.warehouseId))]
    .map((id) => {
      const own = runs.filter((r) => r.warehouseId === id);
      const latest = own.find((r) => r.latest)?.businessDate ?? null;
      const cutoff = latest
        ? new Date(Date.parse(`${latest}T00:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10)
        : '';
      return {
        warehouseId: id,
        warehouse: names.get(id) ?? id,
        latestDay: latest,
        days: new Set(own.map((r) => r.businessDate)).size,
        missingDays: missingSnapshotDays(runs, id).filter((d) => d >= cutoff),
      };
    })
    .sort((a, b) => a.warehouse.localeCompare(b.warehouse));
}
