/**
 * Analysis reports (M13 round 6): Inventory Aging and Location Utilization. Scoped to
 * the viewer's warehouses and clients (quantities from out-of-scope clients never count).
 */
import { sql, type SQL } from 'drizzle-orm';
import type { AppDb } from '@/server/api/db';
import type { AuthContext } from '@/server/auth/context';
import {
  AGING_BUCKETS,
  AGING_DEF,
  UTILIZATION_BANDS,
  UTILIZATION_DEF,
} from '@/lib/grid-defs/reports/analysis';
import {
  clientIn,
  inList,
  runReport,
  warehouseLabel,
  type ReportPage,
  type ReportQuery,
} from './reports-grid';
import { dbAll } from '@/server/db/sql';

type Row = Record<string, unknown>;

const lit = (s: string): string => `'${s.replace(/'/g, "''")}'`;

/** CASE expression mapping an age (days) to the bucket label; mirrors `agingBucketOf`. */
export function agingBucketCase(ageExpr: string): SQL {
  const whens = AGING_BUCKETS.filter((b) => Number.isFinite(b.max)).map(
    (b) => `WHEN ${ageExpr} <= ${b.max} THEN ${lit(b.label)}`,
  );
  const last = AGING_BUCKETS[AGING_BUCKETS.length - 1]!.label;
  return sql.raw(`CASE ${whens.join(' ')} ELSE ${lit(last)} END`);
}

/** Age in whole days, shifted into the warehouse calendar by `offsetMinutes`. */
const ageExpr = (offsetMinutes: number): string =>
  `GREATEST(trunc(EXTRACT(EPOCH FROM ((now() + interval '${offsetMinutes} minutes') - ((i.received_at)::timestamptz + interval '${offsetMinutes} minutes'))) / 86400.0)::int, 0)`;

export function agingSql(auth: AuthContext, offsetMinutes = 0): SQL {
  const off = Math.trunc(offsetMinutes);
  const age = ageExpr(off);
  return sql`
    SELECT i.id AS "rowId", i.warehouse_id AS "warehouseId", ${warehouseLabel('w')} AS "warehouse",
           i.client_id AS "clientId", c.name AS "client",
           p.sku AS "sku", p.name AS "productName", '/products/' || p.id AS "productHref",
           loc.code AS "location", '/locations/' || loc.id AS "locationHref", lp.number AS "lpNumber",
           i.lot_number AS "lotNumber", i.expiry_date AS "expiryDate", i.on_hand AS "onHand",
           i.received_at AS "receivedAt", ${sql.raw(age)} AS "ageDays", ${agingBucketCase(age)} AS "agingBucket",
           i.status AS "status"
    FROM inventory i
    JOIN products p ON p.id = i.product_id
    JOIN warehouses w ON w.id = i.warehouse_id
    JOIN locations loc ON loc.id = i.location_id
    LEFT JOIN clients c ON c.id = i.client_id
    LEFT JOIN license_plates lp ON lp.id = i.lp_id
    WHERE i.on_hand > 0
      AND ${inList(sql`i.warehouse_id`, auth.viewScope.warehouseIds)} AND ${clientIn(sql`i.client_id`, auth.viewScope.clientIds)}`;
}

/** One unit's cube in cubic inches, from the product master dimensions (0 when unknown). */
const UNIT_CUBE_SQL = sql.raw(
  '(COALESCE(p.length_in, 0) * COALESCE(p.width_in, 0) * COALESCE(p.height_in, 0))',
);

/**
 * Capacity resolution, most exact first: the location's Max Capacity Qty, its Location Product
 * Capacity (sum of SKU max qty), its cube (location volume vs the stored units' product
 * dimensions), and only then the legacy capacity units, which are a size rating (estimate).
 */
