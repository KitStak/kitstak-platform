/**
 * Shipment Orders write side (BUILD_PLAN M01). Everything goes through the foundation
 * domain (`orders.createOrder/updateOrder/...`, `stateMachines`, `changeLog`).
 *
 * LOCAL ADAPTER (docs/requests/orders-outbound.md REQ-1): `orderHeaderSchema` does not
 * yet carry the wizard's shipping / billing / retailer / return / tax fields. Until it
 * does, `applyExtras` writes those columns in the same transaction as the domain call
 * and logs them with human-readable values. Remove it once REQ-1 lands.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppDb } from "@/server/api/db";
import { schema } from "@/server/db";
import { allocation, changeLog, jobs, orders, runBulk, sequences, tasks, type BulkResult, type DomainCtx } from "@/server/domain";
import { verifyAddress, type AddressCheck } from "@/server/domain/address-verification";
import { DomainError } from "@/server/domain/errors";
import { checkScope } from "@/server/domain/types";
import { BILLING_PARTY_TYPES, EXPORT_REASONS, TAX_TYPES } from "@/lib/enums";
import type { OrderRecord } from "./orders";

const so = schema.shipmentOrders;
const optText = (max = 500) => z.string().trim().max(max).nullish();
const isoDate = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date");

const billingAddressSchema = z.object({
  firstName: optText(100), lastName: optText(100), email: optText(200), phone: optText(50),
  line1: optText(256), line2: optText(256), city: optText(100), state: optText(100), postalCode: optText(10),
  country: optText(100), companyName: optText(200),
});

/** Columns the domain header schema does not cover yet (REQ-1). */
export const orderExtrasSchema = z.object({
  taxType: z.enum(TAX_TYPES).nullish(),
  taxId: optText(100),
  useShipAsBilling: z.boolean().optional(),
  billingAddress: billingAddressSchema.nullish(),
  scheduledPickupDate: isoDate.nullish(),
  scheduledShipmentDate: isoDate.nullish(),
  shippingChargesBillingType: z.enum(BILLING_PARTY_TYPES).nullish(),
  taxDutiesBillingType: z.enum(BILLING_PARTY_TYPES).nullish(),
  shippingAccountNumber: optText(100),
  taxDutiesAccountNumber: optText(100),
  shipmentPackageId: z.string().max(64).nullish(),
  totalShippingCost: z.number().min(0).max(1_000_000).optional(),
  discount: z.number().min(0).max(1_000_000).optional(),
  trackingNumber: optText(100),
  trackingNumbers: z.array(z.string().trim().min(1).max(100)).max(50).nullish(),
  reasonForExport: z.enum(EXPORT_REASONS).nullish(),
  returnAddressId: z.string().max(64).nullish(),
  returnCarrierServiceId: z.string().max(64).nullish(),
  returnShippingCost: z.number().min(0).max(1_000_000).nullish(),
  returnTrackingNumbers: z.array(z.string().trim().min(1).max(100)).max(50).nullish(),
  fraud: optText(500),
  packingWarningTypeId: z.string().max(64).nullish(),
  giftNote: optText(500),
  retailerId: z.string().max(64).nullish(),
  bol: optText(100), pro: optText(100), retailerPo: optText(100), dept: optText(100), markFor: optText(200),
  retailerCustomerAccount: optText(100),
  customerId: z.string().max(64).nullish(),
  priorityRank: z.number().int().min(0).max(9999).optional(),
});
export type OrderExtras = z.output<typeof orderExtrasSchema>;
const EXTRA_KEYS = Object.keys(orderExtrasSchema.shape) as (keyof OrderExtras)[];

export const createOrderBodySchema = orders.createOrderSchema.extend(orderExtrasSchema.shape);
export type CreateOrderBody = z.input<typeof createOrderBodySchema>;

export const updateOrderBodySchema = z.object({
  version: z.number().int().positive(),
  patch: orders.orderHeaderSchema.partial().extend(orderExtrasSchema.shape).default({}),
  lines: orders.updateOrderSchema.shape.lines,
});
export type UpdateOrderBody = z.input<typeof updateOrderBodySchema>;

