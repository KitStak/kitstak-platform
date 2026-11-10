/**
 * Product writes (M09): create / update from the wizard payload, status changes and the
 * guarded delete. Every write goes through `change_log` (field-level, human labels) and is
 * checked against the caller's client scope (cross-scope → 404).
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import { AppError, conflictError, notFoundError } from "@/server/api/errors";
import { assertInScope, hasClient, hasWarehouse } from "@/server/auth/scope";
import { schema } from "@/server/db";
import { recordCreate, recordDelete, recordUpdate } from "@/server/domain/change-log";
import { OPEN_PO_STATUSES, OPEN_SO_STATUSES } from "@/server/domain/atp";
import type { DomainCtx } from "@/server/domain/types";
import { CUSTOM_FIELD_SLOTS } from "@/lib/enums";
import { toInches, toOunces } from "@/lib/grid-defs/products/catalog-options";
import { derivedVolume, normalizePackTypes, productInputSchema, type ProductInput, type ProductValue } from "@/lib/grid-defs/products/product-form";
import { productSnapshot } from "./products-snapshot";

const { products: p, productPackTypes: ppt, productBarcodes: pb, kitComponents: kc, productReplenishmentLevels: prl, productChannelAllocations: pca } = schema;

export type ScopedCtx = DomainCtx & { readonly scope: NonNullable<DomainCtx["scope"]> };
export type ProductRow = typeof p.$inferSelect;

const ENTITY = "product";

function invalid(path: string, message: string): AppError {
  return new AppError("VALIDATION", message, { fieldErrors: { [path]: [message] } });
}

/** Parses and cross-checks the payload against the database. */
function validate(tx: AppDb, ctx: ScopedCtx, raw: ProductInput, existing: ProductRow | null): ProductValue {
  const parsed = productInputSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const i of parsed.error.issues) {
      const k = i.path.map(String).join(".") || "_";
      fieldErrors[k] = [...(fieldErrors[k] ?? []), i.message];
    }
    throw new AppError("VALIDATION", parsed.error.issues[0]?.message ?? "Invalid product", { fieldErrors });
  }
  const v = parsed.data;
  if (existing && existing.clientId !== v.clientId) throw invalid("clientId", "The client of a product cannot be changed");
  if (existing && existing.productCategory !== v.productCategory) throw invalid("productCategory", "The product category cannot be changed");
  if (!hasClient(ctx.scope, v.clientId)) throw notFoundError("Client");
  const client = tx.select({ id: schema.clients.id, code: schema.clients.code }).from(schema.clients).where(eq(schema.clients.id, v.clientId)).get();
  if (!client) throw invalid("clientId", "Client not found");

  const dup = tx.select({ id: p.id }).from(p)
    .where(and(eq(p.clientId, v.clientId), sql`lower(${p.sku}) = lower(${v.sku})`, existing ? sql`${p.id} <> ${existing.id}` : undefined)).get();
  if (dup) throw new AppError("DUPLICATE", `SKU ${v.sku} already exists for client ${client.code}`, { fieldErrors: { sku: [`SKU ${v.sku} already exists for this client`] } });

  for (const [key, type] of [["productTypeId", "product_type"], ["productGroupId", "product_group"]] as const) {
    const id = v[key];
    if (!id) continue;
    const row = tx.select({ clientId: schema.lookupValues.clientId, type: schema.lookupValues.type }).from(schema.lookupValues).where(eq(schema.lookupValues.id, id)).get();
    if (!row || row.type !== type || (row.clientId && row.clientId !== v.clientId)) throw invalid(key, "Choose a value for this client");
  }
  if (v.useShipPackageId && !tx.select({ id: schema.shipmentPackages.id }).from(schema.shipmentPackages).where(eq(schema.shipmentPackages.id, v.useShipPackageId)).get()) {
    throw invalid("useShipPackageId", "Shipment package not found");
  }
  for (const level of v.replenishmentLevels) {
    if (!hasWarehouse(ctx.scope, level.warehouseId)) throw invalid("replenishmentLevels", "Warehouse not found");
  }
  if (v.channelAllocations.length) {
    const ids = v.channelAllocations.map((a) => a.channelConnectionId);
    const ok = tx.select({ id: schema.channelConnections.id }).from(schema.channelConnections)
      .where(and(inArray(schema.channelConnections.id, ids), eq(schema.channelConnections.clientId, v.clientId))).all();
    if (new Set(ok.map((r) => r.id)).size !== new Set(ids).size) throw invalid("channelAllocations", "A sales channel does not belong to this client");
  }
  if (v.productCategory === "Kit") {
    const ids = v.components.map((c) => c.productId);
    if (existing && ids.includes(existing.id)) throw invalid("components", "A kit cannot contain itself");
    const rows = ids.length ? tx.select({ id: p.id, clientId: p.clientId, sku: p.sku, category: p.productCategory, kitType: p.kitType }).from(p).where(inArray(p.id, ids)).all() : [];
    for (const c of v.components) {
      const row = rows.find((r) => r.id === c.productId);
      if (!row || row.clientId !== v.clientId) throw invalid("components", "Components must belong to the kit's client");
      if (row.category === "Packaging Material") throw invalid("components", `${row.sku} is packaging material and cannot be a component`);
      if (row.category === "Kit" && row.kitType !== "Kit to Stock") throw invalid("components", `${row.sku} is a kit-to-order kit and cannot be a component`);
    }
  }
  return v;
}

