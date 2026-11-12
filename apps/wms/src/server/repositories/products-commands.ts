/**
 * Product writes (M09): create / update from the wizard payload, status changes and the
 * guarded delete. Every write goes through `change_log` (field-level, human labels) and is
 * checked against the caller's client scope (cross-scope → 404).
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { AppDb } from '@/server/api/db';
import { AppError, conflictError, notFoundError } from '@/server/api/errors';
import { assertInScope, hasClient, hasWarehouse } from '@/server/auth/scope';
import { schema } from '@/server/db';
import { recordCreate, recordDelete, recordUpdate } from '@/server/domain/change-log';
import { OPEN_PO_STATUSES, OPEN_SO_STATUSES } from '@/server/domain/atp';
import type { DomainCtx } from '@/server/domain/types';
import { CUSTOM_FIELD_SLOTS } from '@/lib/enums';
import { toInches, toOunces } from '@/lib/grid-defs/products/catalog-options';
import {
  derivedVolume,
  duplicateBarcodesWithin,
  normalizePackTypes,
  productInputSchema,
  type ProductInput,
  type ProductValue,
} from '@/lib/grid-defs/products/product-form';
import { fillDerivedPackWeights } from '@/lib/grid-defs/products/pack-derivation';
import { getProductForm } from './products-detail';
import { productSnapshot } from './products-snapshot';
import { dbGet, mapSeq } from '@/server/db/sql';

const {
  products: p,
  productPackTypes: ppt,
  productBarcodes: pb,
  kitComponents: kc,
  productReplenishmentLevels: prl,
  productChannelAllocations: pca,
} = schema;

export type ScopedCtx = DomainCtx & { readonly scope: NonNullable<DomainCtx['scope']> };
export type ProductRow = typeof p.$inferSelect;

const ENTITY = 'product';

function invalid(path: string, message: string): AppError {
  return new AppError('VALIDATION', message, { fieldErrors: { [path]: [message] } });
}

/** Parses and cross-checks the payload against the database. */
async function validate(
  tx: AppDb,
  ctx: ScopedCtx,
  raw: ProductInput,
  existing: ProductRow | null,
): Promise<ProductValue> {
  const parsed = productInputSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const i of parsed.error.issues) {
      const k = i.path.map(String).join('.') || '_';
      if (!(fieldErrors[k] ?? []).includes(i.message))
        fieldErrors[k] = [...(fieldErrors[k] ?? []), i.message];
    }
    throw new AppError('VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid product', { fieldErrors });
  }
  const v = parsed.data;
  if (existing && existing.clientId !== v.clientId)
    throw invalid('clientId', 'The client of a product cannot be changed');
  if (existing && existing.productCategory !== v.productCategory)
    throw invalid('productCategory', 'The product category cannot be changed');
  if (!hasClient(ctx.scope, v.clientId)) throw notFoundError('Client');
  const client = (
    await tx
      .select({ id: schema.clients.id, code: schema.clients.code })
      .from(schema.clients)
      .where(eq(schema.clients.id, v.clientId))
      .limit(1)
  )[0];
  if (!client) throw invalid('clientId', 'Client not found');

  const dup = (
    await tx
      .select({ id: p.id })
      .from(p)
      .where(
        and(
          eq(p.clientId, v.clientId),
          sql`lower(${p.sku}) = lower(${v.sku})`,
          existing ? sql`${p.id} <> ${existing.id}` : undefined,
        ),
      )
      .limit(1)
  )[0];
  if (dup)
    throw new AppError('DUPLICATE', `SKU ${v.sku} already exists for client ${client.code}`, {
      fieldErrors: { sku: [`SKU ${v.sku} already exists for this client`] },
    });

  await assertBarcodesUnique(tx, v, existing?.id ?? null);

  for (const [key, type] of [
    ['productTypeId', 'product_type'],
    ['productGroupId', 'product_group'],
  ] as const) {
    const id = v[key];
    if (!id) continue;
    const row = (
      await tx
        .select({ clientId: schema.lookupValues.clientId, type: schema.lookupValues.type })
        .from(schema.lookupValues)
        .where(eq(schema.lookupValues.id, id))
        .limit(1)
    )[0];
    if (!row || row.type !== type || (row.clientId && row.clientId !== v.clientId))
      throw invalid(key, 'Choose a value for this client');
  }
  if (
    v.useShipPackageId &&
    !(
      await tx
        .select({ id: schema.shipmentPackages.id })
        .from(schema.shipmentPackages)
        .where(eq(schema.shipmentPackages.id, v.useShipPackageId))
        .limit(1)
    )[0]
  ) {
    throw invalid('useShipPackageId', 'Shipment package not found');
  }
  for (const level of v.replenishmentLevels) {
    if (!hasWarehouse(ctx.scope, level.warehouseId))
      throw invalid('replenishmentLevels', 'Warehouse not found');
  }
  if (v.channelAllocations.length) {
    const ids = v.channelAllocations.map((a) => a.channelConnectionId);
    const ok = await tx
      .select({ id: schema.channelConnections.id })
      .from(schema.channelConnections)
      .where(
        and(inArray(schema.channelConnections.id, ids), eq(schema.channelConnections.clientId, v.clientId)),
      );
    if (new Set(ok.map((r) => r.id)).size !== new Set(ids).size)
      throw invalid('channelAllocations', 'A sales channel does not belong to this client');
  }
  if (v.productCategory === 'Kit') {
    const ids = v.components.map((c) => c.productId);
    if (existing && ids.includes(existing.id)) throw invalid('components', 'A kit cannot contain itself');
    const rows = ids.length
      ? await tx
          .select({
            id: p.id,
            clientId: p.clientId,
            sku: p.sku,
            category: p.productCategory,
            kitType: p.kitType,
          })
          .from(p)
          .where(inArray(p.id, ids))
      : [];
    for (const c of v.components) {
      const row = rows.find((r) => r.id === c.productId);
      if (!row || row.clientId !== v.clientId)
        throw invalid('components', "Components must belong to the kit's client");
      if (row.category === 'Packaging Material')
        throw invalid('components', `${row.sku} is packaging material and cannot be a component`);
      if (row.category === 'Kit' && row.kitType !== 'Kit to Stock')
        throw invalid('components', `${row.sku} is a kit-to-order kit and cannot be a component`);
    }
  }
  return v;
}

