/**
 * Import handlers for shipment orders (BUILD_PLAN M01 §11):
 *   - shipment-orders: rows sharing an Order Code form one order (the first row creates
 *     it, later rows of the same batch add lines);
 *   - shipment-orders-update: keyed by code, only the filled columns change;
 *   - so-serials: assigns a registered serial number to an order line.
 * Each row runs in its own savepoint (pipeline), so a bad row fails alone.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import { schema } from "@/server/db";
import { changeLog, orders, type DomainCtx } from "@/server/domain";
import { DomainError } from "@/server/domain/errors";
import { countryName, isCountryCode } from "@/lib/countries";
import type { ImportApplyContext, ImportApplyResult, ImportRowValues } from "@/server/imports/types";
import { changeLine, createOrder, createOrderBodySchema, updateOrder, updateOrderBodySchema } from "./orders-commands";

const so = schema.shipmentOrders;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : typeof v === "number" ? String(v) : null);
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null;
const PRIORITY: Readonly<Record<string, "Low" | "Medium" | "High">> = { low: "Low", medium: "Medium", high: "High" };

/** batchId -> (order code -> order id) for orders created by this batch. */
const BATCH_ORDERS = new Map<string, Map<string, string>>();
const MAX_TRACKED_BATCHES = 20;

function batchMap(batchId: string): Map<string, string> {
  let map = BATCH_ORDERS.get(batchId);
  if (!map) {
    map = new Map();
    BATCH_ORDERS.set(batchId, map);
    if (BATCH_ORDERS.size > MAX_TRACKED_BATCHES) BATCH_ORDERS.delete(BATCH_ORDERS.keys().next().value as string);
  }
  return map;
}

function ctxOf(c: ImportApplyContext): DomainCtx {
  return { userId: c.actor.userId, source: c.actor.source, scope: c.auth.scope };
}

export function importCountry(value: unknown): string {
  const raw = str(value);
  if (!raw) return "United States";
  if (raw.length === 2 && isCountryCode(raw.toUpperCase())) return countryName(raw.toUpperCase());
  return raw;
}

function byCode<T extends typeof schema.clients | typeof schema.warehouses>(db: AppDb, table: T, code: string, what: string) {
  const row = db.select().from(table as typeof schema.clients).where(eq(sql`upper(${(table as typeof schema.clients).code})`, code.toUpperCase())).get();
  if (!row) throw new DomainError("VALIDATION", `${what} "${code}" not found`);
  return row;
}

function resolveProduct(db: AppDb, clientId: string, sku: string) {
  const p = db.select().from(schema.products).where(and(eq(schema.products.clientId, clientId), eq(sql`upper(${schema.products.sku})`, sku.toUpperCase()))).get();
  if (!p) throw new DomainError("VALIDATION", `SKU "${sku}" not found for this client`);
  return p;
}

function shipTo(row: ImportRowValues) {
  const name = str(row.shipToName);
  const address = str(row.shipToAddress1);
  const city = str(row.shipToCity);
  const zip = str(row.shipToPostalCode);
  if (!name) throw new DomainError("VALIDATION", "Ship To Name is required for a new order");
  if (!address || !city || !zip) throw new DomainError("VALIDATION", "Ship To Address 1, City and Postal Code are required for a new order");
  return {
    customerName: name, companyName: str(row.shipToCompany), shipAddress: address, shipAddress2: str(row.shipToAddress2), shipCity: city,
    shipState: str(row.shipToState) ?? "", shipZip: zip, shipCountry: importCountry(row.shipToCountry), customerPhone: str(row.shipToPhone),
    customerEmail: str(row.shipToEmail) ?? "",
  };
}

const priorityOf = (v: unknown) => PRIORITY[(str(v) ?? "").toLowerCase()];

export function applyShipmentOrderRow(c: ImportApplyContext, row: ImportRowValues): ImportApplyResult {
  const ctx = ctxOf(c);
  const code = str(row.orderCode);
  const sku = str(row.sku);
  const quantity = num(row.quantity);
  if (!code || !sku || !quantity) throw new DomainError("VALIDATION", "Order Code, SKU and Quantity are required");
  const client = byCode(c.db, schema.clients, str(row.clientCode) ?? "", "Client");
  const warehouse = byCode(c.db, schema.warehouses, str(row.warehouseCode) ?? "", "Warehouse");
  const product = resolveProduct(c.db, client.id, sku);
  const line = { productId: product.id, quantity, unitPrice: num(row.unitPrice) ?? product.price, packType: str(row.packType) ?? undefined };
  const mine = batchMap(c.batchId);
  const existingId = mine.get(code.toUpperCase());
  if (existingId) {
    const order = orders.loadOrderRow(c.db, ctx, existingId);
    if (order.clientId !== client.id || order.warehouseId !== warehouse.id) throw new DomainError("VALIDATION", `Rows of order ${code} must use the same client and warehouse`);
    changeLine(c.db, ctx, order.id, order.version, { kind: "add", line });
    return { entityId: order.id, message: `Line ${product.sku} added to ${code}` };
  }
  if (c.db.select({ id: so.id }).from(so).where(eq(sql`upper(${so.code})`, code.toUpperCase())).get()) {
    throw new DomainError("DUPLICATE", `Shipment order code ${code} already exists`);
  }
  const body = createOrderBodySchema.parse({
    code, warehouseId: warehouse.id, clientId: client.id, channel: "Manual", storeOrderNumber: str(row.storeOrderNumber),
    orderDate: str(row.orderDate) ?? undefined, expectedShipDate: str(row.expectedShipDate), carrier: str(row.carrier), shippingService: str(row.shippingService),
    priority: priorityOf(row.priority) ?? "None", isGift: row.isGift === true, note: str(row.notes), ...shipTo(row), lines: [line],
  });
  const created = createOrder(c.db, ctx, body, { trigger: "Shipment Order Imported" });
  mine.set(code.toUpperCase(), created.id);
  return { entityId: created.id, message: `Order ${created.code} created` };
}

