/**
 * Return orders (RMA) — M04 owns `return_orders` / `return_order_lines` (Part C1).
 * Detail, shippable lines for Create RMA, create, status transitions (state machine +
 * guards), return labels (shipping ops) and change_log on every write.
 */
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { RETURN_STATUSES, type ReturnStatus } from "@/lib/enums";
import type { AppDb } from "@/server/api/db";
import type { AuthContext } from "@/server/auth/context";
import type { Scope } from "@/server/auth/scope";
import { assertInScope } from "@/server/auth/scope";
import * as schema from "@/server/db/schema";
import { changeLog, runBulk, sequences, shipping, stateMachines } from "@/server/domain";
import { validationError } from "@/server/api/errors";
import { DomainError } from "@/server/domain/errors";
import type { BulkResult, DomainCtx } from "@/server/domain/types";
import { assertVersion, bulkIdsSchema, idSchema } from "./platform-common";

export const RETURN_PERMISSIONS = {
  view: "inventory.return_orders.view",
  changeStatus: "inventory.return_orders.change_status",
  tag: "inventory.return_orders.tag",
  createRma: "fulfillment.shipment_orders.create_rma",
  returnLabel: "fulfillment.shipment_orders.create_return_label",
  station: "inventory.return_station.view",
  /** Receiving at the Return Station posts inventory: execution permission (viewers lack it). See docs/requests/stations-returns.md REQ-1. */
  receive: "fulfillment.task_details.execute_task",
} as const;

/** Domain ctx carrying the caller's full scope (cross-scope -> 404). */
export type ScopedCtx = DomainCtx & { readonly scope: Scope };
export function scopedCtx(actor: { readonly userId: string | null; readonly source: string }, auth: AuthContext): ScopedCtx {
  return { userId: actor.userId, source: actor.source, scope: auth.scope };
}

export const RETURNABLE_ORDER_STATUSES = ["Shipped", "Partially Shipped", "Delivered"] as const;

type ReturnRow = typeof schema.returnOrders.$inferSelect;
type LineRow = typeof schema.returnOrderLines.$inferSelect;

/* ------------------------------------------------------------------ guards */

export interface TransitionOption {
  readonly status: ReturnStatus;
  readonly ok: boolean;
  readonly reason: string | null;
}

/**
 * Legal next statuses for an RMA. Beyond the machine: Completed needs at least one unit
 * received; Cancelled is only possible while nothing has been received.
 */
export function transitionOptions(status: ReturnStatus, receivedQty: number): readonly TransitionOption[] {
  return RETURN_STATUSES.filter((s) => s !== status).map((to) => {
    const check = stateMachines.returnOrder.canTransition(status, to);
    if (!check.ok) {
      const terminal = status === "Completed" || status === "Cancelled";
      return { status: to, ok: false, reason: terminal ? `${status} returns can't be changed.` : check.reason };
    }
    if (to === "Completed" && receivedQty === 0) return { status: to, ok: false, reason: "Receive at least one unit at the Return Station before completing." };
    if (to === "Cancelled" && receivedQty > 0) return { status: to, ok: false, reason: "Units were already received. Complete the return instead." };
    if (to === "Started" && receivedQty === 0 && status === "Pending") return { status: to, ok: true, reason: null };
    return { status: to, ok: true, reason: null };
  });
}

function receivedTotal(db: AppDb, returnOrderId: string): number {
  return db.get<{ n: number }>(sql`SELECT COALESCE(SUM(returned_qty), 0) AS n FROM return_order_lines WHERE return_order_id = ${returnOrderId}`)?.n ?? 0;
}

export function loadReturn(db: AppDb, scope: Scope, id: string): ReturnRow {
  const ro = db.select().from(schema.returnOrders).where(eq(schema.returnOrders.id, id)).get();
  assertInScope(scope, ro, "Return order");
  return ro as ReturnRow;
}

/* ------------------------------------------------------------------ detail */

