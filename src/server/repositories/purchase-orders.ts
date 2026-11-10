/**
 * Purchase orders — read side (M05). List (grid grammar), detail, code uniqueness and
 * product info for the line editor. Every read is scoped (`scopedWhere`); a PO outside
 * the caller's scope is NOT_FOUND. Mutations live in `purchase-orders-commands.ts`.
 */
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { trackingIssues } from "@/lib/grid-defs/receiving/po-schemas";
import { displayPoStatus, PO_GRID_FIELDS, PO_SEARCH_FIELDS, PO_SORT_FIELDS } from "@/lib/grid-defs/receiving/purchase-orders";
import type { AppDb } from "@/server/api/db";
import { notFoundError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { assertInScope, scopedWhere, type Scope } from "@/server/auth/scope";
import * as schema from "@/server/db/schema";
import { canChangePoStatus, nextPoStatuses } from "./po-status-rules";
import type { GridQuery } from "@/server/query/grid-query";
import { compileGrid, tagFilter, type GridSpec } from "./purchase-orders-grid";
import { preAdvisedByLine, preAdvisedCounts, type PreAdvisedSerial } from "./purchase-orders-serials";
import { getVendor, type VendorDetail } from "./vendors";

const po = schema.purchaseOrders;
const line = schema.purchaseOrderLines;

const STATUS_SQL: SQL = sql`(CASE WHEN ${po.status} = 'Receiving' THEN 'Started' ELSE ${po.status} END)`;
const CLIENT_NAME_SQL: SQL = sql`(SELECT c.name FROM clients c WHERE c.id = ${po.clientId})`;
const WAREHOUSE_NAME_SQL: SQL = sql`(SELECT w.name FROM warehouses w WHERE w.id = ${po.warehouseId})`;
const VENDOR_SQL: SQL = sql`COALESCE((SELECT v.display_name FROM vendors v WHERE v.id = ${po.vendorId}), ${po.vendorName})`;
const TAGS_SORT_SQL: SQL = sql`(SELECT group_concat(t.name) FROM entity_tags et JOIN tags t ON t.id = et.tag_id WHERE et.entity_type = 'purchase_order' AND et.entity_id = ${po.id})`;
const ACTIVE_RECEIPTS_SQL: SQL = sql`(SELECT count(*) FROM receipts r WHERE r.purchase_order_id = ${po.id} AND r.cancelled_at IS NULL)`;
const cf = (slot: string): SQL => sql`json_extract(${po.customFields}, ${`$.${slot}`})`;

const SPEC: GridSpec = {
  fields: PO_GRID_FIELDS,
  sortFields: PO_SORT_FIELDS,
  searchFields: PO_SEARCH_FIELDS,
  exprs: {
    code: sql`${po.code}`, referenceNumber: sql`${po.referenceNumber}`, vendorName: VENDOR_SQL, purchasePrice: sql`${po.purchasePrice}`,
    totalQuantity: sql`${po.totalQuantity}`, status: STATUS_SQL, poType: sql`${po.poType}`, tags: TAGS_SORT_SQL, tag: sql`1`,
    poDate: sql`${po.poDate}`, clientId: sql`${po.clientId}`, clientName: CLIENT_NAME_SQL, warehouseId: sql`${po.warehouseId}`,
    warehouseName: WAREHOUSE_NAME_SQL, createdAt: sql`${po.createdAt}`, plannedReceivingDate: sql`${po.plannedReceivingDate}`,
    receivedAt: sql`${po.receivedAt}`, plannedArrivalDate: sql`${po.plannedArrivalDate}`, actualArrivalDate: sql`${po.actualArrivalDate}`,
    cf_textBox1: cf("textBox1"), cf_textBox2: cf("textBox2"), cf_textBox3: cf("textBox3"), cf_dropDown1: cf("dropDown1"), cf_dropDown2: cf("dropDown2"),
    cf_date1: cf("date1"), cf_date2: cf("date2"), cf_date3: cf("date3"), cf_toggle1: cf("toggle1"), cf_toggle2: cf("toggle2"),
  },
  custom: { tag: tagFilter("purchase_order", sql`${po.id}`) },
  defaultOrder: [sql`${po.createdAt} DESC`, sql`${po.code} DESC`],
};

export interface TagChip {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

export interface PurchaseOrderRow {
  readonly id: string;
  readonly code: string;
  readonly vendorId: string | null;
  readonly vendorName: string;
  readonly referenceNumber: string | null;
  readonly purchasePrice: number;
  readonly totalQuantity: number;
  readonly receivedQuantity: number;
  /** Display status (Receiving reads as Started). */
  readonly status: string;
  readonly rawStatus: string;
  readonly poType: string;
  readonly tags: readonly TagChip[];
  readonly poDate: string | null;
  readonly clientId: string;
  readonly clientName: string;
  readonly warehouseId: string;
  readonly warehouseName: string;
  readonly createdAt: string;
  readonly plannedReceivingDate: string | null;
  readonly receivedAt: string | null;
  readonly plannedArrivalDate: string | null;
  readonly actualArrivalDate: string | null;
  readonly activeReceipts: number;
  readonly version: number;
  /** The warehouse's IANA time zone: every time in the module renders in it, labelled. */
  readonly warehouseTimeZone: string;
  /** Warehouse default receiving location (bulk Receive PO target). */
  readonly receivingLocationCode: string | null;
  /**
   * Why a one-click "Receive PO" (full receive into the default location) can't run: an
   * open line is lot / expiry / production / serial tracked without a preset value. Null
   * when Receive PO can run (status permitting).
   */
  readonly receiveAllBlockedReason: string | null;
  /** Serial numbers pre-advised on the PO's lines (Import Serial Numbers; Remove Serial Number). */
  readonly preAdvisedSerials: number;
}

/** Status modal reason for Cancelled on a PO with receipts (the menu's Cancel order short-closes it). */
export const SHORT_CLOSE_HINT = "This order has received stock, so it can't become Cancelled. Choose Completed to close it, or use Other actions › Cancel order to cancel the open balance and keep the received stock.";

export const RECEIVE_ALL_TRACKED_REASON = "Lot, expiry and serial tracked lines must be received with Receive items";

/** Cheap pre-filter: an open line of a tracked product a full receive can't fill. */
const TRACKED_OPEN_SQL: SQL = sql`EXISTS (SELECT 1 FROM purchase_order_lines tl JOIN products tp ON tp.id = tl.product_id
  WHERE tl.purchase_order_id = ${po.id} AND tl.received_quantity < tl.ordered_quantity
    AND (tp.track_serial = 1 OR (tp.track_lot = 1 AND tl.lot_number IS NULL) OR (tp.track_expiry = 1 AND tl.expiry_date IS NULL)
      OR (tp.track_production_date = 1 AND tl.production_date IS NULL)))`;

const SELECT = {
  id: po.id, code: po.code, vendorId: po.vendorId, vendorName: sql<string>`${VENDOR_SQL}`, referenceNumber: po.referenceNumber,
  purchasePrice: po.purchasePrice, totalQuantity: po.totalQuantity, receivedQuantity: po.receivedQuantity, rawStatus: po.status,
  poType: po.poType, poDate: po.poDate, clientId: po.clientId, clientName: sql<string>`${CLIENT_NAME_SQL}`, warehouseId: po.warehouseId,
  warehouseName: sql<string>`${WAREHOUSE_NAME_SQL}`, createdAt: po.createdAt, plannedReceivingDate: po.plannedReceivingDate,
  receivedAt: po.receivedAt, plannedArrivalDate: po.plannedArrivalDate, actualArrivalDate: po.actualArrivalDate,
  activeReceipts: sql<number>`${ACTIVE_RECEIPTS_SQL}`, version: po.version,
  warehouseTimeZone: sql<string>`COALESCE((SELECT w.timezone FROM warehouses w WHERE w.id = ${po.warehouseId}), 'UTC')`,
  receivingLocationCode: sql<string | null>`(SELECT l.code FROM warehouses w JOIN locations l ON l.id = w.default_receiving_location_id WHERE w.id = ${po.warehouseId})`,
  trackedOpen: sql<number>`${TRACKED_OPEN_SQL}`,
};

export function tagsFor(db: AppDb, entityType: string, ids: readonly string[]): Map<string, TagChip[]> {
  const out = new Map<string, TagChip[]>();
  if (ids.length === 0) return out;
  const rows = db.select({ entityId: schema.entityTags.entityId, id: schema.tags.id, name: schema.tags.name, color: schema.tags.color })
    .from(schema.entityTags).innerJoin(schema.tags, eq(schema.tags.id, schema.entityTags.tagId))
    .where(and(eq(schema.entityTags.entityType, entityType), inArray(schema.entityTags.entityId, [...ids]))).orderBy(asc(schema.tags.name)).all();
  for (const r of rows) out.set(r.entityId, [...(out.get(r.entityId) ?? []), { id: r.id, name: r.name, color: r.color }]);
  return out;
}

/**
 * Per PO, why a full receive (Receive PO) can't post: the first open tracked line without
 * a preset lot / expiry / production date, or any serial-tracked line. Applies the
 * warehouse receiving screen config exactly as `receiveAll` does.
 */
export function receiveAllBlockers(db: AppDb, poIds: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  if (poIds.length === 0) return out;
  const p = schema.products;
  const rows = db.select({
    poId: line.purchaseOrderId, warehouseId: po.warehouseId, sku: p.sku, ordered: line.orderedQuantity, received: line.receivedQuantity, ratio: line.uomQuantity,
    lotNumber: line.lotNumber, expiryDate: line.expiryDate, productionDate: line.productionDate,
    lot: p.trackLot, expiry: p.trackExpiry, production: p.trackProductionDate, serial: p.trackSerial,
  }).from(line).innerJoin(po, eq(po.id, line.purchaseOrderId)).innerJoin(p, eq(p.id, line.productId))
    .where(and(inArray(line.purchaseOrderId, [...poIds]), sql`${line.receivedQuantity} < ${line.orderedQuantity}`))
    .orderBy(asc(line.createdAt), sql`"purchase_order_lines".rowid`).all();
  for (const r of rows) {
    if (out.has(r.poId) || !(r.lot || r.expiry || r.production || r.serial)) continue;
    const req = receivingRequirements(db, r.warehouseId, { lot: Boolean(r.lot), expiry: Boolean(r.expiry), production: Boolean(r.production), serial: Boolean(r.serial) });
    const issues = trackingIssues({ quantity: r.ordered - r.received, lotNumber: r.lotNumber, expiryDate: r.expiryDate, productionDate: r.productionDate, serials: [], uomRatio: r.ratio }, req, r.sku);
    if (Object.keys(issues).length > 0) out.set(r.poId, `${RECEIVE_ALL_TRACKED_REASON} (${r.sku}).`);
  }
  return out;
}

type BaseRow = Omit<PurchaseOrderRow, "status" | "tags" | "receiveAllBlockedReason" | "preAdvisedSerials"> & { readonly trackedOpen: number | boolean };

function shape(db: AppDb, rows: readonly BaseRow[], tags: Map<string, TagChip[]>): PurchaseOrderRow[] {
  const blockers = receiveAllBlockers(db, rows.filter((r) => Boolean(r.trackedOpen)).map((r) => r.id));
  const serials = preAdvisedCounts(db, rows.map((r) => r.id));
  return rows.map(({ trackedOpen: _tracked, ...r }) => ({ ...r, status: displayPoStatus(r.rawStatus), tags: tags.get(r.id) ?? [], receiveAllBlockedReason: blockers.get(r.id) ?? null, preAdvisedSerials: serials.get(r.id) ?? 0 }));
}

export function listPurchaseOrders(db: AppDb, auth: AuthContext, query: GridQuery, extra: readonly (SQL | undefined)[] = []): { rows: PurchaseOrderRow[]; total: number } {
  const { where, orderBy } = compileGrid(SPEC, query, [scopedWhere(po, auth.viewScope), ...extra]);
  const total = db.select({ n: sql<number>`count(*)` }).from(po).where(where).get()?.n ?? 0;
  const base = db.select(SELECT).from(po).where(where).orderBy(...orderBy).limit(query.pageSize).offset((query.page - 1) * query.pageSize).all();
  return { rows: shape(db, base, tagsFor(db, "purchase_order", base.map((r) => r.id))), total };
}

/** Rows for a set of ids (bulk confirm tables, labels); scoped. */
export function purchaseOrdersByIds(db: AppDb, scope: Scope, ids: readonly string[]): PurchaseOrderRow[] {
  if (ids.length === 0) return [];
  const base = db.select(SELECT).from(po).where(and(inArray(po.id, [...ids]), scopedWhere(po, scope))).all();
  return shape(db, base, tagsFor(db, "purchase_order", base.map((r) => r.id)));
}

export interface PurchaseOrderLineRow {
  readonly id: string;
  readonly productId: string;
  readonly sku: string;
  readonly productName: string;
  readonly barcode: string;
  readonly imageUrl: string | null;
  readonly uom: string;
  readonly packType: string;
  readonly uomQuantity: number;
  readonly orderedQuantity: number;
  readonly receivedQuantity: number;
  readonly damagedQuantity: number;
  readonly unitCost: number;
  readonly totalPrice: number;
  readonly receivingLocationId: string | null;
  readonly receivingLocationCode: string | null;
  readonly lotNumber: string | null;
  readonly expiryDate: string | null;
  readonly productionDate: string | null;
  readonly lpTypeId: string | null;
  readonly lpTypeCode: string | null;
  readonly lpNumber: string | null;
  readonly note: string | null;
  readonly tracking: { readonly lot: boolean; readonly expiry: boolean; readonly production: boolean; readonly serial: boolean };
  readonly version: number;
  /** Pre-advised serials (Import PO Serial Numbers), in import order. */
  readonly preAdvisedSerials: readonly PreAdvisedSerial[];
}

export function linesFor(db: AppDb, poId: string): PurchaseOrderLineRow[] {
  const p = schema.products;
  const serials = preAdvisedByLine(db, poId);
  return db.select({
    id: line.id, productId: line.productId, sku: p.sku, productName: p.name, barcode: p.barcode, imageUrl: p.imageUrl, uom: p.uom,
    packType: line.packType, uomQuantity: line.uomQuantity, orderedQuantity: line.orderedQuantity, receivedQuantity: line.receivedQuantity,
    damagedQuantity: line.damagedQuantity, unitCost: line.unitCost, receivingLocationId: line.receivingLocationId,
    receivingLocationCode: sql<string | null>`(SELECT l.code FROM locations l WHERE l.id = ${line.receivingLocationId})`,
    lotNumber: line.lotNumber, expiryDate: line.expiryDate, productionDate: line.productionDate, lpTypeId: line.lpTypeId,
    lpTypeCode: sql<string | null>`(SELECT t.code FROM lp_types t WHERE t.id = ${line.lpTypeId})`, lpNumber: line.lpNumber, note: line.note,
    trackLot: p.trackLot, trackExpiry: p.trackExpiry, trackProduction: p.trackProductionDate, trackSerial: p.trackSerial, version: line.version,
  }).from(line).innerJoin(p, eq(p.id, line.productId)).where(eq(line.purchaseOrderId, poId)).orderBy(asc(line.createdAt), sql`"purchase_order_lines".rowid`).all()
    .map(({ trackLot, trackExpiry, trackProduction, trackSerial, ...r }) => ({
      ...r,
      totalPrice: Math.round(r.orderedQuantity * r.unitCost * 100) / 100,
      tracking: { lot: Boolean(trackLot), expiry: Boolean(trackExpiry), production: Boolean(trackProduction), serial: Boolean(trackSerial) },
      preAdvisedSerials: serials.get(r.id) ?? [],
    }));
}

export interface PurchaseOrderDetail extends PurchaseOrderRow {
  readonly note: string | null;
  readonly completedAt: string | null;
  readonly cancelledAt: string | null;
  readonly customFields: Readonly<Record<string, string | boolean | null>>;
  readonly lines: readonly PurchaseOrderLineRow[];
  readonly vendor: VendorDetail | null;
  readonly warehouseCode: string;
  readonly clientCode: string;
  readonly defaultReceivingLocation: { readonly id: string; readonly code: string } | null;
  readonly attachmentCount: number;
  /** Status machine targets for the manual status pencil. */
  readonly allowedStatuses: readonly string[];
  /** Why each manual status (Pending / Started / Completed / Cancelled) is unavailable; null when allowed or current. */
  readonly statusReasons: Readonly<Record<string, string | null>>;
}

export function getPurchaseOrder(db: AppDb, scope: Scope, id: string): PurchaseOrderDetail {
  const base = db.select({ ...SELECT, note: po.note, completedAt: po.completedAt, cancelledAt: po.cancelledAt, customFields: po.customFields })
    .from(po).where(eq(po.id, id)).get();
  if (!base) throw notFoundError("Purchase order");
  assertInScope(scope, base, "Purchase order");
  const [row] = shape(db, [base], tagsFor(db, "purchase_order", [id]));
  const wh = db.select({ code: schema.warehouses.code, recv: schema.warehouses.defaultReceivingLocationId }).from(schema.warehouses).where(eq(schema.warehouses.id, base.warehouseId)).get();
  const recv = wh?.recv ? db.select({ id: schema.locations.id, code: schema.locations.code }).from(schema.locations).where(eq(schema.locations.id, wh.recv)).get() ?? null : null;
  const clientCode = db.select({ code: schema.clients.code }).from(schema.clients).where(eq(schema.clients.id, base.clientId)).get()?.code ?? "";
  let vendor: VendorDetail | null = null;
  if (base.vendorId) {
    try {
      vendor = getVendor(db, scope, base.vendorId);
    } catch {
      vendor = null;
    }
  }
  const attachmentCount = db.select({ n: sql<number>`count(*)` }).from(schema.attachments)
    .where(and(eq(schema.attachments.entityType, "purchase_order"), eq(schema.attachments.entityId, id))).get()?.n ?? 0;
  const ctx = { activeReceipts: base.activeReceipts };
  const allowedStatuses = nextPoStatuses(base.rawStatus)
    .filter((s) => s !== "Receiving" && canChangePoStatus(base.rawStatus, s, ctx).ok);
  // One state machine answers for the status modal and the Other actions menu alike: the
  // reason each manual status is unavailable (null = allowed, or the current status).
  const current = base.rawStatus === "Receiving" ? "Started" : base.rawStatus;
  const statusReasons = Object.fromEntries((["Pending", "Started", "Completed", "Cancelled"] as const).map((s) => {
    if (s === current) return [s, null];
    const check = canChangePoStatus(base.rawStatus, s, ctx);
    // Received stock is never reversed to stop expecting the balance: point to the short-close.
    if (!check.ok && s === "Cancelled" && base.activeReceipts > 0 && (base.rawStatus === "Started" || base.rawStatus === "Receiving")) return [s, SHORT_CLOSE_HINT];
    return [s, check.ok ? null : check.reason];
  })) as Record<string, string | null>;
  return {
    ...(row as PurchaseOrderRow), note: base.note, completedAt: base.completedAt, cancelledAt: base.cancelledAt, customFields: base.customFields ?? {},
    lines: linesFor(db, id), vendor, warehouseCode: wh?.code ?? "", clientCode, defaultReceivingLocation: recv, attachmentCount, allowedStatuses, statusReasons,
  };
}

/** Inline uniqueness check for step 1 (codes are globally unique: `po_code_idx`). */
export function poCodeTaken(db: AppDb, code: string, exceptId?: string | null): { taken: boolean; id: string | null } {
  const hit = db.select({ id: po.id }).from(po).where(and(sql`lower(${po.code}) = lower(${code.trim()})`, exceptId ? sql`${po.id} <> ${exceptId}` : undefined)).get();
  return { taken: Boolean(hit), id: hit?.id ?? null };
}

export interface ProductInfo {
  readonly id: string;
  readonly clientId: string;
  readonly sku: string;
  readonly name: string;
  readonly barcode: string;
  readonly imageUrl: string | null;
  readonly uom: string;
  readonly purchasePrice: number;
  readonly packTypes: readonly { readonly packType: string; readonly uomQty: number }[];
  readonly tracking: { readonly lot: boolean; readonly expiry: boolean; readonly production: boolean; readonly serial: boolean };
}

export function productInfo(db: AppDb, scope: Scope, ids: readonly string[]): ProductInfo[] {
  if (ids.length === 0) return [];
  const p = schema.products;
  const rows = db.select().from(p).where(and(inArray(p.id, [...ids]), scopedWhere(p, scope, { clientId: p.clientId }))).all();
  const packs = db.select({ productId: schema.productPackTypes.productId, packType: schema.productPackTypes.packType, uomQty: schema.productPackTypes.uomQty })
    .from(schema.productPackTypes).where(inArray(schema.productPackTypes.productId, rows.map((r) => r.id))).all();
  return rows.map((r) => {
    const own = packs.filter((k) => k.productId === r.id).map((k) => ({ packType: k.packType, uomQty: k.uomQty }));
    const packTypes = own.some((k) => k.packType === r.uom) ? own : [{ packType: r.uom, uomQty: 1 }, ...own];
    return {
      id: r.id, clientId: r.clientId, sku: r.sku, name: r.name, barcode: r.barcode, imageUrl: r.imageUrl, uom: r.uom, purchasePrice: r.purchasePrice,
      packTypes, tracking: { lot: r.trackLot, expiry: r.trackExpiry, production: r.trackProductionDate, serial: r.trackSerial },
    };
  });
}

/** Receiving tracking requirement: product flags plus the warehouse's receiving screen config. */
export function receivingRequirements(db: AppDb, warehouseId: string, product: ProductInfo["tracking"]): ProductInfo["tracking"] {
  const configs = db.select({ config: schema.screenConfigs.config }).from(schema.screenConfigs)
    .where(and(eq(schema.screenConfigs.warehouseId, warehouseId), eq(schema.screenConfigs.operationType, "Receiving"), eq(schema.screenConfigs.isActive, true))).all();
  // A tracked attribute is required unless an active screen config marks its step optional.
  const optional = new Set(configs.flatMap((c) => (c.config?.steps ?? []).filter((s) => !s.enabled || !s.required).map((s) => s.key.toLowerCase().replace(/[^a-z]/g, ""))));
  return {
    lot: product.lot && !optional.has("lot") && !optional.has("lotnumber"),
    expiry: product.expiry && !optional.has("expiry") && !optional.has("expirydate"),
    production: product.production && !optional.has("productiondate"),
    serial: product.serial,
  };
}