function splitExtras<T extends Record<string, unknown>>(input: T): { header: Omit<T, keyof OrderExtras>; extras: Partial<OrderExtras> } {
  const header: Record<string, unknown> = {};
  const extras: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if ((EXTRA_KEYS as string[]).includes(key)) {
      if (value !== undefined) extras[key] = value;
    } else header[key] = value;
  }
  return { header: header as Omit<T, keyof OrderExtras>, extras: extras as Partial<OrderExtras> };
}

/* --------------------------------------------------- human-readable values */

const nameOf = (db: AppDb, table: "retailers" | "lookup" | "package" | "service" | "address", id: unknown): string | null => {
  if (typeof id !== "string" || !id) return null;
  switch (table) {
    case "retailers": return db.select({ v: schema.retailers.name }).from(schema.retailers).where(eq(schema.retailers.id, id)).get()?.v ?? null;
    case "lookup": return db.select({ v: schema.lookupValues.name }).from(schema.lookupValues).where(eq(schema.lookupValues.id, id)).get()?.v ?? null;
    case "package": return db.select({ v: schema.shipmentPackages.code }).from(schema.shipmentPackages).where(eq(schema.shipmentPackages.id, id)).get()?.v ?? null;
    case "service": return db.select({ v: schema.carrierServices.name }).from(schema.carrierServices).where(eq(schema.carrierServices.id, id)).get()?.v ?? null;
    case "address": return db.select({ v: schema.addresses.name }).from(schema.addresses).where(eq(schema.addresses.id, id)).get()?.v ?? null;
  }
};

/** Snapshot of the extra fields with ids resolved to names (change-log values). */
export function displayExtras(db: AppDb, values: Readonly<Record<string, unknown>>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const v = values[key];
    switch (key) {
      case "retailerId": out.retailer = nameOf(db, "retailers", v); break;
      case "packingWarningTypeId": out.packingWarningType = nameOf(db, "lookup", v); break;
      case "shipmentPackageId": out.shipmentPackage = nameOf(db, "package", v); break;
      case "returnCarrierServiceId": out.returnShippingOption = nameOf(db, "service", v); break;
      case "returnAddressId": out.returnAddress = nameOf(db, "address", v); break;
      case "customerId": break;
      case "trackingNumbers":
      case "returnTrackingNumbers": out[key] = Array.isArray(v) ? v.join(", ") : v ?? null; break;
      case "billingAddress": {
        const a = v as Record<string, unknown> | null | undefined;
        out.billingAddress = a ? [a.line1, a.city, a.state, a.postalCode, a.country].filter(Boolean).join(", ") : null;
        break;
      }
      default: out[key] = v ?? null;
    }
  }
  return out;
}

function applyExtras(tx: AppDb, ctx: DomainCtx, order: OrderRecord, extras: Partial<OrderExtras>, log: boolean): void {
  const keys = Object.keys(extras);
  if (keys.length === 0) return;
  if (extras.retailerId && !tx.select({ id: schema.retailers.id }).from(schema.retailers).where(eq(schema.retailers.id, extras.retailerId)).get()) {
    throw new DomainError("VALIDATION", "Retailer not found");
  }
  if (extras.shipmentPackageId) {
    const pkg = tx.select({ wh: schema.shipmentPackages.warehouseId }).from(schema.shipmentPackages).where(eq(schema.shipmentPackages.id, extras.shipmentPackageId)).get();
    if (!pkg || pkg.wh !== order.warehouseId) throw new DomainError("VALIDATION", "Shipment package not found in this warehouse");
  }
  const set = Object.fromEntries(keys.map((k) => [k, (extras as Record<string, unknown>)[k] ?? null])) as Partial<typeof so.$inferInsert>;
  if (extras.totalShippingCost === undefined) delete set.totalShippingCost;
  if (extras.discount === undefined) delete set.discount;
  tx.update(so).set({ ...set, updatedBy: ctx.userId }).where(eq(so.id, order.id)).run();
  if (log) {
    const before = displayExtras(tx, order as unknown as Record<string, unknown>, keys);
    const after = displayExtras(tx, extras as Record<string, unknown>, keys);
    changeLog.recordUpdate(tx, ctx, { entityType: "shipment_order", entityId: order.id, entityCode: order.code, before, after });
  }
}

/* ------------------------------------------------------------ create/update */

function loadOrder(tx: AppDb, ctx: DomainCtx, id: string): OrderRecord {
  return orders.loadOrderRow(tx, ctx, id);
}