const UPDATE_MAP: readonly (readonly [string, string])[] = [
  ["expectedShipDate", "expectedShipDate"], ["carrier", "carrier"], ["shippingService", "shippingService"], ["shipToName", "customerName"],
  ["shipToCompany", "companyName"], ["shipToAddress1", "shipAddress"], ["shipToAddress2", "shipAddress2"], ["shipToCity", "shipCity"],
  ["shipToState", "shipState"], ["shipToPostalCode", "shipZip"], ["shipToPhone", "customerPhone"], ["shipToEmail", "customerEmail"], ["notes", "note"],
];

export function applyShipmentOrderUpdateRow(c: ImportApplyContext, row: ImportRowValues): ImportApplyResult {
  const ctx = ctxOf(c);
  const code = str(row.orderCode);
  if (!code) throw new DomainError("VALIDATION", "Order Code is required");
  const order = c.db.select().from(so).where(and(eq(sql`upper(${so.code})`, code.toUpperCase()), isNull(so.deletedAt))).get();
  if (!order) throw new DomainError("NOT_FOUND", `Shipment order ${code} not found`);
  const patch: Record<string, unknown> = {};
  for (const [column, field] of UPDATE_MAP) {
    const value = str(row[column]);
    if (value !== null) patch[field] = value;
  }
  const priority = priorityOf(row.priority);
  if (priority) patch.priority = priority;
  if (str(row.shipToCountry)) patch.shipCountry = importCountry(row.shipToCountry);
  const count = Object.keys(patch).length;
  if (count === 0) throw new DomainError("VALIDATION", "The row has no columns to update");
  updateOrder(c.db, ctx, order.id, updateOrderBodySchema.parse({ version: order.version, patch }));
  return { entityId: order.id, message: `Order ${order.code} updated (${count} field${count === 1 ? "" : "s"})` };
}

/** LOCAL ADAPTER (REQ-3): assigns a registered serial to the order line; replace with a ledger call. */
export function applySoSerialRow(c: ImportApplyContext, row: ImportRowValues): ImportApplyResult {
  const ctx = ctxOf(c);
  const code = str(row.orderCode);
  const sku = str(row.sku);
  const serial = str(row.serialNumber);
  if (!code || !sku || !serial) throw new DomainError("VALIDATION", "Order Code, SKU and Serial Number are required");
  const found = c.db.select().from(so).where(and(eq(sql`upper(${so.code})`, code.toUpperCase()), isNull(so.deletedAt))).get();
  if (!found) throw new DomainError("NOT_FOUND", `Shipment order ${code} not found`);
  const order = orders.loadOrderRow(c.db, ctx, found.id);
  if (["Shipped", "Partially Shipped", "Delivered", "Cancelled"].includes(order.status)) throw new DomainError("INVALID_STATE", `Order ${code} is ${order.status}`);
  const product = resolveProduct(c.db, order.clientId, sku);
  const line = c.db.select().from(schema.orderLines).where(and(eq(schema.orderLines.orderId, order.id), eq(schema.orderLines.productId, product.id))).get();
  if (!line) throw new DomainError("VALIDATION", `SKU ${sku} is not on order ${code}`);
  const sn = c.db.select().from(schema.serialNumbers).where(and(eq(schema.serialNumbers.productId, product.id), eq(schema.serialNumbers.primarySerial, serial))).get();
  if (!sn) throw new DomainError("NOT_FOUND", `Serial ${serial} is not registered for ${sku}`);
  if (sn.orderLineId && sn.orderLineId !== line.id) throw new DomainError("DUPLICATE", `Serial ${serial} is already assigned to another order`);
  if (sn.shipmentId) throw new DomainError("INVALID_STATE", `Serial ${serial} has already shipped`);
  const assigned = c.db.select({ n: sql<number>`count(*)` }).from(schema.serialNumbers).where(eq(schema.serialNumbers.orderLineId, line.id)).get()?.n ?? 0;
  if (!sn.orderLineId && Number(assigned) >= line.quantity) throw new DomainError("VALIDATION", `Line ${sku} already has ${line.quantity} serial numbers`);
  c.db.update(schema.serialNumbers).set({ orderLineId: line.id, updatedBy: ctx.userId }).where(eq(schema.serialNumbers.id, sn.id)).run();
  changeLog.recordLine(c.db, ctx, { entityType: "shipment_order", entityId: order.id, entityCode: order.code, lineEntityType: "order_line", lineEntityId: line.id, lineLabel: sku, field: "serialNumber", from: "", to: serial });
  return { entityId: order.id, message: `Serial ${serial} assigned to ${code}` };
}
