/**
 * Packing Station commands (M04 §2): the pack context of one order, Complete Packing
 * (ledger Packing through `tasks.execute`, labels through `shipping.createLabel`,
 * packing slip through the print service, auto-ship, packaging consumption), Pack
 * Without Label and Report Issue (stock to a hospital location, Pack Short Open).
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { clientSettingsSchema, parseSettings, type ClientSettings } from "@/lib/domain-types";
import type { AppDb } from "@/server/api/db";
import type { Scope } from "@/server/auth/scope";
import { assertInScope } from "@/server/auth/scope";
import * as schema from "@/server/db/schema";
import { changeLog, ledger, shipping, tasks } from "@/server/domain";
import { validationError } from "@/server/api/errors";
import { DomainError } from "@/server/domain/errors";
import { markOrderShort } from "@/server/domain/task-handlers/shared";
import type { DomainCtx } from "@/server/domain/types";
import { printToFile } from "@/server/print";
import { idSchema } from "./platform-common";
import { loadStation, PACKABLE_STATUSES } from "./packing-scan";
import { carrierOptions, type CarrierOption } from "./returns-carriers";

type Ctx = DomainCtx & { readonly scope: Scope };
type OrderRow = typeof schema.shipmentOrders.$inferSelect;

/* ---------------------------------------------------------------- context */

export interface PackLine {
  readonly orderLineId: string;
  readonly productId: string;
  readonly sku: string;
  readonly name: string;
  readonly imageUrl: string | null;
  readonly packType: string;
  readonly ordered: number;
  readonly toPack: number;
  readonly packed: number;
  readonly weightOz: number;
  readonly scanCodes: readonly string[];
  readonly trackSerial: boolean;
  readonly captureLot: boolean;
  readonly captureExpiry: boolean;
  readonly lotNumber: string | null;
  readonly expiryDate: string | null;
  readonly pickedSerials: readonly string[];
  readonly packingInstructions: string | null;
}

export interface PackPackageType {
  readonly id: string;
  readonly code: string;
  readonly description: string | null;
  readonly length: number;
  readonly width: number;
  readonly height: number;
  readonly emptyWeightLb: number;
  readonly tracksInventory: boolean;
}

export interface PackContext {
  readonly order: {
    readonly id: string; readonly code: string; readonly status: string; readonly version: number; readonly warehouseId: string; readonly clientId: string;
    readonly clientName: string; readonly customerName: string; readonly storeOrderNumber: string | null; readonly channel: string;
    readonly shipTo: string; readonly isAutoShip: boolean; readonly packShortStatus: string; readonly packingInstructions: string | null;
    readonly giftNote: string | null; readonly carrierServiceId: string | null; readonly carrierConnectionId: string | null;
    readonly defaultPackageId: string | null; readonly jobCode: string | null; readonly priority: string;
  };
  readonly lines: readonly PackLine[];
  readonly packages: readonly PackPackageType[];
  readonly carriers: readonly CarrierOption[];
  readonly settings: ClientSettings["packing"];
  readonly activeLabels: readonly { readonly trackingNumber: string; readonly labelFileId: string | null }[];
  readonly hospitalLocationId: string | null;
}

function scanCodesOf(db: AppDb, product: typeof schema.products.$inferSelect): string[] {
  const alt = db.select({ b: schema.productBarcodes.barcode }).from(schema.productBarcodes).where(eq(schema.productBarcodes.productId, product.id)).all().map((r) => r.b);
  return [...new Set([product.sku, product.barcode, product.fnsku, ...alt].filter((c): c is string => !!c).map((c) => c.toLowerCase()))];
}

export function loadPackOrder(db: AppDb, scope: Scope, orderId: string): OrderRow {
  const o = db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, orderId)).get();
  if (!o || o.deletedAt) throw new DomainError("NOT_FOUND", "Shipment order not found");
  assertInScope(scope, o, "Shipment order");
  return o;
}

