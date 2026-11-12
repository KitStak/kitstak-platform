/**
 * Charge If value pickers (M11 fee form): the real values an attribute can take for a
 * contract's client + warehouse, merged from master data (carriers, shipment packages,
 * lookup types, LP types, enums) and the values that occur on the client's activity.
 * Typing a value that never occurs would silently make a fee never charge, so the
 * condition modal picks from this list.
 */
import { sql, type SQL } from 'drizzle-orm';
import type { AppDb } from '@/server/api/db';
import type { AuthContext } from '@/server/auth/context';
import {
  AREA_TYPES,
  BILLING_PARTY_TYPES,
  LOCATION_TYPES,
  ORDER_CHANNELS,
  ORDER_TYPES,
  PRIORITIES,
} from '@/lib/enums';
import { isLookupChargeIf } from '@/lib/grid-defs/organization/billing';
import { loadContract } from './billing';
import { dbAll } from '@/server/db/sql';

export interface ChargeIfValue {
  readonly value: string;
  readonly source: 'Master data' | 'In use';
}

const col = async (db: AppDb, q: SQL): Promise<string[]> =>
  (await dbAll<{ v: string | null }>(db, q)).map((r) => r.v ?? '').filter((v) => v.trim() !== '');

async function sources(
  db: AppDb,
  field: string,
  clientId: string,
  warehouseId: string,
): Promise<{ master: readonly string[]; used: readonly string[] }> {
  const so = sql`FROM shipment_orders so WHERE so.client_id = ${clientId} AND so.warehouse_id = ${warehouseId} AND so.deleted_at IS NULL`;
  const lookup = async (type: string) =>
    await col(
      db,
      sql`SELECT name AS v FROM lookup_values WHERE type = ${type} AND is_active = true
    AND (client_id IS NULL OR client_id = ${clientId}) AND (warehouse_id IS NULL OR warehouse_id = ${warehouseId}) ORDER BY sort_order, name`,
    );
  switch (field) {
    case 'carrier':
      return {
        master: [
          ...(await col(
            db,
            sql`SELECT DISTINCT provider AS v FROM carrier_connections WHERE warehouse_id = ${warehouseId} AND is_active = true`,
          )),
          ...(await lookup('custom_carrier')),
        ],
        used: await col(db, sql`SELECT DISTINCT so.carrier AS v ${so} LIMIT 500`),
      };
    case 'shipmentMethod':
      return {
        master: await col(
          db,
          sql`SELECT DISTINCT cs.service_code AS v FROM carrier_services cs JOIN carrier_connections cc ON cc.id = cs.connection_id WHERE cc.warehouse_id = ${warehouseId} AND cs.is_active = true`,
        ),
        used: await col(db, sql`SELECT DISTINCT so.shipping_service AS v ${so} LIMIT 500`),
      };
    case 'shipmentPackageType':
      return {
        master: await col(db, sql`SELECT DISTINCT code AS v FROM shipment_packages ORDER BY code`),
        used: await col(
          db,
          sql`SELECT DISTINCT (SELECT sp.code FROM shipment_packages sp WHERE sp.id = so.shipment_package_id) AS v ${so} LIMIT 500`,
        ),
      };
    case 'carrierBillingType':
      return {
        master: BILLING_PARTY_TYPES,
        used: await col(db, sql`SELECT DISTINCT so.shipping_charges_billing_type AS v ${so}`),
      };
    case 'shipmentOrderType':
      return {
        master: [...ORDER_TYPES, ...(await lookup('so_type'))],
        used: await col(
          db,
          sql`SELECT DISTINCT COALESCE((SELECT lv.name FROM lookup_values lv WHERE lv.id = so.order_type_id), so.order_type) AS v ${so}`,
        ),
      };
    case 'soStore':
      return {
        master: [],
        used: await col(db, sql`SELECT DISTINCT so.store_name AS v ${so} ORDER BY 1 LIMIT 500`),
      };
    case 'soChannel':
      return { master: ORDER_CHANNELS, used: await col(db, sql`SELECT DISTINCT so.channel AS v ${so}`) };
    case 'priority':
      return { master: PRIORITIES, used: [] };
    case 'shipCountry':
      return {
        master: [],
        used: await col(db, sql`SELECT DISTINCT so.ship_country AS v ${so} ORDER BY 1 LIMIT 500`),
      };
    case 'shipState':
      return {
        master: [],
        used: await col(db, sql`SELECT DISTINCT so.ship_state AS v ${so} ORDER BY 1 LIMIT 500`),
      };
    case 'orderTag':
      return {
        master: await col(db, sql`SELECT DISTINCT name AS v FROM tags ORDER BY name LIMIT 500`),
        used: [],
      };
    case 'locationAreaType':
      return { master: AREA_TYPES, used: [] };
    case 'locationType':
      return {
        master: LOCATION_TYPES,
        used: await col(
          db,
          sql`SELECT DISTINCT location_type AS v FROM locations WHERE warehouse_id = ${warehouseId}`,
        ),
      };
    case 'locationZone':
      return {
        master: await lookup('location_zone'),
        used: await col(
          db,
          sql`SELECT DISTINCT zone AS v FROM locations WHERE warehouse_id = ${warehouseId} ORDER BY 1 LIMIT 500`,
        ),
      };
    case 'locationGroup':
      return { master: await lookup('location_group'), used: [] };
    case 'lpType':
      return { master: await col(db, sql`SELECT DISTINCT code AS v FROM lp_types ORDER BY code`), used: [] };
    case 'productType':
      return { master: await lookup('product_type'), used: [] };
    case 'productGroup':
      return { master: await lookup('product_group'), used: [] };
    default:
      return { master: [], used: [] };
  }
}

/** Values for one lookup-backed Charge If attribute, master data first (case-insensitive de-dupe). */
export async function chargeIfValues(
  db: AppDb,
  auth: AuthContext,
  contractId: string,
  field: string,
): Promise<ChargeIfValue[]> {
  if (!isLookupChargeIf(field)) return [];
  const contract = await loadContract(db, auth, contractId);
  const { master, used } = await sources(db, field, contract.clientId, contract.warehouseId);
  const seen = new Set<string>();
  const out: ChargeIfValue[] = [];
  for (const [list, source] of [
    [master, 'Master data'],
    [used, 'In use'],
  ] as const) {
    for (const v of list) {
      const k = v.trim().toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ value: v.trim(), source });
    }
  }
  return out;
}
