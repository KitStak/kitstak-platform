/** Shared lookups for the shipping commands. */
import { and, eq } from "drizzle-orm";
import { carrierSettingsSchema, parseSettings } from "@/lib/domain-types";
import type { AppDb } from "@/server/api/db";
import * as schema from "@/server/db/schema";
import { fileStore, type FileStore } from "@/server/files";
import { getCarrierAdapter, type CarrierAdapter, type CarrierAddress, type CarrierConnectionRow, type CarrierServiceRow } from "../carriers";
import { DomainError } from "../errors";
import type { OrderRow } from "../facts";
import { checkScope, type DomainCtx } from "../types";

export interface ShippingOptions {
  /** Label file storage; defaults to the process file store (`.data/files`). */
  readonly files?: FileStore;
  readonly now?: () => Date;
}

export const filesOf = (opts: ShippingOptions | undefined): FileStore => opts?.files ?? fileStore();

export function loadOrder(db: AppDb, ctx: DomainCtx, orderId: string): OrderRow {
  const order = db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, orderId)).get();
  if (!order || order.deletedAt) throw new DomainError("NOT_FOUND", "Shipment order not found");
  checkScope(ctx, order, "Shipment order");
  return order;
}

export interface CarrierContext {
  readonly connection: CarrierConnectionRow;
  readonly adapter: CarrierAdapter;
}

export function loadCarrier(db: AppDb, connectionId: string, order: OrderRow): CarrierContext {
  const connection = db.select().from(schema.carrierConnections).where(eq(schema.carrierConnections.id, connectionId)).get();
  if (!connection) throw new DomainError("NOT_FOUND", "Carrier connection not found");
  if (!connection.isActive) throw new DomainError("INVALID_STATE", `Carrier ${connection.setupName} is inactive.`);
  if (connection.warehouseId !== order.warehouseId) throw new DomainError("VALIDATION", `Carrier ${connection.setupName} is set up for another warehouse.`);
  if (!connection.allClients) {
    const access = db.select().from(schema.carrierConnectionClients)
      .where(and(eq(schema.carrierConnectionClients.connectionId, connection.id), eq(schema.carrierConnectionClients.clientId, order.clientId))).get();
    if (!access?.hasAccess) throw new DomainError("FORBIDDEN", `Carrier ${connection.setupName} is not available for this client.`);
  }
  const adapter = getCarrierAdapter(connection.provider);
  if (!adapter) throw new DomainError("INVALID_STATE", `The ${connection.provider} carrier integration is not configured yet.`);
  return { connection, adapter };
}

export function loadService(db: AppDb, connection: CarrierConnectionRow, serviceId: string): CarrierServiceRow {
  const service = db.select().from(schema.carrierServices).where(eq(schema.carrierServices.id, serviceId)).get();
  if (!service || service.connectionId !== connection.id) throw new DomainError("NOT_FOUND", "Carrier service not found");
  if (!service.isActive) throw new DomainError("INVALID_STATE", `Service ${service.name} is inactive.`);
  return service;
}

export function warehouseAddress(db: AppDb, warehouseId: string, connection?: CarrierConnectionRow): CarrierAddress {
  const settings = connection ? parseSettings(carrierSettingsSchema, connection.settings) : null;
  const custom = settings?.shipFrom.address;
  const wh = db.select().from(schema.warehouses).where(eq(schema.warehouses.id, warehouseId)).get();
  if (!wh) throw new DomainError("NOT_FOUND", "Warehouse not found");
  if (custom) {
    return { name: custom.companyName ?? wh.name, line1: custom.line1, line2: custom.line2, city: custom.city, state: custom.state, postalCode: custom.postalCode, country: custom.country, phone: custom.phone };
  }
  return { name: wh.name, line1: wh.addressLine, line2: wh.addressLine2, city: wh.city, state: wh.state, postalCode: wh.postalCode ?? "", country: wh.country, phone: wh.contactPhone };
}

export function orderAddress(order: OrderRow): CarrierAddress {
  return {
    name: order.customerName, company: order.companyName, line1: order.shipAddress, line2: order.shipAddress2, city: order.shipCity,
    state: order.shipState, postalCode: order.shipZip, country: order.shipCountry, phone: order.customerPhone,
  };
}

/** Client markup (per-connection) or the connection's general markup applied to a carrier amount. */
export function applyMarkup(db: AppDb, connection: CarrierConnectionRow, clientId: string, amount: number): number {
  const client = db.select().from(schema.carrierConnectionClients)
    .where(and(eq(schema.carrierConnectionClients.connectionId, connection.id), eq(schema.carrierConnectionClients.clientId, clientId))).get();
  const general = parseSettings(carrierSettingsSchema, connection.settings).generalMarkup;
  const type = client?.markupType ?? general?.type ?? null;
  const value = client?.markupAmount ?? general?.amount ?? 0;
  const marked = type === "Percentage" ? amount * (1 + value / 100) : type === "Fixed Price" ? amount + value : amount;
  return Math.round(marked * 100) / 100;
}

export interface CallLogInput {
  readonly step: "LabelGeneration" | "RateCall" | "VoidLabel" | "Tracking" | "Pickup";
  readonly connection: CarrierConnectionRow;
  readonly order: OrderRow | null;
  readonly shipmentId?: string | null;
  readonly trackingNumber?: string | null;
  readonly ok: boolean;
  readonly httpCode: number;
  readonly error?: string | null;
  readonly startedAt: number;
  readonly serviceName?: string | null;
  readonly source?: string | null;
  readonly labelType?: string | null;
  readonly rateShoppingName?: string | null;
  readonly request: unknown;
  readonly response: unknown;
}

export function writeCallLog(db: AppDb, ctx: DomainCtx, input: CallLogInput): void {
  db.insert(schema.carrierCallLogs).values({
    step: input.step, connectionId: input.connection.id, orderId: input.order?.id ?? null, shipmentId: input.shipmentId ?? null,
    trackingNumber: input.trackingNumber ?? null,
    destinationType: input.order ? (input.order.shipCountry === "United States" ? "Domestic" : "International") : null,
    status: input.ok ? "Success" : "Error", httpCode: input.httpCode, error: input.error ?? null,
    responseMs: Math.max(0, Date.now() - input.startedAt), serviceName: input.serviceName ?? null,
    warehouseId: input.connection.warehouseId, clientId: input.order?.clientId ?? null, userId: ctx.userId,
    source: input.source ?? null, labelType: input.labelType ?? null, rateShoppingName: input.rateShoppingName ?? null,
    requestJson: JSON.stringify(input.request), responseJson: JSON.stringify(input.response),
  }).run();
}

/** YYYY-MM-DD of an instant in a warehouse time zone. */
export function localDate(at: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}
