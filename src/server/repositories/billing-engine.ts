/**
 * Billing engine (M11, BUILD_PLAN M11 §8). For a contract period it aggregates the
 * client's activity in the contract warehouse:
 *   receipts (Receiving, Return) · shipped orders, labels and shipment items (Shipment) ·
 *   completed picking / packing tasks (Pick & Pack) · completed work orders (Work Order) ·
 *   VAS operations (VAS) · `inventory_snapshots` (Storage: daily accumulation, peak,
 *   period end, distinct period count, average, split month) · Recurring.
 * Then it applies Charge-If conditions, graduated tiers and min/max adjustments, and
 * writes one bill with consolidated (per fee / tier) and detailed (per activity) lines.
 * Bill number `YYMMDD<seq>` via `sequences.billNumber`. Any failure produces a Failed
 * bill carrying the error message, so nothing is lost silently.
 */
import { eq, sql } from "drizzle-orm";
import { evaluateConditions, type Facts } from "@/server/domain/conditions";
import { billNumber } from "@/server/domain/sequences";
import type { DomainCtx } from "@/server/domain/types";
import type { AppDb } from "@/server/api/db";
import * as s from "@/server/db/schema";
import { minMaxAdjust, periodEnd, tieredAmount, type CalculationType, type OperationType } from "@/lib/grid-defs/organization/billing";
import { logCreate, logUpdate } from "./clients-shared";
import { CONTRACT_ENTITY } from "./billing";

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

interface Scope { readonly clientId: string; readonly warehouseId: string; readonly from: string; readonly to: string }

/* ---------------- facts ---------------- */

const PRODUCT_FACTS = sql.raw(`p.sku AS sku, p.is_fragile AS isFragile, p.is_hazmat AS isHazmat, p.is_kit AS isKit, p.is_digital AS isDigital,
  p.is_foldable AS isFoldable, p.is_oversized AS isOversized, p.is_insert AS isInsert, p.is_stackable AS isStackable, p.is_poster AS isPoster,
  p.is_liquid AS isLiquid, (p.product_category = 'Packaging Material') AS isPackingMaterial, p.track_expiry AS expiryTracking,
  p.track_lot AS lotTracking, p.track_serial AS serialTracking, p.weight_oz AS productWeight,
  (p.length_in * p.width_in * p.height_in) AS productVolume,
  (SELECT lv.name FROM lookup_values lv WHERE lv.id = p.product_type_id) AS productType,
  (SELECT lv.name FROM lookup_values lv WHERE lv.id = p.product_group_id) AS productGroup`);

const LOCATION_FACTS = sql.raw(`l.area_type AS locationAreaType, l.color_code AS locationColorCode, l.location_type AS locationType,
  COALESCE((SELECT lv.name FROM lookup_values lv WHERE lv.id = l.location_zone_id), l.zone) AS locationZone,
  (SELECT lv.name FROM lookup_values lv WHERE lv.id = l.location_group_id) AS locationGroup`);

type Raw = Record<string, unknown>;

const FACT_KEYS = ["sku", "isFragile", "isHazmat", "isKit", "isDigital", "isFoldable", "isOversized", "isInsert", "isStackable", "isPoster", "isLiquid",
  "isPackingMaterial", "expiryTracking", "lotTracking", "serialTracking", "productWeight", "productVolume", "productType", "productGroup",
  "locationAreaType", "locationColorCode", "locationType", "locationZone", "locationGroup", "lpType", "onlyDamaged"] as const;
const BOOL_FACTS = new Set(["isFragile", "isHazmat", "isKit", "isDigital", "isFoldable", "isOversized", "isInsert", "isStackable", "isPoster", "isLiquid", "isPackingMaterial", "expiryTracking", "lotTracking", "serialTracking", "onlyDamaged"]);

function factsOf(row: Raw): Facts {
  const out: Record<string, string | number | boolean | null> = {};
  for (const k of FACT_KEYS) {
    if (!(k in row)) continue;
    const v = row[k];
    out[k] = BOOL_FACTS.has(k) ? Boolean(v) : (v as string | number | null);
  }
  if ("productVolume" in out) out.totalVolume = Number(row.productVolume ?? 0) * Number(row.qty ?? 1);
  return out;
}

