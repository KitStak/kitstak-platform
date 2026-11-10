/**
 * Carrier Shipment Details (M02): one row per package / label, the shipment detail view,
 * scoped facets for the filter builder, void (guarded) and reprint.
 */
import { sql, type SQL } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import {
  SHIPMENT_FIELDS, SHIPMENT_SEARCH_FIELDS, SHIPMENT_SORT_FIELDS, trackingUrl, voidBlockReason,
} from "@/lib/grid-defs/shipping/shipments";
import type { ShippingFacets } from "@/lib/grid-defs/shipping/common";
import type { AppDb } from "@/server/api/db";
import { AppError, notFoundError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { redactFor } from "@/server/auth/permissions";
import { assertInScope, type Scope } from "@/server/auth/scope";
import { recordUpdate } from "@/server/domain/change-log";
import { shipping } from "@/server/domain";
import type { BulkResult, DomainCtx } from "@/server/domain/types";
import { fileStore, type FileStore } from "@/server/files";
import type { GridQuery } from "@/server/query/grid-query";
import { compileGrid, inList, scopeSql, whereClause, type GridSpec } from "./shipping-grid";

const raw = (expr: string): SQL => sql.raw(expr);

const FROM = sql.raw(`
  shipments s
  JOIN shipment_orders o ON o.id = s.order_id
  LEFT JOIN warehouses w ON w.id = s.warehouse_id
  LEFT JOIN clients c ON c.id = s.client_id
  LEFT JOIN carrier_connections cc ON cc.id = s.carrier_connection_id
  LEFT JOIN locations l ON l.id = s.packed_from_location_id
  LEFT JOIN license_plates plp ON plp.id = s.parent_lp_id
  LEFT JOIN shipment_packages sp ON sp.id = s.shipment_package_id
  LEFT JOIN rate_shopping_presets rp ON rp.id = s.rate_shopping_preset_id
`);

const SQL_FOR: Readonly<Record<string, SQL>> = {
  warehouseCode: raw("w.code"),
  locationCode: raw("l.code"),
  clientName: raw("c.name"),
  orderCode: raw("o.code"),
  orderStatus: raw("o.status"),
  customerName: raw("o.customer_name"),
  labelCreatedAt: raw("s.label_created_at"),
  carrierExpectedDeliveryAt: raw("s.carrier_expected_delivery_at"),
  carrier: raw("s.carrier_code"),
  carrierPrefix: raw("cc.account_prefix"),
  serviceName: raw("s.service_name"),
  isRateShopped: raw("s.is_rate_shopped"),
  rateShoppingName: raw("rp.name"),
  rate: raw("s.rate"),
  labelType: raw("s.label_type"),
  masterTrackingNumber: raw("s.master_tracking_number"),
  trackingNumber: raw("s.tracking_number"),
  actualShipmentAt: raw("s.actual_shipment_at"),
  deliveredAt: raw("COALESCE(s.delivered_at, o.delivered_at)"),
  voidedAt: raw("s.voided_at"),
  insuranceType: raw("s.insurance_type"),
  insuranceValue: raw("s.insurance_value"),
  confirmationType: raw("s.confirmation_type"),
  weight: raw("s.weight"),
  height: raw("s.height"),
  width: raw("s.width"),
  length: raw("s.length"),
  dimensionUnit: raw("s.dimension_unit"),
  packageCode: raw("sp.code"),
  weightUnit: raw("s.weight_unit"),
  shippingCost: raw("s.shipping_cost"),
  zone: raw("s.zone"),
  otherCost: raw("s.other_cost"),
  currency: raw("s.currency"),
  allowSaturdayDelivery: raw("s.allow_saturday_delivery"),
  labelStatus: raw("s.label_status"),
  scheduledPickupAt: raw("s.scheduled_pickup_at"),
  actualPickupAt: raw("s.actual_pickup_at"),
  parentLpNumber: raw("plp.number"),
  externalReference: raw("s.external_reference"),
  packageSeq: raw("s.package_seq"),
  isVoided: raw("(s.label_status = 'Voided')"),
  isReturnLabel: raw("(s.label_type = 'Return Label')"),
};

export const SHIPMENTS_GRID: GridSpec = {
  fields: SHIPMENT_FIELDS,
  sqlFor: SQL_FOR,
  searchFields: SHIPMENT_SEARCH_FIELDS,
  sortFields: SHIPMENT_SORT_FIELDS,
  defaultSort: [{ field: "labelCreatedAt", dir: "desc" }],
  tiebreaker: raw("s.id"),
};

const SELECT = sql.raw(`
  s.id AS id, s.order_id AS orderId, o.code AS orderCode, o.status AS orderStatus, o.customer_name AS customerName,
  o.ship_address AS shipAddress, o.ship_address2 AS shipAddress2, o.ship_city AS shipCity, o.ship_state AS shipState,
  o.ship_zip AS shipZip, o.ship_country AS shipCountry,
  w.code AS warehouseCode, l.code AS locationCode, c.name AS clientName,
  (SELECT group_concat(p.sku || ' × ' || si.quantity, ', ') FROM shipment_items si JOIN products p ON p.id = si.product_id WHERE si.shipment_id = s.id) AS products,
  s.label_created_at AS labelCreatedAt, s.carrier_expected_delivery_at AS carrierExpectedDeliveryAt,
  s.carrier_code AS carrierCode, cc.account_prefix AS carrierPrefix, cc.setup_name AS carrierSetupName,
  s.service_name AS serviceName, s.is_rate_shopped AS isRateShopped, rp.name AS rateShoppingName, s.rate AS rate,
  s.label_type AS labelType, s.label_status AS labelStatus, s.label_format AS labelFormat, s.label_file_id AS labelFileId,
  s.master_tracking_number AS masterTrackingNumber, s.tracking_number AS trackingNumber,
  s.actual_shipment_at AS actualShipmentAt, COALESCE(s.delivered_at, o.delivered_at) AS deliveredAt, s.voided_at AS voidedAt,
  s.insurance_type AS insuranceType, s.insurance_value AS insuranceValue, s.confirmation_type AS confirmationType,
  s.weight AS weight, s.height AS height, s.width AS width, s.length AS length, s.dimension_unit AS dimensionUnit,
  sp.code AS packageCode, s.weight_unit AS weightUnit, s.shipping_cost AS shippingCost, s.zone AS zone,
  s.other_cost AS otherCost, s.currency AS currency, s.allow_saturday_delivery AS allowSaturdayDelivery,
  s.scheduled_pickup_at AS scheduledPickupAt, s.actual_pickup_at AS actualPickupAt, plp.number AS parentLpNumber,
  s.external_reference AS externalReference, s.package_seq AS packageSeq,
  (SELECT COUNT(*) FROM shipments s2 WHERE s2.order_id = s.order_id AND s2.master_tracking_number IS s.master_tracking_number AND s2.label_type = s.label_type) AS packageCount,
  s.end_of_day_manifest_id AS manifestId
`);

type RawShipmentRow = Readonly<Record<string, unknown>> & {
  readonly id: string;
  readonly orderId: string;
  readonly orderCode: string;
  readonly orderStatus: string;
  readonly customerName: string;
  readonly shipAddress: string;
  readonly shipAddress2: string | null;
  readonly shipCity: string;
  readonly shipState: string;
  readonly shipZip: string;
  readonly shipCountry: string;
  readonly carrierCode: string;
  readonly carrierPrefix: string | null;
  readonly isRateShopped: number;
  readonly allowSaturdayDelivery: number;
  readonly labelStatus: string;
  readonly labelCreatedAt: string;
  readonly actualShipmentAt: string | null;
  readonly trackingNumber: string;
  readonly masterTrackingNumber: string | null;
  readonly labelFileId: string | null;
};

export type ShipmentListRow = Readonly<Record<string, unknown>> & {
  readonly id: string;
  readonly orderId: string;
  readonly orderCode: string;
  readonly trackingNumber: string;
  readonly labelStatus: string;
  readonly customerAddress: string;
  readonly carrier: string;
  readonly isRateShopped: boolean;
  readonly allowSaturdayDelivery: boolean;
  readonly isMaster: boolean;
  readonly trackingUrl: string | null;
  readonly voidBlockedReason: string | null;
};

/** "812 Oak Rd, Apt 2, Mobile, AL, 36571, US" (Logiwa order). */
export function formatAddress(parts: readonly (string | null | undefined)[]): string {
  return parts.map((p) => (p ?? "").trim()).filter(Boolean).join(", ");
}

function toRow(r: RawShipmentRow, auth: AuthContext | null, now: Date): ShipmentListRow {
  const row = {
    ...r,
    customerAddress: formatAddress([r.shipAddress, r.shipAddress2, r.shipCity, r.shipState, r.shipZip, r.shipCountry]),
    carrier: r.carrierPrefix ? `${r.carrierCode} - ${r.carrierPrefix}` : r.carrierCode,
    isRateShopped: Boolean(r.isRateShopped),
    allowSaturdayDelivery: Boolean(r.allowSaturdayDelivery),
    isMaster: !r.masterTrackingNumber || r.masterTrackingNumber === r.trackingNumber,
    trackingUrl: trackingUrl(r.carrierCode, r.trackingNumber),
    voidBlockedReason: voidBlockReason(r, now),
  } as ShipmentListRow;
  return auth ? redactFor(auth, row) : row;
}

export interface ListResult<T> {
  readonly rows: readonly T[];
  readonly total: number;
}

export function listShipments(db: AppDb, auth: AuthContext, query: GridQuery, now: Date = new Date()): ListResult<ShipmentListRow> {
  const scope = scopeSql(raw("s.warehouse_id"), raw("s.client_id"), auth.viewScope);
  const grid = compileGrid(SHIPMENTS_GRID, query, scope);
  const rows = db.all<RawShipmentRow>(sql`SELECT ${SELECT} FROM ${FROM} ${whereClause(grid.where)} ORDER BY ${sql.join(grid.orderBy, sql`, `)} LIMIT ${grid.pageSize} OFFSET ${grid.offset}`);
  const total = db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM ${FROM} ${whereClause(grid.where)}`)?.n ?? 0;
  return { rows: rows.map((r) => toRow(r, auth, now)), total };
}

export interface ShipmentItemRow {
  readonly id: string;
  readonly sku: string;
  readonly productName: string;
  readonly quantity: number;
  readonly packType: string;
  readonly lotNumber: string | null;
  readonly expiryDate: string | null;
}

export interface ShipmentDetail extends ShipmentListRow {
  readonly items: readonly ShipmentItemRow[];
  readonly siblings: readonly { readonly id: string; readonly trackingNumber: string; readonly packageSeq: number; readonly labelStatus: string }[];
}

function loadRaw(db: AppDb, id: string): RawShipmentRow & { warehouseId: string; clientId: string } {
  const row = db.get<RawShipmentRow & { warehouseId: string; clientId: string }>(
    sql`SELECT ${SELECT}, s.warehouse_id AS warehouseId, s.client_id AS clientId FROM ${FROM} WHERE s.id = ${id}`,
  );
  if (!row) throw notFoundError("Shipment");
  return row;
}

export function getShipment(db: AppDb, auth: AuthContext, id: string, now: Date = new Date()): ShipmentDetail {
  const r = loadRaw(db, id);
  assertInScope(auth.scope, r, "Shipment");
  const items = db.all<ShipmentItemRow>(sql`
    SELECT si.id AS id, p.sku AS sku, p.name AS productName, si.quantity AS quantity, si.pack_type AS packType,
      si.lot_number AS lotNumber, si.expiry_date AS expiryDate
    FROM shipment_items si JOIN products p ON p.id = si.product_id WHERE si.shipment_id = ${id} ORDER BY p.sku`);
  const siblings = r.masterTrackingNumber
    ? db.all<{ id: string; trackingNumber: string; packageSeq: number; labelStatus: string }>(sql`
        SELECT id, tracking_number AS trackingNumber, package_seq AS packageSeq, label_status AS labelStatus FROM shipments
        WHERE order_id = ${r.orderId} AND master_tracking_number = ${r.masterTrackingNumber} ORDER BY package_seq`)
    : [];
  return { ...toRow(r, auth, now), items, siblings };
}

/* ----------------------------------------------------------------- facets */

/** Distinct, scoped filter values for the M02 grids (warehouses, clients, carriers, accounts, services). */
export function shippingFacets(db: AppDb, scope: Scope): ShippingFacets {
  const wh = scopeSql(raw("id"), null, scope);
  const opt = (rows: readonly { v: string | null }[]) => rows.filter((r) => r.v).map((r) => ({ value: r.v as string, label: r.v as string }));
  const clientScope = scope.clientIds === "all" ? sql`1 = 1` : inList(raw("id"), scope.clientIds);
  const connScope = scopeSql(raw("warehouse_id"), null, scope);
  return {
    warehouses: opt(db.all<{ v: string }>(sql`SELECT code AS v FROM warehouses WHERE ${wh} ORDER BY code`)),
    clients: opt(db.all<{ v: string }>(sql`SELECT name AS v FROM clients WHERE ${clientScope} ORDER BY name`)),
    carriers: opt(db.all<{ v: string }>(sql`SELECT DISTINCT carrier_code AS v FROM carrier_services WHERE connection_id IN (SELECT id FROM carrier_connections WHERE ${connScope}) ORDER BY carrier_code`)),
    carrierAccounts: opt(db.all<{ v: string }>(sql`SELECT DISTINCT account_prefix AS v FROM carrier_connections WHERE ${connScope} ORDER BY account_prefix`)),
    services: opt(db.all<{ v: string }>(sql`SELECT DISTINCT name AS v FROM carrier_services WHERE connection_id IN (SELECT id FROM carrier_connections WHERE ${connScope}) ORDER BY name`)),
  };
}

/* ------------------------------------------------------------------- void */

/** Voids labels one by one (carrier I/O); multi-package groups void together. */
export async function voidShipments(db: AppDb, auth: AuthContext, ctx: DomainCtx, ids: readonly string[], now: Date = new Date()): Promise<BulkResult> {
  const succeeded: string[] = [];
  const failed: { id: string; code: string; message: string }[] = [];
  for (const id of [...new Set(ids)]) {
    try {
      const r = loadRaw(db, id);
      assertInScope(auth.scope, r, "Shipment");
      if (r.labelStatus === "Voided" && succeeded.length > 0 && r.masterTrackingNumber) {
        const voidedWith = db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM shipments WHERE id IN (${sql.join(succeeded.map((s) => sql`${s}`), sql`, `)}) AND master_tracking_number = ${r.masterTrackingNumber}`);
        if (voidedWith && voidedWith.n > 0) { succeeded.push(id); continue; }
      }
      const blocked = voidBlockReason(r, now);
      if (blocked) throw new AppError("INVALID_STATE", `${r.trackingNumber}: ${blocked}.`);
      await shipping.voidLabel(db, ctx, { shipmentId: id });
      succeeded.push(id);
    } catch (error: unknown) {
      const code = error instanceof AppError ? error.code : (error as { code?: string }).code ?? "INTERNAL";
      failed.push({ id, code, message: error instanceof Error ? error.message : "Void failed" });
    }
  }
  return { succeeded, failed };
}

