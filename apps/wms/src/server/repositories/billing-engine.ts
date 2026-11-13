/**
 * Billing engine (M11, BUILD_PLAN M11 §8). For a contract period it aggregates the
 * client's activity in the contract warehouse:
 *   receipts (Receiving, Return) · shipped orders, labels and shipment items (Shipment) ·
 *   completed picking / packing tasks (Pick & Pack) · completed work orders (Work Order) ·
 *   VAS operations (VAS) · `inventory_snapshots` (Storage: daily accumulation, peak,
 *   period end, distinct period count, average, split month) · Recurring.
 * Then it applies Charge-If conditions, graduated tiers and min/max adjustments, and
 * writes one bill with consolidated (per fee / tier) and detailed (per activity) lines.
 * Bill number `YYMMDD` + 10-digit sequence (wideBillNumber). Any failure produces a Failed
 * bill carrying the error message, so nothing is lost silently.
 */
import { eq, sql } from 'drizzle-orm';
import { evaluateConditions, type Facts } from '@/server/domain/conditions';
import { nextValue } from '@/server/domain/sequences';
import type { DomainCtx } from '@/server/domain/types';
import type { AppDb } from '@/server/api/db';
import { AppError } from '@/server/api/errors';
import * as s from '@/server/db/schema';
import {
  CUSTOM_ENTITIES,
  CUSTOM_SLOT_LABELS,
  minMaxAdjust,
  periodEnd,
  priceQuantity,
  splitOneTime,
  type CalculationType,
  type OperationType,
  type PricingMode,
} from '@/lib/grid-defs/organization/billing';
import { logCreate, logUpdate } from './clients-shared';
import { logContractEvent } from './billing';
import { dbAll, dbGet, inSavepoint } from '@/server/db/sql';

/** One unit of billable activity before pricing. */
export interface Activity {
  readonly quantity: number;
  readonly activityDate: string;
  readonly referenceNumber: string | null;
  readonly sku: string | null;
  readonly lpNumber: string | null;
  readonly facts: Facts;
  /** Split month storage: true when the alternate rate applies. */
  readonly alternate?: boolean;
}

export interface EngineFee {
  readonly id: string;
  readonly name: string;
  readonly operationType: OperationType;
  readonly calculationType: CalculationType | null;
  readonly feeBy: string;
  readonly chargeBy: string;
  readonly vasTypeId: string | null;
  readonly useMinPrice: boolean;
  readonly minPrice: number | null;
  readonly useMaxPrice: boolean;
  readonly maxPrice: number | null;
  readonly splitDay: number | null;
  readonly standardRate: number | null;
  readonly alternateRate: number | null;
  readonly conditions: readonly { field: string; comparator: string; value: unknown }[];
  readonly tiers: readonly { fromQty: number | null; toQty: number | null; rate: number }[];
  /** Recurring only: bill in the first period that charges it, never again. */
  readonly chargeOneTime?: boolean;
  /** How the period quantity is priced against the tiers (default graduated). */
  readonly pricingMode?: PricingMode;
}

export interface Period {
  /** YYYY-MM-DD inclusive. */
  readonly start: string;
  /** YYYY-MM-DD exclusive. */
  readonly end: string;
}

export interface LineOut {
  readonly feeId: string;
  readonly feeName: string;
  readonly operationType: string;
  readonly feeBy: string;
  readonly chargeBy: string;
  readonly sku: string | null;
  readonly fromQty: number | null;
  readonly toQty: number | null;
  readonly unitPrice: number;
  readonly quantity: number;
  readonly totalPrice: number;
  readonly minMaxAdjustment: number;
  readonly adjustedPrice: number;
  readonly activityDate: string | null;
  readonly referenceNumber: string | null;
  readonly lpNumber: string | null;
  readonly isDetail: boolean;
  readonly note: string | null;
}

const r2 = (n: number): number => Math.round(n * 100) / 100;
const r4 = (n: number): number => Math.round(n * 10_000) / 10_000;
const isoStart = (day: string): string => `${day}T00:00:00.000Z`;

interface Scope {
  readonly clientId: string;
  readonly warehouseId: string;
  readonly from: string;
  readonly to: string;
}

/* ---------------- facts ---------------- */

const PRODUCT_FACTS =
  sql.raw(`p.sku AS sku, p.is_fragile AS "isFragile", p.is_hazmat AS "isHazmat", p.is_kit AS "isKit", p.is_digital AS "isDigital",
  p.is_foldable AS "isFoldable", p.is_oversized AS "isOversized", p.is_insert AS "isInsert", p.is_stackable AS "isStackable", p.is_poster AS "isPoster",
  p.is_liquid AS "isLiquid", (p.product_category = 'Packaging Material') AS "isPackingMaterial", p.track_expiry AS "expiryTracking",
  p.track_lot AS "lotTracking", p.track_serial AS "serialTracking", p.weight_oz AS "productWeight",
  (p.length_in * p.width_in * p.height_in) AS "productVolume",
  (SELECT lv.name FROM lookup_values lv WHERE lv.id = p.product_type_id) AS "productType",
  (SELECT lv.name FROM lookup_values lv WHERE lv.id = p.product_group_id) AS "productGroup", p.custom_fields AS "productCustom"`);

const LOCATION_FACTS =
  sql.raw(`l.area_type AS "locationAreaType", l.color_code AS "locationColorCode", l.location_type AS "locationType",
  COALESCE((SELECT lv.name FROM lookup_values lv WHERE lv.id = l.location_zone_id), l.zone) AS "locationZone",
  (SELECT lv.name FROM lookup_values lv WHERE lv.id = l.location_group_id) AS "locationGroup", l.volume AS "locationVolume",
  l.single_client AS "onlySingleClient", l.only_one_lp AS "onlySingleLp", l.only_one_lot AS "onlySingleLot", l.only_one_sku AS "onlySingleSku",
  l.custom_fields AS "locationCustom"`);

