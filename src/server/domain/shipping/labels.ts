/**
 * Carrier calls: rate shopping, label creation (multi-package with a master tracking
 * number), void, and return labels. These are async (carrier I/O), so they take the
 * database handle and open their own short transaction for the writes; route handlers
 * use `defineRoute({ transaction: false })`.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { carrierSettingsSchema, parseSettings } from "@/lib/domain-types";
import type { AppDb } from "@/server/api/db";
import * as schema from "@/server/db/schema";
import { CarrierError, type CarrierAddress, type LabelFormat, type LabelType, type PackageSpec, type RateQuote } from "../carriers";
import { recordUpdate } from "../change-log";
import { DomainError } from "../errors";
import type { OrderRow } from "../facts";
import { stateMachines } from "../state-machines";
import type { DomainCtx } from "../types";
import { attachLabelsToManifest, detachVoidedFromManifest } from "./ship";
import {
  applyMarkup, filesOf, loadCarrier, loadOrder, loadService, orderAddress, warehouseAddress, writeCallLog, type ShippingOptions,
} from "./common";

export type ShipmentRow = typeof schema.shipments.$inferSelect;

export interface PackageInput extends PackageSpec {
  readonly shipmentPackageId?: string | null;
  /** Lines in this package; defaults to every packed line in the first package. */
  readonly items?: readonly { readonly orderLineId: string; readonly qty: number }[];
}

// Open / Ready to Pick allow pre-pack labels (Logiwa carrier batch; REQ-R4-4).
const LABELABLE: readonly OrderRow["status"][] = ["Open", "Ready to Pick", "Packing Started", "Ready to Load", "Loading Started", "Ready to Ship", "Partially Shipped"];

/* -------------------------------------------------------------- rate shop */
export interface RateShopInput {
  readonly orderId: string;
  readonly packages: readonly PackageSpec[];
  readonly presetId?: string | null;
  readonly carrierConnectionIds?: readonly string[];
}

export interface RateShopResult {
  readonly quotes: readonly (RateQuote & { readonly carrierConnectionId: string; readonly price: number })[];
  readonly errors: readonly { readonly carrierConnectionId: string; readonly message: string }[];
  readonly selected: (RateQuote & { readonly carrierConnectionId: string; readonly price: number }) | null;
}

export async function rateShop(db: AppDb, ctx: DomainCtx, input: RateShopInput): Promise<RateShopResult> {
  const order = loadOrder(db, ctx, input.orderId);
  const preset = input.presetId
    ? db.select().from(schema.rateShoppingPresets).where(eq(schema.rateShoppingPresets.id, input.presetId)).get()
    : undefined;
  if (input.presetId && !preset) throw new DomainError("NOT_FOUND", "Rate shopping preset not found");
  const presetServiceIds = preset && !preset.useAllServices
    ? new Set(db.select().from(schema.rateShoppingPresetServices)
      .where(and(eq(schema.rateShoppingPresetServices.presetId, preset.id), eq(schema.rateShoppingPresetServices.isSelected, true))).all().map((r) => r.carrierServiceId))
    : null;
  const conns = db.select().from(schema.carrierConnections)
    .where(and(eq(schema.carrierConnections.warehouseId, order.warehouseId), eq(schema.carrierConnections.isActive, true))).all()
    .filter((c) => !input.carrierConnectionIds || input.carrierConnectionIds.includes(c.id));
  const quotes: (RateQuote & { carrierConnectionId: string; price: number })[] = [];
  const errors: { carrierConnectionId: string; message: string }[] = [];
  for (const conn of conns) {
    const startedAt = Date.now();
    try {
      const { connection, adapter } = loadCarrier(db, conn.id, order);
      const services = db.select().from(schema.carrierServices)
        .where(and(eq(schema.carrierServices.connectionId, conn.id), eq(schema.carrierServices.isActive, true))).all()
        .filter((s) => !presetServiceIds || presetServiceIds.has(s.id));
      if (services.length === 0) continue;
      const request = { connection, services, from: warehouseAddress(db, order.warehouseId, connection), to: orderAddress(order), packages: input.packages };
      const result = await adapter.rate(request);
      writeCallLog(db, ctx, { step: "RateCall", connection, order, ok: true, httpCode: 200, startedAt, rateShoppingName: preset?.name, request: { services: services.map((s) => s.serviceCode), packages: input.packages }, response: result });
      quotes.push(...result.map((q) => ({ ...q, carrierConnectionId: conn.id, price: applyMarkup(db, connection, order.clientId, q.amount) })));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Rate call failed";
      errors.push({ carrierConnectionId: conn.id, message });
      writeCallLog(db, ctx, { step: "RateCall", connection: conn, order, ok: false, httpCode: error instanceof CarrierError ? error.httpCode : 500, error: message, startedAt, rateShoppingName: preset?.name, request: { packages: input.packages }, response: { error: message } });
    }
  }
  const method = preset?.method ?? "Cheapest";
  const eligible = method === "Cheapest In Time" && preset?.transitDays ? quotes.filter((q) => q.transitDays <= (preset.transitDays ?? Infinity)) : quotes;
  const sorted = [...eligible].sort((a, b) => (method === "Fastest" ? a.transitDays - b.transitDays || a.price - b.price : a.price - b.price || a.transitDays - b.transitDays));
  return { quotes: sorted, errors, selected: sorted[0] ?? null };
}