function pendingPackTasks(db: AppDb, orderId: string) {
  return db.select().from(schema.tasks).where(and(eq(schema.tasks.orderId, orderId), eq(schema.tasks.taskType, "Packing"), inArray(schema.tasks.status, ["Pending", "Started"]))).all();
}

/** Default hospital: a location coded HOSP*, else the Damaged location, else Returns area. */
function hospitalLocation(db: AppDb, warehouseId: string): string | null {
  const row = db.get<{ id: string }>(sql`SELECT id FROM locations WHERE warehouse_id = ${warehouseId} AND is_active = 1 AND only_damaged = 0
    ORDER BY CASE WHEN upper(code) LIKE 'HOSP%' THEN 0 WHEN area_type = 'Returns' AND location_type <> 'Virtual' THEN 1 WHEN area_type = 'Returns' THEN 2 ELSE 3 END, code LIMIT 1`);
  return row?.id ?? null;
}

export function packContext(db: AppDb, scope: Scope, orderId: string): PackContext {
  const o = loadPackOrder(db, scope, orderId);
  const client = db.select().from(schema.clients).where(eq(schema.clients.id, o.clientId)).get();
  const settings = parseSettings(clientSettingsSchema, client?.settings ?? {}).packing;
  const job = o.jobId ? db.select({ code: schema.jobs.code }).from(schema.jobs).where(eq(schema.jobs.id, o.jobId)).get() : undefined;
  const pending = pendingPackTasks(db, o.id);
  const lines = db.select({ l: schema.orderLines, p: schema.products }).from(schema.orderLines)
    .innerJoin(schema.products, eq(schema.products.id, schema.orderLines.productId)).where(eq(schema.orderLines.orderId, o.id)).all();
  const packLines: PackLine[] = lines.map(({ l, p }) => {
    const planned = pending.filter((t) => t.orderLineId === l.id).reduce((s, t) => s + t.plannedQty - t.actualQty, 0);
    const picked = db.get<{ n: number }>(sql`SELECT COALESCE(SUM(qty),0) AS n FROM inventory_allocations WHERE order_line_id = ${l.id} AND status IN ('Picked','Sorted')`)?.n ?? 0;
    const serials = p.trackSerial ? db.select({ s: schema.serialNumbers.primarySerial }).from(schema.serialNumbers)
      .where(and(eq(schema.serialNumbers.orderLineId, l.id), eq(schema.serialNumbers.status, "Picked"))).all().map((r) => r.s) : [];
    return {
      orderLineId: l.id, productId: p.id, sku: p.sku, name: p.name, imageUrl: p.imageUrl, packType: l.packType, ordered: l.quantity - l.cancelledQuantity,
      toPack: Math.min(planned, picked), packed: l.packedQuantity, weightOz: p.weightOz, scanCodes: scanCodesOf(db, p), trackSerial: p.trackSerial,
      captureLot: p.trackLot && p.lotScanMethod === "During Packing", captureExpiry: p.trackExpiry && p.expiryScanMethod === "During Packing",
      lotNumber: l.lotNumber, expiryDate: l.expiryDate, pickedSerials: serials, packingInstructions: p.packingInstructions,
    };
  }).filter((l) => l.toPack > 0 || l.packed > 0);
  const packages = db.select().from(schema.shipmentPackages).where(and(eq(schema.shipmentPackages.warehouseId, o.warehouseId), eq(schema.shipmentPackages.isActive, true))).orderBy(schema.shipmentPackages.code).all()
    .map((p): PackPackageType => ({ id: p.id, code: p.code, description: p.description, length: p.length, width: p.width, height: p.height, emptyWeightLb: p.emptyWeight, tracksInventory: p.trackInventory }));
  const productPackage = lines.map((r) => r.p.useShipPackageId).find((id) => !!id) ?? null;
  const labels = db.select({ t: schema.shipments.trackingNumber, f: schema.shipments.labelFileId }).from(schema.shipments)
    .where(and(eq(schema.shipments.orderId, o.id), eq(schema.shipments.labelType, "Shipping Label"), eq(schema.shipments.labelStatus, "Active"))).all();
  return {
    order: {
      id: o.id, code: o.code, status: o.status, version: o.version, warehouseId: o.warehouseId, clientId: o.clientId, clientName: client?.name ?? "",
      customerName: o.customerName, storeOrderNumber: o.storeOrderNumber, channel: o.channel,
      shipTo: [o.shipAddress, o.shipAddress2, o.shipCity, o.shipState, o.shipZip, o.shipCountry].filter(Boolean).join(", "),
      isAutoShip: o.isAutoShip, packShortStatus: o.packShortStatus, packingInstructions: o.packingInstructions, giftNote: o.isGift ? o.giftNote : null,
      carrierServiceId: o.carrierServiceId, carrierConnectionId: o.carrierConnectionId, defaultPackageId: o.shipmentPackageId ?? productPackage,
      jobCode: job?.code ?? null, priority: o.priority,
    },
    lines: packLines,
    packages,
    carriers: carrierOptions(db, o.warehouseId, o.clientId),
    settings,
    activeLabels: labels.map((l) => ({ trackingNumber: l.t, labelFileId: l.f })),
    hospitalLocationId: hospitalLocation(db, o.warehouseId),
  };
}

