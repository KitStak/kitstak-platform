/**
 * `createOrder`: validation -> code generation -> address verification -> workflow run -> change log.
 * `updateOrder`: optimistic concurrency + field locks by status (lines are read-only once
 * the order is allocated / picking starts).
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import { verifyAddress } from "../address-verification";
import { recordCreate, recordLine, recordUpdate } from "../change-log";
import { DomainError } from "../errors";
import type { OrderLineRow, OrderRow } from "../facts";
import { next } from "../sequences";
import { checkScope, type DomainCtx, type Tx } from "../types";
import { runWorkflows } from "../workflows";
import { ADDRESS_FIELDS, createOrderSchema, updateOrderSchema, type CreateOrderInput, type OrderLineInput, type UpdateOrderInput } from "./schemas";

type ProductRow = typeof schema.products.$inferSelect;

export function loadOrderRow(tx: Tx, ctx: DomainCtx, id: string): OrderRow {
  const order = tx.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, id)).get();
  if (!order || order.deletedAt) throw new DomainError("NOT_FOUND", "Shipment order not found");
  checkScope(ctx, order, "Shipment order");
  return order;
}

function loadProducts(tx: Tx, clientId: string, lines: readonly { productId: string }[]): Map<string, ProductRow> {
  const ids = [...new Set(lines.map((l) => l.productId))];
  const rows = tx.select().from(schema.products).where(inArray(schema.products.id, ids)).all();
  const map = new Map(rows.map((p) => [p.id, p]));
  for (const id of ids) {
    const p = map.get(id);
    if (!p) throw new DomainError("VALIDATION", "A line references a product that does not exist.");
    if (p.clientId !== clientId) throw new DomainError("VALIDATION", `Product ${p.sku} belongs to another client.`);
    if (p.status !== "Active") throw new DomainError("VALIDATION", `Product ${p.sku} is inactive.`);
  }
  return map;
}

function lineValues(orderId: string, line: OrderLineInput, product: ProductRow, ctx: DomainCtx): typeof schema.orderLines.$inferInsert {
  return {
    orderId, productId: product.id, quantity: line.quantity, unitPrice: line.unitPrice ?? product.price, packType: line.packType ?? product.uom,
    lotNumber: line.lotNumber ?? null, expiryDate: line.expiryDate ?? null, productionDate: line.productionDate ?? null,
    damageReason: line.damageReason ?? null, pinnedLocationId: line.pinnedLocationId ?? null, pinnedLpId: line.pinnedLpId ?? null,
    lineNote1: line.lineNote1 ?? null, lineNote2: line.lineNote2 ?? null, lineNote3: line.lineNote3 ?? null,
    createdBy: ctx.userId, updatedBy: ctx.userId,
  };
}

function totals(lines: readonly OrderLineInput[], products: ReadonlyMap<string, ProductRow>): { totalQuantity: number; totalWeightOz: number; salesPrice: number } {
  let totalQuantity = 0;
  let totalWeightOz = 0;
  let salesPrice = 0;
  for (const l of lines) {
    const p = products.get(l.productId);
    totalQuantity += l.quantity;
    totalWeightOz += (p?.weightOz ?? 0) * l.quantity;
    salesPrice += (l.unitPrice ?? p?.price ?? 0) * l.quantity;
  }
  return { totalQuantity, totalWeightOz: Math.round(totalWeightOz * 100) / 100, salesPrice: Math.round(salesPrice * 100) / 100 };
}

function addressCheck(a: { shipAddress: string; shipAddress2?: string | null; shipCity: string; shipState?: string | null; shipZip: string; shipCountry: string }, skip: boolean) {
  if (skip) return null;
  return verifyAddress({ line1: a.shipAddress, line2: a.shipAddress2, city: a.shipCity, state: a.shipState, postalCode: a.shipZip, country: a.shipCountry });
}

export interface CreateOrderOptions {
  readonly trigger?: "Shipment Order Created" | "Shipment Order Imported";
}

export function createOrder(tx: Tx, ctx: DomainCtx, raw: CreateOrderInput, opts: CreateOrderOptions = {}): OrderRow {
  const input = createOrderSchema.parse(raw);
  checkScope(ctx, input, "Warehouse");
  const wh = tx.select().from(schema.warehouses).where(eq(schema.warehouses.id, input.warehouseId)).get();
  if (!wh || !wh.isActive) throw new DomainError("VALIDATION", "Warehouse not found or inactive");
  const client = tx.select().from(schema.clients).where(eq(schema.clients.id, input.clientId)).get();
  if (!client || client.status !== "Active") throw new DomainError("VALIDATION", "Client not found or inactive");
  const products = loadProducts(tx, client.id, input.lines);
  if (input.code && tx.select({ id: schema.shipmentOrders.id }).from(schema.shipmentOrders).where(eq(schema.shipmentOrders.code, input.code)).get()) {
    throw new DomainError("DUPLICATE", `Shipment order code ${input.code} already exists.`);
  }
  const code = input.code ?? next(tx, "so");
  const check = addressCheck(input, input.skipAddressVerification);
  const { lines, customFields, orderDate, ...header } = input;
  const order = tx.insert(schema.shipmentOrders).values({
    ...header, code, status: "Open", orderDate: orderDate ?? new Date().toISOString(), customFields: customFields ?? {},
    ...totals(lines, products),
    shipAddress: check?.normalized.line1 ?? input.shipAddress, shipAddress2: check ? null : input.shipAddress2 ?? null,
    shipState: check?.normalized.state ?? input.shipState, shipCountry: check?.normalized.country ?? input.shipCountry,
    addressVerificationStatus: check?.status ?? "Skipped", addressVerificationNotes: check ? [...check.notes] : null,
    addressType: input.addressType ?? (check?.isMilitary ? "Military" : null),
    createdBy: ctx.userId, updatedBy: ctx.userId,
  }).returning().get();
  const inserted = tx.insert(schema.orderLines).values(lines.map((l) => lineValues(order.id, l, products.get(l.productId) as ProductRow, ctx))).returning().all();
  recordCreate(tx, ctx, { entityType: "shipment_order", entityId: order.id, entityCode: order.code });
  // One entry per line (Logiwa: "<SKU> -> Shipment Order Line is created"), for UI, import and channel creates alike.
  for (const line of inserted) {
    recordLine(tx, ctx, {
      entityType: "shipment_order", entityId: order.id, entityCode: order.code, lineEntityType: "order_line", lineEntityId: line.id,
      lineLabel: products.get(line.productId)?.sku ?? "Line", field: "quantity", from: 0, to: line.quantity,
    });
  }
  runWorkflows(tx, ctx, opts.trigger ?? "Shipment Order Created", { type: "shipment_order", id: order.id });
  return loadOrderRow(tx, ctx, order.id);
}

const TERMINAL: readonly OrderRow["status"][] = ["Shipped", "Partially Shipped", "Delivered", "Cancelled"];
const LINE_EDITABLE: readonly OrderRow["status"][] = ["Open", "Shortage", "On Hold"];
const NOTE_FIELDS = new Set(["note", "extraNote1", "extraNote2", "extraNote3", "extraNote4", "extraNote5", "customFields"]);

function replaceLines(tx: Tx, ctx: DomainCtx, order: OrderRow, lines: NonNullable<ReturnType<typeof updateOrderSchema.parse>["lines"]>): ReturnType<typeof totals> {
  const existing = tx.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, order.id)).all();
  if (existing.some((l) => l.allocatedQuantity > 0 || l.pickedQuantity > 0)) {
    throw new DomainError("INVALID_STATE", "Deallocate the order before changing its lines.");
  }
  const products = loadProducts(tx, order.clientId, [...lines, ...existing]);
  const keep = new Set(lines.flatMap((l) => (l.id ? [l.id] : [])));
  const byId = new Map(existing.map((l) => [l.id, l]));
  const sku = (productId: string) => products.get(productId)?.sku ?? productId;
  const log = (line: OrderLineRow | { id: string; productId: string }, from: number, to: number) =>
    recordLine(tx, ctx, { entityType: "shipment_order", entityId: order.id, entityCode: order.code, lineEntityType: "order_line", lineEntityId: line.id, lineLabel: sku(line.productId), field: "quantity", from, to });
  for (const old of existing.filter((l) => !keep.has(l.id))) {
    tx.delete(schema.orderLineShortages).where(eq(schema.orderLineShortages.orderLineId, old.id)).run();
    tx.delete(schema.orderLines).where(eq(schema.orderLines.id, old.id)).run();
    log(old, old.quantity, 0);
  }
  for (const line of lines) {
    const product = products.get(line.productId) as ProductRow;
    const prior = line.id ? byId.get(line.id) : undefined;
    if (line.id && !prior) throw new DomainError("NOT_FOUND", "Order line not found");
    if (prior) {
      tx.update(schema.orderLines).set({ ...lineValues(order.id, line, product, ctx), createdBy: prior.createdBy }).where(eq(schema.orderLines.id, prior.id)).run();
      log(prior, prior.quantity, line.quantity);
    } else {
      const row = tx.insert(schema.orderLines).values(lineValues(order.id, line, product, ctx)).returning().get();
      log(row, 0, line.quantity);
    }
  }
  return totals(lines, products);
}

export function updateOrder(tx: Tx, ctx: DomainCtx, raw: UpdateOrderInput): OrderRow {
  const input = updateOrderSchema.parse(raw);
  const order = loadOrderRow(tx, ctx, input.id);
  if (order.version !== input.version) throw new DomainError("CONFLICT", "This record changed since you opened it — Reload");
  const patch = Object.fromEntries(Object.entries(input.patch).filter(([, v]) => v !== undefined));
  if (TERMINAL.includes(order.status) && (input.lines || Object.keys(patch).some((k) => !NOTE_FIELDS.has(k)))) {
    throw new DomainError("INVALID_STATE", `Only notes can be changed on an order in ${order.status} status.`);
  }
  if (input.lines && !LINE_EDITABLE.includes(order.status)) {
    throw new DomainError("INVALID_STATE", `Lines can't be changed on an order in ${order.status} status.`);
  }
  const lineTotals = input.lines ? replaceLines(tx, ctx, order, input.lines) : null;
  const merged = { ...order, ...patch };
  const addressChanged = ADDRESS_FIELDS.some((f) => f in patch && patch[f] !== order[f]);
  const check = addressChanged ? addressCheck(merged, merged.skipAddressVerification) : null;
  const after = tx.update(schema.shipmentOrders).set({
    ...patch, ...(lineTotals ?? {}),
    ...(check ? {
      shipAddress: check.normalized.line1, shipAddress2: null, shipState: check.normalized.state ?? merged.shipState,
      shipCountry: check.normalized.country, addressVerificationStatus: check.status, addressVerificationNotes: [...check.notes],
    } : {}),
    updatedBy: ctx.userId, version: sql`${schema.shipmentOrders.version} + 1`,
  }).where(and(eq(schema.shipmentOrders.id, order.id), eq(schema.shipmentOrders.version, input.version))).returning().get();
  if (!after) throw new DomainError("CONFLICT", "This record changed since you opened it — Reload");
  recordUpdate(tx, ctx, { entityType: "shipment_order", entityId: order.id, entityCode: order.code, before: order, after });
  runWorkflows(tx, ctx, "Shipment Order Updated", { type: "shipment_order", id: order.id });
  return loadOrderRow(tx, ctx, order.id);
}