/* ---------------------------------------------------------------- reprint */

export interface ReprintResult {
  readonly fileId: string;
  readonly count: number;
  readonly format: "PDF" | "ZPL";
}

/**
 * Merges the stored label files of the selection into one printable file (PDF pages, or
 * concatenated ZPL) and records a "Label reprinted" change-log entry per order.
 */
export async function reprintShipments(db: AppDb, auth: AuthContext, ctx: DomainCtx, ids: readonly string[], store: FileStore = fileStore()): Promise<ReprintResult> {
  const rows = [...new Set(ids)].map((id) => {
    const r = loadRaw(db, id);
    assertInScope(auth.scope, r, "Shipment");
    return r;
  });
  const voided = rows.find((r) => r.labelStatus === "Voided");
  if (voided) throw new AppError("INVALID_STATE", `Label ${voided.trackingNumber} is voided and can't be reprinted.`);
  const missing = rows.find((r) => !r.labelFileId);
  if (missing) throw new AppError("INVALID_STATE", `Label ${missing.trackingNumber} has no stored label file.`);
  const files = rows.map((r) => ({ row: r, ...store.read(db, r.labelFileId as string) }));
  const pdfs = files.filter((f) => f.record.mime === "application/pdf");
  if (pdfs.length > 0 && pdfs.length < files.length) throw new AppError("VALIDATION", "Select labels of one format (PDF or ZPL) to reprint together.");
  let bytes: Uint8Array;
  let format: "PDF" | "ZPL";
  if (pdfs.length === files.length) {
    const merged = await PDFDocument.create();
    for (const f of files) {
      const src = await PDFDocument.load(f.bytes);
      for (const page of await merged.copyPages(src, src.getPageIndices())) merged.addPage(page);
    }
    bytes = await merged.save();
    format = "PDF";
  } else {
    bytes = new TextEncoder().encode(files.map((f) => f.bytes.toString("utf8")).join("\n"));
    format = "ZPL";
  }
  return db.transaction((tx) => {
    const file = store.store(tx, {
      name: `Labels reprint ${new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", "")}.${format === "PDF" ? "pdf" : "zpl"}`,
      bytes, purpose: "print", uploadedBy: auth.user.id, ownerEntityType: null, ownerEntityId: null,
    });
    for (const r of rows) {
      recordUpdate(tx, ctx, { entityType: "shipment_order", entityId: r.orderId, entityCode: r.orderCode, before: { labelReprinted: "" }, after: { labelReprinted: r.trackingNumber } });
    }
    return { fileId: file.id, count: rows.length, format };
  });
}