/* --------------------------------------------------------------- complete */

const packageSchema = z.object({
  shipmentPackageId: idSchema.nullish(),
  length: z.number().positive("Length is required"),
  width: z.number().positive("Width is required"),
  height: z.number().positive("Height is required"),
  weightOz: z.number().positive("Enter the package weight").max(2400, "Max 150 lb per package"),
  items: z.array(z.object({ orderLineId: idSchema, qty: z.number().int().min(1) })).min(1, "A package can't be empty"),
});

export const completePackingSchema = z.object({
  orderId: idSchema,
  stationId: idSchema,
  version: z.number().int().min(1).optional(),
  withLabel: z.boolean().default(true),
  carrierConnectionId: idSchema.nullish(),
  carrierServiceId: idSchema.nullish(),
  packages: z.array(packageSchema).min(1, "Close at least one package").max(50),
  captures: z.array(z.object({
    orderLineId: idSchema,
    serials: z.array(z.string().trim().min(1).max(120)).max(1000).default([]),
    lotNumber: z.string().trim().max(120).nullish(),
    expiryDate: z.string().trim().max(40).nullish(),
  })).default([]),
}).superRefine((b, ctx) => {
  if (b.withLabel && (!b.carrierConnectionId || !b.carrierServiceId)) {
    ctx.addIssue({ code: "custom", path: ["carrierServiceId"], message: "Choose a carrier and shipping service" });
  }
});
export type CompletePackingInput = z.output<typeof completePackingSchema>;

export interface CompletePackingResult {
  readonly orderId: string;
  readonly orderCode: string;
  readonly status: string;
  readonly packedUnits: number;
  readonly shipments: readonly { readonly trackingNumber: string; readonly masterTrackingNumber: string | null; readonly labelFileId: string | null; readonly packageSeq: number; readonly shippingCost: number }[];
  readonly masterTrackingNumber: string | null;
  readonly packingSlipFileId: string | null;
  readonly labelError: string | null;
  readonly shipped: boolean;
  readonly warnings: readonly string[];
}