function cleanCustomFields(values: Readonly<Record<string, unknown>>): Record<string, string | boolean | null> {
  const out: Record<string, string | boolean | null> = {};
  for (const slot of CUSTOM_FIELD_SLOTS) {
    const value = values[slot];
    if (typeof value === "string" || typeof value === "boolean") out[slot] = value;
    else if (value === null) out[slot] = null;
  }
  return out;
}

/** Product columns derived from the payload (primary pack drives the legacy dims). */
export function productColumns(v: ProductValue): Omit<typeof p.$inferInsert, "id" | "clientId" | "createdBy" | "createdAt"> {
  const packs = normalizePackTypes(v.packTypes);
  const primary = packs.find((x) => x.kind === "Primary");
  const dims = v.productCategory === "Product" && primary
    ? { unit: primary.dimensionUnit, l: primary.length, w: primary.width, h: primary.height, wu: primary.weightUnit, wt: primary.weight }
    : { unit: v.dimensionUnit, l: v.length, w: v.width, h: v.height, wu: v.weightUnit, wt: v.weight };
  const barcode = primary?.barcodes[0] ?? v.barcode ?? v.sku;
  const isKit = v.productCategory === "Kit";
  const isPackaging = v.productCategory === "Packaging Material";
  const tracking = isKit
    ? { trackExpiry: false, trackLot: false, trackProductionDate: false, trackSerial: false }
    : { trackExpiry: v.trackExpiry, trackLot: v.trackLot, trackProductionDate: v.trackProductionDate, trackSerial: v.trackSerial };
  return {
    sku: v.sku,
    barcode,
    name: v.name,
    category: "General",
    uom: v.productCategory === "Product" ? primary?.packType ?? "Unit" : v.uom,
    weightOz: toOunces(dims.wt, dims.wu),
    lengthIn: toInches(dims.l, dims.unit),
    widthIn: toInches(dims.w, dims.unit),
    heightIn: toInches(dims.h, dims.unit),
    price: isPackaging ? 0 : Math.round(v.salesPrice * 100) / 100,
    isKit,
    isFragile: v.isFragile,
    isHazmat: !isPackaging && v.isHazmat,
    status: v.isActive ? "Active" : "Inactive",
    reorderPoint: v.minSafetyStock,
    productCategory: v.productCategory,
    kitType: isKit ? v.kitType : null,
    description: v.description,
    imageUrl: v.imageUrl,
    productTypeId: v.productTypeId,
    productGroupId: v.productGroupId,
    currency: v.currency,
    purchasePrice: Math.round(v.purchasePrice * 100) / 100,
    taxRate: isPackaging ? 0 : v.taxRate,
    minSafetyStock: v.minSafetyStock,
    fnsku: v.fnsku,
    isDigital: !isPackaging && v.isDigital,
    isFoldable: v.isFoldable,
    isOversized: v.isOversized,
    isInsert: v.isInsert,
    isStackable: v.isStackable,
    isPoster: v.isPoster,
    isLiquid: !isPackaging && v.isLiquid,
    isNonReturnable: v.isNonReturnable,
    packingInstructions: v.packingInstructions,
    returnInstructions: v.returnInstructions,
    useShipPackageId: v.productCategory === "Product" ? primary?.useShipPackageId ?? null : v.useShipPackageId,
    // REQ-1 adapter: "Use production date" lives in the customs JSON until a column lands.
    customs: { ...v.customs, useProductionDate: !isKit && v.useProductionDate } as typeof p.$inferInsert.customs,
    hazmat: (v.isHazmat && !isPackaging ? v.hazmat : null) as typeof p.$inferInsert.hazmat,
    ...tracking,
    expiryReceivingOnly: !isKit && v.expiryReceivingOnly,
    expiryFormat: tracking.trackExpiry ? v.expiryFormat : null,
    expiryScanMethod: tracking.trackExpiry ? v.expiryScanMethod ?? "During Picking" : null,
    shelfLifeDays: isKit ? null : v.shelfLifeDays,
    lotReceivingOnly: !isKit && v.lotReceivingOnly,
    autoCreateLot: !isKit && v.autoCreateLot,
    lotRegex: tracking.trackLot ? v.lotRegex : null,
    lotScanMethod: tracking.trackLot ? v.lotScanMethod ?? "During Picking" : null,
    productionReceivingOnly: !isKit && v.productionReceivingOnly,
    productionFormat: tracking.trackProductionDate ? v.productionFormat : null,
    productionScanMethod: tracking.trackProductionDate ? v.productionScanMethod ?? "During Picking" : null,
    replenishmentStrategy: isKit ? "Global" : v.replenishmentStrategy,
    replenishmentMin: isKit || v.replenishmentStrategy !== "Global" ? 0 : v.replenishmentMin,
    replenishmentMax: isKit || v.replenishmentStrategy !== "Global" ? 0 : v.replenishmentMax,
    trackSecondarySerial: tracking.trackSerial && v.trackSecondarySerial,
    serialMethod: tracking.trackSerial ? v.serialMethod : null,
    skipSerialScan: tracking.trackSerial && v.skipSerialScan,
    serialRegex: tracking.trackSerial ? v.serialRegex : null,
    customFields: cleanCustomFields(v.customFields),
  };
}

