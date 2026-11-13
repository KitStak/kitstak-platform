/**
 * Human-readable product snapshot for the field-level change log: lookup names instead of
 * ids, flattened customs/hazmat, and one-line summaries for pack types, components,
 * replenishment levels and channel allocations. Keys humanize into the log labels
 * (`salesPrice` → "Sales price").
 */
import { eq } from 'drizzle-orm';
import { asc } from '@/server/db/order';
import type { AppDb } from '@/server/api/db';
import { schema } from '@/server/db';

const {
  products: p,
  productPackTypes: ppt,
  productBarcodes: pb,
  kitComponents: kc,
  productReplenishmentLevels: prl,
  productChannelAllocations: pca,
} = schema;

const name = async (db: AppDb, id: string | null): Promise<string | null> =>
  id
    ? ((
        await db
          .select({ n: schema.lookupValues.name })
          .from(schema.lookupValues)
          .where(eq(schema.lookupValues.id, id))
          .limit(1)
      )[0]?.n ?? id)
    : null;

export async function packTypesSummary(db: AppDb, productId: string): Promise<string> {
  const packs = await db.select().from(ppt).where(eq(ppt.productId, productId)).orderBy(asc(ppt.uomQty));
  const codes = await db.select().from(pb).where(eq(pb.productId, productId));
  return packs
    .map((x) => {
      const bc = codes.filter((c) => c.packTypeId === x.id).map((c) => c.barcode);
      const dims = `${x.length}×${x.width}×${x.height} ${x.dimensionUnit}, ${x.weight} ${x.weightUnit}`;
      return `${x.packType} (${x.kind}, UOM ${x.uomQty}; ${dims}${bc.length ? `; ${bc.join(' ')}` : ''})`;
    })
    .join('; ');
}

export async function productSnapshot(db: AppDb, productId: string): Promise<Record<string, unknown>> {
  const r = (await db.select().from(p).where(eq(p.id, productId)).limit(1))[0];
  if (!r) return {};
  const customs = (r.customs ?? {}) as Record<string, unknown>;
  const hazmat = (r.hazmat ?? {}) as Record<string, unknown>;
  const components = (
    await db
      .select({ sku: p.sku, qty: kc.quantity })
      .from(kc)
      .innerJoin(p, eq(p.id, kc.componentProductId))
      .where(eq(kc.kitProductId, productId))
      .orderBy(asc(p.sku))
  )
    .map((c) => `${c.sku} ×${c.qty}`)
    .join(', ');
  const levels = (
    await db
      .select({ code: schema.warehouses.code, min: prl.minLevel, max: prl.maxLevel })
      .from(prl)
      .innerJoin(schema.warehouses, eq(schema.warehouses.id, prl.warehouseId))
      .where(eq(prl.productId, productId))
  )
    .map((l) => `${l.code} ${l.min} to ${l.max}`)
    .join(', ');
  const allocations = (
    await db
      .select({
        store: schema.channelConnections.storeName,
        s: pca.staticQty,
        rq: pca.reserveQty,
        pct: pca.allocationPct,
      })
      .from(pca)
      .innerJoin(schema.channelConnections, eq(schema.channelConnections.id, pca.channelConnectionId))
      .where(eq(pca.productId, productId))
  )
    .map(
      (a) =>
        `${a.store}${a.s !== null ? ` static ${a.s}` : ''}${a.rq !== null ? ` reserve ${a.rq}` : ''}${a.pct !== null ? ` ${a.pct}%` : ''}`,
    )
    .join(', ');
  const shipBox = r.useShipPackageId
    ? ((
        await db
          .select({ code: schema.shipmentPackages.code })
          .from(schema.shipmentPackages)
          .where(eq(schema.shipmentPackages.id, r.useShipPackageId))
          .limit(1)
      )[0]?.code ?? null)
    : null;
  return {
    sku: r.sku,
    name: r.name,
    description: r.description,
    productImage: r.imageUrl,
    kitType: r.kitType,
    productType: await name(db, r.productTypeId),
    productGroup: await name(db, r.productGroupId),
    uomPackType: r.uom,
    currency: r.currency,
    purchasePrice: r.purchasePrice,
    salesPrice: r.price,
    taxRate: r.taxRate,
    minimumSafetyStock: r.minSafetyStock,
    FNSKU: r.fnsku,
    status: r.status,
    digital: r.isDigital,
    packingInstructions: r.packingInstructions,
    returnInstructions: r.returnInstructions,
    foldable: r.isFoldable,
    fragile: r.isFragile,
    oversized: r.isOversized,
    insert: r.isInsert,
    stackable: r.isStackable,
    poster: r.isPoster,
    liquid: r.isLiquid,
    nonReturnable: r.isNonReturnable,
    useThisShippingBoxOnly: shipBox,
    packTypes: await packTypesSummary(db, productId),
    declaredValue: customs.declaredValue ?? null,
    hsTariffCode: customs.hsCode ?? null,
    originCountryCode: customs.originCountry ?? null,
    notDeclaredToCustoms: customs.notDeclared ?? false,
    manufacturer: customs.manufacturer ?? null,
    manufacturerProductIdentifier: customs.manufacturerProductId ?? null,
    customsDescription: customs.description ?? null,
    hazardous: r.isHazmat,
    hazmatId: hazmat.hazmatId ?? null,
    hazmatType: hazmat.type ?? null,
    hazmatAttribute: hazmat.attribute ?? null,
    hazmatQuantity: hazmat.quantity ?? null,
    hazmatQuantityType: hazmat.quantityType ?? null,
    hazmatQuantityUnit: hazmat.quantityUnit ?? null,
    hazmatContainerType: hazmat.containerType ?? null,
    properShippingName: hazmat.properShippingName ?? null,
    classDivision: hazmat.classDivision ?? null,
    expiryDateTracking: r.trackExpiry,
    receivingOnlyExpiryTracking: r.expiryReceivingOnly,
    expiryDateFormat: r.expiryFormat,
    expiryDateScanMethod: r.expiryScanMethod,
    useProductionDate: customs.useProductionDate ?? false,
    shelfLifeInDays: r.shelfLifeDays,
    lotBatchTracking: r.trackLot,
    receivingOnlyLotBatchTracking: r.lotReceivingOnly,
    autoCreateLotBatchNumber: r.autoCreateLot,
    lotBatchRegex: r.lotRegex,
    lotBatchNumberScanMethod: r.lotScanMethod,
    productionDateTracking: r.trackProductionDate,
    receivingOnlyProdDateTracking: r.productionReceivingOnly,
    productionDateFormat: r.productionFormat,
    productionDateScanMethod: r.productionScanMethod,
    replenishmentStrategy: r.replenishmentStrategy,
    minReplenishmentLevel: r.replenishmentMin,
    maxReplenishmentLevel: r.replenishmentMax,
    warehouseReplenishmentLevels: levels,
    channelAllocations: allocations,
    kitComponents: components,
    trackSerialNumber: r.trackSerial,
    trackSecondarySerialNumber: r.trackSecondarySerial,
    serialTrackingMethod: r.serialMethod,
    skipScanSerialNumber: r.skipSerialScan,
    serialNumberRegex: r.serialRegex,
    customFields: Object.entries(r.customFields ?? {})
      .filter(([, v]) => v !== null && v !== '')
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join(', '),
  };
}