/** Validates packed quantities against what is still to pack (no over-pack, no partial). */
export function validatePackages(ctxLines: readonly PackLine[], input: Pick<CompletePackingInput, "packages" | "captures">): void {
  const sums = new Map<string, number>();
  for (const p of input.packages) for (const i of p.items) sums.set(i.orderLineId, (sums.get(i.orderLineId) ?? 0) + i.qty);
  for (const [lineId, qty] of sums) {
    const line = ctxLines.find((l) => l.orderLineId === lineId);
    if (!line) throw new DomainError("VALIDATION", "A packed item is not on this order.");
    if (qty > line.toPack) throw new DomainError("VALIDATION", `${line.sku}: ${qty} packed but only ${line.toPack} to pack. Over-packing is blocked.`);
  }
  const short = ctxLines.filter((l) => l.toPack > 0 && (sums.get(l.orderLineId) ?? 0) < l.toPack);
  if (short.length > 0) {
    throw new DomainError("VALIDATION", `Pack every item before completing (${short.map((l) => `${l.sku} ${sums.get(l.orderLineId) ?? 0}/${l.toPack}`).join(", ")}). Use Report Issue for missing items.`);
  }
  for (const line of ctxLines.filter((l) => l.trackSerial && l.toPack > 0)) {
    const cap = input.captures.find((c) => c.orderLineId === line.orderLineId);
    const serials = cap?.serials ?? [];
    if (serials.length !== line.toPack) throw new DomainError("VALIDATION", `${line.sku}: scan ${line.toPack} serial number${line.toPack === 1 ? "" : "s"} (${serials.length} scanned).`);
    if (new Set(serials.map((s) => s.toLowerCase())).size !== serials.length) throw new DomainError("VALIDATION", `${line.sku}: a serial number was scanned twice.`);
    if (line.pickedSerials.length > 0) {
      const picked = new Set(line.pickedSerials.map((s) => s.toLowerCase()));
      const wrong = serials.find((s) => !picked.has(s.toLowerCase()));
      if (wrong) throw new DomainError("VALIDATION", `${line.sku}: serial ${wrong} was not picked for this order.`);
    }
  }
  for (const line of ctxLines.filter((l) => (l.captureLot || l.captureExpiry) && l.toPack > 0)) {
    const cap = input.captures.find((c) => c.orderLineId === line.orderLineId);
    if (line.captureLot && !cap?.lotNumber) throw new DomainError("VALIDATION", `${line.sku}: enter the lot number.`);
    if (line.captureExpiry && !cap?.expiryDate) throw new DomainError("VALIDATION", `${line.sku}: enter the expiry date.`);
  }
}