/** Shipment order + carrier facts; needs the order aliased `so`. */
const SO_FACTS =
  sql.raw(`so.carrier AS carrier, so.rate AS "carrierRate", so.shipping_charges_billing_type AS "carrierBillingType",
  so.shipping_service AS "shipmentMethod", (SELECT sp.code FROM shipment_packages sp WHERE sp.id = so.shipment_package_id) AS "shipmentPackageType",
  (SELECT COALESCE(SUM(x.shipping_cost), 0) FROM shipments x WHERE x.order_id = so.id AND x.label_status <> 'Voided') AS "labelCost",
  (SELECT COUNT(*) FROM order_lines ol WHERE ol.order_id = so.id) AS "nofLines",
  COALESCE((SELECT lv.name FROM lookup_values lv WHERE lv.id = so.order_type_id), so.order_type) AS "shipmentOrderType",
  so.store_name AS "soStore", so.channel AS "soChannel", so.priority AS priority, so.discount AS discount, so.total_shipping_cost AS "totalShippingCost",
  so.total_weight_oz AS "soTotalWeight", so.total_quantity AS "soTotalQuantity", so.ship_country AS "shipCountry", so.ship_state AS "shipState",
  so.is_gift AS "isGift", so.is_prime AS "isPrime", so.custom_fields AS "soCustom",
  (SELECT string_agg((tg.name)::text, '|') FROM entity_tags et JOIN tags tg ON tg.id = et.tag_id WHERE et.entity_type = 'shipment_order' AND et.entity_id = so.id) AS "orderTag",
  (SELECT pl.custom_fields FROM shipment_plan_orders spo JOIN shipment_plans pl ON pl.id = spo.plan_id WHERE spo.order_id = so.id ORDER BY spo.added_at DESC LIMIT 1) AS "shipmentPlanCustom"`);

/** SO line facts; needs the order line aliased `ol`. */
const LINE_FACTS = sql.raw(
  `ol.line_note1 AS "lineNote1", ol.line_note2 AS "lineNote2", ol.line_note3 AS "lineNote3", (ol.kit_product_id IS NOT NULL) AS "isKitComponent"`,
);

type Raw = Record<string, unknown>;

const FACT_KEYS = [
  'sku',
  'isFragile',
  'isHazmat',
  'isKit',
  'isDigital',
  'isFoldable',
  'isOversized',
  'isInsert',
  'isStackable',
  'isPoster',
  'isLiquid',
  'isPackingMaterial',
  'expiryTracking',
  'lotTracking',
  'serialTracking',
  'productWeight',
  'productVolume',
  'productType',
  'productGroup',
  'locationAreaType',
  'locationColorCode',
  'locationType',
  'locationZone',
  'locationGroup',
  'locationVolume',
  'lpType',
  'onlyDamaged',
  'onlySingleClient',
  'onlySingleLp',
  'onlySingleLot',
  'onlySingleSku',
  'carrier',
  'carrierRate',
  'carrierBillingType',
  'shipmentMethod',
  'shipmentPackageType',
  'labelCost',
  'nofLines',
  'shipmentOrderType',
  'soStore',
  'soChannel',
  'priority',
  'discount',
  'totalShippingCost',
  'soTotalWeight',
  'soTotalQuantity',
  'shipCountry',
  'shipState',
  'isGift',
  'isPrime',
  'lineNote1',
  'lineNote2',
  'lineNote3',
  'isKitComponent',
] as const;
const BOOL_FACTS = new Set([
  'isFragile',
  'isHazmat',
  'isKit',
  'isDigital',
  'isFoldable',
  'isOversized',
  'isInsert',
  'isStackable',
  'isPoster',
  'isLiquid',
  'isPackingMaterial',
  'expiryTracking',
  'lotTracking',
  'serialTracking',
  'onlyDamaged',
  'onlySingleClient',
  'onlySingleLp',
  'onlySingleLot',
  'onlySingleSku',
  'isGift',
  'isPrime',
  'isKitComponent',
]);
const CUSTOM_COLUMNS: Readonly<Record<(typeof CUSTOM_ENTITIES)[number]['entity'], string>> = {
  location: 'locationCustom',
  lpType: 'lpTypeCustom',
  product: 'productCustom',
  shipmentPlan: 'shipmentPlanCustom',
  so: 'soCustom',
};