const day = (iso: unknown): string => String(iso ?? "").slice(0, 10);
const num = (v: unknown): number => Number(v ?? 0) || 0;
const str = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

/* ---------------- collectors ---------------- */

function receipts(db: AppDb, sc: Scope, types: readonly string[]): Raw[] {
  return db.all<Raw>(sql`SELECT r.id, r.received_at AS at, r.uom_quantity AS qty, r.quantity AS packQty, r.product_id AS productId, r.purchase_order_id AS poId,
      r.purchase_order_line_id AS poLineId, r.return_order_id AS rmaId, r.shipment_order_id AS soId, r.lp_id AS lpId, r.damage_reason AS damage,
      (SELECT po.code FROM purchase_orders po WHERE po.id = r.purchase_order_id) AS poCode,
      (SELECT ro.rma_code FROM return_orders ro WHERE ro.id = r.return_order_id) AS rmaCode,
      (SELECT so.code FROM shipment_orders so WHERE so.id = COALESCE(r.shipment_order_id, (SELECT ro.shipment_order_id FROM return_orders ro WHERE ro.id = r.return_order_id))) AS soCode,
      (SELECT lp.number FROM license_plates lp WHERE lp.id = r.lp_id) AS lpNumber,
      (SELECT lt.code FROM license_plates lp JOIN lp_types lt ON lt.id = lp.lp_type_id WHERE lp.id = r.lp_id) AS lpType,
      ${PRODUCT_FACTS}, ${LOCATION_FACTS}
    FROM receipts r JOIN products p ON p.id = r.product_id LEFT JOIN locations l ON l.id = r.location_id
    WHERE r.client_id = ${sc.clientId} AND r.warehouse_id = ${sc.warehouseId} AND r.cancelled_at IS NULL
      AND r.received_at >= ${sc.from} AND r.received_at < ${sc.to}
      AND r.type IN (${sql.join(types.map((t) => sql`${t}`), sql`, `)})
    ORDER BY r.received_at, r.master_id`);
}

const act = (row: Raw, quantity: number, ref: unknown, extra: Partial<Activity> = {}): Activity => ({
  quantity, activityDate: day(row.at), referenceNumber: str(ref), sku: str(row.sku), lpNumber: str(row.lpNumber),
  facts: { ...factsOf(row), onlyDamaged: Boolean(row.damage) }, ...extra,
});

/** Distinct-key rollup: one activity per key (first row's facts), quantity 1. */
function distinct(rows: readonly Raw[], key: (r: Raw) => unknown, ref: (r: Raw) => unknown, keepSku = false): Activity[] {
  const seen = new Map<string, Activity>();
  for (const r of rows) {
    const k = key(r);
    if (k === null || k === undefined || k === "") continue;
    const id = String(k);
    if (!seen.has(id)) seen.set(id, act(r, 1, ref(r), keepSku ? {} : { sku: str(r.sku) }));
  }
  return [...seen.values()];
}

function receivingActivity(db: AppDb, sc: Scope, fee: EngineFee): Activity[] {
  const rows = receipts(db, sc, ["Purchase Order", "Product Receive"]).filter((r) => matches(fee, r));
  switch (fee.feeBy) {
    case "Per LP": return distinct(rows, (r) => r.lpId, (r) => r.poCode);
    case "Per PO": return distinct(rows, (r) => r.poId, (r) => r.poCode);
    case "Per SKU": return distinct(rows, (r) => `${r.poId ?? r.id}|${r.productId}`, (r) => r.poCode, true);
    case "Per Volume": return rows.map((r) => act(r, r4(num(r.qty) * num(r.productVolume)), r.poCode));
    case "Per Receiving Line": return distinct(rows, (r) => r.poLineId ?? r.id, (r) => r.poCode, true);
    default: return rows.map((r) => act(r, fee.chargeBy === "Product (Pack Quantity)" ? num(r.packQty) : num(r.qty), r.poCode));
  }
}

