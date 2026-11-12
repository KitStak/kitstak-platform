/**
 * What actually shipped on an order, per product, read from the ledger (M04 Return Process).
 * Shared by return receiving (rule enforcement) and the RMA detail (capture hints).
 */
import { sql } from 'drizzle-orm';
import type { AppDb } from '@/server/api/db';
import { dbAll } from '@/server/db/sql';

/** What actually left the warehouse for one SKU of an order (from the pick/pack/ship ledger, not the order line's request). */
export interface ShippedAttributes {
  readonly lots: readonly string[];
  readonly expiryDates: readonly string[];
  readonly productionDates: readonly string[];
  readonly packTypes: readonly string[];
  readonly serials: readonly string[];
}

export const dateOnly = (v: string | null | undefined): string | null => (v ? v.trim().slice(0, 10) : null);
const uniq = (xs: readonly (string | null | undefined)[]): string[] => [
  ...new Set(xs.filter((x): x is string => Boolean(x && x.trim())).map((x) => x.trim())),
];

/**
 * Lots, expiry / production dates, pack types and serials that shipped on the order, per product.
 * Source of truth is the ledger: Shipment transactions when the order shipped, else Packing /
 * Picking / Loading. Serials come from the serial ledger (Shipment / Packing / Picking serial
 * transactions of the order) plus serials still linked to its lines.
 */
export async function shippedAttributes(db: AppDb, orderId: string): Promise<Map<string, ShippedAttributes>> {
  const txns = await dbAll<{
    productId: string;
    type: string;
    lot: string | null;
    expiry: string | null;
    production: string | null;
    packType: string | null;
  }>(
    db,
    sql`
    SELECT product_id AS "productId", type, COALESCE(from_lot, to_lot) AS lot, COALESCE(from_expiry, to_expiry) AS expiry,
      COALESCE(from_production_date, to_production_date) AS production, COALESCE(from_pack_type, to_pack_type) AS "packType"
    FROM inventory_transactions WHERE order_id = ${orderId} AND type IN ('Shipment', 'Loading', 'Packing', 'Picking')`,
  );
  const shippedTypes = new Set(txns.filter((t) => t.type === 'Shipment').map((t) => t.productId));
  const serials = await dbAll<{ productId: string; serial: string }>(
    db,
    sql`
    SELECT DISTINCT sn.product_id AS "productId", sn.primary_serial AS serial FROM serial_transactions st
      JOIN inventory_transactions it ON it.id = st.inventory_transaction_id JOIN serial_numbers sn ON sn.id = st.serial_id
      WHERE it.order_id = ${orderId} AND st.type IN ('Shipment', 'Loading', 'Packing', 'Picking')
    UNION SELECT sn.product_id, sn.primary_serial FROM serial_numbers sn JOIN order_lines ol ON ol.id = sn.order_line_id WHERE ol.order_id = ${orderId}`,
  );
  const out = new Map<string, ShippedAttributes>();
  const products = new Set([...txns.map((t) => t.productId), ...serials.map((s) => s.productId)]);
  for (const productId of products) {
    // A SKU that shipped is judged on its Shipment rows only; picks that were later cancelled don't count.
    const rows = txns.filter(
      (t) => t.productId === productId && (!shippedTypes.has(productId) || t.type === 'Shipment'),
    );
    out.set(productId, {
      lots: uniq(rows.map((r) => r.lot)),
      expiryDates: uniq(rows.map((r) => dateOnly(r.expiry))),
      productionDates: uniq(rows.map((r) => dateOnly(r.production))),
      packTypes: uniq(rows.map((r) => r.packType)),
      serials: uniq(serials.filter((s) => s.productId === productId).map((s) => s.serial)),
    });
  }
  return out;
}