export interface ReturnDetail {
  readonly id: string;
  readonly rmaCode: string;
  readonly status: ReturnStatus;
  readonly source: string;
  readonly version: number;
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly customerName: string | null;
  readonly fromCountry: string | null;
  readonly note: string | null;
  readonly createdAt: string;
  readonly createdByName: string;
  readonly updatedAt: string;
  readonly expectedReturnDate: string | null;
  readonly actualReturnDate: string | null;
  readonly carrierCode: string | null;
  readonly carrierServiceName: string | null;
  readonly trackingNumber: string | null;
  readonly order: { readonly id: string; readonly code: string; readonly storeOrderNumber: string | null; readonly channel: string; readonly status: string; readonly orderDate: string; readonly shippedAt: string | null; readonly deliveredAt: string | null; readonly shipTo: string } | null;
  readonly label: { readonly shipmentId: string; readonly trackingNumber: string; readonly labelFileId: string | null; readonly labelStatus: string; readonly serviceName: string | null; readonly carrierCode: string | null; readonly shippingCost: number; readonly createdAt: string } | null;
  readonly lines: readonly {
    readonly id: string; readonly productId: string; readonly sku: string; readonly name: string; readonly imageUrl: string | null; readonly packType: string;
    readonly requestedQty: number; readonly returnedQty: number; readonly lineStatus: string; readonly disposition: string | null;
    readonly customerReturnReason: string | null; readonly actualReturnReason: string | null; readonly shippedQty: number | null;
  }[];
  readonly receipts: readonly {
    readonly id: string; readonly receiptNo: number; readonly sku: string; readonly quantity: number; readonly locationCode: string; readonly lpNumber: string | null;
    readonly damageReason: string | null; readonly actualReturnReason: string | null; readonly note: string | null; readonly receivedBy: string; readonly receivedAt: string; readonly cancelledAt: string | null;
  }[];
  readonly receivedQty: number;
  readonly requestedQty: number;
  readonly transitions: readonly TransitionOption[];
  readonly tagIds: readonly string[];
}

const lookupName = (db: AppDb, id: string | null): string | null =>
  id ? db.select({ name: schema.lookupValues.name }).from(schema.lookupValues).where(eq(schema.lookupValues.id, id)).get()?.name ?? null : null;

export function getReturnDetail(db: AppDb, scope: Scope, id: string): ReturnDetail {
  const ro = loadReturn(db, scope, id);
  const wh = db.select().from(schema.warehouses).where(eq(schema.warehouses.id, ro.warehouseId)).get();
  const client = db.select().from(schema.clients).where(eq(schema.clients.id, ro.clientId)).get();
  const creator = ro.createdBy ? db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, ro.createdBy)).get() : undefined;
  const so = ro.shipmentOrderId ? db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, ro.shipmentOrderId)).get() : undefined;
  const label = ro.returnLabelShipmentId ? db.select().from(schema.shipments).where(eq(schema.shipments.id, ro.returnLabelShipmentId)).get() : undefined;
  const lines = db.select({ l: schema.returnOrderLines, p: schema.products }).from(schema.returnOrderLines)
    .innerJoin(schema.products, eq(schema.products.id, schema.returnOrderLines.productId))
    .where(eq(schema.returnOrderLines.returnOrderId, ro.id)).orderBy(asc(schema.products.sku)).all();
  const orderLineIds = lines.flatMap((r) => (r.l.orderLineId ? [r.l.orderLineId] : []));
  const shipped = new Map(orderLineIds.length
    ? db.select({ id: schema.orderLines.id, q: schema.orderLines.shippedQuantity }).from(schema.orderLines).where(inArray(schema.orderLines.id, orderLineIds)).all().map((r) => [r.id, r.q])
    : []);
  const receipts = db.select({ r: schema.receipts, sku: schema.products.sku, loc: schema.locations.code, lp: schema.licensePlates.number })
    .from(schema.receipts).innerJoin(schema.products, eq(schema.products.id, schema.receipts.productId))
    .innerJoin(schema.locations, eq(schema.locations.id, schema.receipts.locationId))
    .leftJoin(schema.licensePlates, eq(schema.licensePlates.id, schema.receipts.lpId))
    .where(eq(schema.receipts.returnOrderId, ro.id)).orderBy(asc(schema.receipts.receivedAt)).all();
  const tagIds = db.select({ id: schema.entityTags.tagId }).from(schema.entityTags)
    .where(and(eq(schema.entityTags.entityType, "return_order"), eq(schema.entityTags.entityId, ro.id))).all().map((t) => t.id);
  const receivedQty = lines.reduce((s, r) => s + r.l.returnedQty, 0);
  return {
    id: ro.id, rmaCode: ro.rmaCode, status: ro.status, source: ro.source, version: ro.version,
    warehouseId: ro.warehouseId, warehouseCode: wh?.code ?? "", clientId: ro.clientId, clientName: client?.name ?? "",
    customerName: ro.customerName ?? so?.customerName ?? null, fromCountry: ro.fromCountry, note: ro.note,
    createdAt: ro.createdAt, createdByName: creator?.name ?? "System", updatedAt: ro.updatedAt,
    expectedReturnDate: ro.expectedReturnDate, actualReturnDate: ro.actualReturnDate,
    carrierCode: ro.carrierCode, carrierServiceName: ro.carrierServiceName, trackingNumber: ro.trackingNumber,
    order: so ? {
      id: so.id, code: so.code, storeOrderNumber: so.storeOrderNumber, channel: so.channel, status: so.status, orderDate: so.orderDate,
      shippedAt: so.shippedAt, deliveredAt: so.deliveredAt, shipTo: [so.shipAddress, so.shipCity, so.shipState, so.shipZip].filter(Boolean).join(", "),
    } : null,
    label: label ? {
      shipmentId: label.id, trackingNumber: label.trackingNumber, labelFileId: label.labelFileId, labelStatus: label.labelStatus,
      serviceName: label.serviceName, carrierCode: label.carrierCode, shippingCost: label.shippingCost, createdAt: label.labelCreatedAt ?? "",
    } : null,
    lines: lines.map(({ l, p }) => ({
      id: l.id, productId: p.id, sku: p.sku, name: p.name, imageUrl: p.imageUrl, packType: l.packType, requestedQty: l.requestedQty,
      returnedQty: l.returnedQty, lineStatus: l.lineStatus, disposition: l.disposition,
      customerReturnReason: lookupName(db, l.customerReturnReasonId), actualReturnReason: lookupName(db, l.actualReturnReasonId),
      shippedQty: l.orderLineId ? shipped.get(l.orderLineId) ?? null : null,
    })),
    receipts: receipts.map(({ r, sku, loc, lp }) => ({
      id: r.id, receiptNo: r.masterId, sku, quantity: r.quantity, locationCode: loc, lpNumber: lp ?? null, damageReason: r.damageReason,
      actualReturnReason: r.actualReturnReason, note: r.note, receivedBy: r.receivedBy, receivedAt: r.receivedAt, cancelledAt: r.cancelledAt,
    })),
    receivedQty,
    requestedQty: lines.reduce((s, r) => s + r.l.requestedQty, 0),
    transitions: transitionOptions(ro.status, receivedQty),
    tagIds,
  };
}