function returnActivity(db: AppDb, sc: Scope, fee: EngineFee): Activity[] {
  const rows = receipts(db, sc, ["Return"]).filter((r) => matches(fee, r));
  switch (fee.feeBy) {
    case "Per RMA": return distinct(rows, (r) => r.rmaId ?? r.id, (r) => r.rmaCode);
    case "Per SO": return distinct(rows, (r) => r.soCode, (r) => r.soCode);
    case "Per SKU": return distinct(rows, (r) => `${r.rmaId ?? r.id}|${r.productId}`, (r) => r.rmaCode, true);
    default: return rows.map((r) => act(r, num(r.qty), r.rmaCode ?? r.soCode));
  }
}

function taskActivity(db: AppDb, sc: Scope, fee: EngineFee): Activity[] {
  const type = fee.feeBy === "Per Picking" ? "Picking" : "Packing";
  const rows = db.all<Raw>(sql`SELECT t.id, t.finished_at AS at, t.actual_qty AS qty, t.product_id AS productId, t.order_id AS orderId,
      COALESCE((SELECT pt.uom_qty FROM product_pack_types pt WHERE pt.product_id = t.product_id AND pt.pack_type = t.pack_type LIMIT 1), 1) AS packUom,
      (SELECT so.code FROM shipment_orders so WHERE so.id = t.order_id) AS soCode,
      (SELECT lp.number FROM license_plates lp WHERE lp.id = COALESCE(t.target_lp_id, t.source_lp_id)) AS lpNumber,
      ${PRODUCT_FACTS}, ${LOCATION_FACTS}
    FROM tasks t JOIN products p ON p.id = t.product_id LEFT JOIN locations l ON l.id = t.source_location_id
    WHERE t.client_id = ${sc.clientId} AND t.warehouse_id = ${sc.warehouseId} AND t.task_type = ${type} AND t.status = 'Completed'
      AND t.finished_at >= ${sc.from} AND t.finished_at < ${sc.to} AND t.actual_qty > 0
    ORDER BY t.finished_at, t.task_no`).filter((r) => matches(fee, r));
  switch (fee.chargeBy) {
    case "SO": return distinct(rows, (r) => r.orderId, (r) => r.soCode);
    case "SKU": return distinct(rows, (r) => `${r.orderId}|${r.productId}`, (r) => r.soCode, true);
    case "Product (Pack Quantity)": return rows.map((r) => act(r, r2(num(r.qty) / Math.max(1, num(r.packUom))), r.soCode));
    default: return rows.map((r) => act(r, num(r.qty), r.soCode));
  }
}