export function createOrder(tx: AppDb, ctx: DomainCtx, body: z.output<typeof createOrderBodySchema>): OrderRecord {
  const { header, extras } = splitExtras(body);
  if (extras.customerId) {
    const customer = tx.select().from(schema.customers).where(eq(schema.customers.id, extras.customerId)).get();
    if (!customer || customer.clientId !== header.clientId) throw new DomainError("VALIDATION", "Customer not found for this client");
  }
  const order = orders.createOrder(tx, ctx, header as orders.CreateOrderInput);
  applyExtras(tx, ctx, order, extras, false);
  // Line entries (Logiwa: "<SKU> -> Shipment Order Line is created.").
  for (const line of tx.select({ id: schema.orderLines.id, sku: schema.products.sku, qty: schema.orderLines.quantity }).from(schema.orderLines)
    .innerJoin(schema.products, eq(schema.products.id, schema.orderLines.productId)).where(eq(schema.orderLines.orderId, order.id)).all()) {
    changeLog.recordLine(tx, ctx, { entityType: "shipment_order", entityId: order.id, entityCode: order.code, lineEntityType: "order_line", lineEntityId: line.id, lineLabel: line.sku, field: "quantity", from: 0, to: line.qty });
  }
  return loadOrder(tx, ctx, order.id);
}

export function updateOrder(tx: AppDb, ctx: DomainCtx, id: string, body: z.output<typeof updateOrderBodySchema>): OrderRecord {
  const before = loadOrder(tx, ctx, id);
  const { header, extras } = splitExtras(body.patch as Record<string, unknown>);
  if ("warehouseId" in header || "clientId" in header) throw new DomainError("VALIDATION", "Warehouse and client can't be changed on an existing order.");
  const updated = orders.updateOrder(tx, ctx, { id, version: body.version, patch: header, lines: body.lines });
  const changedExtras = Object.fromEntries(Object.entries(extras).filter(([k, v]) => JSON.stringify(v ?? null) !== JSON.stringify((before as Record<string, unknown>)[k] ?? null)));
  if (Object.keys(changedExtras).length > 0) {
    const terminal = ["Shipped", "Partially Shipped", "Delivered", "Cancelled"].includes(before.status);
    const allowed = new Set(["giftNote", "fraud", "returnCarrierServiceId", "returnShippingCost", "returnTrackingNumbers", "returnAddressId"]);
    if (terminal && Object.keys(changedExtras).some((k) => !allowed.has(k))) {
      throw new DomainError("INVALID_STATE", `Only notes and return info can be changed on an order in ${before.status} status.`);
    }
    applyExtras(tx, ctx, updated, changedExtras, true);
  }
  return loadOrder(tx, ctx, id);
}

/** Line add / edit / delete on a saved order: the domain replaces the full line set. */
export type LineOp =
  | { readonly kind: "add"; readonly line: orders.OrderLineInput }
  | { readonly kind: "edit"; readonly lineId: string; readonly patch: Partial<orders.OrderLineInput> }
  | { readonly kind: "delete"; readonly lineId: string };

export function changeLine(tx: AppDb, ctx: DomainCtx, orderId: string, version: number, op: LineOp): OrderRecord {
  const order = loadOrder(tx, ctx, orderId);
  const current = tx.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, order.id)).all();
  const asInput = (l: (typeof current)[number]) => ({
    id: l.id, productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice, packType: l.packType,
    lotNumber: l.lotNumber, expiryDate: l.expiryDate, productionDate: l.productionDate, damageReason: l.damageReason,
    pinnedLocationId: l.pinnedLocationId, pinnedLpId: l.pinnedLpId, lineNote1: l.lineNote1, lineNote2: l.lineNote2, lineNote3: l.lineNote3,
  });
  let next: (orders.OrderLineInput & { id?: string })[] = current.map(asInput);
  if (op.kind === "add") next = [...next, { ...op.line }];
  else {
    if (!current.some((l) => l.id === op.lineId)) throw new DomainError("NOT_FOUND", "Order line not found");
    if (op.kind === "delete") {
      if (current.length === 1) throw new DomainError("VALIDATION", "An order needs at least one line. Cancel or delete the order instead.");
      next = next.filter((l) => l.id !== op.lineId);
    } else next = next.map((l) => (l.id === op.lineId ? { ...l, ...op.patch, id: l.id } : l));
  }
  return orders.updateOrder(tx, ctx, { id: order.id, version, lines: next });
}