/**
 * A pack-type barcode has one meaning per client: reject codes already on another product of the
 * same client (409) and codes repeated across this product's own pack types (scans would be ambiguous).
 */
export async function assertBarcodesUnique(
  tx: AppDb,
  v: ProductValue,
  productId: string | null,
): Promise<void> {
  const packs = packsFor(v);
  const within = duplicateBarcodesWithin(packs);
  if (within.length) {
    const [code, owners] = within[0] as [string, string[]];
    throw new AppError(
      'DUPLICATE',
      `Barcode ${code} is used on more than one pack type (${owners.join(', ')})`,
      { fieldErrors: { packTypes: [`Barcode ${code} is used on more than one pack type`] } },
    );
  }
  const packCodes = [...new Set(packs.flatMap((x) => x.barcodes.map((b) => b.trim()).filter(Boolean)))];
  // Kits / packaging carry a product-level barcode instead of pack-type barcodes.
  const own = v.productCategory !== 'Product' && v.barcode ? v.barcode.trim() : '';
  const codes = own && !packCodes.includes(own) ? [...packCodes, own] : packCodes;
  if (!codes.length) return;
  const field = (code: string) => (packCodes.includes(code) ? 'packTypes' : 'barcode');
  const clash = (
    await tx
      .select({ barcode: pb.barcode, sku: p.sku, packType: ppt.packType })
      .from(pb)
      .innerJoin(p, eq(p.id, pb.productId))
      .innerJoin(ppt, eq(ppt.id, pb.packTypeId))
      .where(
        and(
          inArray(pb.barcode, codes),
          eq(p.clientId, v.clientId),
          productId ? sql`${p.id} <> ${productId}` : undefined,
        ),
      )
      .limit(1)
  )[0];
  if (clash) {
    const msg = `Barcode ${clash.barcode} is already used by ${clash.sku} (${clash.packType})`;
    throw new AppError('DUPLICATE', msg, { fieldErrors: { [field(clash.barcode)]: [msg] } });
  }
  // Product-level barcode column of other products (kits, packaging, listing-created products).
  const col = (
    await tx
      .select({ barcode: p.barcode, sku: p.sku })
      .from(p)
      .where(
        and(
          inArray(p.barcode, codes),
          eq(p.clientId, v.clientId),
          sql`${p.barcode} <> ${p.sku}`,
          productId ? sql`${p.id} <> ${productId}` : undefined,
        ),
      )
      .limit(1)
  )[0];
  if (col) {
    const msg = `Barcode ${col.barcode} is already used by ${col.sku}`;
    throw new AppError('DUPLICATE', msg, { fieldErrors: { [field(col.barcode)]: [msg] } });
  }
}