function shipmentActivity(db: AppDb, sc: Scope, fee: EngineFee): Activity[] {
  if (fee.feeBy === "Per SO") {
    const rows = db.all<Raw>(sql`SELECT so.id, so.shipped_at AS at, so.code AS soCode FROM shipment_orders so
      WHERE so.client_id = ${sc.clientId} AND so.warehouse_id = ${sc.warehouseId} AND so.shipped_at >= ${sc.from} AND so.shipped_at < ${sc.to} AND so.deleted_at IS NULL
      ORDER BY so.shipped_at`);
    return rows.map((r) => act(r, 1, r.soCode));
  }
  if (fee.feeBy === "Per Product") {
    const rows = db.all<Raw>(sql`SELECT si.id, so.shipped_at AS at, si.quantity AS qty, si.product_id AS productId, so.id AS orderId, so.code AS soCode,
        COALESCE((SELECT pt.uom_qty FROM product_pack_types pt WHERE pt.product_id = si.product_id AND pt.pack_type = si.pack_type LIMIT 1), 1) AS packUom, ${PRODUCT_FACTS}
      FROM shipment_items si JOIN shipments sh ON sh.id = si.shipment_id JOIN shipment_orders so ON so.id = sh.order_id JOIN products p ON p.id = si.product_id
      WHERE sh.client_id = ${sc.clientId} AND sh.warehouse_id = ${sc.warehouseId} AND so.shipped_at >= ${sc.from} AND so.shipped_at < ${sc.to} AND sh.label_status <> 'Voided'
      ORDER BY so.shipped_at`).filter((r) => matches(fee, r));
    if (fee.chargeBy === "SKU") return distinct(rows, (r) => `${r.orderId}|${r.productId}`, (r) => r.soCode, true);
    return rows.map((r) => act(r, fee.chargeBy === "Product (Pack Quantity)" ? r2(num(r.qty) / Math.max(1, num(r.packUom))) : num(r.qty), r.soCode));
  }
  const rows = db.all<Raw>(sql`SELECT sh.id, COALESCE(so.shipped_at, sh.created_at) AS at, so.code AS soCode, sh.tracking_number AS tracking, sh.shipment_package_id AS pkg
    FROM shipments sh JOIN shipment_orders so ON so.id = sh.order_id
    WHERE sh.client_id = ${sc.clientId} AND sh.warehouse_id = ${sc.warehouseId} AND sh.label_status <> 'Voided' AND sh.label_type = 'Shipping Label'
      AND COALESCE(so.shipped_at, sh.created_at) >= ${sc.from} AND COALESCE(so.shipped_at, sh.created_at) < ${sc.to}
    ORDER BY at`);

  const list = fee.feeBy === "Shipment Package" ? rows.filter((r) => r.pkg) : rows;
  return list.map((r) => ({ ...act(r, 1, r.soCode), lpNumber: str(r.tracking) }));
}

function workOrderActivity(db: AppDb, sc: Scope, fee: EngineFee): Activity[] {
  const rows = db.all<Raw>(sql`SELECT wo.id, wo.actual_finish_at AS at, wo.code AS woCode, wo.processed_qty AS qty,
      (SELECT COALESCE(SUM(c.component_qty), 0) FROM work_order_components c WHERE c.work_order_id = wo.id) AS perKit, ${PRODUCT_FACTS}
    FROM work_orders wo JOIN products p ON p.id = wo.kit_product_id
    WHERE wo.client_id = ${sc.clientId} AND wo.warehouse_id = ${sc.warehouseId} AND wo.status = 'Completed'
      AND wo.actual_finish_at >= ${sc.from} AND wo.actual_finish_at < ${sc.to}
    ORDER BY wo.actual_finish_at`).filter((r) => matches(fee, r));
  if (fee.feeBy === "Per Kit") return rows.map((r) => act(r, num(r.qty), r.woCode));
  if (fee.feeBy === "Per Component") return rows.map((r) => act(r, num(r.qty) * num(r.perKit), r.woCode));
  return rows.map((r) => act(r, 1, r.woCode));
}

function vasActivity(db: AppDb, sc: Scope, fee: EngineFee): Activity[] {
  if (!fee.vasTypeId) return [];
  const rows = db.all<Raw>(sql`SELECT v.id, v.operation_at AS at, v.value AS qty, v.calculation_type AS calc, v.reference_number AS ref, v.note,
      (SELECT lv.name FROM lookup_values lv WHERE lv.id = v.vas_type_id) AS vasType
    FROM vas_operations v WHERE v.client_id = ${sc.clientId} AND v.warehouse_id = ${sc.warehouseId} AND v.vas_type_id = ${fee.vasTypeId}
      AND v.operation_at >= ${sc.from} AND v.operation_at < ${sc.to} ORDER BY v.operation_at`);
  return rows.map((r) => ({ ...act(r, num(r.qty), r.ref ?? r.vasType), facts: { totalPrice: r.calc === "Total Price" } }));
}

/* ---------------- storage ---------------- */