/* ----------------------------------------------------------- code / address */

export function peekOrderCode(tx: AppDb): string {
  return sequences.peek(tx, "so");
}

export function codeAvailable(db: AppDb, code: string, excludeId?: string): boolean {
  const row = db.select({ id: so.id }).from(so).where(eq(sql`upper(${so.code})`, code.trim().toUpperCase())).get();
  return !row || row.id === excludeId;
}

export const addressCheckSchema = z.object({
  line1: z.string().trim().min(1, "Address line 1 is required").max(256),
  line2: z.string().trim().max(256).nullish(),
  city: z.string().trim().max(100).default(""),
  state: z.string().trim().max(100).nullish(),
  postalCode: z.string().trim().max(10).default(""),
  country: z.string().trim().min(1).max(100),
});

export function checkAddress(input: z.output<typeof addressCheckSchema>): AddressCheck {
  return verifyAddress(input);
}

/** Re-verifies a saved order's ship-to address and stores the normalized result. */
export function verifyOrderAddress(tx: AppDb, ctx: DomainCtx, orderId: string, version: number): OrderRecord {
  const order = loadOrder(tx, ctx, orderId);
  const check = verifyAddress({ line1: order.shipAddress, line2: order.shipAddress2, city: order.shipCity, state: order.shipState, postalCode: order.shipZip, country: order.shipCountry });
  if (order.version !== version) throw new DomainError("CONFLICT", "This record changed since you opened it — Reload");
  const after = tx.update(so).set({
    shipAddress: check.normalized.line1, shipAddress2: null, shipState: check.normalized.state ?? order.shipState, shipCountry: check.normalized.country,
    addressVerificationStatus: check.status, addressVerificationNotes: [...check.notes], skipAddressVerification: false,
    updatedBy: ctx.userId, version: sql`${so.version} + 1`,
  }).where(eq(so.id, order.id)).returning().get();
  changeLog.recordUpdate(tx, ctx, { entityType: "shipment_order", entityId: order.id, entityCode: order.code, before: order, after });
  return after;
}

/* ---------------------------------------------------------- bulk commands */

export function cancelPicking(tx: AppDb, ctx: DomainCtx, ids: readonly string[]): BulkResult {
  return runBulk(tx, ids, (inner, id) => {
    const order = loadOrder(inner, ctx, id);
    const active = inner.select({ id: schema.tasks.id, status: schema.tasks.status }).from(schema.tasks)
      .where(and(eq(schema.tasks.orderId, id), inArray(schema.tasks.status, ["Pending", "Started"]), inArray(schema.tasks.taskType, ["Picking", "Packing", "Sorting"]))).all();
    if (active.length === 0) throw new DomainError("INVALID_STATE", "The Cancel Picking operation is only available for the orders that have active picking/packing tasks.");
    if (active.some((t) => t.status === "Started")) throw new DomainError("INVALID_STATE", `Picking has started for ${order.code}; finish or cancel the started tasks from the job first.`);
    tasks.cancel(inner, ctx, { taskIds: active.map((t) => t.id) });
    const fresh = loadOrder(inner, ctx, id);
    if (!fresh.jobId && ["Ready to Pick", "Shortage"].includes(fresh.status)) allocation.deallocate(inner, ctx, { orderIds: [id] });
  });
}

function resolveShort(tx: AppDb, ctx: DomainCtx, ids: readonly string[], field: "pickShortStatus" | "packShortStatus"): BulkResult {
  const label = field === "pickShortStatus" ? "pick short" : "pack short";
  return runBulk(tx, ids, (inner, id) => {
    const order = loadOrder(inner, ctx, id);
    if (order[field] !== "Open") throw new DomainError("INVALID_STATE", `Order ${order.code} has no open ${label} to resolve.`);
    inner.update(so).set({ [field]: "Resolved", updatedBy: ctx.userId, version: sql`${so.version} + 1` }).where(eq(so.id, id)).run();
    changeLog.recordUpdate(inner, ctx, { entityType: "shipment_order", entityId: id, entityCode: order.code, before: { [field]: order[field] }, after: { [field]: "Resolved" } });
  });
}