/** Pack types for kits/packaging: a single primary carrying the packing-step dims. */
function packsFor(v: ProductValue): ProductValue["packTypes"] {
  if (v.productCategory === "Product") return normalizePackTypes(v.packTypes);
  const existing = v.packTypes.find((x) => x.kind === "Primary");
  return [{
    key: existing?.key ?? "primary", id: existing?.id ?? null, packType: v.uom, kind: "Primary", parentKey: null, childQty: undefined, uomQty: 1,
    dimensionUnit: v.dimensionUnit, length: v.length, width: v.width, height: v.height, volumeUnit: v.volumeUnit,
    volume: derivedVolume(v), volumeOverridden: v.volumeOverridden, weightUnit: v.weightUnit, weight: v.weight,
    useShipPackageId: v.useShipPackageId, useOwnBox: false, usePrimaryBarcodes: false, barcodes: v.barcode ? [v.barcode] : [],
  }];
}

function inventoryPackTypes(tx: AppDb, productId: string): Set<string> {
  return new Set(tx.select({ packType: schema.inventory.packType }).from(schema.inventory)
    .where(and(eq(schema.inventory.productId, productId), sql`${schema.inventory.onHand} > 0`)).all().map((r) => r.packType.toLowerCase()));
}

/** Replaces pack types + barcodes, keeping ids of edited packs (inventory references names). */
function syncPackTypes(tx: AppDb, ctx: ScopedCtx, productId: string, v: ProductValue): void {
  const packs = packsFor(v);
  const current = tx.select().from(ppt).where(eq(ppt.productId, productId)).all();
  const keep = new Set(packs.map((x) => x.id).filter((x): x is string => Boolean(x)));
  const inUse = inventoryPackTypes(tx, productId);
  for (const old of current) {
    const replacement = packs.find((x) => x.id === old.id);
    const renamed = replacement && replacement.packType.toLowerCase() !== old.packType.toLowerCase();
    if ((!keep.has(old.id) || renamed) && inUse.has(old.packType.toLowerCase())) {
      throw invalid("packTypes", `Pack type ${old.packType} has stock on hand and cannot be removed or renamed`);
    }
  }
  const removed = current.filter((c) => !keep.has(c.id)).map((c) => c.id);
  if (removed.length) tx.delete(ppt).where(inArray(ppt.id, removed)).run();
  tx.delete(pb).where(eq(pb.productId, productId)).run();
  // Two passes: rows first (ids), then hierarchical parents.
  const idByKey = new Map<string, string>();
  for (const pack of packs) {
    const values = {
      productId, packType: pack.packType, kind: pack.kind, childQty: pack.kind === "Hierarchical" ? pack.childQty ?? 2 : null,
      uomQty: pack.uomQty, dimensionUnit: pack.dimensionUnit, length: pack.length, width: pack.width, height: pack.height,
      volumeUnit: pack.volumeUnit, volume: derivedVolume(pack), weightUnit: pack.weightUnit, weight: pack.weight,
      useShipPackageId: pack.useShipPackageId, useOwnBox: pack.useOwnBox, usePrimaryBarcodes: pack.kind !== "Primary" && pack.usePrimaryBarcodes,
      updatedBy: ctx.userId,
    };
    if (pack.id && current.some((c) => c.id === pack.id)) {
      tx.update(ppt).set({ ...values, version: sql`${ppt.version} + 1` }).where(eq(ppt.id, pack.id)).run();
      idByKey.set(pack.key, pack.id);
    } else {
      const row = tx.insert(ppt).values({ ...values, createdBy: ctx.userId }).returning({ id: ppt.id }).get();
      idByKey.set(pack.key, row.id);
    }
  }
  const primaryId = packs.find((x) => x.kind === "Primary")?.key;
  for (const pack of packs) {
    const id = idByKey.get(pack.key) as string;
    if (pack.kind === "Hierarchical") {
      const parent = (pack.parentKey && idByKey.get(pack.parentKey)) || (primaryId ? idByKey.get(primaryId) : null) || null;
      tx.update(ppt).set({ parentPackTypeId: parent }).where(eq(ppt.id, id)).run();
    } else {
      tx.update(ppt).set({ parentPackTypeId: null }).where(eq(ppt.id, id)).run();
    }
    const codes = [...new Set(pack.barcodes.map((b) => b.trim()).filter(Boolean))];
    if (codes.length) tx.insert(pb).values(codes.map((barcode) => ({ productId, packTypeId: id, barcode }))).run();
  }
}