function parseJson(v: unknown): Record<string, unknown> {
  if (v && typeof v === 'object') return v as Record<string, unknown>;
  if (typeof v !== 'string' || !v) return {};
  try {
    const o: unknown = JSON.parse(v);
    return o && typeof o === 'object' ? (o as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function factsOf(row: Raw): Facts {
  const out: Record<string, string | number | boolean | null> = {};
  for (const k of FACT_KEYS) {
    if (!(k in row)) continue;
    const v = row[k];
    out[k] = BOOL_FACTS.has(k) ? Boolean(v) : (v as string | number | null);
  }
  if ('productVolume' in out) out.totalVolume = Number(row.productVolume ?? 0) * Number(row.qty ?? 1);
  for (const e of CUSTOM_ENTITIES) {
    const col = CUSTOM_COLUMNS[e.entity];
    if (!(col in row)) continue;
    const values = parseJson(row[col]);
    for (const slot of CUSTOM_SLOT_LABELS) {
      const v = values[slot.slot];
      out[`cf.${e.entity}.${slot.slot}`] =
        slot.type === 'boolean'
          ? v === true || v === 'true'
          : v === undefined || v === null
            ? null
            : String(v);
    }
  }
  const facts: Record<string, Facts[string]> = out;
  if (typeof row.orderTag === 'string' && row.orderTag) facts.orderTag = row.orderTag.split('|');
  else if ('orderTag' in row) facts.orderTag = [];
  return facts;
}

const day = (iso: unknown): string => String(iso ?? '').slice(0, 10);
const num = (v: unknown): number => Number(v ?? 0) || 0;
const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));

/* ---------------- collectors ---------------- */

async function receipts(db: AppDb, sc: Scope, types: readonly string[]): Promise<Raw[]> {
  return await dbAll<Raw>(
    db,
    sql`SELECT r.id, r.received_at AS at, r.uom_quantity AS qty, r.quantity AS "packQty", r.product_id AS "productId", r.purchase_order_id AS "poId",
      r.purchase_order_line_id AS "poLineId", r.return_order_id AS "rmaId", r.shipment_order_id AS "soId", r.lp_id AS "lpId", r.damage_reason AS damage,
      (SELECT po.code FROM purchase_orders po WHERE po.id = r.purchase_order_id) AS "poCode",
      (SELECT ro.rma_code FROM return_orders ro WHERE ro.id = r.return_order_id) AS "rmaCode",
      (SELECT so.code FROM shipment_orders so WHERE so.id = COALESCE(r.shipment_order_id, (SELECT ro.shipment_order_id FROM return_orders ro WHERE ro.id = r.return_order_id))) AS "soCode",
      (SELECT lp.number FROM license_plates lp WHERE lp.id = r.lp_id) AS "lpNumber",
      (SELECT lt.code FROM license_plates lp JOIN lp_types lt ON lt.id = lp.lp_type_id WHERE lp.id = r.lp_id) AS "lpType",
      (SELECT lt.custom_fields FROM license_plates lp JOIN lp_types lt ON lt.id = lp.lp_type_id WHERE lp.id = r.lp_id) AS "lpTypeCustom",
      ${PRODUCT_FACTS}, ${LOCATION_FACTS}
    FROM receipts r JOIN products p ON p.id = r.product_id LEFT JOIN locations l ON l.id = r.location_id
    WHERE r.client_id = ${sc.clientId} AND r.warehouse_id = ${sc.warehouseId} AND r.cancelled_at IS NULL
      AND r.received_at >= ${sc.from} AND r.received_at < ${sc.to}
      AND r.type IN (${sql.join(
        types.map((t) => sql`${t}`),
        sql`, `,
      )})
    ORDER BY r.received_at, r.master_id`,
  );
}

const act = (row: Raw, quantity: number, ref: unknown, extra: Partial<Activity> = {}): Activity => ({
  quantity,
  activityDate: day(row.at),
  referenceNumber: str(ref),
  sku: str(row.sku),
  lpNumber: str(row.lpNumber),
  facts: { ...factsOf(row), onlyDamaged: Boolean(row.damage) },
  ...extra,
});

/**
 * Distinct-key rollup: one activity per key (first row's facts), quantity 1. Only SKU-keyed
 * rollups keep the SKU; an SO / PO / LP / RMA-level charge covers many SKUs, so its line
 * carries none (showing the first line's SKU implied a per-SKU charge).
 */
function distinct(
  rows: readonly Raw[],
  key: (r: Raw) => unknown,
  ref: (r: Raw) => unknown,
  keepSku = false,
): Activity[] {
  const seen = new Map<string, Activity>();
  for (const r of rows) {
    const k = key(r);
    if (k === null || k === undefined || k === '') continue;
    const id = String(k);
    if (!seen.has(id)) seen.set(id, act(r, 1, ref(r), keepSku ? {} : { sku: null }));
  }
  return [...seen.values()];
}

async function receivingActivity(db: AppDb, sc: Scope, fee: EngineFee): Promise<Activity[]> {
  const rows = (await receipts(db, sc, ['Purchase Order', 'Product Receive'])).filter((r) => matches(fee, r));
  switch (fee.feeBy) {
    case 'Per LP':
      return distinct(
        rows,
        (r) => r.lpId,
        (r) => r.poCode,
      );
    case 'Per PO':
      return distinct(
        rows,
        (r) => r.poId,
        (r) => r.poCode,
      );
    case 'Per SKU':
      return distinct(
        rows,
        (r) => `${r.poId ?? r.id}|${r.productId}`,
        (r) => r.poCode,
        true,
      );
    case 'Per Volume':
      return rows.map((r) => act(r, r4(num(r.qty) * num(r.productVolume)), r.poCode));
    case 'Per Receiving Line':
      return distinct(
        rows,
        (r) => r.poLineId ?? r.id,
        (r) => r.poCode,
        true,
      );
    default:
      return rows.map((r) =>
        act(r, fee.chargeBy === 'Product (Pack Quantity)' ? num(r.packQty) : num(r.qty), r.poCode),
      );
  }
}

async function returnActivity(db: AppDb, sc: Scope, fee: EngineFee): Promise<Activity[]> {
  const rows = (await receipts(db, sc, ['Return'])).filter((r) => matches(fee, r));
  switch (fee.feeBy) {
    case 'Per RMA':
      return distinct(
        rows,
        (r) => r.rmaId ?? r.id,
        (r) => r.rmaCode,
      );
    case 'Per SO':
      return distinct(
        rows,
        (r) => r.soCode,
        (r) => r.soCode,
      );
    case 'Per SKU':
      return distinct(
        rows,
        (r) => `${r.rmaId ?? r.id}|${r.productId}`,
        (r) => r.rmaCode,
        true,
      );
    default:
      return rows.map((r) => act(r, num(r.qty), r.rmaCode ?? r.soCode));
  }
}

async function taskActivity(db: AppDb, sc: Scope, fee: EngineFee): Promise<Activity[]> {
  const type = fee.feeBy === 'Per Picking' ? 'Picking' : 'Packing';
  const rows = (
    await dbAll<Raw>(
      db,
      sql`SELECT t.id, t.finished_at AS at, t.actual_qty AS qty, t.product_id AS "productId", t.order_id AS "orderId",
      COALESCE((SELECT pt.uom_qty FROM product_pack_types pt WHERE pt.product_id = t.product_id AND pt.pack_type = t.pack_type LIMIT 1), 1) AS "packUom",
      so.code AS "soCode",
      (SELECT lp.number FROM license_plates lp WHERE lp.id = COALESCE(t.target_lp_id, t.source_lp_id)) AS "lpNumber",
      ${PRODUCT_FACTS}, ${LOCATION_FACTS}, ${SO_FACTS}, ${LINE_FACTS}
    FROM tasks t JOIN products p ON p.id = t.product_id LEFT JOIN locations l ON l.id = t.source_location_id
      LEFT JOIN shipment_orders so ON so.id = t.order_id
      LEFT JOIN order_lines ol ON ol.id = (SELECT ol2.id FROM order_lines ol2 WHERE ol2.order_id = t.order_id AND ol2.product_id = t.product_id LIMIT 1)
    WHERE t.client_id = ${sc.clientId} AND t.warehouse_id = ${sc.warehouseId} AND t.task_type = ${type} AND t.status = 'Completed'
      AND t.finished_at >= ${sc.from} AND t.finished_at < ${sc.to} AND t.actual_qty > 0
    ORDER BY t.finished_at, t.task_no`,
    )
  ).filter((r) => matches(fee, r));
  switch (fee.chargeBy) {
    case 'SO':
      return distinct(
        rows,
        (r) => r.orderId,
        (r) => r.soCode,
      );
    case 'SKU':
      return distinct(
        rows,
        (r) => `${r.orderId}|${r.productId}`,
        (r) => r.soCode,
        true,
      );
    case 'Product (Pack Quantity)':
      return rows.map((r) => act(r, r2(num(r.qty) / Math.max(1, num(r.packUom))), r.soCode));
    default:
      return rows.map((r) => act(r, num(r.qty), r.soCode));
  }
}

async function shipmentActivity(db: AppDb, sc: Scope, fee: EngineFee): Promise<Activity[]> {
  if (fee.feeBy === 'Per SO') {
    const rows = (
      await dbAll<Raw>(
        db,
        sql`SELECT so.id, so.shipped_at AS at, so.code AS "soCode", ${SO_FACTS} FROM shipment_orders so
      WHERE so.client_id = ${sc.clientId} AND so.warehouse_id = ${sc.warehouseId} AND so.shipped_at >= ${sc.from} AND so.shipped_at < ${sc.to} AND so.deleted_at IS NULL
      ORDER BY so.shipped_at`,
      )
    ).filter((r) => matches(fee, r));
    return rows.map((r) => act(r, 1, r.soCode));
  }
  if (fee.feeBy === 'Per Product') {
    const rows = (
      await dbAll<Raw>(
        db,
        sql`SELECT si.id, so.shipped_at AS at, si.quantity AS qty, si.product_id AS "productId", so.id AS "orderId", so.code AS "soCode",
        COALESCE((SELECT pt.uom_qty FROM product_pack_types pt WHERE pt.product_id = si.product_id AND pt.pack_type = si.pack_type LIMIT 1), 1) AS "packUom",
        ${PRODUCT_FACTS}, ${SO_FACTS}, ${LINE_FACTS}
      FROM shipment_items si JOIN shipments sh ON sh.id = si.shipment_id JOIN shipment_orders so ON so.id = sh.order_id JOIN products p ON p.id = si.product_id
        LEFT JOIN order_lines ol ON ol.id = si.order_line_id
      WHERE sh.client_id = ${sc.clientId} AND sh.warehouse_id = ${sc.warehouseId} AND so.shipped_at >= ${sc.from} AND so.shipped_at < ${sc.to} AND sh.label_status <> 'Voided'
      ORDER BY so.shipped_at`,
      )
    ).filter((r) => matches(fee, r));
    if (fee.chargeBy === 'SKU')
      return distinct(
        rows,
        (r) => `${r.orderId}|${r.productId}`,
        (r) => r.soCode,
        true,
      );
    // Kit: kit products shipped as the parent; Component: lines exploded from a kit (order_lines.kit_product_id).
    if (fee.chargeBy === 'Kit (UOM Quantity)')
      return rows
        .filter((r) => Boolean(r.isKit) && !r.isKitComponent)
        .map((r) => act(r, num(r.qty), r.soCode));
    if (fee.chargeBy === 'Component (UOM Quantity)')
      return rows.filter((r) => Boolean(r.isKitComponent)).map((r) => act(r, num(r.qty), r.soCode));
    return rows.map((r) =>
      act(
        r,
        fee.chargeBy === 'Product (Pack Quantity)'
          ? r2(num(r.qty) / Math.max(1, num(r.packUom)))
          : num(r.qty),
        r.soCode,
      ),
    );
  }
  const rows = (
    await dbAll<Raw>(
      db,
      sql`SELECT sh.id, COALESCE(so.shipped_at, sh.label_created_at) AS at, so.code AS "soCode", sh.tracking_number AS tracking, sh.shipment_package_id AS pkg,
      ${SO_FACTS}
    FROM shipments sh JOIN shipment_orders so ON so.id = sh.order_id
    WHERE sh.client_id = ${sc.clientId} AND sh.warehouse_id = ${sc.warehouseId} AND sh.label_status <> 'Voided' AND sh.label_type = 'Shipping Label'
      AND COALESCE(so.shipped_at, sh.label_created_at) >= ${sc.from} AND COALESCE(so.shipped_at, sh.label_created_at) < ${sc.to}
    ORDER BY at`,
    )
  ).filter((r) => matches(fee, r));

  const list = fee.feeBy === 'Shipment Package' ? rows.filter((r) => r.pkg) : rows;
  return list.map((r) => ({ ...act(r, 1, r.soCode), lpNumber: str(r.tracking) }));
}

async function workOrderActivity(db: AppDb, sc: Scope, fee: EngineFee): Promise<Activity[]> {
  const rows = (
    await dbAll<Raw>(
      db,
      sql`SELECT wo.id, wo.actual_finish_at AS at, wo.code AS "woCode", wo.processed_qty AS qty,
      (SELECT COALESCE(SUM(c.component_qty), 0) FROM work_order_components c WHERE c.work_order_id = wo.id) AS "perKit", ${PRODUCT_FACTS}
    FROM work_orders wo JOIN products p ON p.id = wo.kit_product_id
    WHERE wo.client_id = ${sc.clientId} AND wo.warehouse_id = ${sc.warehouseId} AND wo.status = 'Completed'
      AND wo.actual_finish_at >= ${sc.from} AND wo.actual_finish_at < ${sc.to}
    ORDER BY wo.actual_finish_at`,
    )
  ).filter((r) => matches(fee, r));
  if (fee.feeBy === 'Per Kit') return rows.map((r) => act(r, num(r.qty), r.woCode));
  if (fee.feeBy === 'Per Component') return rows.map((r) => act(r, num(r.qty) * num(r.perKit), r.woCode));
  return rows.map((r) => act(r, 1, r.woCode));
}

async function vasActivity(db: AppDb, sc: Scope, fee: EngineFee): Promise<Activity[]> {
  if (!fee.vasTypeId) return [];
  const rows = await dbAll<Raw>(
    db,
    sql`SELECT v.id, v.operation_at AS at, v.value AS qty, v.calculation_type AS calc, v.reference_number AS ref, v.note,
      (SELECT lv.name FROM lookup_values lv WHERE lv.id = v.vas_type_id) AS "vasType"
    FROM vas_operations v WHERE v.client_id = ${sc.clientId} AND v.warehouse_id = ${sc.warehouseId} AND v.vas_type_id = ${fee.vasTypeId}
      AND v.operation_at >= ${sc.from} AND v.operation_at < ${sc.to} ORDER BY v.operation_at`,
  );
  return rows.map((r) => ({
    ...act(r, num(r.qty), r.ref ?? r.vasType),
    facts: { totalPrice: r.calc === 'Total Price' },
  }));
}

/* ---------------- storage ---------------- */

async function storageRows(db: AppDb, sc: Scope, fee: EngineFee): Promise<Raw[]> {
  return (
    await dbAll<Raw>(
      db,
      sql`SELECT sn.snapshot_at AS at, substr(sn.snapshot_at, 1, 10) AS d, sn.location_id AS "locationId", sn.lp_id AS "lpId", sn.parent_lp_id AS "parentLpId",
      sn.uom_qty AS qty, sn.damage_reason AS damage, l.code AS "locationCode",
      (SELECT lp.number FROM license_plates lp WHERE lp.id = sn.lp_id) AS "lpNumber",
      (SELECT lp.number FROM license_plates lp WHERE lp.id = sn.parent_lp_id) AS "parentLpNumber",
      (SELECT lt.code FROM license_plates lp JOIN lp_types lt ON lt.id = lp.lp_type_id WHERE lp.id = sn.lp_id) AS "lpType",
      (SELECT lt.custom_fields FROM license_plates lp JOIN lp_types lt ON lt.id = lp.lp_type_id WHERE lp.id = sn.lp_id) AS "lpTypeCustom",
      ${PRODUCT_FACTS}, ${LOCATION_FACTS}
    FROM inventory_snapshots sn JOIN products p ON p.id = sn.product_id LEFT JOIN locations l ON l.id = sn.location_id
    WHERE sn.client_id = ${sc.clientId} AND sn.warehouse_id = ${sc.warehouseId} AND sn.snapshot_at >= ${sc.from} AND sn.snapshot_at < ${sc.to} AND sn.uom_qty > 0
    ORDER BY sn.snapshot_at`,
    )
  ).filter((r) => matches(fee, { ...r, damage: r.damage }));
}

function storageKey(fee: EngineFee, r: Raw): string | null {
  switch (fee.feeBy) {
    case 'LP':
      return str(r.lpId);
    case 'Parent LP':
      return str(r.parentLpId);
    case 'Location':
      return str(r.locationId);
    default:
      return null;
  }
}
function storageLabel(fee: EngineFee, r: Raw): { ref: string | null; lp: string | null } {
  if (fee.feeBy === 'LP') return { ref: str(r.locationCode), lp: str(r.lpNumber) };
  if (fee.feeBy === 'Parent LP') return { ref: str(r.locationCode), lp: str(r.parentLpNumber) };
  return { ref: str(r.locationCode), lp: null };
}

/** Per-day metric: distinct keys, units or volume. */
function dailyMetric(fee: EngineFee, rows: readonly Raw[]): number {
  if (fee.feeBy === 'Product') return rows.reduce((n, r) => n + num(r.qty), 0);
  if (fee.feeBy === 'Total Volume')
    return r4(rows.reduce((n, r) => n + num(r.qty) * num(r.productVolume), 0));
  return new Set(rows.map((r) => storageKey(fee, r)).filter(Boolean)).size;
}

export async function storageActivity(db: AppDb, sc: Scope, fee: EngineFee): Promise<Activity[]> {
  const rows = await storageRows(db, sc, fee);
  if (rows.length === 0) return [];
  const byDay = new Map<string, Raw[]>();
  for (const r of rows) byDay.set(String(r.d), [...(byDay.get(String(r.d)) ?? []), r]);
  const days = [...byDay.keys()].sort();
  const metric = (d: string) => dailyMetric(fee, byDay.get(d) ?? []);
  const calc = fee.calculationType ?? 'At Period End';
  const note = (d: string) => `${calc}: snapshot ${d}`;
  const keyed = (list: readonly Raw[], d: string, extra: Partial<Activity> = {}): Activity[] => {
    if (fee.feeBy === 'Product' || fee.feeBy === 'Total Volume')
      return [
        {
          quantity: metric(d),
          activityDate: d,
          referenceNumber: note(d),
          sku: null,
          lpNumber: null,
          facts: {},
          ...extra,
        },
      ];
    const seen = new Map<string, Activity>();
    for (const r of list) {
      const k = storageKey(fee, r);
      if (!k || seen.has(k)) continue;
      const label = storageLabel(fee, r);
      seen.set(k, {
        quantity: 1,
        activityDate: d,
        referenceNumber: label.ref,
        sku: null,
        lpNumber: label.lp,
        facts: {},
        ...extra,
      });
    }
    return [...seen.values()];
  };
  switch (calc) {
    case 'Daily Accumulation':
      return days.flatMap((d) => keyed(byDay.get(d) ?? [], d));
    case 'At Peak Inventory': {
      const peak = days.reduce((best, d) => (metric(d) > metric(best) ? d : best), days[0]!);
      return keyed(byDay.get(peak) ?? [], peak);
    }
    case 'Average Calculation': {
      const avg = r2(days.reduce((n, d) => n + metric(d), 0) / days.length);
      return [
        {
          quantity: avg,
          activityDate: days[days.length - 1]!,
          referenceNumber: `Average of ${days.length} daily snapshots`,
          sku: null,
          lpNumber: null,
          facts: {},
        },
      ];
    }
    case 'Distinct Period Count':
      return keyed(rows, days[days.length - 1]!);
    case 'Split Month Storage': {
      const first = new Map<string, Raw>();
      for (const r of rows) {
        const k = storageKey(fee, r);
        if (k && !first.has(k)) first.set(k, r);
      }
      const splitDay = fee.splitDay ?? 15;
      const periodFirstDay = days[0]!;
      return [...first.values()].map((r) => {
        const d = String(r.d);
        const label = storageLabel(fee, r);
        // Carried-over LPs (present on the first snapshot) bill at standard; first receipts after the split day at alternate.
        const alternate = d !== periodFirstDay && Number(d.slice(8, 10)) > splitDay;
        return {
          quantity: 1,
          activityDate: d,
          referenceNumber: label.ref,
          sku: null,
          lpNumber: label.lp,
          facts: {},
          alternate,
        };
      });
    }
    default:
      return keyed(byDay.get(days[days.length - 1]!) ?? [], days[days.length - 1]!);
  }
}

/* ---------------- conditions + pricing ---------------- */

function matches(fee: EngineFee, row: Raw): boolean {
  if (fee.conditions.length === 0) return true;
  const facts = { ...factsOf(row), onlyDamaged: Boolean(row.damage) };
  return evaluateConditions(fee.conditions as never, facts, 'All');
}

/**
 * True when a live bill already carries this fee (Charge One Time): Successful, not Canceled,
 * with a positive line — and never the bill being recalculated in place (`exceptReportId`).
 */
export async function alreadyCharged(db: AppDb, feeId: string, exceptReportId?: string): Promise<boolean> {
  return Boolean(
    await dbGet<{ one: number }>(
      db,
      sql`SELECT 1 AS one FROM billing_report_lines li JOIN billing_reports br ON br.id = li.report_id
    WHERE li.fee_id = ${feeId} AND br.id <> ${exceptReportId ?? ''} AND br.calc_status = 'Successful' AND br.bill_status <> 'Canceled'
      AND li.total_price > 0 LIMIT 1`,
    ),
  );
}

export async function collect(
  db: AppDb,
  sc: Scope,
  fee: EngineFee,
  contractName: string,
  opts: { readonly exceptReportId?: string } = {},
): Promise<Activity[]> {
  switch (fee.operationType) {
    case 'Recurring':
      if (fee.chargeOneTime && (await alreadyCharged(db, fee.id, opts.exceptReportId))) return [];
      return [
        {
          quantity: 1,
          activityDate: sc.from.slice(0, 10),
          referenceNumber: contractName,
          sku: null,
          lpNumber: null,
          facts: {},
        },
      ];
    case 'Receiving':
      return await receivingActivity(db, sc, fee);
    case 'Return':
      return await returnActivity(db, sc, fee);
    case 'Pick & Pack':
      return await taskActivity(db, sc, fee);
    case 'Shipment':
      return await shipmentActivity(db, sc, fee);
    case 'Work Order':
      return await workOrderActivity(db, sc, fee);
    case 'VAS':
      return await vasActivity(db, sc, fee);
    case 'Storage':
      return await storageActivity(db, sc, fee);
    default:
      return [];
  }
}

/** Prices one fee's activity: consolidated lines (per tier part) plus detailed lines. */
export function priceFee(fee: EngineFee, activity: readonly Activity[]): { lines: LineOut[]; total: number } {
  const base = {
    feeId: fee.id,
    feeName: fee.name,
    operationType: fee.operationType,
    feeBy: fee.feeBy,
    chargeBy: fee.chargeBy,
  };
  const lines: LineOut[] = [];
  const detail = (a: Activity, unitPrice: number, total: number): LineOut => ({
    ...base,
    sku: a.sku,
    fromQty: null,
    toQty: null,
    unitPrice: r4(unitPrice),
    quantity: r4(a.quantity),
    totalPrice: r2(total),
    minMaxAdjustment: 0,
    adjustedPrice: r2(total),
    activityDate: a.activityDate || null,
    referenceNumber: a.referenceNumber,
    lpNumber: a.lpNumber,
    isDetail: true,
    note: null,
  });
  const consolidated: {
    fromQty: number | null;
    toQty: number | null;
    unitPrice: number;
    quantity: number;
    total: number;
    note: string | null;
  }[] = [];

  if (fee.operationType === 'VAS' && activity.some((a) => a.facts.totalPrice === true)) {
    // "Total Price" VAS types carry their own price; quantity types use the rate.
    const rate = fee.tiers[0]?.rate ?? fee.standardRate ?? 0;
    let total = 0;
    let qty = 0;
    for (const a of activity) {
      const amount = a.facts.totalPrice === true ? a.quantity : a.quantity * rate;
      total += amount;
      qty += a.facts.totalPrice === true ? 1 : a.quantity;
      lines.push(
        detail(
          a.facts.totalPrice === true ? { ...a, quantity: 1 } : a,
          a.facts.totalPrice === true ? a.quantity : rate,
          amount,
        ),
      );
    }
    consolidated.push({
      fromQty: null,
      toQty: null,
      unitPrice: qty ? total / qty : 0,
      quantity: qty,
      total: r2(total),
      note: 'Total-price VAS operations billed at their own value',
    });
  } else if (fee.calculationType === 'Split Month Storage') {
    const std = fee.standardRate ?? 0;
    const alt = fee.alternateRate ?? 0;
    const stdQty = activity.filter((a) => !a.alternate).length;
    const altQty = activity.length - stdQty;
    for (const a of activity)
      lines.push({
        ...detail(a, a.alternate ? alt : std, a.alternate ? alt : std),
        note: a.alternate ? 'Alternate rate (after split day)' : 'Standard rate',
      });
    if (stdQty)
      consolidated.push({
        fromQty: null,
        toQty: null,
        unitPrice: std,
        quantity: stdQty,
        total: r2(stdQty * std),
        note: `Standard rate (days 1-${fee.splitDay ?? 15})`,
      });
    if (altQty)
      consolidated.push({
        fromQty: null,
        toQty: null,
        unitPrice: alt,
        quantity: altQty,
        total: r2(altQty * alt),
        note: `Alternate rate (days ${(fee.splitDay ?? 15) + 1}-end)`,
      });
    // Every fee on the contract shows on the bill, even with nothing to charge.
    if (!stdQty && !altQty)
      consolidated.push({
        fromQty: null,
        toQty: null,
        unitPrice: std,
        quantity: 0,
        total: 0,
        note: 'No activity in this period',
      });
  } else {
    const mode: PricingMode = fee.pricingMode ?? 'graduated';
    const qty = r4(activity.reduce((n, a) => n + a.quantity, 0));
    const tiers = fee.tiers.length ? fee.tiers : [{ fromQty: 1, toQty: null, rate: fee.standardRate ?? 0 }];
    const { parts } = priceQuantity(qty, tiers, mode);
    const ranged = tiers.length > 1 || mode === 'fromQuantity';
    for (const p of parts)
      consolidated.push({
        fromQty: ranged ? p.fromQty : null,
        toQty: ranged ? p.toQty : null,
        unitPrice: p.rate,
        quantity: p.quantity,
        total: p.amount,
        note: mode === 'tierBase' && tiers.length > 1 ? "Tier base: all units at this tier's rate" : null,
      });
    if (mode === 'tierBase') {
      // Volume pricing: every activity carries the rate of the tier the period total lands in.
      const rate = parts[0]?.rate ?? 0;
      for (const a of activity) lines.push(detail(a, rate, r2(a.quantity * rate)));
    } else {
      // Detailed lines consume threshold / tier capacity in activity order.
      let cursor = 0;
      for (const a of activity) {
        const before = priceQuantity(cursor, tiers, mode).total;
        cursor = r4(cursor + a.quantity);
        const amount = r2(priceQuantity(cursor, tiers, mode).total - before);
        lines.push(detail(a, a.quantity ? amount / a.quantity : 0, amount));
      }
    }
    if (parts.length === 0)
      consolidated.push({
        fromQty: null,
        toQty: null,
        unitPrice: tiers[0]?.rate ?? 0,
        quantity: qty,
        total: 0,
        note:
          qty > 0
            ? `Below the charge-from quantity (${tiers[0]?.fromQty ?? 1})`
            : fee.operationType === 'Recurring' && fee.chargeOneTime
              ? 'One-time fee already billed'
              : 'No activity in this period',
      });
  }

  const raw = r2(consolidated.reduce((n, c) => n + c.total, 0));
  const adjustment = minMaxAdjust(raw, fee);
  consolidated.forEach((c, i) => {
    const adj = i === consolidated.length - 1 ? adjustment : 0;
    lines.push({
      ...base,
      sku: null,
      fromQty: c.fromQty,
      toQty: c.toQty,
      unitPrice: r4(c.unitPrice),
      quantity: r4(c.quantity),
      totalPrice: r2(c.total),
      minMaxAdjustment: adj,
      adjustedPrice: r2(c.total + adj),
      activityDate: null,
      referenceNumber: null,
      lpNumber: null,
      isDetail: false,
      note: adj
        ? adj > 0
          ? `Minimum price ${fee.minPrice?.toFixed(2)} applied`
          : `Maximum price ${fee.maxPrice?.toFixed(2)} applied`
        : c.note,
    });
  });
  return { lines, total: r2(raw + adjustment) };
}

/* ---------------- run ---------------- */

export async function loadEngineFees(db: AppDb, contractId: string): Promise<EngineFee[]> {
  const fees = await db.select().from(s.billingFees).where(eq(s.billingFees.contractId, contractId));
  const tiers = await db.select().from(s.billingFeeTiers);
  return fees.map((f) => ({
    id: f.id,
    name: f.name,
    operationType: f.operationType,
    calculationType: f.calculationType,
    feeBy: normalizeFeeBy(f.operationType, f.feeBy),
    chargeBy: normalizeChargeBy(f.chargeBy),
    vasTypeId: f.vasTypeId,
    useMinPrice: Boolean(f.useMinPrice),
    minPrice: f.minPrice,
    useMaxPrice: Boolean(f.useMaxPrice),
    maxPrice: f.maxPrice,
    splitDay: f.splitDay,
    standardRate: f.standardRate,
    alternateRate: f.alternateRate,
    ...splitOneTime(f.conditions),
    chargeOneTime:
      f.operationType === 'Recurring' &&
      (Boolean(f.chargeOneTime) || splitOneTime(f.conditions).chargeOneTime),
    tiers: tiers
      .filter((t) => t.feeId === f.id)
      .sort((a, b) => (a.fromQty ?? 0) - (b.fromQty ?? 0))
      .map((t) => ({ fromQty: t.fromQty, toQty: t.toQty, rate: t.rate })),
  }));
}

/** Legacy/seeded values ("Order", "Unit") map onto the Logiwa matrix. */
function normalizeFeeBy(op: OperationType, feeBy: string): string {
  if (feeBy === 'Order') return op === 'Return' ? 'Per SO' : op === 'Pick & Pack' ? 'Per Packing' : 'Per SO';
  if (feeBy === 'Unit')
    return op === 'Pick & Pack' ? 'Per Picking' : op === 'Storage' ? 'Product' : 'Per Product';
  return feeBy;
}
function normalizeChargeBy(chargeBy: string): string {
  if (chargeBy === 'Per Order') return 'SO';
  if (chargeBy === 'Per Unit') return 'Product (UOM Quantity)';
  if (chargeBy === 'Per Day') return 'Location';
  return chargeBy;
}

export interface CalcResult {
  readonly reportId: string;
  readonly billNumber: string;
  readonly status: 'Successful' | 'Failed';
  readonly totalPrice: number;
  readonly errorMessage: string | null;
}

/**
 * Bill number: `YYMMDD` + a 10-digit daily sequence (16 digits, as Logiwa) so the
 * system is never capped at 999 bills a day.
 */
export async function wideBillNumber(tx: AppDb, at: Date = new Date()): Promise<string> {
  const p = (v: number) => String(v).padStart(2, '0');
  const ymd = `${p(at.getUTCFullYear() % 100)}${p(at.getUTCMonth() + 1)}${p(at.getUTCDate())}`;
  // Data Setup › Code generation can set a prefix and the sequence length via the global "billNumber" row (REQ R2-9).
  const fmt = await dbGet<{ prefix: string; padding: number }>(
    tx,
    sql`SELECT prefix, padding FROM code_sequences WHERE key = 'billNumber' AND warehouse_id = '*'`,
  );
  const padding = Math.min(12, Math.max(3, fmt?.padding ?? 10));
  // Edit Info may have taken a number the daily sequence has not issued yet; skip any value already in use.
  for (let attempt = 0; attempt < 10_000; attempt++) {
    const candidate = `${fmt?.prefix ?? ''}${ymd}${String(await nextValue(tx, `bill16:${ymd}`)).padStart(padding, '0')}`;
    const taken = await dbGet<{ one: number }>(
      tx,
      sql`SELECT 1 AS one FROM billing_reports WHERE bill_number = ${candidate} LIMIT 1`,
    );
    if (!taken) return candidate;
  }
  throw new AppError(
    'CONFLICT',
    'Could not allocate a free bill number for today. Check Data Setup › Code generation for the bill number format.',
  );
}

const usDate = (d: string): string => {
  const [y, m, day] = d.split('-');
  return `${m}/${day}/${y}`;
};

/** A Successful, non-canceled bill of the contract (other than `exceptId`) sharing a day with [start, endInclusive]. */
export async function overlappingBill(
  tx: AppDb,
  contractId: string,
  start: string,
  endInclusive: string,
  exceptId?: string,
): Promise<{ id: string; billNumber: string; billStatus: string } | undefined> {
  return (
    (await dbGet<{ id: string; billNumber: string; billStatus: string }>(
      tx,
      sql`SELECT id, bill_number AS "billNumber", bill_status AS "billStatus" FROM billing_reports
    WHERE contract_id = ${contractId} AND id <> ${exceptId ?? ''} AND bill_status <> 'Canceled' AND calc_status = 'Successful'
      AND substr(period_start, 1, 10) <= ${endInclusive} AND substr(period_end, 1, 10) >= ${start} LIMIT 1`,
    )) ?? undefined
  );
}

export const BILL_PERIOD_GUARD = 'KS_BILL_PERIOD_OVERLAP';

/**
 * DB-level guarantee (REQ R2-16): triggers refuse any insert or update that would leave two
 * Successful, non-canceled bills of one contract sharing a day. They are owned by migration
 * `0001_billing_period_guard` (raises `KS_BILL_PERIOD_OVERLAP`); nothing is created at runtime.
 */
export async function ensureBillGuards(_tx: AppDb): Promise<void> {
  // Kept for callers; the migration installs the triggers.
}
const addDays = (d: string, n: number): string =>
  new Date(Date.parse(`${d.slice(0, 10)}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Computes then writes one bill for the period. Never throws for calculation errors.
 * With `replaceReportId` the period's existing Draft bill is recalculated in place
 * (same id and bill number, lines rewritten): one bill per period, as Logiwa.
 */
export async function calculateContract(
  tx: AppDb,
  ctx: DomainCtx,
  contractId: string,
  period: Period,
  now: Date = new Date(),
  opts: { readonly replaceReportId?: string } = {},
): Promise<CalcResult> {
  const contract = (
    await tx.select().from(s.billingContracts).where(eq(s.billingContracts.id, contractId)).limit(1)
  )[0];
  if (!contract) throw new Error('Billing contract not found');
  const client = (
    await tx
      .select({ currency: s.clients.currency })
      .from(s.clients)
      .where(eq(s.clients.id, contract.clientId))
      .limit(1)
  )[0];
  const sc: Scope = {
    clientId: contract.clientId,
    warehouseId: contract.warehouseId,
    from: isoStart(period.start),
    to: isoStart(period.end),
  };
  let lines: LineOut[] = [];
  let total = 0;
  let error: string | null = null;
  try {
    // A savepoint: a failing collector query must not abort the enclosing transaction (Postgres).
    await inSavepoint(tx, async (sp) => {
      const fees = await loadEngineFees(sp, contractId);
      if (fees.length === 0) throw new Error('The contract has no fees');
      for (const fee of fees) {
        const priced = priceFee(
          fee,
          await collect(sp, sc, fee, contract.name, { exceptReportId: opts.replaceReportId }),
        );
        lines = [...lines, ...priced.lines];
        total = r2(total + priced.total);
      }
    });
  } catch (e) {
    error = e instanceof Error ? e.message : 'Calculation failed';
    lines = [];
    total = 0;
  }
  const periodEndIso = new Date(Date.parse(sc.to) - 1).toISOString();
  await ensureBillGuards(tx);
  // Last line of defence on every write path (Calculate, scheduler, a stale dry run): one live bill per contract period.
  if (!error) {
    const clash = await overlappingBill(
      tx,
      contractId,
      sc.from.slice(0, 10),
      periodEndIso.slice(0, 10),
      opts.replaceReportId,
    );
    if (clash)
      throw new AppError(
        'DUPLICATE',
        `${clash.billStatus} bill ${clash.billNumber} already covers part of this period. Replace or cancel it before billing the period again.`,
      );
  }
  const existing = opts.replaceReportId
    ? (
        await tx
          .select({
            id: s.billingReports.id,
            billNumber: s.billingReports.billNumber,
            totalPrice: s.billingReports.totalPrice,
          })
          .from(s.billingReports)
          .where(eq(s.billingReports.id, opts.replaceReportId))
          .limit(1)
      )[0]
    : undefined;
  const number = existing?.billNumber ?? (await wideBillNumber(tx, now));
  const values = {
    calcStatus: error ? ('Failed' as const) : ('Successful' as const),
    calculatedAt: now.toISOString(),
    periodStart: sc.from,
    periodEnd: periodEndIso,
    billStatus: 'Draft' as const,
    totalPrice: total,
    currency: client?.currency ?? 'USD',
    errorMessage: error,
  };
  let report: { id: string };
  if (existing) {
    await tx.delete(s.billingReportLines).where(eq(s.billingReportLines.reportId, existing.id));
    await tx
      .update(s.billingReports)
      .set({ ...values, updatedBy: ctx.userId, version: sql`${s.billingReports.version} + 1` })
      .where(eq(s.billingReports.id, existing.id));
    report = { id: existing.id };
  } else {
    report = (
      await tx
        .insert(s.billingReports)
        .values({
          ...values,
          contractId,
          billNumber: number,
          clientId: contract.clientId,
          warehouseId: contract.warehouseId,
          createdBy: ctx.userId,
        })
        .returning({ id: s.billingReports.id })
    )[0];
  }
  for (let i = 0; i < lines.length; i += 200) {
    await tx
      .insert(s.billingReportLines)
      .values(lines.slice(i, i + 200).map((l) => ({ ...l, reportId: report.id })));
  }
  const prevCalc = contract.lastCalculatedAt;
  // Only a full, contract-aligned period advances the schedule; custom / to-date previews do not.
  const fullPeriod = periodEnd(period.start, contract.frequency) === period.end;
  const nextStart =
    fullPeriod && period.end > (contract.nextPeriodStart ?? '') ? period.end : contract.nextPeriodStart;
  // A failed run neither stamps Last calculation nor advances the schedule.
  if (!error)
    await tx
      .update(s.billingContracts)
      .set({ lastCalculatedAt: now.toISOString(), nextPeriodStart: nextStart })
      .where(eq(s.billingContracts.id, contractId));
  if (existing)
    await logUpdate(
      tx,
      ctx,
      'billing_report',
      report.id,
      number,
      { totalPrice: existing.totalPrice },
      { totalPrice: total, recalculatedAt: now.toISOString() },
    );
  else await logCreate(tx, ctx, 'billing_report', report.id, number);
  await logContractEvent(tx, ctx, contractId, contract.name, {
    type: 'Update',
    field: 'lastCalculatedAt',
    from: prevCalc ?? '',
    to: now.toISOString(),
    message: `${existing ? 'Recalculated' : 'Calculated'} bill ${number} for ${usDate(period.start)} to ${usDate(addDays(period.end, -1))}${error ? ` (failed: ${error})` : ''}.`,
  });
  return {
    reportId: report.id,
    billNumber: number,
    status: error ? 'Failed' : 'Successful',
    totalPrice: total,
    errorMessage: error,
  };
}