/* ----------------------------------------------------------- create label */
export interface CreateLabelInput {
  readonly orderId: string;
  readonly carrierConnectionId: string;
  readonly carrierServiceId: string;
  readonly packages: readonly PackageInput[];
  readonly format?: LabelFormat;
  readonly rateShoppingPresetId?: string | null;
  /** BatchPacking | PackingStation | OrderGrid | ShipmentPlan */
  readonly source?: string;
  readonly insuranceType?: string | null;
  readonly insuranceValue?: number | null;
  readonly confirmationType?: string | null;
  readonly allowSaturdayDelivery?: boolean;
  readonly otherCost?: number;
  /** Defaults to the order's store order number. */
  readonly externalReference?: string | null;
  readonly scheduledPickupAt?: string | null;
}

/** Carrier options persisted on every package row of the label (Logiwa Carrier Shipment Details columns). */
export type LabelOptions = Pick<CreateLabelInput, "insuranceType" | "insuranceValue" | "confirmationType" | "allowSaturdayDelivery" | "otherCost" | "externalReference" | "scheduledPickupAt" | "rateShoppingPresetId">;

export interface CreateLabelResult {
  readonly shipments: readonly ShipmentRow[];
  readonly masterTrackingNumber: string;
  readonly totalAmount: number;
  readonly totalPrice: number;
}

interface LabelCall {
  readonly labelType: LabelType;
  readonly order: OrderRow;
  readonly connectionId: string;
  readonly serviceId: string;
  readonly from: (db: AppDb, connection: ReturnType<typeof loadCarrier>["connection"]) => CarrierAddress;
  readonly to: (db: AppDb, connection: ReturnType<typeof loadCarrier>["connection"]) => CarrierAddress;
  readonly packages: readonly PackageInput[];
  readonly format?: LabelFormat;
  readonly source?: string;
  readonly options?: LabelOptions;
}

async function callCarrier(db: AppDb, ctx: DomainCtx, call: LabelCall, opts?: ShippingOptions) {
  const { connection, adapter } = loadCarrier(db, call.connectionId, call.order);
  const service = loadService(db, connection, call.serviceId);
  const format = call.format ?? parseSettings(carrierSettingsSchema, connection.settings).label.format;
  const attempt = (db.select({ n: sql<number>`COUNT(*)` }).from(schema.shipments).where(eq(schema.shipments.orderId, call.order.id)).get()?.n ?? 0) + 1;
  const now = opts?.now?.() ?? new Date();
  const request = {
    connection, service, from: call.from(db, connection), to: call.to(db, connection), packages: call.packages,
    orderCode: call.order.code, attempt, labelType: call.labelType, format, shipDate: now.toISOString(),
  };
  const startedAt = Date.now();
  try {
    const result = await adapter.createLabel(request);
    return { connection, service, result, startedAt, request };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Label generation failed";
    writeCallLog(db, ctx, {
      step: "LabelGeneration", connection, order: call.order, ok: false, httpCode: error instanceof CarrierError ? error.httpCode : 500,
      error: message, startedAt, serviceName: service.name, source: call.source, labelType: call.labelType,
      request: { service: service.serviceCode, packages: call.packages, to: request.to }, response: { error: message },
    });
    throw new DomainError("VALIDATION", `Carrier error: ${message}`);
  }
}