function syncChildren(tx: AppDb, productId: string, v: ProductValue): void {
  tx.delete(kc).where(eq(kc.kitProductId, productId)).run();
  if (v.productCategory === "Kit" && v.components.length) {
    tx.insert(kc).values(v.components.map((c) => ({ kitProductId: productId, componentProductId: c.productId, quantity: c.quantity }))).run();
  }
  tx.delete(prl).where(eq(prl.productId, productId)).run();
  if (v.productCategory !== "Kit" && v.replenishmentStrategy === "Per Warehouse" && v.replenishmentLevels.length) {
    tx.insert(prl).values(v.replenishmentLevels.map((l) => ({ productId, warehouseId: l.warehouseId, minLevel: l.minLevel, maxLevel: l.maxLevel }))).run();
  }
  tx.delete(pca).where(eq(pca.productId, productId)).run();
  if (v.productCategory !== "Packaging Material" && v.channelAllocations.length) {
    tx.insert(pca).values(v.channelAllocations.map((a) => ({
      productId, channelConnectionId: a.channelConnectionId, warehouseId: a.warehouseId, staticQty: a.staticQty, reserveQty: a.reserveQty, allocationPct: a.allocationPct,
    }))).run();
  }
}

export function createProductFromWizard(tx: AppDb, ctx: ScopedCtx, raw: ProductInput): ProductRow {
  const v = validate(tx, ctx, raw, null);
  const row = tx.insert(p).values({ ...productColumns(v), clientId: v.clientId, createdBy: ctx.userId, updatedBy: ctx.userId }).returning().get();
  syncPackTypes(tx, ctx, row.id, v);
  syncChildren(tx, row.id, v);
  recordCreate(tx, ctx, { entityType: ENTITY, entityId: row.id, entityCode: row.sku });
  return row;
}

export function loadProduct(tx: AppDb, ctx: ScopedCtx, id: string): ProductRow {
  const row = tx.select().from(p).where(eq(p.id, id)).get();
  assertInScope(ctx.scope, row ? { clientId: row.clientId } : null, "Product");
  return row as ProductRow;
}

export function updateProductFromWizard(tx: AppDb, ctx: ScopedCtx, id: string, raw: ProductInput): ProductRow {
  const existing = loadProduct(tx, ctx, id);
  if (raw.version !== undefined && raw.version !== existing.version) throw conflictError();
  const v = validate(tx, ctx, raw, existing);
  const before = productSnapshot(tx, id);
  tx.update(p).set({ ...productColumns(v), updatedBy: ctx.userId, version: existing.version + 1 }).where(eq(p.id, id)).run();
  syncPackTypes(tx, ctx, id, v);
  syncChildren(tx, id, v);
  const after = productSnapshot(tx, id);
  recordUpdate(tx, ctx, { entityType: ENTITY, entityId: id, entityCode: v.sku, before, after });
  return tx.select().from(p).where(eq(p.id, id)).get() as ProductRow;
}