function storageRows(db: AppDb, sc: Scope, fee: EngineFee): Raw[] {
  return db.all<Raw>(sql`SELECT sn.snapshot_at AS at, substr(sn.snapshot_at, 1, 10) AS d, sn.location_id AS locationId, sn.lp_id AS lpId, sn.parent_lp_id AS parentLpId,
      sn.uom_qty AS qty, sn.damage_reason AS damage, l.code AS locationCode,
      (SELECT lp.number FROM license_plates lp WHERE lp.id = sn.lp_id) AS lpNumber,
      (SELECT lp.number FROM license_plates lp WHERE lp.id = sn.parent_lp_id) AS parentLpNumber,
      (SELECT lt.code FROM license_plates lp JOIN lp_types lt ON lt.id = lp.lp_type_id WHERE lp.id = sn.lp_id) AS lpType,
      ${PRODUCT_FACTS}, ${LOCATION_FACTS}
    FROM inventory_snapshots sn JOIN products p ON p.id = sn.product_id LEFT JOIN locations l ON l.id = sn.location_id
    WHERE sn.client_id = ${sc.clientId} AND sn.warehouse_id = ${sc.warehouseId} AND sn.snapshot_at >= ${sc.from} AND sn.snapshot_at < ${sc.to} AND sn.uom_qty > 0
    ORDER BY sn.snapshot_at`).filter((r) => matches(fee, { ...r, damage: r.damage }));
}

function storageKey(fee: EngineFee, r: Raw): string | null {
  switch (fee.feeBy) {
    case "LP": return str(r.lpId);
    case "Parent LP": return str(r.parentLpId);
    case "Location": return str(r.locationId);
    default: return null;
  }
}
function storageLabel(fee: EngineFee, r: Raw): { ref: string | null; lp: string | null } {
  if (fee.feeBy === "LP") return { ref: str(r.locationCode), lp: str(r.lpNumber) };
  if (fee.feeBy === "Parent LP") return { ref: str(r.locationCode), lp: str(r.parentLpNumber) };
  return { ref: str(r.locationCode), lp: null };
}

/** Per-day metric: distinct keys, units or volume. */
function dailyMetric(fee: EngineFee, rows: readonly Raw[]): number {
  if (fee.feeBy === "Product") return rows.reduce((n, r) => n + num(r.qty), 0);
  if (fee.feeBy === "Total Volume") return r4(rows.reduce((n, r) => n + num(r.qty) * num(r.productVolume), 0));
  return new Set(rows.map((r) => storageKey(fee, r)).filter(Boolean)).size;
}

export function storageActivity(db: AppDb, sc: Scope, fee: EngineFee): Activity[] {
  const rows = storageRows(db, sc, fee);
  if (rows.length === 0) return [];
  const byDay = new Map<string, Raw[]>();
  for (const r of rows) byDay.set(String(r.d), [...(byDay.get(String(r.d)) ?? []), r]);
  const days = [...byDay.keys()].sort();
  const metric = (d: string) => dailyMetric(fee, byDay.get(d) ?? []);
  const calc = fee.calculationType ?? "At Period End";
  const note = (d: string) => `${calc}: snapshot ${d}`;
  const keyed = (list: readonly Raw[], d: string, extra: Partial<Activity> = {}): Activity[] => {
    if (fee.feeBy === "Product" || fee.feeBy === "Total Volume") return [{ quantity: metric(d), activityDate: d, referenceNumber: note(d), sku: null, lpNumber: null, facts: {}, ...extra }];
    const seen = new Map<string, Activity>();
    for (const r of list) {
      const k = storageKey(fee, r);
      if (!k || seen.has(k)) continue;
      const label = storageLabel(fee, r);
      seen.set(k, { quantity: 1, activityDate: d, referenceNumber: label.ref, sku: null, lpNumber: label.lp, facts: {}, ...extra });
    }
    return [...seen.values()];
  };
  switch (calc) {
    case "Daily Accumulation": return days.flatMap((d) => keyed(byDay.get(d) ?? [], d));
    case "At Peak Inventory": {
      const peak = days.reduce((best, d) => (metric(d) > metric(best) ? d : best), days[0]!);
      return keyed(byDay.get(peak) ?? [], peak);
    }
    case "Average Calculation": {
      const avg = r2(days.reduce((n, d) => n + metric(d), 0) / days.length);
      return [{ quantity: avg, activityDate: days[days.length - 1]!, referenceNumber: `Average of ${days.length} daily snapshots`, sku: null, lpNumber: null, facts: {} }];
    }
    case "Distinct Period Count": return keyed(rows, days[days.length - 1]!);
    case "Split Month Storage": {
      const first = new Map<string, Raw>();
      for (const r of rows) { const k = storageKey(fee, r); if (k && !first.has(k)) first.set(k, r); }
      const splitDay = fee.splitDay ?? 15;
      const periodFirstDay = days[0]!;
      return [...first.values()].map((r) => {
        const d = String(r.d);
        const label = storageLabel(fee, r);
        // Carried-over LPs (present on the first snapshot) bill at standard; first receipts after the split day at alternate.
        const alternate = d !== periodFirstDay && Number(d.slice(8, 10)) > splitDay;
        return { quantity: 1, activityDate: d, referenceNumber: label.ref, sku: null, lpNumber: label.lp, facts: {}, alternate };
      });
    }
    default: return keyed(byDay.get(days[days.length - 1]!) ?? [], days[days.length - 1]!);
  }
}