/* ------------------------------------------------------- shippable lines */

export interface ShippableLine {
  readonly orderLineId: string;
  readonly productId: string;
  readonly sku: string;
  readonly name: string;
  readonly imageUrl: string | null;
  readonly packType: string;
  readonly shippedQty: number;
  readonly alreadyReturned: number;
  readonly returnable: number;
  readonly isNonReturnable: boolean;
}

export interface ShippableOrder {
  readonly id: string;
  readonly code: string;
  readonly status: string;
  readonly warehouseId: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly customerName: string;
  readonly storeOrderNumber: string | null;
  readonly shippedAt: string | null;
  readonly deliveredAt: string | null;
  readonly shipTo: string;
  readonly shipCountry: string;
  readonly eligible: boolean;
  readonly reason: string | null;
  readonly lines: readonly ShippableLine[];
}

/** Quantity already committed to non-cancelled RMAs (Completed: returned; open: requested). */
export function committedReturnQty(db: AppDb, orderLineId: string, excludeReturnId?: string): number {
  return db.get<{ n: number }>(sql`SELECT COALESCE(SUM(CASE WHEN ro.status = 'Completed' THEN rl.returned_qty ELSE MAX(rl.requested_qty, rl.returned_qty) END), 0) AS n
    FROM return_order_lines rl JOIN return_orders ro ON ro.id = rl.return_order_id
    WHERE rl.order_line_id = ${orderLineId} AND ro.status <> 'Cancelled' ${excludeReturnId ? sql`AND ro.id <> ${excludeReturnId}` : sql``}`)?.n ?? 0;
}