/** Fields the wizard payload carries; a PATCH that omits some keeps the stored values. */
function mergePartial(stored: Record<string, unknown>, raw: Record<string, unknown>): ProductInput {
  const out: Record<string, unknown> = { ...stored };
  for (const [k, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    const prev = out[k];
    // customs / hazmat / customFields may be sent partially.
    if (
      (k === 'customs' || k === 'hazmat' || k === 'customFields') &&
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      prev &&
      typeof prev === 'object'
    ) {
      out[k] = { ...(prev as Record<string, unknown>), ...(value as Record<string, unknown>) };
    } else out[k] = value;
  }
  delete out.id;
  delete out.clientName;
  return out as ProductInput;
}

function cleanCustomFields(
  values: Readonly<Record<string, unknown>>,
): Record<string, string | boolean | null> {
  const out: Record<string, string | boolean | null> = {};
  for (const slot of CUSTOM_FIELD_SLOTS) {
    const value = values[slot];
    if (typeof value === 'string' || typeof value === 'boolean') out[slot] = value;
    else if (value === null) out[slot] = null;
  }
  return out;
}

/** Product columns derived from the payload (primary pack drives the legacy dims). */
export function productColumns(
  v: ProductValue,
): Omit<typeof p.$inferInsert, 'id' | 'clientId' | 'createdBy' | 'createdAt'> {
  const packs = normalizePackTypes(v.packTypes);
  const primary = packs.find((x) => x.kind === 'Primary');
  const dims =
    v.productCategory === 'Product' && primary
      ? {
          unit: primary.dimensionUnit,
          l: primary.length,
          w: primary.width,
          h: primary.height,
          wu: primary.weightUnit,
          wt: primary.weight,
        }
      : { unit: v.dimensionUnit, l: v.length, w: v.width, h: v.height, wu: v.weightUnit, wt: v.weight };
  // No silent SKU fallback: a blank barcode stays blank (a SKU stored as barcode could later
  // collide with a real barcode). Labels print the SKU when the barcode is empty.
  const barcode = primary?.barcodes[0] ?? (v.barcode?.trim() || '');
  const isKit = v.productCategory === 'Kit';
  const isPackaging = v.productCategory === 'Packaging Material';
  const tracking = isKit
    ? { trackExpiry: false, trackLot: false, trackProductionDate: false, trackSerial: false }
    : {
        trackExpiry: v.trackExpiry,
        trackLot: v.trackLot,
        trackProductionDate: v.trackProductionDate,
        trackSerial: v.trackSerial,
      };
  return {
    sku: v.sku,
    barcode,
    name: v.name,
    category: 'General',
    uom: v.productCategory === 'Product' ? (primary?.packType ?? 'Unit') : v.uom,
    weightOz: toOunces(dims.wt, dims.wu),
    lengthIn: toInches(dims.l, dims.unit),
    widthIn: toInches(dims.w, dims.unit),
    heightIn: toInches(dims.h, dims.unit),
    price: isPackaging ? 0 : Math.round(v.salesPrice * 100) / 100,
    isKit,
    isFragile: v.isFragile,
    isHazmat: !isPackaging && v.isHazmat,
    status: v.isActive ? 'Active' : 'Inactive',
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
    useShipPackageId:
      v.productCategory === 'Product' ? (primary?.useShipPackageId ?? null) : v.useShipPackageId,
    // REQ-1 adapter: "Use production date" lives in the customs JSON until a column lands.
    customs: {
      ...v.customs,
      useProductionDate: !isKit && v.useProductionDate,
    } as typeof p.$inferInsert.customs,
    hazmat: (v.isHazmat && !isPackaging ? v.hazmat : null) as typeof p.$inferInsert.hazmat,
    ...tracking,
    expiryReceivingOnly: !isKit && v.expiryReceivingOnly,
    expiryFormat: tracking.trackExpiry ? v.expiryFormat : null,
    expiryScanMethod: tracking.trackExpiry ? (v.expiryScanMethod ?? 'During Picking') : null,
    shelfLifeDays: isKit ? null : v.shelfLifeDays,
    lotReceivingOnly: !isKit && v.lotReceivingOnly,
    autoCreateLot: !isKit && v.autoCreateLot,
    lotRegex: tracking.trackLot ? v.lotRegex : null,
    lotScanMethod: tracking.trackLot ? (v.lotScanMethod ?? 'During Picking') : null,
    productionReceivingOnly: !isKit && v.productionReceivingOnly,
    productionFormat: tracking.trackProductionDate ? v.productionFormat : null,
    productionScanMethod: tracking.trackProductionDate ? (v.productionScanMethod ?? 'During Picking') : null,
    replenishmentStrategy: isKit ? 'Global' : v.replenishmentStrategy,
    replenishmentMin: isKit || v.replenishmentStrategy !== 'Global' ? 0 : v.replenishmentMin,
    replenishmentMax: isKit || v.replenishmentStrategy !== 'Global' ? 0 : v.replenishmentMax,
    trackSecondarySerial: tracking.trackSerial && v.trackSecondarySerial,
    serialMethod: tracking.trackSerial ? v.serialMethod : null,
    skipSerialScan: tracking.trackSerial && v.skipSerialScan,
    serialRegex: tracking.trackSerial ? v.serialRegex : null,
    customFields: cleanCustomFields(v.customFields),
  };
}

/** Pack types for kits/packaging: a single primary carrying the packing-step dims. */
function packsFor(v: ProductValue): ProductValue['packTypes'] {
  // Hierarchical packs saved without a weight take child qty × the contained pack weight.
  if (v.productCategory === 'Product') return fillDerivedPackWeights(normalizePackTypes(v.packTypes));
  const existing = v.packTypes.find((x) => x.kind === 'Primary');
  return [
    {
      key: existing?.key ?? 'primary',
      id: existing?.id ?? null,
      packType: v.uom,
      kind: 'Primary',
      parentKey: null,
      childQty: undefined,
      uomQty: 1,
      dimensionUnit: v.dimensionUnit,
      length: v.length,
      width: v.width,
      height: v.height,
      volumeUnit: v.volumeUnit,
      volume: derivedVolume(v),
      volumeOverridden: v.volumeOverridden,
      weightUnit: v.weightUnit,
      weight: v.weight,
      useShipPackageId: v.useShipPackageId,
      useOwnBox: false,
      usePrimaryBarcodes: false,
      barcodes: v.barcode ? [v.barcode] : [],
    },
  ];
}

async function inventoryPackTypes(tx: AppDb, productId: string): Promise<Set<string>> {
  return new Set(
    (
      await tx
        .select({ packType: schema.inventory.packType })
        .from(schema.inventory)
        .where(and(eq(schema.inventory.productId, productId), sql`${schema.inventory.onHand} > 0`))
    ).map((r) => r.packType.toLowerCase()),
  );
}

/** Replaces pack types + barcodes, keeping ids of edited packs (inventory references names). */
async function syncPackTypes(tx: AppDb, ctx: ScopedCtx, productId: string, v: ProductValue): Promise<void> {
  const packs = packsFor(v);
  const current = await tx.select().from(ppt).where(eq(ppt.productId, productId));
  const keep = new Set(packs.map((x) => x.id).filter((x): x is string => Boolean(x)));
  const inUse = await inventoryPackTypes(tx, productId);
  for (const old of current) {
    const replacement = packs.find((x) => x.id === old.id);
    const renamed = replacement && replacement.packType.toLowerCase() !== old.packType.toLowerCase();
    if ((!keep.has(old.id) || renamed) && inUse.has(old.packType.toLowerCase())) {
      throw invalid(
        'packTypes',
        `Pack type ${old.packType} has stock on hand and cannot be removed or renamed`,
      );
    }
  }
  const removed = current.filter((c) => !keep.has(c.id)).map((c) => c.id);
  if (removed.length) await tx.delete(ppt).where(inArray(ppt.id, removed));
  await tx.delete(pb).where(eq(pb.productId, productId));
  // Two passes: rows first (ids), then hierarchical parents.
  const idByKey = new Map<string, string>();
  for (const pack of packs) {
    const values = {
      productId,
      packType: pack.packType,
      kind: pack.kind,
      childQty: pack.kind === 'Hierarchical' ? (pack.childQty ?? 2) : null,
      uomQty: pack.uomQty,
      dimensionUnit: pack.dimensionUnit,
      length: pack.length,
      width: pack.width,
      height: pack.height,
      volumeUnit: pack.volumeUnit,
      volume: derivedVolume(pack),
      weightUnit: pack.weightUnit,
      weight: pack.weight,
      useShipPackageId: pack.useShipPackageId,
      useOwnBox: pack.useOwnBox,
      usePrimaryBarcodes: pack.kind !== 'Primary' && pack.usePrimaryBarcodes,
      updatedBy: ctx.userId,
    };
    if (pack.id && current.some((c) => c.id === pack.id)) {
      await tx
        .update(ppt)
        .set({ ...values, version: sql`${ppt.version} + 1` })
        .where(eq(ppt.id, pack.id));
      idByKey.set(pack.key, pack.id);
    } else {
      const row = (
        await tx
          .insert(ppt)
          .values({ ...values, createdBy: ctx.userId })
          .returning({ id: ppt.id })
      )[0];
      idByKey.set(pack.key, row.id);
    }
  }
  const primaryId = packs.find((x) => x.kind === 'Primary')?.key;
  for (const pack of packs) {
    const id = idByKey.get(pack.key) as string;
    if (pack.kind === 'Hierarchical') {
      const parent =
        (pack.parentKey && idByKey.get(pack.parentKey)) ||
        (primaryId ? idByKey.get(primaryId) : null) ||
        null;
      await tx.update(ppt).set({ parentPackTypeId: parent }).where(eq(ppt.id, id));
    } else {
      await tx.update(ppt).set({ parentPackTypeId: null }).where(eq(ppt.id, id));
    }
    const codes = [...new Set(pack.barcodes.map((b) => b.trim()).filter(Boolean))];
    if (codes.length)
      await tx.insert(pb).values(codes.map((barcode) => ({ productId, packTypeId: id, barcode })));
  }
}

async function syncChildren(tx: AppDb, productId: string, v: ProductValue): Promise<void> {
  await tx.delete(kc).where(eq(kc.kitProductId, productId));
  if (v.productCategory === 'Kit' && v.components.length) {
    await tx
      .insert(kc)
      .values(
        v.components.map((c) => ({
          kitProductId: productId,
          componentProductId: c.productId,
          quantity: c.quantity,
        })),
      );
  }
  await tx.delete(prl).where(eq(prl.productId, productId));
  if (
    v.productCategory !== 'Kit' &&
    v.replenishmentStrategy === 'Per Warehouse' &&
    v.replenishmentLevels.length
  ) {
    await tx
      .insert(prl)
      .values(
        v.replenishmentLevels.map((l) => ({
          productId,
          warehouseId: l.warehouseId,
          minLevel: l.minLevel,
          maxLevel: l.maxLevel,
        })),
      );
  }
  await tx.delete(pca).where(eq(pca.productId, productId));
  if (v.productCategory !== 'Packaging Material' && v.channelAllocations.length) {
    await tx.insert(pca).values(
      v.channelAllocations.map((a) => ({
        productId,
        channelConnectionId: a.channelConnectionId,
        warehouseId: a.warehouseId,
        staticQty: a.staticQty,
        reserveQty: a.reserveQty,
        allocationPct: a.allocationPct,
      })),
    );
  }
}

export async function createProductFromWizard(
  tx: AppDb,
  ctx: ScopedCtx,
  raw: ProductInput,
): Promise<ProductRow> {
  const v = await validate(tx, ctx, raw, null);
  const row = (
    await tx
      .insert(p)
      .values({ ...productColumns(v), clientId: v.clientId, createdBy: ctx.userId, updatedBy: ctx.userId })
      .returning()
  )[0];
  await syncPackTypes(tx, ctx, row.id, v);
  await syncChildren(tx, row.id, v);
  await recordCreate(tx, ctx, { entityType: ENTITY, entityId: row.id, entityCode: row.sku });
  return row;
}

export async function loadProduct(tx: AppDb, ctx: ScopedCtx, id: string): Promise<ProductRow> {
  const row = (await tx.select().from(p).where(eq(p.id, id)).limit(1))[0];
  assertInScope(ctx.scope, row ? { clientId: row.clientId } : null, 'Product');
  return row as ProductRow;
}

export async function updateProductFromWizard(
  tx: AppDb,
  ctx: ScopedCtx,
  id: string,
  raw: ProductInput,
): Promise<ProductRow> {
  const existing = await loadProduct(tx, ctx, id);
  if (raw.version !== undefined && raw.version !== existing.version) throw conflictError();
  // Partial PATCH: keys the caller omits keep their stored values (the wizard always sends everything).
  const stored = await getProductForm(tx, ctx.scope, id);
  const v = await validate(
    tx,
    ctx,
    stored ? mergePartial(stored as unknown as Record<string, unknown>, raw as Record<string, unknown>) : raw,
    existing,
  );
  const before = await productSnapshot(tx, id);
  await tx
    .update(p)
    .set({ ...productColumns(v), updatedBy: ctx.userId, version: existing.version + 1 })
    .where(eq(p.id, id));
  await syncPackTypes(tx, ctx, id, v);
  await syncChildren(tx, id, v);
  const after = await productSnapshot(tx, id);
  await recordUpdate(tx, ctx, { entityType: ENTITY, entityId: id, entityCode: v.sku, before, after });
  return (await tx.select().from(p).where(eq(p.id, id)).limit(1))[0] as ProductRow;
}

/** Activates / deactivates one product (bulk callers wrap this in `runBulk`). */
export async function setProductStatus(
  tx: AppDb,
  ctx: ScopedCtx,
  id: string,
  status: 'Active' | 'Inactive',
  version?: number,
): Promise<ProductRow> {
  const existing = await loadProduct(tx, ctx, id);
  if (version !== undefined && version !== existing.version) throw conflictError();
  if (existing.status === status) return existing;
  await tx
    .update(p)
    .set({ status, updatedBy: ctx.userId, version: existing.version + 1 })
    .where(eq(p.id, id));
  await recordUpdate(tx, ctx, {
    entityType: ENTITY,
    entityId: id,
    entityCode: existing.sku,
    before: { status: existing.status },
    after: { status },
  });
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
  return sql.raw(OPEN_SO_STATUSES.map((s) => `'${s}'`).join(','));
}
function poList(): ReturnType<typeof sql> {
  return sql.raw(OPEN_PO_STATUSES.map((s) => `'${s}'`).join(','));
}

/** Why a product cannot be deleted: stock, open orders/POs, kit usage, or history. */
export async function deleteBlockerFor(tx: AppDb, id: string): Promise<string | null> {
  const n = async (q: ReturnType<typeof sql>): Promise<number> =>
    Number((await dbGet<{ n: number }>(tx, q))?.n ?? 0);
  const onHand = await n(sql`SELECT COALESCE(SUM(on_hand), 0) AS n FROM inventory WHERE product_id = ${id}`);
  if (onHand > 0) return `Has ${plural(onHand, 'unit')} on hand`;
  const openSo = await n(
    sql`SELECT COUNT(DISTINCT o.id) AS n FROM order_lines l JOIN shipment_orders o ON o.id = l.order_id WHERE l.product_id = ${id} AND o.deleted_at IS NULL AND o.status IN (${soList()})`,
  );
  if (openSo > 0) return `On ${plural(openSo, 'open shipment order')}`;
  const openPo = await n(
    sql`SELECT COUNT(DISTINCT o.id) AS n FROM purchase_order_lines l JOIN purchase_orders o ON o.id = l.purchase_order_id WHERE l.product_id = ${id} AND o.status IN (${poList()})`,
  );
  if (openPo > 0) return `On ${plural(openPo, 'open purchase order')}`;
  const kit = await dbGet<{ sku: string }>(
    tx,
    sql`SELECT k.sku AS sku FROM kit_components c JOIN products k ON k.id = c.kit_product_id WHERE c.component_product_id = ${id} LIMIT 1`,
  );
  if (kit) return `Component of kit ${kit.sku}`;
  const history = await n(sql`SELECT
      (SELECT COUNT(*) FROM inventory WHERE product_id = ${id}) +
      (SELECT COUNT(*) FROM inventory_transactions WHERE product_id = ${id}) +
      (SELECT COUNT(*) FROM order_lines WHERE product_id = ${id}) +
      (SELECT COUNT(*) FROM purchase_order_lines WHERE product_id = ${id}) +
      (SELECT COUNT(*) FROM work_orders WHERE kit_product_id = ${id}) +
      (SELECT COUNT(*) FROM location_product_capacity WHERE product_id = ${id}) +
      (SELECT COUNT(*) FROM serial_numbers WHERE product_id = ${id}) AS n`);
  if (history > 0) return 'Has transaction history';
  return null;
}

export async function deleteCheck(
  tx: AppDb,
  ctx: ScopedCtx,
  ids: readonly string[],
): Promise<DeleteBlocker[]> {
  const rows = (
    await tx
      .select({ id: p.id, sku: p.sku, name: p.name, status: p.status, clientId: p.clientId })
      .from(p)
      .where(inArray(p.id, [...ids]))
  ).filter((r) => hasClient(ctx.scope, r.clientId));
  return await mapSeq(rows, async (r) => ({
    id: r.id,
    sku: r.sku,
    name: r.name,
    status: r.status,
    reason: await deleteBlockerFor(tx, r.id),
  }));
}

export async function deleteProduct(tx: AppDb, ctx: ScopedCtx, id: string): Promise<void> {
  const existing = await loadProduct(tx, ctx, id);
  const reason = await deleteBlockerFor(tx, id);
  if (reason) throw new AppError('INVALID_STATE', `${existing.sku}: ${reason}. Deactivate it instead.`);
  await tx
    .update(schema.productListings)
    .set({ productId: null, linkedAt: null })
    .where(eq(schema.productListings.productId, id));
  await tx.delete(p).where(eq(p.id, id));
  await recordDelete(tx, ctx, { entityType: ENTITY, entityId: id, entityCode: existing.sku });
}