function insertShipments(
  tx: AppDb, ctx: DomainCtx, call: LabelCall, carrier: Awaited<ReturnType<typeof callCarrier>>, opts?: ShippingOptions,
): ShipmentRow[] {
  const { connection, service, result } = carrier;
  const files = filesOf(opts);
  const lines = tx.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, call.order.id)).all();
  const rows = result.packages.map((pkg, i) => {
    const spec = call.packages[i];
    const ext = result.format === "PDF" ? "pdf" : "zpl";
    const file = files.store(tx, { name: `label-${pkg.trackingNumber}.${ext}`, bytes: pkg.label, purpose: "print", ownerEntityType: "shipment_order", ownerEntityId: call.order.id, uploadedBy: ctx.userId });
    const price = applyMarkup(tx, connection, call.order.clientId, pkg.amount);
    const row = tx.insert(schema.shipments).values({
      orderId: call.order.id, warehouseId: call.order.warehouseId, clientId: call.order.clientId, carrierConnectionId: connection.id,
      carrierCode: service.carrierCode, carrierServiceId: service.id, serviceName: service.name, labelType: call.labelType,
      labelFormat: result.format, labelFileId: file.id, masterTrackingNumber: result.masterTrackingNumber, trackingNumber: pkg.trackingNumber,
      shipmentPackageId: spec.shipmentPackageId ?? null, packageSeq: i + 1, weight: spec.weightOz, length: spec.length, width: spec.width,
      height: spec.height, rate: pkg.amount, shippingCost: price, currency: result.currency, zone: result.zone,
      carrierExpectedDeliveryAt: result.estimatedDeliveryAt, createdBy: ctx.userId,
      insuranceType: call.options?.insuranceType ?? null, insuranceValue: call.options?.insuranceValue ?? null,
      confirmationType: call.options?.confirmationType ?? null, allowSaturdayDelivery: call.options?.allowSaturdayDelivery ?? false,
      otherCost: i === 0 ? call.options?.otherCost ?? 0 : 0, scheduledPickupAt: call.options?.scheduledPickupAt ?? null,
      externalReference: call.options?.externalReference ?? call.order.storeOrderNumber ?? null,
      rateShoppingPresetId: call.options?.rateShoppingPresetId ?? null, isRateShopped: Boolean(call.options?.rateShoppingPresetId),
    }).returning().get();
    const items = spec.items ?? (i === 0 && call.labelType === "Shipping Label"
      ? lines.map((l) => ({ orderLineId: l.id, qty: l.packedQuantity > 0 ? l.packedQuantity : l.quantity - l.cancelledQuantity })).filter((x) => x.qty > 0)
      : []);
    for (const item of items) {
      const line = lines.find((l) => l.id === item.orderLineId);
      if (!line) throw new DomainError("VALIDATION", "Package item is not a line of this order");
      tx.insert(schema.shipmentItems).values({ shipmentId: row.id, orderLineId: line.id, productId: line.productId, packType: line.packType, quantity: item.qty, lotNumber: line.lotNumber, expiryDate: line.expiryDate }).run();
    }
    writeCallLog(tx, ctx, {
      step: "LabelGeneration", connection, order: call.order, shipmentId: row.id, trackingNumber: pkg.trackingNumber, ok: true, httpCode: 200,
      startedAt: carrier.startedAt, serviceName: service.name, source: call.source, labelType: call.labelType,
      request: { service: service.serviceCode, package: spec }, response: { trackingNumber: pkg.trackingNumber, amount: pkg.amount, zone: result.zone },
    });
    return row;
  });
  // End-of-day manifests are maintained as labels are created (docs/requests/shipping.md REQ-1).
  if (call.labelType === "Shipping Label") attachLabelsToManifest(tx, ctx, rows, new Date());
  return rows;
}

const totalPriceOf = (rows: readonly ShipmentRow[]): number => Math.round(rows.reduce((s, r) => s + r.shippingCost, 0) * 100) / 100;