/* ---------------- conditions + pricing ---------------- */

function matches(fee: EngineFee, row: Raw): boolean {
  if (fee.conditions.length === 0) return true;
  const facts = { ...factsOf(row), onlyDamaged: Boolean(row.damage) };
  return evaluateConditions(fee.conditions as never, facts, "All");
}

export function collect(db: AppDb, sc: Scope, fee: EngineFee, contractName: string): Activity[] {
  switch (fee.operationType) {
    case "Recurring": return [{ quantity: 1, activityDate: sc.from.slice(0, 10), referenceNumber: contractName, sku: null, lpNumber: null, facts: {} }];
    case "Receiving": return receivingActivity(db, sc, fee);
    case "Return": return returnActivity(db, sc, fee);
    case "Pick & Pack": return taskActivity(db, sc, fee);
    case "Shipment": return shipmentActivity(db, sc, fee);
    case "Work Order": return workOrderActivity(db, sc, fee);
    case "VAS": return vasActivity(db, sc, fee);
    case "Storage": return storageActivity(db, sc, fee);
    default: return [];
  }
}

/** Prices one fee's activity: consolidated lines (per tier part) plus detailed lines. */
export function priceFee(fee: EngineFee, activity: readonly Activity[]): { lines: LineOut[]; total: number } {
  const base = { feeId: fee.id, feeName: fee.name, operationType: fee.operationType, feeBy: fee.feeBy, chargeBy: fee.chargeBy };
  const lines: LineOut[] = [];
  const detail = (a: Activity, unitPrice: number, total: number): LineOut => ({
    ...base, sku: a.sku, fromQty: null, toQty: null, unitPrice: r4(unitPrice), quantity: r4(a.quantity), totalPrice: r2(total), minMaxAdjustment: 0,
    adjustedPrice: r2(total), activityDate: a.activityDate || null, referenceNumber: a.referenceNumber, lpNumber: a.lpNumber, isDetail: true, note: null,
  });
  const consolidated: { fromQty: number | null; toQty: number | null; unitPrice: number; quantity: number; total: number; note: string | null }[] = [];

  if (fee.operationType === "VAS" && activity.some((a) => a.facts.totalPrice === true)) {
    // "Total Price" VAS types carry their own price; quantity types use the rate.
    const rate = fee.tiers[0]?.rate ?? fee.standardRate ?? 0;
    let total = 0; let qty = 0;
    for (const a of activity) {
      const amount = a.facts.totalPrice === true ? a.quantity : a.quantity * rate;
      total += amount; qty += a.facts.totalPrice === true ? 1 : a.quantity;
      lines.push(detail(a.facts.totalPrice === true ? { ...a, quantity: 1 } : a, a.facts.totalPrice === true ? a.quantity : rate, amount));
    }
    consolidated.push({ fromQty: null, toQty: null, unitPrice: qty ? total / qty : 0, quantity: qty, total: r2(total), note: "Total-price VAS operations billed at their own value" });
  } else if (fee.calculationType === "Split Month Storage") {
    const std = fee.standardRate ?? 0; const alt = fee.alternateRate ?? 0;
    const stdQty = activity.filter((a) => !a.alternate).length;
    const altQty = activity.length - stdQty;
    for (const a of activity) lines.push({ ...detail(a, a.alternate ? alt : std, a.alternate ? alt : std), note: a.alternate ? "Alternate rate (after split day)" : "Standard rate" });
    if (stdQty) consolidated.push({ fromQty: null, toQty: null, unitPrice: std, quantity: stdQty, total: r2(stdQty * std), note: `Standard rate (days 1-${fee.splitDay ?? 15})` });
    if (altQty) consolidated.push({ fromQty: null, toQty: null, unitPrice: alt, quantity: altQty, total: r2(altQty * alt), note: `Alternate rate (days ${(fee.splitDay ?? 15) + 1}-end)` });
  } else {
    const qty = r4(activity.reduce((n, a) => n + a.quantity, 0));
    const tiers = fee.tiers.length ? fee.tiers : [{ fromQty: 1, toQty: null, rate: fee.standardRate ?? 0 }];
    const { parts } = tieredAmount(qty, tiers);
    for (const p of parts) consolidated.push({ fromQty: tiers.length > 1 ? p.fromQty : null, toQty: tiers.length > 1 ? p.toQty : null, unitPrice: p.rate, quantity: p.quantity, total: p.amount, note: null });
    // Detailed lines consume tier capacity in activity order (graduated).
    let cursor = 0;
    for (const a of activity) {
      const before = tieredAmount(cursor, tiers).total;
      cursor = r4(cursor + a.quantity);
      const amount = r2(tieredAmount(cursor, tiers).total - before);
      lines.push(detail(a, a.quantity ? amount / a.quantity : 0, amount));
    }
    if (parts.length === 0) consolidated.push({ fromQty: null, toQty: null, unitPrice: tiers[0]?.rate ?? 0, quantity: 0, total: 0, note: "No activity in this period" });
  }

  const raw = r2(consolidated.reduce((n, c) => n + c.total, 0));
  const adjustment = minMaxAdjust(raw, fee);
  consolidated.forEach((c, i) => {
    const adj = i === consolidated.length - 1 ? adjustment : 0;
    lines.push({
      ...base, sku: null, fromQty: c.fromQty, toQty: c.toQty, unitPrice: r4(c.unitPrice), quantity: r4(c.quantity), totalPrice: r2(c.total), minMaxAdjustment: adj,
      adjustedPrice: r2(c.total + adj), activityDate: null, referenceNumber: null, lpNumber: null, isDetail: false,
      note: adj ? (adj > 0 ? `Minimum price ${fee.minPrice?.toFixed(2)} applied` : `Maximum price ${fee.maxPrice?.toFixed(2)} applied`) : c.note,
    });
  });
  return { lines, total: r2(raw + adjustment) };
}