export function utilizationSql(auth: AuthContext): SQL {
  const invScope = sql`${clientIn(sql`i.client_id`, auth.viewScope.clientIds)}`;
  return sql`
    WITH used AS (
      SELECT i.location_id AS lid, SUM(i.on_hand) AS qty, COUNT(DISTINCT i.product_id) AS skus,
             COUNT(DISTINCT i.lp_id) AS lps,
             SUM(i.on_hand * ${UNIT_CUBE_SQL}) AS cube,
             SUM(CASE WHEN ${UNIT_CUBE_SQL} > 0 THEN i.on_hand ELSE 0 END) AS dim_qty
      FROM inventory i JOIN products p ON p.id = i.product_id
      WHERE i.on_hand > 0 AND ${inList(sql`i.warehouse_id`, auth.viewScope.warehouseIds)} AND ${invScope}
      GROUP BY i.location_id
    ), pcap AS (
      -- Location Product Capacity (min/max per SKU and pack type), in units.
      SELECT lpc.location_id AS lid,
             SUM(lpc.max_qty * COALESCE((SELECT MAX(pt.uom_qty) FROM product_pack_types pt WHERE pt.product_id = lpc.product_id AND pt.pack_type = lpc.pack_type), 1)) AS max_units
      FROM location_product_capacity lpc WHERE lpc.max_qty > 0 GROUP BY lpc.location_id
    ), src AS (
      SELECT l.id AS lid, l.warehouse_id AS wid, l.code AS code, l.zone AS zone, l.area_type AS area_type,
             l.location_type AS location_type, l.capacity_type AS capacity_type, l.volume AS volume,
             COALESCE(u.qty, 0) AS qty, COALESCE(u.skus, 0) AS skus, COALESCE(u.lps, 0) AS lps,
             COALESCE(u.cube, 0) AS cube,
             CASE WHEN l.max_capacity_qty > 0 THEN 'Max Capacity Qty'
                  WHEN COALESCE(pc.max_units, 0) > 0 THEN 'Product Max Qty'
                  WHEN l.volume > 0 AND COALESCE(u.dim_qty, 0) = COALESCE(u.qty, 0) THEN 'Cube (volume)'
                  WHEN l.capacity_units > 0 THEN 'Legacy Capacity Units (estimate)'
                  ELSE 'Not Set' END AS cap_source,
             l.max_capacity_qty AS mcq, pc.max_units AS pmax, l.capacity_units AS legacy
      FROM locations l LEFT JOIN used u ON u.lid = l.id LEFT JOIN pcap pc ON pc.lid = l.id
      WHERE l.is_active = true AND ${inList(sql`l.warehouse_id`, auth.viewScope.warehouseIds)}
    ), base AS (
      SELECT s.*,
             CASE s.cap_source
               WHEN 'Max Capacity Qty' THEN s.mcq
               WHEN 'Product Max Qty' THEN s.pmax
               -- Cube: how many units of the stored mix fit the location's volume.
               WHEN 'Cube (volume)' THEN CASE WHEN s.qty > 0 AND s.cube > 0 THEN trunc(s.volume * s.qty / s.cube)::int END
               WHEN 'Legacy Capacity Units (estimate)' THEN s.legacy
             END AS cap,
             CASE s.cap_source
               WHEN 'Cube (volume)' THEN ROUND((s.cube * 100.0::float8 / s.volume)::numeric, 1)::float8
               WHEN 'Max Capacity Qty' THEN ROUND((s.qty * 100.0::float8 / s.mcq)::numeric, 1)::float8
               WHEN 'Product Max Qty' THEN ROUND((s.qty * 100.0::float8 / s.pmax)::numeric, 1)::float8
               WHEN 'Legacy Capacity Units (estimate)' THEN ROUND((s.qty * 100.0::float8 / s.legacy)::numeric, 1)::float8
             END AS pct
      FROM src s
    )
    SELECT b.lid AS "rowId", b.wid AS "warehouseId", ${warehouseLabel('w')} AS "warehouse",
           b.code AS "location", '/locations/' || b.lid AS "locationHref", b.zone AS "zone",
           b.area_type AS "areaType", b.location_type AS "locationType", b.capacity_type AS "capacityType",
           b.cap_source AS "capacitySource", CASE WHEN b.cap_source = 'Legacy Capacity Units (estimate)' THEN 1 ELSE 0 END AS "estimated",
           CASE WHEN b.cap > 0 THEN b.cap END AS "capacity", b.qty AS "usedQty",
           CASE WHEN b.cap > 0 THEN GREATEST(b.cap - b.qty, 0) END AS "freeQty",
           b.pct AS "utilizationPct",
           CASE WHEN b.volume > 0 THEN ROUND((b.cube)::numeric, 0)::float8 END AS "usedCube",
           CASE WHEN b.volume > 0 THEN ROUND((b.volume)::numeric, 0)::float8 END AS "locationCube",
           CASE
             WHEN b.qty <= 0 THEN 'Empty'
             WHEN b.pct IS NULL THEN 'No Capacity Set'
             WHEN b.pct > 100 THEN 'Over Capacity'
             WHEN b.pct >= 85 THEN 'Near Full'
             WHEN b.pct >= 25 THEN 'Healthy'
             ELSE 'Low'
           END AS "band",
           b.skus AS "skuCount", b.lps AS "lpCount"
    FROM base b JOIN warehouses w ON w.id = b.wid`;
}

export const listAging = async (db: AppDb, auth: AuthContext, q: ReportQuery): Promise<ReportPage<Row>> =>
  await runReport<Row>(db, agingSql(auth, q.tzOffsetMinutes ?? 0), AGING_DEF, q);

export const listUtilization = async (
  db: AppDb,
  auth: AuthContext,
  q: ReportQuery,
): Promise<ReportPage<Row>> => await runReport<Row>(db, utilizationSql(auth), UTILIZATION_DEF, q);

export interface UtilizationSummary {
  readonly total: number;
  readonly estimated: number;
  readonly bands: readonly { readonly band: string; readonly count: number }[];
}

/** Location count per utilization band, plus how many rows rest on estimated capacity. */
export async function utilizationSummary(db: AppDb, auth: AuthContext): Promise<UtilizationSummary> {
  const rows = await dbAll<{ band: string; n: number; est: number }>(
    db,
    sql`
    SELECT t.band AS "band", COUNT(*) AS "n", SUM(t.estimated) AS "est" FROM (${utilizationSql(auth)}) t GROUP BY t.band`,
  );
  const by = new Map(rows.map((r) => [r.band, Number(r.n)]));
  return {
    total: rows.reduce((s, r) => s + Number(r.n), 0),
    estimated: rows.reduce((s, r) => s + Number(r.est ?? 0), 0),
    bands: UTILIZATION_BANDS.map((band) => ({ band, count: by.get(band) ?? 0 })),
  };
}