/** Packaging material: one unit of the package's tracked product per closed box. */
function consumePackaging(tx: AppDb, ctx: Ctx, order: OrderRow, stationId: string, packageIds: readonly (string | null | undefined)[]): string[] {
  const warnings: string[] = [];
  for (const id of packageIds) {
    if (!id) continue;
    const pkg = tx.select().from(schema.shipmentPackages).where(eq(schema.shipmentPackages.id, id)).get();
    if (!pkg?.trackInventory || !pkg.inventoryProductId) continue;
    const where = pkg.reductionRule === "Specific Location" && pkg.reductionLocationId ? sql`location_id = ${pkg.reductionLocationId}`
      : pkg.reductionRule === "Packing Station" ? sql`location_id = ${stationId}` : sql`1 = 1`;
    const bucket = tx.get<{ id: string }>(sql`SELECT id FROM inventory WHERE warehouse_id = ${order.warehouseId} AND product_id = ${pkg.inventoryProductId}
      AND status = 'Stock' AND on_hand - allocated >= 1 AND damage_reason IS NULL AND ${where} ORDER BY on_hand DESC LIMIT 1`)
      ?? (pkg.reductionRule === "Packing Station" ? tx.get<{ id: string }>(sql`SELECT id FROM inventory WHERE warehouse_id = ${order.warehouseId} AND product_id = ${pkg.inventoryProductId}
      AND status = 'Stock' AND on_hand - allocated >= 1 AND damage_reason IS NULL ORDER BY on_hand DESC LIMIT 1`) : undefined);
    if (!bucket) {
      warnings.push(`No stock of packaging ${pkg.code} to consume; inventory was not reduced.`);
      continue;
    }
    try {
      ledger.remove(tx, ctx, { inventoryId: bucket.id, qty: 1, type: "Inventory Adjustment", refs: { orderId: order.id, note: `Packaging ${pkg.code} used for ${order.code}` } });
    } catch (error) {
      warnings.push(`Packaging ${pkg.code} not consumed: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }
  return warnings;
}

async function packingSlip(db: AppDb, ctx: Ctx, order: OrderRow, lines: readonly PackLine[], input: CompletePackingInput, tracking: string | null): Promise<string | null> {
  const client = db.select({ name: schema.clients.name }).from(schema.clients).where(eq(schema.clients.id, order.clientId)).get();
  const wh = db.select().from(schema.warehouses).where(eq(schema.warehouses.id, order.warehouseId)).get();
  const record = {
    orderCode: order.code, storeOrderNumber: order.storeOrderNumber ?? undefined, orderDate: order.orderDate, clientName: client?.name,
    shipFrom: wh ? { name: wh.name, address1: wh.addressLine, city: wh.city, state: wh.state ?? undefined, postalCode: wh.postalCode ?? undefined, country: wh.country ?? undefined } : undefined,
    shipTo: { name: order.customerName, company: order.companyName ?? undefined, address1: order.shipAddress, address2: order.shipAddress2 ?? undefined, city: order.shipCity, state: order.shipState, postalCode: order.shipZip, country: order.shipCountry },
    carrier: order.carrier ?? undefined, shippingService: order.shippingService ?? undefined, trackingNumber: tracking ?? undefined,
    giftMessage: order.isGift ? order.giftNote ?? undefined : undefined,
    lines: lines.filter((l) => l.toPack > 0).map((l) => {
      const cap = input.captures.find((c) => c.orderLineId === l.orderLineId);
      return { sku: l.sku, name: l.name, quantity: l.toPack, uom: l.packType, lotNumber: cap?.lotNumber ?? l.lotNumber ?? undefined, serialNumbers: cap?.serials.length ? cap.serials : undefined };
    }),
  };
  try {
    const file = await printToFile(db, { request: { typeKey: "packing-slip", records: [record] }, userId: ctx.userId ?? "", ownerEntityType: "shipment_order", ownerEntityId: order.id });
    return file.id;
  } catch {
    return null;
  }
}

export async function completePacking(db: AppDb, ctx: Ctx, input: CompletePackingInput): Promise<CompletePackingResult> {
  const station = loadStation(db, ctx.scope, input.stationId);
  const context = packContext(db, ctx.scope, input.orderId);
  const order = loadPackOrder(db, ctx.scope, input.orderId);
  if (input.version !== undefined && order.version !== input.version) throw new DomainError("CONFLICT", "This order changed since you opened it — Reload");
  if (order.warehouseId !== station.warehouseId) throw new DomainError("VALIDATION", `Station ${station.code} is in another warehouse.`);
  if (!(PACKABLE_STATUSES as readonly string[]).includes(order.status)) throw new DomainError("INVALID_STATE", `Order ${order.code} is ${order.status}; it can't be packed.`);
  if (order.packShortStatus === "Open") throw new DomainError("INVALID_STATE", `${order.code} has an open pack short issue. Resolve the pack short on the order before packing it.`);
  if (!input.withLabel && context.settings.disablePackingWithoutLabel) throw new DomainError("INVALID_STATE", `Packing without a label is disabled for ${context.order.clientName}.`);
  if (input.packages.length > 1 && context.settings.disallowMultipleShipmentPackages) throw new DomainError("INVALID_STATE", `${context.order.clientName} does not allow multiple packages per order.`);
  validatePackages(context.lines, input);
  const packedUnits = context.lines.reduce((s, l) => s + l.toPack, 0);
  const warnings = db.transaction((tx) => {
    const pending = pendingPackTasks(tx, order.id);
    tasks.execute(tx, ctx, { taskIds: pending.map((t) => t.id), targetLocationId: station.id });
    const pkgIds = input.packages.map((p) => p.shipmentPackageId);
    if (pkgIds[0] && pkgIds[0] !== order.shipmentPackageId) {
      tx.update(schema.shipmentOrders).set({ shipmentPackageId: pkgIds[0], updatedBy: ctx.userId }).where(eq(schema.shipmentOrders.id, order.id)).run();
      changeLog.recordUpdate(tx, ctx, { entityType: "shipment_order", entityId: order.id, entityCode: order.code, before: { shipmentPackageId: order.shipmentPackageId }, after: { shipmentPackageId: pkgIds[0] } });
    }
    return consumePackaging(tx, ctx, order, station.id, pkgIds);
  });
  let labelError: string | null = null;
  let shipments: CompletePackingResult["shipments"] = [];
  let master: string | null = null;
  if (input.withLabel && input.carrierConnectionId && input.carrierServiceId) {
    try {
      const res = await shipping.createLabel(db, ctx, {
        orderId: order.id, carrierConnectionId: input.carrierConnectionId, carrierServiceId: input.carrierServiceId, source: "PackingStation",
        packages: input.packages.map((p) => ({ shipmentPackageId: p.shipmentPackageId ?? null, weightOz: p.weightOz, length: p.length, width: p.width, height: p.height, items: p.items })),
      });
      master = res.masterTrackingNumber;
      shipments = res.shipments.map((s) => ({ trackingNumber: s.trackingNumber, masterTrackingNumber: s.masterTrackingNumber, labelFileId: s.labelFileId, packageSeq: s.packageSeq, shippingCost: s.shippingCost }));
    } catch (error) {
      labelError = error instanceof Error ? error.message : "Label could not be created";
    }
  }
  const fresh = loadPackOrder(db, ctx.scope, order.id);
  const slip = await packingSlip(db, ctx, fresh, context.lines, input, master);
  let shipped = false;
  if (fresh.isAutoShip && fresh.status === "Ready to Ship" && (shipments.length > 0 || !input.withLabel)) {
    const r = db.transaction((tx) => shipping.shipOrders(tx, ctx, { orderIds: [order.id], requireLabel: input.withLabel }));
    shipped = r.succeeded.length > 0;
    if (!shipped) warnings.push(`Auto-ship failed: ${r.failed[0]?.message ?? "unknown error"}`);
  }
  const final = loadPackOrder(db, ctx.scope, order.id);
  return { orderId: order.id, orderCode: order.code, status: final.status, packedUnits, shipments, masterTrackingNumber: master, packingSlipFileId: slip, labelError, shipped, warnings };
}

/** Label for an already-packed order (retry after a carrier error). */
export const retryLabelSchema = z.object({
  orderId: idSchema,
  carrierConnectionId: idSchema,
  carrierServiceId: idSchema,
  packages: z.array(packageSchema).min(1),
});

export async function retryLabel(db: AppDb, ctx: Ctx, input: z.output<typeof retryLabelSchema>) {
  loadPackOrder(db, ctx.scope, input.orderId);
  return shipping.createLabel(db, ctx, {
    orderId: input.orderId, carrierConnectionId: input.carrierConnectionId, carrierServiceId: input.carrierServiceId, source: "PackingStation",
    packages: input.packages.map((p) => ({ shipmentPackageId: p.shipmentPackageId ?? null, weightOz: p.weightOz, length: p.length, width: p.width, height: p.height, items: p.items })),
  });
}

/* ----------------------------------------------------------- report issue */

export const reportIssueSchema = z.object({
  orderId: idSchema,
  hospitalLocationId: idSchema,
  note: z.string().trim().min(1, "Describe the issue").max(500),
  lines: z.array(z.object({ orderLineId: idSchema, qty: z.number().int().min(1) })).optional(),
});

export interface ReportIssueResult {
  readonly orderId: string;
  readonly orderCode: string;
  readonly movedUnits: number;
  readonly hospitalCode: string;
  readonly packShortStatus: string;
}

/** Moves the order's picked (unpacked) stock to a hospital location, keeping its allocation, and opens Pack Short. */
export function reportIssue(tx: AppDb, ctx: Ctx, input: z.output<typeof reportIssueSchema>): ReportIssueResult {
  const order = loadPackOrder(tx, ctx.scope, input.orderId);
  if (!(PACKABLE_STATUSES as readonly string[]).includes(order.status)) throw new DomainError("INVALID_STATE", `Order ${order.code} is ${order.status}; only orders being packed can report an issue.`);
  const loc = tx.select().from(schema.locations).where(eq(schema.locations.id, input.hospitalLocationId)).get();
  if (!loc || loc.warehouseId !== order.warehouseId) throw validationError("Choose a hospital location in the order's warehouse", { hospitalLocationId: ["Location is in another warehouse"] });
  const allocs = tx.select().from(schema.inventoryAllocations)
    .where(and(eq(schema.inventoryAllocations.orderId, order.id), inArray(schema.inventoryAllocations.status, ["Picked", "Sorted"]))).all();
  const wanted = input.lines ? new Map(input.lines.map((l) => [l.orderLineId, l.qty])) : null;
  let moved = 0;
  for (const a of allocs) {
    if (wanted && !wanted.has(a.orderLineId ?? "")) continue;
    const left = wanted ? wanted.get(a.orderLineId ?? "") ?? 0 : a.qty;
    const qty = Math.min(left, a.qty);
    if (qty <= 0) continue;
    const bucket = tx.select({ locationId: schema.inventory.locationId }).from(schema.inventory).where(eq(schema.inventory.id, a.inventoryId)).get();
    if (bucket?.locationId === loc.id) continue;
    ledger.move(tx, ctx, { inventoryId: a.inventoryId, qty, toLocationId: loc.id, toLpId: null, allocationId: a.id, type: "Inventory Movement", refs: { orderId: order.id, note: `Pack issue: ${input.note}` } });
    if (wanted && a.orderLineId) wanted.set(a.orderLineId, left - qty);
    moved += qty;
  }
  if (moved === 0) throw new DomainError("INVALID_STATE", "No picked stock left to move for this order.");
  markOrderShort(tx, ctx, order.id, "pack");
  tx.update(schema.shipmentOrders).set({ note: order.note ? `${order.note}\nPack issue: ${input.note}` : `Pack issue: ${input.note}`, version: sql`${schema.shipmentOrders.version} + 1` })
    .where(eq(schema.shipmentOrders.id, order.id)).run();
  changeLog.recordUpdate(tx, ctx, { entityType: "shipment_order", entityId: order.id, entityCode: order.code, before: { packShortStatus: order.packShortStatus }, after: { packShortStatus: "Open" } });
  return { orderId: order.id, orderCode: order.code, movedUnits: moved, hospitalCode: loc.code, packShortStatus: "Open" };
}

/* ---------------------------------------------------- hospitals & slip */

export interface HospitalOption {
  readonly id: string;
  readonly code: string;
  readonly detail: string;
  readonly isDefault: boolean;
}

/** Locations an issue can be reported to (default hospital first, then Returns area, then the rest). */
export function hospitalOptions(db: AppDb, scope: Scope, warehouseId: string): HospitalOption[] {
  if (!scope.warehouseIds.includes(warehouseId)) throw new DomainError("NOT_FOUND", "Warehouse not found");
  const def = hospitalLocation(db, warehouseId);
  const rows = db.all<{ id: string; code: string; detail: string }>(sql`SELECT id, code, area_type || ' · ' || location_type AS detail FROM locations
    WHERE warehouse_id = ${warehouseId} AND is_active = 1 AND area_type IN ('Returns', 'Storage', 'Receiving', 'Picking')
    ORDER BY CASE WHEN id = ${def ?? ""} THEN 0 WHEN upper(code) LIKE 'HOSP%' THEN 1 WHEN area_type = 'Returns' THEN 2 ELSE 3 END, code LIMIT 200`);
  return rows.map((r) => ({ ...r, isDefault: r.id === def }));
}

/** Prints the packing slip of an order being packed (Print Actions), before completion. */
export async function printPackingSlip(db: AppDb, ctx: Ctx, orderId: string): Promise<{ fileId: string | null }> {
  const context = packContext(db, ctx.scope, orderId);
  const order = loadPackOrder(db, ctx.scope, orderId);
  const lines = context.lines.map((l) => ({ ...l, toPack: l.toPack > 0 ? l.toPack : l.packed }));
  const fileId = await packingSlip(db, ctx, order, lines, { orderId, stationId: "", withLabel: false, packages: [], captures: [] } as unknown as CompletePackingInput, order.trackingNumber ?? null);
  if (!fileId) throw new DomainError("INVALID_STATE", "The packing slip could not be generated. Check the printout templates.");
  return { fileId };
}