export function shippableOrder(db: AppDb, scope: Scope, orderId: string): ShippableOrder {
  const so = db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, orderId)).get();
  if (!so || so.deletedAt) throw new DomainError("NOT_FOUND", "Shipment order not found");
  assertInScope(scope, so, "Shipment order");
  const client = db.select({ name: schema.clients.name }).from(schema.clients).where(eq(schema.clients.id, so.clientId)).get();
  const lines = db.select({ l: schema.orderLines, p: schema.products }).from(schema.orderLines)
    .innerJoin(schema.products, eq(schema.products.id, schema.orderLines.productId))
    .where(eq(schema.orderLines.orderId, so.id)).orderBy(asc(schema.products.sku)).all()
    .map(({ l, p }): ShippableLine => {
      const already = committedReturnQty(db, l.id);
      return {
        orderLineId: l.id, productId: p.id, sku: p.sku, name: p.name, imageUrl: p.imageUrl, packType: l.packType, shippedQty: l.shippedQuantity,
        alreadyReturned: already, returnable: Math.max(0, l.shippedQuantity - already), isNonReturnable: p.isNonReturnable,
      };
    });
  const shippedStatus = (RETURNABLE_ORDER_STATUSES as readonly string[]).includes(so.status);
  const anyReturnable = lines.some((l) => l.returnable > 0 && !l.isNonReturnable);
  const reason = !shippedStatus ? `Order ${so.code} is ${so.status}. Only shipped orders can be returned.`
    : !anyReturnable ? `Every shipped unit of ${so.code} is already on a return.` : null;
  return {
    id: so.id, code: so.code, status: so.status, warehouseId: so.warehouseId, clientId: so.clientId, clientName: client?.name ?? "",
    customerName: so.customerName, storeOrderNumber: so.storeOrderNumber, shippedAt: so.shippedAt, deliveredAt: so.deliveredAt,
    shipTo: [so.shipAddress, so.shipCity, so.shipState, so.shipZip].filter(Boolean).join(", "), shipCountry: so.shipCountry,
    eligible: reason === null, reason, lines,
  };
}

/* ---------------------------------------------------------------- create */

export const packageSchema = z.object({
  weightOz: z.number().positive("Weight must be greater than 0").max(2400, "Max 150 lb"),
  length: z.number().positive("Length is required"),
  width: z.number().positive("Width is required"),
  height: z.number().positive("Height is required"),
});

export const returnLabelSchema = z.object({
  carrierConnectionId: idSchema,
  carrierServiceId: idSchema,
  package: packageSchema,
});

export const createRmaSchema = z.object({
  shipmentOrderId: idSchema,
  lines: z.array(z.object({
    orderLineId: idSchema,
    quantity: z.number().int().min(1, "Quantity must be at least 1"),
    customerReturnReasonId: idSchema.nullish(),
  })).min(1, "Select at least one line to return"),
  expectedReturnDate: z.string().trim().max(40).nullish(),
  note: z.string().trim().max(1000).nullish(),
  label: returnLabelSchema.nullish(),
});
export type CreateRmaInput = z.output<typeof createRmaSchema>;

export interface CreateRmaResult {
  readonly id: string;
  readonly rmaCode: string;
  readonly status: ReturnStatus;
  readonly trackingNumber: string | null;
  readonly labelFileId: string | null;
  readonly labelError: string | null;
}

/** Synchronous part (inside a transaction): validates quantities and inserts the RMA as Pending. */
export function insertRma(tx: AppDb, ctx: ScopedCtx, input: CreateRmaInput): { id: string; rmaCode: string; orderId: string } {
  const order = shippableOrder(tx, ctx.scope, input.shipmentOrderId);
  if (!(RETURNABLE_ORDER_STATUSES as readonly string[]).includes(order.status)) {
    throw new DomainError("INVALID_STATE", `Order ${order.code} is ${order.status}. Only shipped orders can be returned.`);
  }
  const seen = new Set<string>();
  const fieldErrors: Record<string, string[]> = {};
  input.lines.forEach((l, i) => {
    const line = order.lines.find((x) => x.orderLineId === l.orderLineId);
    if (!line) { fieldErrors[`lines.${i}.orderLineId`] = ["This line is not on the order"]; return; }
    if (seen.has(l.orderLineId)) fieldErrors[`lines.${i}.orderLineId`] = ["Line selected twice"];
    seen.add(l.orderLineId);
    if (line.isNonReturnable) fieldErrors[`lines.${i}.quantity`] = [`${line.sku} is marked non-returnable`];
    else if (l.quantity > line.returnable) fieldErrors[`lines.${i}.quantity`] = [`Max ${line.returnable} (shipped ${line.shippedQty}, already on returns ${line.alreadyReturned})`];
  });
  if (Object.keys(fieldErrors).length > 0) {
    const first = Object.values(fieldErrors)[0]?.[0] ?? "Invalid lines";
    throw validationError(first, fieldErrors);
  }
  const rmaCode = sequences.next(tx, "rma");
  const ro = tx.insert(schema.returnOrders).values({
    rmaCode, shipmentOrderId: order.id, warehouseId: order.warehouseId, clientId: order.clientId, source: "RMA", status: "Pending",
    customerName: order.customerName, fromCountry: order.shipCountry, expectedReturnDate: input.expectedReturnDate ?? null,
    note: input.note ?? null, createdBy: ctx.userId, updatedBy: ctx.userId,
  }).returning().get();
  for (const l of input.lines) {
    const line = order.lines.find((x) => x.orderLineId === l.orderLineId) as ShippableLine;
    tx.insert(schema.returnOrderLines).values({
      returnOrderId: ro.id, orderLineId: line.orderLineId, productId: line.productId, packType: line.packType, requestedQty: l.quantity,
      customerReturnReasonId: l.customerReturnReasonId ?? null, createdBy: ctx.userId,
    }).run();
  }
  changeLog.recordCreate(tx, ctx, { entityType: "return_order", entityId: ro.id, entityCode: rmaCode });
  return { id: ro.id, rmaCode, orderId: order.id };
}