/** Activates / deactivates one product (bulk callers wrap this in `runBulk`). */
export function setProductStatus(tx: AppDb, ctx: ScopedCtx, id: string, status: "Active" | "Inactive", version?: number): ProductRow {
  const existing = loadProduct(tx, ctx, id);
  if (version !== undefined && version !== existing.version) throw conflictError();
  if (existing.status === status) return existing;
  tx.update(p).set({ status, updatedBy: ctx.userId, version: existing.version + 1 }).where(eq(p.id, id)).run();
  recordUpdate(tx, ctx, { entityType: ENTITY, entityId: id, entityCode: existing.sku, before: { status: existing.status }, after: { status } });
  return { ...existing, status, version: existing.version + 1 };
}

export interface DeleteBlocker {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly status: string;
  /** Null when the product can be deleted. */
  readonly reason: string | null;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

function soList(): ReturnType<typeof sql> {
  return sql.raw(OPEN_SO_STATUSES.map((s) => `'${s}'`).join(","));
}
function poList(): ReturnType<typeof sql> {
  return sql.raw(OPEN_PO_STATUSES.map((s) => `'${s}'`).join(","));
}

/** Why a product cannot be deleted: stock, open orders/POs, kit usage, or history. */
export function deleteBlockerFor(tx: AppDb, id: string): string | null {
  const n = (q: ReturnType<typeof sql>): number => Number(tx.get<{ n: number }>(q)?.n ?? 0);
  const onHand = n(sql`SELECT COALESCE(SUM(on_hand), 0) AS n FROM inventory WHERE product_id = ${id}`);
  if (onHand > 0) return `Has ${plural(onHand, "unit")} on hand`;
  const openSo = n(sql`SELECT COUNT(DISTINCT o.id) AS n FROM order_lines l JOIN shipment_orders o ON o.id = l.order_id WHERE l.product_id = ${id} AND o.deleted_at IS NULL AND o.status IN (${soList()})`);
  if (openSo > 0) return `On ${plural(openSo, "open shipment order")}`;
  const openPo = n(sql`SELECT COUNT(DISTINCT o.id) AS n FROM purchase_order_lines l JOIN purchase_orders o ON o.id = l.purchase_order_id WHERE l.product_id = ${id} AND o.status IN (${poList()})`);
  if (openPo > 0) return `On ${plural(openPo, "open purchase order")}`;
  const kit = tx.get<{ sku: string }>(sql`SELECT k.sku AS sku FROM kit_components c JOIN products k ON k.id = c.kit_product_id WHERE c.component_product_id = ${id} LIMIT 1`);
  if (kit) return `Component of kit ${kit.sku}`;
  const history = n(sql`SELECT
      (SELECT COUNT(*) FROM inventory WHERE product_id = ${id}) +
      (SELECT COUNT(*) FROM inventory_transactions WHERE product_id = ${id}) +
      (SELECT COUNT(*) FROM order_lines WHERE product_id = ${id}) +
      (SELECT COUNT(*) FROM purchase_order_lines WHERE product_id = ${id}) +
      (SELECT COUNT(*) FROM work_orders WHERE kit_product_id = ${id}) +
      (SELECT COUNT(*) FROM location_product_capacity WHERE product_id = ${id}) +
      (SELECT COUNT(*) FROM serial_numbers WHERE product_id = ${id}) AS n`);
  if (history > 0) return "Has transaction history";
  return null;
}

export function deleteCheck(tx: AppDb, ctx: ScopedCtx, ids: readonly string[]): DeleteBlocker[] {
  const rows = tx.select({ id: p.id, sku: p.sku, name: p.name, status: p.status, clientId: p.clientId }).from(p).where(inArray(p.id, [...ids])).all()
    .filter((r) => hasClient(ctx.scope, r.clientId));
  return rows.map((r) => ({ id: r.id, sku: r.sku, name: r.name, status: r.status, reason: deleteBlockerFor(tx, r.id) }));
}

export function deleteProduct(tx: AppDb, ctx: ScopedCtx, id: string): void {
  const existing = loadProduct(tx, ctx, id);
  const reason = deleteBlockerFor(tx, id);
  if (reason) throw new AppError("INVALID_STATE", `${existing.sku}: ${reason}. Deactivate it instead.`);
  tx.update(schema.productListings).set({ productId: null, linkedAt: null }).where(eq(schema.productListings.productId, id)).run();
  tx.delete(p).where(eq(p.id, id)).run();
  recordDelete(tx, ctx, { entityType: ENTITY, entityId: id, entityCode: existing.sku });
}
