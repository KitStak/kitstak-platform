/**
 * Product detail (`/products/[id]`) and the edit-wizard payload (M09). Every section reads
 * real tables: pack types + barcodes, inventory buckets, ATP per warehouse, open orders and
 * POs, listings, kit components / used-in-kits, replenishment levels and the ledger.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import { assertInScope, type Scope } from "@/server/auth/scope";
import { schema } from "@/server/db";
import { getAtp, OPEN_PO_STATUSES, OPEN_SO_STATUSES } from "@/server/domain/atp";
import { emptyProductForm, normalizeCountryCode, type ProductFormValues } from "@/lib/grid-defs/products/product-form";
import { kitsUsing } from "./products-options";

const { products: p, clients, productPackTypes: ppt, productBarcodes: pb, kitComponents: kc, inventory: inv, locations, warehouses, licensePlates } = schema;

export interface PackTypeView {
  readonly id: string;
  readonly packType: string;
  readonly kind: "Primary" | "Hierarchical" | "Irregular";
  readonly parentPackType: string | null;
  readonly childQty: number | null;
  readonly uomQty: number;
  readonly dimensionUnit: string;
  readonly length: number;
  readonly width: number;
  readonly height: number;
  readonly volumeUnit: string;
  readonly volume: number;
  readonly weightUnit: string;
  readonly weight: number;
  readonly shipPackage: string | null;
  readonly useOwnBox: boolean;
  readonly usePrimaryBarcodes: boolean;
  readonly barcodes: readonly string[];
}

export function loadPackTypes(db: AppDb, productId: string): PackTypeView[] {
  const packs = db.select().from(ppt).where(eq(ppt.productId, productId)).all();
  const codes = db.select().from(pb).where(eq(pb.productId, productId)).all();
  const pkgIds = packs.map((x) => x.useShipPackageId).filter((x): x is string => Boolean(x));
  const pkgs = pkgIds.length ? db.select({ id: schema.shipmentPackages.id, code: schema.shipmentPackages.code }).from(schema.shipmentPackages).where(inArray(schema.shipmentPackages.id, pkgIds)).all() : [];
  const order = { Primary: 0, Hierarchical: 1, Irregular: 2 } as const;
  return packs
    .map((x) => ({
      id: x.id, packType: x.packType, kind: x.kind, parentPackType: packs.find((y) => y.id === x.parentPackTypeId)?.packType ?? null,
      childQty: x.childQty, uomQty: x.uomQty, dimensionUnit: x.dimensionUnit, length: x.length, width: x.width, height: x.height,
      volumeUnit: x.volumeUnit, volume: x.volume, weightUnit: x.weightUnit, weight: x.weight,
      shipPackage: pkgs.find((k) => k.id === x.useShipPackageId)?.code ?? null, useOwnBox: x.useOwnBox, usePrimaryBarcodes: x.usePrimaryBarcodes,
      barcodes: codes.filter((c) => c.packTypeId === x.id).map((c) => c.barcode),
    }))
    .sort((a, b) => order[a.kind] - order[b.kind] || a.uomQty - b.uomQty);
}

export interface InventoryBucketView {
  readonly id: string;
  readonly warehouseCode: string;
  readonly locationId: string;
  readonly locationCode: string;
  readonly zone: string | null;
  readonly lpNumber: string | null;
  readonly status: string;
  readonly packType: string;
  readonly lotNumber: string | null;
  readonly expiryDate: string | null;
  readonly onHand: number;
  readonly allocated: number;
  readonly damaged: number;
  readonly available: number;
  readonly receivedAt: string;
}

function omitLegacyCategory<T extends { category?: unknown }>(row: T): Omit<T, "category"> {
  const { category: _legacy, ...rest } = row;
  return rest;
}

export interface ProductDetailData {
  /** `category` (legacy free-text, always "General") is omitted: `productCategory` is the one category. */
  readonly product: Omit<typeof p.$inferSelect, "category"> & { clientName: string; clientCode: string; productType: string | null; productGroup: string | null; shipPackage: string | null };
  readonly packTypes: readonly PackTypeView[];
  /** Same-client products sharing the primary barcode (pre-uniqueness data). */
  readonly barcodeConflicts: readonly { id: string; sku: string; name: string }[];
  readonly totals: { onHand: number; allocated: number; damaged: number; available: number; openSo: number; openPo: number };
  readonly inventory: readonly InventoryBucketView[];
  readonly atp: readonly { warehouseId: string; warehouseCode: string; onHand: number; undamaged: number; openSo: number; allocatedSo: number; openPo: number; currentAtp: number; plannedAtp: number; pickable: number }[];
  readonly openOrders: readonly { id: string; code: string; status: string; warehouseCode: string; orderDate: string; customerName: string | null; quantity: number; allocated: number }[];
  readonly openPos: readonly { id: string; code: string; status: string; warehouseCode: string; vendorName: string; ordered: number; received: number; expectedAt: string | null }[];
  readonly listings: readonly { id: string; storeName: string; provider: string; sellerSku: string; channelProductId: string; storePrice: number | null; neverSync: boolean }[];
  readonly components: readonly { id: string; sku: string; name: string; quantity: number; available: number; imageUrl: string | null }[];
  readonly usedInKits: readonly { id: string; sku: string; name: string; quantity: number }[];
  readonly replenishment: readonly { warehouseCode: string; min: number; max: number }[];
  readonly allocations: readonly { storeName: string; warehouseCode: string | null; staticQty: number | null; reserveQty: number | null; allocationPct: number | null; syncedQty: number }[];
  readonly transactions: readonly { id: string; seq: number; type: string; at: string; warehouseCode: string; fromLocation: string | null; toLocation: string | null; qty: number; lotNumber: string | null; source: string; reference: string | null }[];
}