/* ---------------- run ---------------- */

export function loadEngineFees(db: AppDb, contractId: string): EngineFee[] {
  const fees = db.select().from(s.billingFees).where(eq(s.billingFees.contractId, contractId)).all();
  const tiers = db.select().from(s.billingFeeTiers).all();
  return fees.map((f) => ({
    id: f.id, name: f.name, operationType: f.operationType, calculationType: f.calculationType, feeBy: normalizeFeeBy(f.operationType, f.feeBy), chargeBy: normalizeChargeBy(f.chargeBy),
    vasTypeId: f.vasTypeId, useMinPrice: Boolean(f.useMinPrice), minPrice: f.minPrice, useMaxPrice: Boolean(f.useMaxPrice), maxPrice: f.maxPrice, splitDay: f.splitDay,
    standardRate: f.standardRate, alternateRate: f.alternateRate, conditions: f.conditions ?? [],
    tiers: tiers.filter((t) => t.feeId === f.id).sort((a, b) => (a.fromQty ?? 0) - (b.fromQty ?? 0)).map((t) => ({ fromQty: t.fromQty, toQty: t.toQty, rate: t.rate })),
  }));
}

/** Legacy/seeded values ("Order", "Unit") map onto the Logiwa matrix. */
function normalizeFeeBy(op: OperationType, feeBy: string): string {
  if (feeBy === "Order") return op === "Return" ? "Per SO" : op === "Pick & Pack" ? "Per Packing" : "Per SO";
  if (feeBy === "Unit") return op === "Pick & Pack" ? "Per Picking" : op === "Storage" ? "Product" : "Per Product";
  return feeBy;
}
function normalizeChargeBy(chargeBy: string): string {
  if (chargeBy === "Per Order") return "SO";
  if (chargeBy === "Per Unit") return "Product (UOM Quantity)";
  if (chargeBy === "Per Day") return "Location";
  return chargeBy;
}