export async function createLabel(db: AppDb, ctx: DomainCtx, input: CreateLabelInput, opts?: ShippingOptions): Promise<CreateLabelResult> {
  if (input.packages.length === 0) throw new DomainError("VALIDATION", "At least one package is required");
  const order = loadOrder(db, ctx, input.orderId);
  if (!LABELABLE.includes(order.status)) throw new DomainError("INVALID_STATE", `A shipping label can't be created for an order in ${order.status} status.`);
  const active = db.select({ id: schema.shipments.id }).from(schema.shipments)
    .where(and(eq(schema.shipments.orderId, order.id), eq(schema.shipments.labelType, "Shipping Label"), eq(schema.shipments.labelStatus, "Active"), sql`${schema.shipments.actualShipmentAt} IS NULL`)).get();
  if (active) throw new DomainError("INVALID_STATE", `Order ${order.code} already has an active shipping label. Void it first.`);
  const call: LabelCall = {
    labelType: "Shipping Label", order, connectionId: input.carrierConnectionId, serviceId: input.carrierServiceId,
    from: (d, c) => warehouseAddress(d, order.warehouseId, c), to: () => orderAddress(order), packages: input.packages, format: input.format, source: input.source,
    options: {
      insuranceType: input.insuranceType, insuranceValue: input.insuranceValue, confirmationType: input.confirmationType,
      allowSaturdayDelivery: input.allowSaturdayDelivery, otherCost: input.otherCost, externalReference: input.externalReference,
      scheduledPickupAt: input.scheduledPickupAt, rateShoppingPresetId: input.rateShoppingPresetId ?? order.rateShoppingPresetId,
    },
  };
  const carrier = await callCarrier(db, ctx, call, opts);
  return db.transaction((tx) => {
    const rows = insertShipments(tx, ctx, call, carrier, opts);
    const tracking = rows.map((r) => r.trackingNumber);
    const totalPrice = totalPriceOf(rows);
    const after = tx.update(schema.shipmentOrders).set({
      carrier: carrier.service.carrierCode, shippingService: carrier.service.name, carrierConnectionId: carrier.connection.id,
      carrierServiceId: carrier.service.id, trackingNumber: carrier.result.masterTrackingNumber, trackingNumbers: tracking,
      totalShippingCost: totalPrice, rate: carrier.result.totalAmount, rateShoppingPresetId: input.rateShoppingPresetId ?? order.rateShoppingPresetId,
      carrierExpectedDeliveryDate: carrier.result.estimatedDeliveryAt, updatedBy: ctx.userId,
    }).where(eq(schema.shipmentOrders.id, order.id)).returning().get();
    recordUpdate(tx, ctx, { entityType: "shipment_order", entityId: order.id, entityCode: order.code,
      before: { carrier: order.carrier, shippingService: order.shippingService, trackingNumber: order.trackingNumber },
      after: { carrier: after.carrier, shippingService: after.shippingService, trackingNumber: after.trackingNumber } });
    return { shipments: rows, masterTrackingNumber: carrier.result.masterTrackingNumber, totalAmount: carrier.result.totalAmount, totalPrice };
  });
}