/**
 * Buys a return label for an RMA (shipping ops `return-label`) and stamps carrier,
 * service and tracking on the RMA. The RMA keeps its status (Pending until the carrier
 * scans it), so the label is bought without `returnOrderId` and linked here.
 */
export async function attachReturnLabel(db: AppDb, ctx: ScopedCtx, returnOrderId: string, label: z.output<typeof returnLabelSchema>): Promise<{ trackingNumber: string; labelFileId: string | null }> {
  const ro = loadReturn(db, ctx.scope, returnOrderId);
  if (!ro.shipmentOrderId) throw new DomainError("INVALID_STATE", "Return labels need a shipment order. Manual returns have none.");
  if (ro.status === "Completed" || ro.status === "Cancelled") throw new DomainError("INVALID_STATE", `A ${ro.status.toLowerCase()} return can't get a new label.`);
  const res = await shipping.createReturnLabel(db, ctx, {
    orderId: ro.shipmentOrderId, carrierConnectionId: label.carrierConnectionId, carrierServiceId: label.carrierServiceId, package: label.package,
  });
  db.transaction((tx) => {
    const after = tx.update(schema.returnOrders).set({
      trackingNumber: res.trackingNumber, returnLabelShipmentId: res.shipment.id, carrierCode: res.shipment.carrierCode,
      carrierServiceName: res.shipment.serviceName, updatedBy: ctx.userId, version: sql`${schema.returnOrders.version} + 1`,
    }).where(eq(schema.returnOrders.id, ro.id)).returning().get();
    changeLog.recordUpdate(tx, ctx, {
      entityType: "return_order", entityId: ro.id, entityCode: ro.rmaCode,
      before: { trackingNumber: ro.trackingNumber, carrierCode: ro.carrierCode, carrierServiceName: ro.carrierServiceName },
      after: { trackingNumber: after.trackingNumber, carrierCode: after.carrierCode, carrierServiceName: after.carrierServiceName },
    });
  });
  return { trackingNumber: res.trackingNumber, labelFileId: res.shipment.labelFileId };
}