export const resolvePickShort = (tx: AppDb, ctx: DomainCtx, ids: readonly string[]): BulkResult => resolveShort(tx, ctx, ids, "pickShortStatus");
export const resolvePackShort = (tx: AppDb, ctx: DomainCtx, ids: readonly string[]): BulkResult => resolveShort(tx, ctx, ids, "packShortStatus");

export const returnInfoSchema = z.object({
  ids: z.array(z.string().min(1).max(64)).min(1).max(1000),
  returnCarrierServiceId: z.string().max(64).nullish(),
  returnShippingCost: z.number().min(0).max(1_000_000).nullish(),
  returnTrackingNumbers: z.array(z.string().trim().min(1).max(100)).max(50).nullish(),
}).refine((b) => b.returnCarrierServiceId !== undefined || b.returnShippingCost !== undefined || b.returnTrackingNumbers !== undefined, {
  message: "Enter at least one return field", path: ["returnCarrierServiceId"],
});

export function updateReturnInfo(tx: AppDb, ctx: DomainCtx, input: z.output<typeof returnInfoSchema>): BulkResult {
  const { ids, ...fields } = input;
  const extras = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as Partial<OrderExtras>;
  return runBulk(tx, ids, (inner, id) => {
    const order = loadOrder(inner, ctx, id);
    if (!["Shipped", "Partially Shipped", "Delivered"].includes(order.status)) throw new DomainError("INVALID_STATE", `Return info applies to shipped orders; ${order.code} is ${order.status}.`);
    applyExtras(inner, ctx, order, extras, true);
    inner.update(so).set({ version: sql`${so.version} + 1` }).where(eq(so.id, id)).run();
  });
}

/**
 * LOCAL ADAPTER (REQ-3): detaches the order's not-yet-shipped serial numbers. Replace
 * with `ledger.unassignOrderSerials` once foundation adds it.
 */
export function removeSerials(tx: AppDb, ctx: DomainCtx, ids: readonly string[]): BulkResult {
  return runBulk(tx, ids, (inner, id) => {
    const order = loadOrder(inner, ctx, id);
    const lines = inner.select({ id: schema.orderLines.id, sku: schema.products.sku }).from(schema.orderLines)
      .innerJoin(schema.products, eq(schema.products.id, schema.orderLines.productId)).where(eq(schema.orderLines.orderId, id)).all();
    let removed = 0;
    for (const line of lines) {
      const serials = inner.select().from(schema.serialNumbers).where(and(eq(schema.serialNumbers.orderLineId, line.id), isNull(schema.serialNumbers.shipmentId))).all();
      if (serials.length === 0) continue;
      inner.update(schema.serialNumbers).set({ orderLineId: null, updatedBy: ctx.userId }).where(inArray(schema.serialNumbers.id, serials.map((s) => s.id))).run();
      changeLog.recordLine(inner, ctx, { entityType: "shipment_order", entityId: id, entityCode: order.code, lineEntityType: "order_line", lineEntityId: line.id, lineLabel: line.sku, field: "serialNumbers", from: serials.map((s) => s.primarySerial).join(", "), to: "" });
      removed += serials.length;
    }
    if (removed === 0) throw new DomainError("INVALID_STATE", `Order ${order.code} has no serial numbers to remove.`);
  });
}

/** Removes the order from its job (Assigned Jobs "x"). */
export function unassignJob(tx: AppDb, ctx: DomainCtx, orderId: string, jobId: string): OrderRecord {
  const order = loadOrder(tx, ctx, orderId);
  jobs.removeOrderFromJob(tx, ctx, { jobId, orderId: order.id });
  return loadOrder(tx, ctx, orderId);
}