/* ------------------------------------------------------------- void label */
export async function voidLabel(db: AppDb, ctx: DomainCtx, input: { shipmentId: string }): Promise<{ voided: number }> {
  const shipment = db.select().from(schema.shipments).where(eq(schema.shipments.id, input.shipmentId)).get();
  if (!shipment) throw new DomainError("NOT_FOUND", "Shipment not found");
  const order = loadOrder(db, ctx, shipment.orderId);
  if (shipment.labelStatus === "Voided") throw new DomainError("INVALID_STATE", "This label is already voided.");
  if (shipment.actualShipmentAt) throw new DomainError("INVALID_STATE", "Labels of shipped packages can't be voided.");
  if (!shipment.carrierConnectionId) throw new DomainError("INVALID_STATE", "This label has no carrier connection.");
  const { connection, adapter } = loadCarrier(db, shipment.carrierConnectionId, order);
  const group = shipment.masterTrackingNumber
    ? db.select().from(schema.shipments).where(and(eq(schema.shipments.orderId, order.id), eq(schema.shipments.masterTrackingNumber, shipment.masterTrackingNumber), eq(schema.shipments.labelStatus, "Active"))).all()
    : [shipment];
  const startedAt = Date.now();
  try {
    await adapter.voidLabel({ connection, trackingNumber: shipment.masterTrackingNumber ?? shipment.trackingNumber });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Void failed";
    writeCallLog(db, ctx, { step: "VoidLabel", connection, order, shipmentId: shipment.id, trackingNumber: shipment.trackingNumber, ok: false, httpCode: error instanceof CarrierError ? error.httpCode : 500, error: message, startedAt, serviceName: shipment.serviceName, labelType: shipment.labelType, request: { trackingNumber: shipment.trackingNumber }, response: { error: message } });
    throw new DomainError("VALIDATION", `Carrier error: ${message}`);
  }
  return db.transaction((tx) => {
    const ids = group.map((g) => g.id);
    tx.update(schema.shipments).set({ labelStatus: "Voided", voidedAt: new Date().toISOString() }).where(inArray(schema.shipments.id, ids)).run();
    detachVoidedFromManifest(tx, ctx, group);
    writeCallLog(tx, ctx, { step: "VoidLabel", connection, order, shipmentId: shipment.id, trackingNumber: shipment.trackingNumber, ok: true, httpCode: 200, startedAt, serviceName: shipment.serviceName, labelType: shipment.labelType, request: { trackingNumber: shipment.trackingNumber }, response: { voided: ids.length } });
    const voidedNumbers = new Set(group.map((g) => g.trackingNumber));
    if (shipment.labelType === "Shipping Label") {
      const remaining = (order.trackingNumbers ?? []).filter((t) => !voidedNumbers.has(t));
      tx.update(schema.shipmentOrders).set({ trackingNumbers: remaining, trackingNumber: remaining[0] ?? null, totalShippingCost: 0, rate: 0, updatedBy: ctx.userId })
        .where(eq(schema.shipmentOrders.id, order.id)).run();
      recordUpdate(tx, ctx, { entityType: "shipment_order", entityId: order.id, entityCode: order.code, before: { trackingNumber: order.trackingNumber }, after: { trackingNumber: remaining[0] ?? null } });
    } else {
      const remaining = (order.returnTrackingNumbers ?? []).filter((t) => !voidedNumbers.has(t));
      tx.update(schema.shipmentOrders).set({ returnTrackingNumbers: remaining, updatedBy: ctx.userId }).where(eq(schema.shipmentOrders.id, order.id)).run();
    }
    return { voided: ids.length };
  });
}

/* ------------------------------------------------------------ return label */
export interface ReturnLabelInput {
  readonly orderId: string;
  readonly returnOrderId?: string | null;
  readonly carrierConnectionId: string;
  readonly carrierServiceId: string;
  readonly package: PackageSpec;
  readonly format?: LabelFormat;
}

export async function createReturnLabel(db: AppDb, ctx: DomainCtx, input: ReturnLabelInput, opts?: ShippingOptions): Promise<{ shipment: ShipmentRow; trackingNumber: string }> {
  const order = loadOrder(db, ctx, input.orderId);
  const ro = input.returnOrderId ? db.select().from(schema.returnOrders).where(eq(schema.returnOrders.id, input.returnOrderId)).get() : undefined;
  if (input.returnOrderId && (!ro || ro.shipmentOrderId !== order.id)) throw new DomainError("NOT_FOUND", "Return order not found");
  if (!ro && !["Shipped", "Partially Shipped", "Delivered"].includes(order.status)) {
    throw new DomainError("INVALID_STATE", "Return labels can only be created for shipped orders.");
  }
  const call: LabelCall = {
    labelType: "Return Label", order, connectionId: input.carrierConnectionId, serviceId: input.carrierServiceId,
    from: () => orderAddress(order), to: (d, c) => warehouseAddress(d, order.warehouseId, c), packages: [input.package], format: input.format,
  };
  const carrier = await callCarrier(db, ctx, call, opts);
  return db.transaction((tx) => {
    const [row] = insertShipments(tx, ctx, call, carrier, opts);
    const tracking = row.trackingNumber;
    tx.update(schema.shipmentOrders).set({
      returnTrackingNumbers: [...(order.returnTrackingNumbers ?? []), tracking], returnShippingCost: row.shippingCost,
      returnCarrierServiceId: carrier.service.id, updatedBy: ctx.userId,
    }).where(eq(schema.shipmentOrders.id, order.id)).run();
    if (ro) {
      tx.update(schema.returnOrders).set({
        trackingNumber: tracking, returnLabelShipmentId: row.id, carrierCode: carrier.service.carrierCode, carrierServiceName: carrier.service.name,
        status: ro.status === "Pending" ? stateMachines.returnOrder.transition(ro.status, "In Transit") : ro.status, updatedBy: ctx.userId,
      }).where(eq(schema.returnOrders.id, ro.id)).run();
    }
    return { shipment: row, trackingNumber: tracking };
  });
}
