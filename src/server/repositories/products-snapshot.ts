/**
 * Human-readable product snapshot for the field-level change log: lookup names instead of
 * ids, flattened customs/hazmat, and one-line summaries for pack types, components,
 * replenishment levels and channel allocations. Keys humanize into the log labels
 * (`salesPrice` → "Sales price").
 */
import { asc, eq } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import { schema } from "@/server/db";

const { products: p, productPackTypes: ppt, productBarcodes: pb, kitComponents: kc, productReplenishmentLevels: prl, productChannelAllocations: pca } = schema;

const name = (db: AppDb, id: string | null): string | null =>
  id ? db.select({ n: schema.lookupValues.name }).from(schema.lookupValues).where(eq(schema.lookupValues.id, id)).get()?.n ?? id : null;

export function packTypesSummary(db: AppDb, productId: string): string {
  const packs = db.select().from(ppt).where(eq(ppt.productId, productId)).orderBy(asc(ppt.uomQty)).all();
  const codes = db.select().from(pb).where(eq(pb.productId, productId)).all();
  return packs.map((x) => {
    const bc = codes.filter((c) => c.packTypeId === x.id).map((c) => c.barcode);
    const dims = `${x.length}×${x.width}×${x.height} ${x.dimensionUnit}, ${x.weight} ${x.weightUnit}`;
    return `${x.packType} (${x.kind}, UOM ${x.uomQty}; ${dims}${bc.length ? `; ${bc.join(" ")}` : ""})`;
  }).join("; ");
}

export function productSnapshot(db: AppDb, productId: string): Record<string, unknown> {
  const r = db.select().from(p).where(eq(p.id, productId)).get();
  if (!r) return {};
  const customs = (r.customs ?? {}) as Record<string, unknown>;
  const hazmat = (r.hazmat ?? {}) as Record<string, unknown>;
  const components = db.select({ sku: p.sku, qty: kc.quantity }).from(kc).innerJoin(p, eq(p.id, kc.componentProductId))
    .where(eq(kc.kitProductId, productId)).orderBy(asc(p.sku)).all().map((c) => `${c.sku} ×${c.qty}`).join(", ");
  const levels = db.select({ code: schema.warehouses.code, min: prl.minLevel, max: prl.maxLevel }).from(prl)
    .innerJoin(schema.warehouses, eq(schema.warehouses.id, prl.warehouseId)).where(eq(prl.productId, productId)).all()
    .map((l) => `${l.code} ${l.min}–${l.max}`).join(", ");
  const allocations = db.select({ store: schema.channelConnections.storeName, s: pca.staticQty, rq: pca.reserveQty, pct: pca.allocationPct }).from(pca)
    .innerJoin(schema.channelConnections, eq(schema.channelConnections.id, pca.channelConnectionId)).where(eq(pca.productId, productId)).all()
    .map((a) => `${a.store}${a.s !== null ? ` static ${a.s}` : ""}${a.rq !== null ? ` reserve ${a.rq}` : ""}${a.pct !== null ? ` ${a.pct}%` : ""}`).join(", ");
  const shipBox = r.useShipPackageId
    ? db.select({ code: schema.shipmentPackages.code }).from(schema.shipmentPackages).where(eq(schema.shipmentPackages.id, r.useShipPackageId)).get()?.code ?? null
    : null;
  return {
    sku: r.sku, name: r.name, description: r.description, productImage: r.imageUrl, kitType: r.kitType,
    productType: name(db, r.productTypeId), productGroup: name(db, r.productGroupId), uomPackType: r.uom,
    currency: r.currency, purchasePrice: r.purchasePrice, salesPrice: r.price, taxRate: r.taxRate, minimumSafetyStock: r.minSafetyStock,
    FNSKU: r.fnsku, status: r.status, digital: r.isDigital,
    packingInstructions: r.packingInstructions, returnInstructions: r.returnInstructions,
    foldable: r.isFoldable, fragile: r.isFragile, oversized: r.isOversized, insert: r.isInsert, stackable: r.isStackable,
    poster: r.isPoster, liquid: r.isLiquid, nonReturnable: r.isNonReturnable, useThisShippingBoxOnly: shipBox,
    packTypes: packTypesSummary(db, productId),
    declaredValue: customs.declaredValue ?? null, hsTariffCode: customs.hsCode ?? null, originCountryCode: customs.originCountry ?? null,
    notDeclaredToCustoms: customs.notDeclared ?? false, manufacturer: customs.manufacturer ?? null,
    manufacturerProductIdentifier: customs.manufacturerProductId ?? null, customsDescription: customs.description ?? null,
    hazardous: r.isHazmat, hazmatId: hazmat.hazmatId ?? null, hazmatType: hazmat.type ?? null, hazmatAttribute: hazmat.attribute ?? null,
    hazmatQuantity: hazmat.quantity ?? null, hazmatQuantityType: hazmat.quantityType ?? null, hazmatQuantityUnit: hazmat.quantityUnit ?? null,
    hazmatContainerType: hazmat.containerType ?? null, properShippingName: hazmat.properShippingName ?? null, classDivision: hazmat.classDivision ?? null,
    expiryDateTracking: r.trackExpiry, receivingOnlyExpiryTracking: r.expiryReceivingOnly, expiryDateFormat: r.expiryFormat,
    expiryDateScanMethod: r.expiryScanMethod, useProductionDate: customs.useProductionDate ?? false, shelfLifeInDays: r.shelfLifeDays,
    lotBatchTracking: r.trackLot, receivingOnlyLotBatchTracking: r.lotReceivingOnly, autoCreateLotBatchNumber: r.autoCreateLot,
    lotBatchRegex: r.lotRegex, lotBatchNumberScanMethod: r.lotScanMethod,
    productionDateTracking: r.trackProductionDate, receivingOnlyProdDateTracking: r.productionReceivingOnly,
    productionDateFormat: r.productionFormat, productionDateScanMethod: r.productionScanMethod,
    replenishmentStrategy: r.replenishmentStrategy, minReplenishmentLevel: r.replenishmentMin, maxReplenishmentLevel: r.replenishmentMax,
    warehouseReplenishmentLevels: levels, channelAllocations: allocations, kitComponents: components,
    trackSerialNumber: r.trackSerial, trackSecondarySerialNumber: r.trackSecondarySerial, serialTrackingMethod: r.serialMethod,
    skipScanSerialNumber: r.skipSerialScan, serialNumberRegex: r.serialRegex,
    customFields: Object.entries(r.customFields ?? {}).filter(([, v]) => v !== null && v !== "").map(([k, v]) => `${k}: ${String(v)}`).join(", "),
  };
}