export interface CalcResult {
  readonly reportId: string;
  readonly billNumber: string;
  readonly status: "Successful" | "Failed";
  readonly totalPrice: number;
  readonly errorMessage: string | null;
}

/** Computes then writes one bill for the period. Never throws for calculation errors. */
export function calculateContract(tx: AppDb, ctx: DomainCtx, contractId: string, period: Period, now: Date = new Date()): CalcResult {
  const contract = tx.select().from(s.billingContracts).where(eq(s.billingContracts.id, contractId)).get();
  if (!contract) throw new Error("Billing contract not found");
  const client = tx.select({ currency: s.clients.currency }).from(s.clients).where(eq(s.clients.id, contract.clientId)).get();
  const sc: Scope = { clientId: contract.clientId, warehouseId: contract.warehouseId, from: isoStart(period.start), to: isoStart(period.end) };
  let lines: LineOut[] = [];
  let total = 0;
  let error: string | null = null;
  try {
    const fees = loadEngineFees(tx, contractId);
    if (fees.length === 0) throw new Error("The contract has no fees");
    for (const fee of fees) {
      const priced = priceFee(fee, collect(tx, sc, fee, contract.name));
      lines = [...lines, ...priced.lines];
      total = r2(total + priced.total);
    }
  } catch (e) {
    error = e instanceof Error ? e.message : "Calculation failed";
    lines = [];
    total = 0;
  }
  const number = billNumber(tx, now);
  const periodEndIso = new Date(Date.parse(sc.to) - 1).toISOString();
  const report = tx.insert(s.billingReports).values({
    contractId, billNumber: number, calcStatus: error ? "Failed" : "Successful", clientId: contract.clientId, warehouseId: contract.warehouseId,
    calculatedAt: now.toISOString(), periodStart: sc.from, periodEnd: periodEndIso, billStatus: "Draft", totalPrice: total, currency: client?.currency ?? "USD",
    errorMessage: error, createdBy: ctx.userId,
  }).returning({ id: s.billingReports.id }).get();
  for (let i = 0; i < lines.length; i += 200) {
    tx.insert(s.billingReportLines).values(lines.slice(i, i + 200).map((l) => ({ ...l, reportId: report.id }))).run();
  }
  const prevCalc = contract.lastCalculatedAt;
  // Only a full, contract-aligned period advances the schedule; custom / to-date previews do not.
  const fullPeriod = periodEnd(period.start, contract.frequency) === period.end;
  const nextStart = fullPeriod && period.end > (contract.nextPeriodStart ?? "") ? period.end : contract.nextPeriodStart;
  tx.update(s.billingContracts).set({ lastCalculatedAt: now.toISOString(), nextPeriodStart: nextStart }).where(eq(s.billingContracts.id, contractId)).run();
  logCreate(tx, ctx, "billing_report", report.id, number);
  logUpdate(tx, ctx, CONTRACT_ENTITY, contractId, contract.name, { lastCalculatedAt: prevCalc ?? "" }, { lastCalculatedAt: `${now.toISOString()} (bill ${number}${error ? ", failed" : ""})` });
  return { reportId: report.id, billNumber: number, status: error ? "Failed" : "Successful", totalPrice: total, errorMessage: error };
}