export async function createRma(db: AppDb, ctx: ScopedCtx, input: CreateRmaInput): Promise<CreateRmaResult> {
  const created = db.transaction((tx) => insertRma(tx, ctx, input));
  if (!input.label) return { id: created.id, rmaCode: created.rmaCode, status: "Pending", trackingNumber: null, labelFileId: null, labelError: null };
  try {
    const label = await attachReturnLabel(db, ctx, created.id, input.label);
    return { id: created.id, rmaCode: created.rmaCode, status: "Pending", trackingNumber: label.trackingNumber, labelFileId: label.labelFileId, labelError: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Return label could not be created";
    return { id: created.id, rmaCode: created.rmaCode, status: "Pending", trackingNumber: null, labelFileId: null, labelError: message };
  }
}

/* ------------------------------------------------------------ status */

export const changeStatusSchema = z.object({
  ids: bulkIdsSchema,
  status: z.enum(RETURN_STATUSES),
  note: z.string().trim().max(500).nullish(),
  version: z.number().int().min(1).optional(),
});

function applyStatus(tx: AppDb, ctx: ScopedCtx, ro: ReturnRow, to: ReturnStatus, note?: string | null): ReturnRow {
  const received = receivedTotal(tx, ro.id);
  const option = transitionOptions(ro.status, received).find((o) => o.status === to);
  if (!option || !option.ok) throw new DomainError("INVALID_STATE", option?.reason ?? `The return is already ${to}.`);
  const status = stateMachines.returnOrder.transition(ro.status, to);
  const now = new Date().toISOString();
  const after = tx.update(schema.returnOrders).set({
    status, updatedBy: ctx.userId, version: sql`${schema.returnOrders.version} + 1`,
    ...(status === "Completed" && !ro.actualReturnDate ? { actualReturnDate: now } : {}),
    ...(note ? { note: ro.note ? `${ro.note}\n${note}` : note } : {}),
  }).where(eq(schema.returnOrders.id, ro.id)).returning().get();
  if (status === "Completed" || status === "Cancelled") {
    tx.update(schema.returnOrderLines).set({ lineStatus: status, updatedBy: ctx.userId })
      .where(and(eq(schema.returnOrderLines.returnOrderId, ro.id), ne(schema.returnOrderLines.lineStatus, "Completed"))).run();
  } else if (status === "In Transit") {
    tx.update(schema.returnOrderLines).set({ lineStatus: "In Transit", updatedBy: ctx.userId })
      .where(and(eq(schema.returnOrderLines.returnOrderId, ro.id), eq(schema.returnOrderLines.lineStatus, "Pending"))).run();
  }
  changeLog.recordUpdate(tx, ctx, {
    entityType: "return_order", entityId: ro.id, entityCode: ro.rmaCode,
    before: { status: ro.status, actualReturnDate: ro.actualReturnDate }, after: { status: after.status, actualReturnDate: after.actualReturnDate },
  });
  return after;
}

export function changeReturnStatus(tx: AppDb, ctx: ScopedCtx, input: z.output<typeof changeStatusSchema>): BulkResult {
  return runBulk(tx, input.ids, (inner, id) => {
    const ro = loadReturn(inner, ctx.scope, id);
    if (input.ids.length === 1) assertVersion(ro.version, input.version);
    applyStatus(inner, ctx, ro, input.status, input.note);
  });
}

/** Per-status eligibility for a selection (the Change Status modal only offers legal moves). */
export function selectionTransitions(db: AppDb, scope: Scope, ids: readonly string[]): { readonly returns: readonly { id: string; rmaCode: string; status: ReturnStatus }[]; readonly options: readonly (TransitionOption & { readonly eligible: number })[] } {
  const rows = [...new Set(ids)].map((id) => loadReturn(db, scope, id));
  const per = rows.map((ro) => transitionOptions(ro.status, receivedTotal(db, ro.id)));
  const options = RETURN_STATUSES.map((status) => {
    const results = per.map((opts) => opts.find((o) => o.status === status) ?? { status, ok: false, reason: `Already ${status}.` });
    const eligible = results.filter((r) => r.ok).length;
    const firstReason = results.find((r) => !r.ok)?.reason ?? null;
    return { status, ok: eligible > 0, eligible, reason: eligible === rows.length ? null : eligible === 0 ? firstReason : `${rows.length - eligible} of ${rows.length} can't move: ${firstReason ?? ""}` };
  });
  return { returns: rows.map((r) => ({ id: r.id, rmaCode: r.rmaCode, status: r.status })), options };
}

/** Line ids → their return order ids (grid rows are RMA lines; bulk actions act on RMAs). */
export function returnIdsForLines(db: AppDb, scope: Scope, lineIds: readonly string[]): string[] {
  if (lineIds.length === 0) return [];
  const rows = db.select({ id: schema.returnOrders.id, warehouseId: schema.returnOrders.warehouseId, clientId: schema.returnOrders.clientId })
    .from(schema.returnOrderLines).innerJoin(schema.returnOrders, eq(schema.returnOrders.id, schema.returnOrderLines.returnOrderId))
    .where(inArray(schema.returnOrderLines.id, [...lineIds])).all();
  return [...new Set(rows.filter((r) => {
    try { assertInScope(scope, r, "Return order"); return true; } catch { return false; }
  }).map((r) => r.id))];
}

export type { LineRow as ReturnLineRow, ReturnRow };