const lookupName = (db: AppDb, id: string | null): string | null =>
  id ? db.select({ n: schema.lookupValues.name }).from(schema.lookupValues).where(eq(schema.lookupValues.id, id)).get()?.n ?? null : null;

const sqlList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v.replace(/'/g, "''")}'`).join(","));

export function getProductDetail(db: AppDb, scope: Scope, viewScope: Scope, id: string): ProductDetailData | null {
  const row = db.select().from(p).innerJoin(clients, eq(clients.id, p.clientId)).where(eq(p.id, id)).get();
  if (!row) return null;
  try {
    assertInScope(scope, { clientId: row.products.clientId }, "Product");
  } catch {
    return null;
  }
  const product = row.products;
  const whIds = viewScope.warehouseIds.length ? [...viewScope.warehouseIds] : ["__none__"];
  const whs = db.select({ id: warehouses.id, code: warehouses.code }).from(warehouses).all();
  const whCode = (w: string | null) => whs.find((x) => x.id === w)?.code ?? "";

  const buckets = db.select({
    id: inv.id, warehouseId: inv.warehouseId, locationId: inv.locationId, locationCode: locations.code, zone: locations.zone, lpNumber: licensePlates.number,
    status: inv.status, packType: inv.packType, lotNumber: inv.lotNumber, expiryDate: inv.expiryDate, onHand: inv.onHand, allocated: inv.allocated,
    damaged: inv.damaged, receivedAt: inv.receivedAt,
  }).from(inv).innerJoin(locations, eq(locations.id, inv.locationId)).leftJoin(licensePlates, eq(licensePlates.id, inv.lpId))
    .where(and(eq(inv.productId, id), inArray(inv.warehouseId, whIds), sql`${inv.onHand} > 0`))
    .orderBy(asc(locations.code)).all()
    .map((b) => ({ ...b, warehouseCode: whCode(b.warehouseId), available: b.onHand - b.allocated - b.damaged }));

  const atp = getAtp(db, { productIds: [id], warehouseIds: whIds }).map((a) => ({
    warehouseId: a.warehouseId, warehouseCode: whCode(a.warehouseId), onHand: a.total, undamaged: a.undamaged, openSo: a.openSo,
    allocatedSo: a.allocatedSo, openPo: a.openPo, currentAtp: a.currentAtp, plannedAtp: a.plannedAtp, pickable: a.pickable,
  }));

  const openOrders = db.all<{ id: string; code: string; status: string; warehouseId: string; orderDate: string; customerName: string | null; quantity: number; allocated: number }>(sql`
    SELECT o.id, o.code, o.status, o.warehouse_id AS warehouseId, o.order_date AS orderDate, o.customer_name AS customerName,
      SUM(l.quantity - l.cancelled_quantity) AS quantity, SUM(l.allocated_quantity) AS allocated
    FROM order_lines l JOIN shipment_orders o ON o.id = l.order_id
    WHERE l.product_id = ${id} AND o.deleted_at IS NULL AND o.status IN (${sqlList(OPEN_SO_STATUSES)}) AND o.warehouse_id IN (${sqlList(whIds)})
    GROUP BY o.id ORDER BY o.order_date DESC LIMIT 100`).map((o) => ({ ...o, warehouseCode: whCode(o.warehouseId), quantity: Number(o.quantity), allocated: Number(o.allocated) }));

  const openPos = db.all<{ id: string; code: string; status: string; warehouseId: string; vendorName: string; ordered: number; received: number; expectedAt: string | null }>(sql`
    SELECT o.id, o.code, o.status, o.warehouse_id AS warehouseId, o.vendor_name AS vendorName,
      SUM(l.ordered_quantity * l.uom_quantity) AS ordered, SUM(l.received_quantity * l.uom_quantity) AS received, o.expected_date AS expectedAt
    FROM purchase_order_lines l JOIN purchase_orders o ON o.id = l.purchase_order_id
    WHERE l.product_id = ${id} AND o.status IN (${sqlList(OPEN_PO_STATUSES)}) AND o.warehouse_id IN (${sqlList(whIds)})
    GROUP BY o.id ORDER BY o.code DESC LIMIT 100`).map((o) => ({ ...o, warehouseCode: whCode(o.warehouseId), ordered: Number(o.ordered), received: Number(o.received) }));

  const listings = db.select({
    id: schema.productListings.id, storeName: schema.channelConnections.storeName, provider: schema.channelConnections.provider,
    sellerSku: schema.productListings.sellerSku, channelProductId: schema.productListings.channelProductId,
    storePrice: schema.productListings.storePrice, neverSync: schema.productListings.neverSync,
  }).from(schema.productListings).innerJoin(schema.channelConnections, eq(schema.channelConnections.id, schema.productListings.channelConnectionId))
    .where(eq(schema.productListings.productId, id)).orderBy(asc(schema.channelConnections.storeName)).all();

  const comp = db.select({ id: p.id, sku: p.sku, name: p.name, quantity: kc.quantity, imageUrl: p.imageUrl }).from(kc)
    .innerJoin(p, eq(p.id, kc.componentProductId)).where(eq(kc.kitProductId, id)).orderBy(asc(p.sku)).all();
  const components = comp.map((c) => ({
    ...c,
    available: Number(db.get<{ n: number }>(sql`SELECT COALESCE(SUM(on_hand - allocated - damaged), 0) AS n FROM inventory WHERE product_id = ${c.id} AND warehouse_id IN (${sqlList(whIds)})`)?.n ?? 0),
  }));

  const replenishment = product.replenishmentStrategy === "Per Warehouse"
    ? db.select({ warehouseId: schema.productReplenishmentLevels.warehouseId, min: schema.productReplenishmentLevels.minLevel, max: schema.productReplenishmentLevels.maxLevel })
      .from(schema.productReplenishmentLevels).where(eq(schema.productReplenishmentLevels.productId, id)).all().map((r) => ({ warehouseCode: whCode(r.warehouseId), min: r.min, max: r.max }))
    : [{ warehouseCode: "All warehouses", min: product.replenishmentMin, max: product.replenishmentMax }];

  const allocations = db.select({
    storeName: schema.channelConnections.storeName, warehouseId: schema.productChannelAllocations.warehouseId, staticQty: schema.productChannelAllocations.staticQty,
    reserveQty: schema.productChannelAllocations.reserveQty, allocationPct: schema.productChannelAllocations.allocationPct, syncedQty: schema.productChannelAllocations.syncedQty,
  }).from(schema.productChannelAllocations).innerJoin(schema.channelConnections, eq(schema.channelConnections.id, schema.productChannelAllocations.channelConnectionId))
    .where(eq(schema.productChannelAllocations.productId, id)).all().map((a) => ({ ...a, warehouseCode: a.warehouseId ? whCode(a.warehouseId) : null }));

  const tx = schema.inventoryTransactions;
  const txns = db.select().from(tx).where(and(eq(tx.productId, id), inArray(tx.warehouseId, whIds))).orderBy(desc(tx.seq)).limit(100).all();
  const locIds = [...new Set(txns.flatMap((t) => [t.fromLocationId, t.toLocationId]).filter((x): x is string => Boolean(x)))];
  const locs = locIds.length ? db.select({ id: locations.id, code: locations.code }).from(locations).where(inArray(locations.id, locIds)).all() : [];
  const orderIds = [...new Set(txns.map((t) => t.orderId).filter((x): x is string => Boolean(x)))];
  const poIds = [...new Set(txns.map((t) => t.purchaseOrderId).filter((x): x is string => Boolean(x)))];
  const orderCodes = orderIds.length ? db.select({ id: schema.shipmentOrders.id, code: schema.shipmentOrders.code }).from(schema.shipmentOrders).where(inArray(schema.shipmentOrders.id, orderIds)).all() : [];
  const poCodes = poIds.length ? db.select({ id: schema.purchaseOrders.id, code: schema.purchaseOrders.code }).from(schema.purchaseOrders).where(inArray(schema.purchaseOrders.id, poIds)).all() : [];
  const transactions = txns.map((t) => ({
    id: t.id, seq: t.seq, type: t.type, at: t.at, warehouseCode: whCode(t.warehouseId),
    fromLocation: locs.find((l) => l.id === t.fromLocationId)?.code ?? null, toLocation: locs.find((l) => l.id === t.toLocationId)?.code ?? null,
    qty: t.uomQty, lotNumber: t.toLot ?? t.fromLot, source: t.source,
    reference: orderCodes.find((o) => o.id === t.orderId)?.code ?? poCodes.find((o) => o.id === t.purchaseOrderId)?.code ?? null,
  }));

  const totals = buckets.reduce((acc, b) => ({ ...acc, onHand: acc.onHand + b.onHand, allocated: acc.allocated + b.allocated, damaged: acc.damaged + b.damaged, available: acc.available + b.available }),
    { onHand: 0, allocated: 0, damaged: 0, available: 0, openSo: atp.reduce((s, a) => s + a.openSo, 0), openPo: atp.reduce((s, a) => s + a.openPo, 0) });

  const shipPackage = product.useShipPackageId
    ? db.select({ code: schema.shipmentPackages.code }).from(schema.shipmentPackages).where(eq(schema.shipmentPackages.id, product.useShipPackageId)).get()?.code ?? null
    : null;

  return {
    product: { ...omitLegacyCategory(product), clientName: row.clients.name, clientCode: row.clients.code, productType: lookupName(db, product.productTypeId), productGroup: lookupName(db, product.productGroupId), shipPackage },
    packTypes: loadPackTypes(db, id), barcodeConflicts: product.barcode ? db.all<{ id: string; sku: string; name: string }>(sql`
      SELECT p2.id, p2.sku, p2.name FROM products p2 WHERE p2.client_id = ${product.clientId} AND p2.id <> ${id}
        AND (p2.barcode = ${product.barcode} OR EXISTS (SELECT 1 FROM product_barcodes b2 WHERE b2.product_id = p2.id AND b2.barcode = ${product.barcode}))
      ORDER BY p2.sku LIMIT 20`) : [], totals, inventory: buckets, atp, openOrders, openPos, listings, components,
    usedInKits: kitsUsing(db, id), replenishment, allocations, transactions,
  };
}

/** Wizard form values for an existing product (edit mode / duplicate). */
export function getProductForm(db: AppDb, scope: Scope, id: string): (ProductFormValues & { id: string; version: number; clientName: string }) | null {
  const row = db.select().from(p).innerJoin(clients, eq(clients.id, p.clientId)).where(eq(p.id, id)).get();
  if (!row) return null;
  try {
    assertInScope(scope, { clientId: row.products.clientId }, "Product");
  } catch {
    return null;
  }
  const r = row.products;
  const base = emptyProductForm(r.productCategory, r.clientId);
  const packs = db.select().from(ppt).where(eq(ppt.productId, id)).all();
  const codes = db.select().from(pb).where(eq(pb.productId, id)).all();
  const primary = packs.find((x) => x.kind === "Primary");
  const customs = (r.customs ?? {}) as Record<string, unknown>;
  const hazmat = (r.hazmat ?? {}) as Record<string, unknown>;
  const components = db.select({ productId: p.id, sku: p.sku, name: p.name, imageUrl: p.imageUrl, quantity: kc.quantity }).from(kc)
    .innerJoin(p, eq(p.id, kc.componentProductId)).where(eq(kc.kitProductId, id)).orderBy(asc(p.sku)).all();
  const levels = db.select().from(schema.productReplenishmentLevels).where(eq(schema.productReplenishmentLevels.productId, id)).all();
  const allocations = db.select().from(schema.productChannelAllocations).where(eq(schema.productChannelAllocations.productId, id)).all();
  const isProduct = r.productCategory === "Product";
  return {
    ...base,
    id: r.id, version: r.version, clientName: row.clients.name,
    productCategory: r.productCategory, kitType: r.kitType, clientId: r.clientId, sku: r.sku, name: r.name,
    description: r.description ?? "", imageUrl: r.imageUrl ?? "", barcode: isProduct ? "" : codes.find((c) => c.packTypeId === primary?.id)?.barcode ?? "",
    productTypeId: r.productTypeId, productGroupId: r.productGroupId, uom: r.uom, currency: r.currency,
    purchasePrice: r.purchasePrice, salesPrice: r.price, taxRate: r.taxRate, minSafetyStock: r.minSafetyStock, fnsku: r.fnsku ?? "",
    isActive: r.status === "Active", isDigital: r.isDigital,
    packingInstructions: r.packingInstructions ?? "", returnInstructions: r.returnInstructions ?? "",
    isFoldable: r.isFoldable, isFragile: r.isFragile, isOversized: r.isOversized, isInsert: r.isInsert, isStackable: r.isStackable,
    isPoster: r.isPoster, isLiquid: r.isLiquid, isNonReturnable: r.isNonReturnable,
    weightUnit: primary?.weightUnit ?? "Pound", weight: primary?.weight ?? null, dimensionUnit: primary?.dimensionUnit ?? "Inch",
    length: primary?.length ?? null, width: primary?.width ?? null, height: primary?.height ?? null, volumeUnit: primary?.volumeUnit ?? "Cubic Inch",
    volume: primary?.volume ?? null, volumeOverridden: Boolean(primary && primary.volume > 0), useShipPackageId: r.useShipPackageId,
    packTypes: packs.map((x) => ({
      key: x.id, id: x.id, packType: x.packType, kind: x.kind, parentKey: x.parentPackTypeId, childQty: x.childQty, uomQty: x.uomQty,
      dimensionUnit: x.dimensionUnit, length: x.length, width: x.width, height: x.height, volumeUnit: x.volumeUnit, volume: x.volume,
      volumeOverridden: true, weightUnit: x.weightUnit, weight: x.weight, useShipPackageId: x.useShipPackageId, useOwnBox: x.useOwnBox,
      usePrimaryBarcodes: x.usePrimaryBarcodes, barcodes: codes.filter((c) => c.packTypeId === x.id).map((c) => c.barcode),
    })),
    components: components.map((c) => ({ ...c })),
    customs: {
      declaredValue: (customs.declaredValue as number | undefined) ?? null, hsCode: customs.hsCode ?? "", originCountry: normalizeCountryCode(customs.originCountry),
      notDeclared: Boolean(customs.notDeclared), manufacturer: customs.manufacturer ?? "", manufacturerProductId: customs.manufacturerProductId ?? "",
      description: customs.description ?? "",
    },
    isHazmat: r.isHazmat,
    hazmat: {
      hazmatId: hazmat.hazmatId ?? "", type: hazmat.type ?? null, attribute: hazmat.attribute ?? null, quantity: hazmat.quantity ?? null,
      quantityType: hazmat.quantityType ?? null, quantityUnit: hazmat.quantityUnit ?? null, containerType: hazmat.containerType ?? null,
      properShippingName: hazmat.properShippingName ?? "", classDivision: hazmat.classDivision ?? "",
    },
    channelAllocations: allocations.map((a) => ({ key: a.id, channelConnectionId: a.channelConnectionId, warehouseId: a.warehouseId, staticQty: a.staticQty, reserveQty: a.reserveQty, allocationPct: a.allocationPct })),
    trackExpiry: r.trackExpiry, expiryReceivingOnly: r.expiryReceivingOnly, expiryFormat: r.expiryFormat, expiryScanMethod: r.expiryScanMethod ?? "During Picking",
    useProductionDate: Boolean(customs.useProductionDate), shelfLifeDays: r.shelfLifeDays,
    trackLot: r.trackLot, lotReceivingOnly: r.lotReceivingOnly, autoCreateLot: r.autoCreateLot, lotRegex: r.lotRegex ?? "", lotScanMethod: r.lotScanMethod ?? "During Picking",
    trackProductionDate: r.trackProductionDate, productionReceivingOnly: r.productionReceivingOnly, productionFormat: r.productionFormat,
    productionScanMethod: r.productionScanMethod ?? "During Picking",
    replenishmentStrategy: r.replenishmentStrategy, replenishmentMin: r.replenishmentMin, replenishmentMax: r.replenishmentMax,
    replenishmentLevels: levels.map((l) => ({ warehouseId: l.warehouseId, minLevel: l.minLevel, maxLevel: l.maxLevel })),
    trackSerial: r.trackSerial, trackSecondarySerial: r.trackSecondarySerial, serialMethod: r.serialMethod, skipSerialScan: r.skipSerialScan, serialRegex: r.serialRegex ?? "",
    customFields: { ...(r.customFields ?? {}) } as Record<string, string | boolean | null>,
  };
}