/** Copies header + lines into a new Open order with the next code. */
export function duplicateOrder(tx: AppDb, ctx: DomainCtx, orderId: string): OrderRecord {
  const src = loadOrder(tx, ctx, orderId);
  checkScope(ctx, src, "Shipment order");
  const lines = tx.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, src.id)).all();
  const header: orders.CreateOrderInput = {
    warehouseId: src.warehouseId, clientId: src.clientId, channel: "Manual", storeName: null, storeOrderNumber: src.storeOrderNumber,
    customerName: src.customerName, customerEmail: src.customerEmail, customerPhone: src.customerPhone, customerFirstName: src.customerFirstName,
    customerLastName: src.customerLastName, companyName: src.companyName, shipAddress: src.shipAddress, shipAddress2: src.shipAddress2,
    shipCity: src.shipCity, shipState: src.shipState, shipZip: src.shipZip, shipCountry: src.shipCountry, addressType: src.addressType,
    orderType: src.orderType, orderTypeId: src.orderTypeId, priority: src.priority, carrier: src.carrier, shippingService: src.shippingService,
    carrierConnectionId: src.carrierConnectionId, carrierServiceId: src.carrierServiceId, rateShoppingPresetId: src.rateShoppingPresetId,
    expectedShipDate: src.expectedShipDate, note: src.note, packingInstructions: src.packingInstructions,
    skipAddressVerification: src.skipAddressVerification, isGift: src.isGift, giftNote: src.giftNote, clientReferenceCode: src.clientReferenceCode,
    extraNote1: src.extraNote1, extraNote2: src.extraNote2, extraNote3: src.extraNote3, extraNote4: src.extraNote4, extraNote5: src.extraNote5,
    customFields: src.customFields ?? {},
    lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice, packType: l.packType, lineNote1: l.lineNote1, lineNote2: l.lineNote2, lineNote3: l.lineNote3 })),
  };
  const extras: Partial<OrderExtras> = {
    taxType: src.taxType, taxId: src.taxId, useShipAsBilling: src.useShipAsBilling, billingAddress: src.billingAddress as OrderExtras["billingAddress"],
    shippingChargesBillingType: src.shippingChargesBillingType, taxDutiesBillingType: src.taxDutiesBillingType, shipmentPackageId: src.shipmentPackageId,
    reasonForExport: src.reasonForExport, packingWarningTypeId: src.packingWarningTypeId, retailerId: src.retailerId, bol: src.bol, pro: src.pro,
    retailerPo: src.retailerPo, dept: src.dept, markFor: src.markFor, retailerCustomerAccount: src.retailerCustomerAccount, customerId: src.customerId,
  };
  return createOrder(tx, ctx, createOrderBodySchema.parse({ ...header, ...Object.fromEntries(Object.entries(extras).filter(([, v]) => v !== null && v !== undefined)) }));
}


/** Workflow-blocked banner "Release": clears the block so the order can be allocated. */
export function releaseWorkflowBlock(tx: AppDb, ctx: DomainCtx, orderId: string, version: number): OrderRecord {
  const order = loadOrder(tx, ctx, orderId);
  if (order.workflowBlocked === "None") throw new DomainError("INVALID_STATE", `Order ${order.code} is not blocked by a workflow.`);
  if (order.version !== version) throw new DomainError("CONFLICT", "This record changed since you opened it — Reload");
  const after = tx.update(so).set({ workflowBlocked: "None", updatedBy: ctx.userId, version: sql`${so.version} + 1` })
    .where(and(eq(so.id, order.id), eq(so.version, version))).returning().get();
  if (!after) throw new DomainError("CONFLICT", "This record changed since you opened it — Reload");
  changeLog.recordUpdate(tx, ctx, { entityType: "shipment_order", entityId: order.id, entityCode: order.code, before: { workflowBlocked: order.workflowBlocked }, after: { workflowBlocked: "None" } });
  return after;
}

export interface OrderBillingCharge {
  readonly feeName: string;
  readonly operationType: string;
  readonly sku: string | null;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly totalPrice: number;
  readonly activityDate: string | null;
  readonly reportCode: string;
}

/** Billing report lines that reference this order (Billing Charges card download). */
export function orderBillingCharges(db: AppDb, ctx: DomainCtx, orderId: string): readonly OrderBillingCharge[] {
  const order = loadOrder(db, ctx, orderId);
  const l = schema.billingReportLines;
  return db.select({
    feeName: l.feeName, operationType: l.operationType, sku: l.sku, quantity: l.quantity, unitPrice: l.unitPrice, totalPrice: l.adjustedPrice,
    activityDate: l.activityDate, reportCode: schema.billingReports.billNumber,
  }).from(l).innerJoin(schema.billingReports, eq(schema.billingReports.id, l.reportId))
    .where(and(eq(l.referenceNumber, order.code), eq(l.isDetail, true))).all();
}
