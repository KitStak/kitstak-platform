/**
 * Import appliers for the seven M09 import keys. Every product-shaped import goes through
 * the wizard commands (`createProductFromWizard` / `updateProductFromWizard`) so imports get
 * exactly the same validation, pack-type normalisation and field-level change log as the UI.
 * Listings write `product_listings` with their own change log.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { AppDb } from '@/server/api/db';
import { AppError } from '@/server/api/errors';
import type { AuthContext } from '@/server/auth/context';
import { hasClient } from '@/server/auth/scope';
import { schema } from '@/server/db';
import { recordCreate, recordUpdate } from '@/server/domain/change-log';
import { domainCtx } from '@/server/repositories/platform-common';
import { createLookup } from '@/server/repositories/platform-lookups';
import type { ImportApplyContext, ImportApplyResult, ImportRowValues } from '@/server/imports/types';
import { SERIAL_METHODS } from '@/lib/grid-defs/products/catalog-options';
import {
  emptyProductForm,
  newPackType,
  type PackTypeFormValue,
  type ProductFormValues,
  type ProductInput,
} from '@/lib/grid-defs/products/product-form';
import { createProductFromWizard, updateProductFromWizard, type ScopedCtx } from './products-commands';
import { getProductForm } from './products-detail';

const {
  products: p,
  clients,
  warehouses,
  channelConnections: cc,
  productListings: pl,
  lookupValues: lv,
} = schema;

export const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());
const has = (v: unknown): boolean => v !== null && v !== undefined && str(v) !== '';
const numOr = (v: unknown, fallback: number | null): number | null => (has(v) ? Number(v) : fallback);

function ctxOf(ctx: ImportApplyContext): ScopedCtx {
  return { ...domainCtx(ctx.actor, ctx.auth), scope: ctx.auth.scope };
}

export async function findClient(
  db: AppDb,
  auth: AuthContext,
  code: string,
): Promise<typeof clients.$inferSelect> {
  const row = (
    await db
      .select()
      .from(clients)
      .where(sql`lower(${clients.code}) = lower(${code})`)
      .limit(1)
  )[0];
  if (!row || !hasClient(auth.scope, row.id)) throw new AppError('VALIDATION', `Client "${code}" not found`);
  return row;
}

export async function findWarehouse(
  db: AppDb,
  auth: AuthContext,
  code: string,
): Promise<typeof warehouses.$inferSelect> {
  const row = (
    await db
      .select()
      .from(warehouses)
      .where(sql`lower(${warehouses.code}) = lower(${code})`)
      .limit(1)
  )[0];
  if (!row || !auth.scope.warehouseIds.includes(row.id))
    throw new AppError('VALIDATION', `Warehouse "${code}" not found`);
  return row;
}

export async function findProduct(
  db: AppDb,
  clientId: string,
  clientCode: string,
  sku: string,
): Promise<typeof p.$inferSelect> {
  const row = (
    await db
      .select()
      .from(p)
      .where(and(eq(p.clientId, clientId), sql`lower(${p.sku}) = lower(${sku})`))
      .limit(1)
  )[0];
  if (!row) throw new AppError('VALIDATION', `SKU "${sku}" not found for client ${clientCode}`);
  return row;
}

/** Client-scoped lookup id by name; created when missing (same as the wizard's inline "+ Create"). */
async function lookupId(
  db: AppDb,
  ctx: ScopedCtx,
  type: 'product_group' | 'product_type',
  clientId: string,
  name: string,
): Promise<string | null> {
  if (!name) return null;
  const row = (
    await db
      .select({ id: lv.id })
      .from(lv)
      .where(
        and(
          eq(lv.type, type),
          sql`lower(${lv.name}) = lower(${name})`,
          sql`(${lv.clientId} = ${clientId} OR ${lv.clientId} IS NULL)`,
        ),
      )
      .limit(1)
  )[0];
  return row?.id ?? (await createLookup(db, ctx, type, { name, clientId, isActive: true, sortOrder: 0 })).id;
}

/** Template "Product Type": Simple → standard product; kits are created in the wizard (they need components). */
function categoryOf(raw: string): 'Product' {
  if (!raw || raw.toLowerCase() === 'simple') return 'Product';
  throw new AppError(
    'VALIDATION',
    `Product type "${raw}" can't be imported as a new product. Create kits in the product wizard, then fill them with the Kit-components update import`,
  );
}

function primaryPack(values: ProductFormValues): PackTypeFormValue | undefined {
  return values.packTypes.find((x) => x.kind === 'Primary');
}

function withTracking(values: ProductFormValues, row: ImportRowValues): ProductFormValues {
  const next: ProductFormValues = { ...values };
  if (row.trackLot !== null && row.trackLot !== undefined) next.trackLot = Boolean(row.trackLot);
  if (row.trackExpiry !== null && row.trackExpiry !== undefined) {
    next.trackExpiry = Boolean(row.trackExpiry);
    if (next.trackExpiry && !next.expiryFormat) next.expiryFormat = 'yyyy-MM-dd';
  }
  if (row.trackSerial !== null && row.trackSerial !== undefined) {
    next.trackSerial = Boolean(row.trackSerial);
    if (next.trackSerial && !next.serialMethod) next.serialMethod = SERIAL_METHODS[0];
  }
  return next;
}

/** "products": creates a standard product with its primary pack type. */
export async function applyProductImport(
  ctx: ImportApplyContext,
  row: ImportRowValues,
): Promise<ImportApplyResult> {
  const db = ctx.db;
  const dctx = ctxOf(ctx);
  const client = await findClient(db, ctx.auth, str(row.clientCode));
  const category = categoryOf(str(row.productType));
  const base = emptyProductForm(category, client.id);
  const pack: PackTypeFormValue = {
    ...newPackType('Primary', []),
    key: 'primary',
    packType: str(row.uom) || 'Unit',
    uomQty: 1,
    length: numOr(row.length, null),
    width: numOr(row.width, null),
    height: numOr(row.height, null),
    weight: numOr(row.weight, null),
    barcodes: has(row.barcode) ? [str(row.barcode)] : [],
  };
  const values = withTracking(
    {
      ...base,
      sku: str(row.sku),
      name: str(row.name),
      description: str(row.description),
      productGroupId: await lookupId(db, dctx, 'product_group', client.id, str(row.productGroup)),
      salesPrice: numOr(row.unitPrice, null),
      purchasePrice: numOr(row.unitCost, null),
      isActive: str(row.status).toLowerCase() !== 'inactive',
      packTypes: [pack],
    },
    row,
  );
  const created = await createProductFromWizard(db, dctx, values as ProductInput);
  return { entityId: created.id, message: `Created ${created.sku}` };
}

async function loadForm(
  db: AppDb,
  auth: AuthContext,
  productId: string,
): Promise<ProductFormValues & { id: string; version: number }> {
  const form = await getProductForm(db, auth.scope, productId);
  if (!form) throw new AppError('NOT_FOUND', 'Product not found');
  return form;
}

async function save(
  db: AppDb,
  dctx: ScopedCtx,
  form: ProductFormValues & { id: string; version: number },
  next: ProductFormValues,
): Promise<ImportApplyResult> {
  const updated = await updateProductFromWizard(db, dctx, form.id, {
    ...next,
    version: form.version,
  } as ProductInput);
  return { entityId: updated.id, message: `Updated ${updated.sku}` };
}

/** "products-update": changes only the columns that carry a value. */
export async function applyProductUpdateImport(
  ctx: ImportApplyContext,
  row: ImportRowValues,
): Promise<ImportApplyResult> {
  const db = ctx.db;
  const dctx = ctxOf(ctx);
  const client = await findClient(db, ctx.auth, str(row.clientCode));
  const product = await findProduct(db, client.id, client.code, str(row.sku));
  const form = await loadForm(db, ctx.auth, product.id);
  let next: ProductFormValues = { ...form };
  if (has(row.name)) next.name = str(row.name);
  if (has(row.description)) next.description = str(row.description);
  if (has(row.productGroup))
    next.productGroupId = await lookupId(db, dctx, 'product_group', client.id, str(row.productGroup));
  if (has(row.unitPrice)) next.salesPrice = Number(row.unitPrice);
  if (has(row.unitCost)) next.purchasePrice = Number(row.unitCost);
  if (has(row.status)) next.isActive = str(row.status).toLowerCase() !== 'inactive';
  const primary = primaryPack(next);
  if (primary && next.productCategory === 'Product') {
    const pack: PackTypeFormValue = {
      ...primary,
      length: numOr(row.length, primary.length),
      width: numOr(row.width, primary.width),
      height: numOr(row.height, primary.height),
      weight: numOr(row.weight, primary.weight),
      volumeOverridden:
        has(row.length) || has(row.width) || has(row.height) ? false : primary.volumeOverridden,
      barcodes: has(row.barcode)
        ? [
            str(row.barcode),
            ...primary.barcodes.filter((b) => b.toLowerCase() !== str(row.barcode).toLowerCase()),
          ]
        : primary.barcodes,
    };
    next.packTypes = next.packTypes.map((x) => (x.key === primary.key ? pack : x));
  } else {
    if (has(row.barcode)) next.barcode = str(row.barcode);
    for (const k of ['length', 'width', 'height', 'weight'] as const)
      if (has(row[k])) next[k] = Number(row[k]);
  }
  next = withTracking(next, row);
  return await save(db, dctx, form, next);
}

/** "pack-types": adds or updates a pack type (UOM qty > 1 → hierarchical over the primary). */
export async function applyPackTypeImport(
  ctx: ImportApplyContext,
  row: ImportRowValues,
): Promise<ImportApplyResult> {
  const db = ctx.db;
  const dctx = ctxOf(ctx);
  const client = await findClient(db, ctx.auth, str(row.clientCode));
  const product = await findProduct(db, client.id, client.code, str(row.sku));
  if (product.productCategory !== 'Product')
    throw new AppError(
      'VALIDATION',
      `${product.sku} is a ${product.productCategory.toLowerCase()}; pack types apply to standard products only`,
    );
  const form = await loadForm(db, ctx.auth, product.id);
  const name = str(row.packType);
  const uomQty = Math.max(1, Math.floor(Number(row.uomQty)));
  const primary = primaryPack(form);
  const existing = form.packTypes.find((x) => x.packType.toLowerCase() === name.toLowerCase());
  const barcode = str(row.barcode);
  const dims = (base: PackTypeFormValue): PackTypeFormValue => ({
    ...base,
    length: numOr(row.length, base.length),
    width: numOr(row.width, base.width),
    height: numOr(row.height, base.height),
    weight: numOr(row.weight, base.weight),
    volumeOverridden: has(row.length) || has(row.width) || has(row.height) ? false : base.volumeOverridden,
    barcodes:
      barcode && !base.barcodes.some((b) => b.toLowerCase() === barcode.toLowerCase())
        ? [...base.barcodes, barcode]
        : base.barcodes,
  });
  let packs: PackTypeFormValue[];
  let verb: string;
  if (existing) {
    const updated = dims(existing);
    const qty = existing.kind === 'Primary' ? 1 : uomQty;
    packs = form.packTypes.map((x) =>
      x.key === existing.key
        ? {
            ...updated,
            uomQty: qty,
            childQty:
              existing.kind === 'Hierarchical' && existing.parentKey === primary?.key
                ? qty
                : existing.childQty,
          }
        : x,
    );
    verb = 'Updated';
  } else if (!primary || uomQty === 1) {
    if (primary)
      throw new AppError(
        'VALIDATION',
        `${product.sku} already has a primary pack type (${primary.packType}); a new pack type needs a UOM quantity above 1`,
      );
    packs = [
      ...form.packTypes,
      dims({ ...newPackType('Primary', form.packTypes), packType: name, key: `imp_${name}` }),
    ];
    verb = 'Added';
  } else {
    const fresh = newPackType('Hierarchical', form.packTypes);
    packs = [
      ...form.packTypes,
      dims({
        ...fresh,
        key: `imp_${name}`,
        packType: name,
        parentKey: primary.key,
        childQty: uomQty,
        uomQty,
        weightUnit: primary.weightUnit,
        dimensionUnit: primary.dimensionUnit,
      }),
    ];
    verb = 'Added';
  }
  const result = await save(db, dctx, form, { ...form, packTypes: packs });
  return { ...result, message: `${verb} ${name} on ${product.sku}` };
}

/** "replenishment-levels": per-warehouse min/max (switches the product to Per Warehouse). */
export async function applyReplenishmentImport(
  ctx: ImportApplyContext,
  row: ImportRowValues,
): Promise<ImportApplyResult> {
  const db = ctx.db;
  const dctx = ctxOf(ctx);
  const warehouse = await findWarehouse(db, ctx.auth, str(row.warehouseCode));
  const client = await findClient(db, ctx.auth, str(row.clientCode));
  const product = await findProduct(db, client.id, client.code, str(row.sku));
  if (product.productCategory === 'Kit')
    throw new AppError('VALIDATION', `${product.sku} is a kit; kits have no replenishment levels`);
  const min = Number(row.minQty);
  const max = Number(row.maxQty);
  if (max < min) throw new AppError('VALIDATION', 'Max quantity must be at least min quantity');
  const form = await loadForm(db, ctx.auth, product.id);
  const levels = [
    ...form.replenishmentLevels.filter((l) => l.warehouseId !== warehouse.id),
    { warehouseId: warehouse.id, minLevel: min, maxLevel: max },
  ];
  const result = await save(db, dctx, form, {
    ...form,
    replenishmentStrategy: 'Per Warehouse',
    replenishmentLevels: levels,
  });
  return { ...result, message: `${product.sku} @ ${warehouse.code}: ${min} to ${max}` };
}

async function findChannel(db: AppDb, clientId: string, channel: string): Promise<typeof cc.$inferSelect> {
  const rows = await db.select().from(cc).where(eq(cc.clientId, clientId));
  const lc = channel.toLowerCase();
  const row =
    rows.find((c) => c.storeName.toLowerCase() === lc) ?? rows.find((c) => c.provider.toLowerCase() === lc);
  if (!row) throw new AppError('VALIDATION', `Sales channel "${channel}" not found for this client`);
  return row;
}

/** "sku-allocation": static qty and/or percentage per channel + warehouse. */
export async function applySkuAllocationImport(
  ctx: ImportApplyContext,
  row: ImportRowValues,
): Promise<ImportApplyResult> {
  const db = ctx.db;
  const dctx = ctxOf(ctx);
  const warehouse = await findWarehouse(db, ctx.auth, str(row.warehouseCode));
  const client = await findClient(db, ctx.auth, str(row.clientCode));
  const product = await findProduct(db, client.id, client.code, str(row.sku));
  if (product.productCategory === 'Packaging Material')
    throw new AppError(
      'VALIDATION',
      `${product.sku} is packaging material and is never published to channels`,
    );
  const channel = await findChannel(db, client.id, str(row.channel));
  const pct = has(row.allocationPercent) ? Number(row.allocationPercent) : null;
  const qty = has(row.allocationQty) ? Number(row.allocationQty) : null;
  if (pct === null && qty === null)
    throw new AppError('VALIDATION', 'Enter an allocation % or an allocation quantity');
  const form = await loadForm(db, ctx.auth, product.id);
  const rest = form.channelAllocations.filter(
    (a) => !(a.channelConnectionId === channel.id && a.warehouseId === warehouse.id),
  );
  const allocations = [
    ...rest,
    {
      key: `imp_${Math.random().toString(36).slice(2, 12)}`,
      channelConnectionId: channel.id,
      warehouseId: warehouse.id,
      staticQty: qty,
      reserveQty: null,
      allocationPct: pct,
    },
  ];
  const result = await save(db, dctx, form, { ...form, channelAllocations: allocations });
  return { ...result, message: `${product.sku} → ${channel.storeName} @ ${warehouse.code}` };
}

/** Kits already reset in a batch: the first row for a kit replaces its components, later rows add. */
const kitsTouched = new Map<string, Set<string>>();
const MAX_TRACKED_BATCHES = 20;

function firstTouch(batchId: string, kitId: string): boolean {
  let set = kitsTouched.get(batchId);
  if (!set) {
    if (kitsTouched.size >= MAX_TRACKED_BATCHES)
      kitsTouched.delete(kitsTouched.keys().next().value as string);
    set = new Set();
    kitsTouched.set(batchId, set);
  }
  if (set.has(kitId)) return false;
  set.add(kitId);
  return true;
}

/** "kit-components": rows for the same kit in one file replace its component list. */
export async function applyKitComponentImport(
  ctx: ImportApplyContext,
  row: ImportRowValues,
): Promise<ImportApplyResult> {
  const db = ctx.db;
  const dctx = ctxOf(ctx);
  const client = await findClient(db, ctx.auth, str(row.clientCode));
  const kit = await findProduct(db, client.id, client.code, str(row.kitSku));
  if (kit.productCategory !== 'Kit') throw new AppError('VALIDATION', `${kit.sku} is not a kit`);
  const component = await findProduct(db, client.id, client.code, str(row.componentSku));
  const quantity = Number(row.quantity);
  const form = await loadForm(db, ctx.auth, kit.id);
  const base = firstTouch(ctx.batchId, kit.id)
    ? []
    : form.components.filter((c) => c.productId !== component.id);
  const components = [
    ...base,
    {
      productId: component.id,
      sku: component.sku,
      name: component.name,
      imageUrl: component.imageUrl,
      quantity,
    },
  ];
  const result = await save(db, dctx, form, { ...form, components });
  return { ...result, message: `${kit.sku}: ${component.sku} ×${quantity}` };
}

/** "listings": upserts a listing by store + seller SKU and links it when SKU is given. */
export async function applyListingImport(
  ctx: ImportApplyContext,
  row: ImportRowValues,
): Promise<ImportApplyResult> {
  const db = ctx.db;
  const dctx = ctxOf(ctx);
  const client = await findClient(db, ctx.auth, str(row.clientCode));
  const channel = await findChannel(db, client.id, str(row.channel));
  const sellerSku = str(row.channelSku);
  const product = has(row.sku) ? await findProduct(db, client.id, client.code, str(row.sku)) : null;
  const existing = (
    await db
      .select()
      .from(pl)
      .where(and(eq(pl.channelConnectionId, channel.id), sql`lower(${pl.sellerSku}) = lower(${sellerSku})`))
      .limit(1)
  )[0];
  const name = str(row.title) || existing?.name || product?.name || sellerSku;
  const neverSync =
    row.neverSync === null || row.neverSync === undefined
      ? (existing?.neverSync ?? false)
      : Boolean(row.neverSync);
  const now = new Date().toISOString();
  if (existing) {
    const productId = product?.id ?? existing.productId;
    const linkedAt = productId === existing.productId ? existing.linkedAt : productId ? now : null;
    await db
      .update(pl)
      .set({ name, neverSync, productId, linkedAt, updatedBy: dctx.userId, version: existing.version + 1 })
      .where(eq(pl.id, existing.id));
    const skuOf = async (id: string | null) =>
      id ? ((await db.select({ sku: p.sku }).from(p).where(eq(p.id, id)).limit(1))[0]?.sku ?? null) : null;
    await recordUpdate(db, dctx, {
      entityType: 'listing',
      entityId: existing.id,
      entityCode: sellerSku,
      before: {
        name: existing.name,
        neverSync: existing.neverSync,
        linkedProduct: await skuOf(existing.productId),
      },
      after: { name, neverSync, linkedProduct: await skuOf(productId) },
    });
    return { entityId: existing.id, message: `Updated ${sellerSku}` };
  }
  const created = (
    await db
      .insert(pl)
      .values({
        channelConnectionId: channel.id,
        clientId: client.id,
        productId: product?.id ?? null,
        sellerSku,
        channelProductId: sellerSku,
        name,
        neverSync,
        linkedAt: product ? now : null,
        createdBy: dctx.userId,
        updatedBy: dctx.userId,
      })
      .returning({ id: pl.id })
  )[0];
  await recordCreate(db, dctx, { entityType: 'listing', entityId: created.id, entityCode: sellerSku });
  return { entityId: created.id, message: `Created ${sellerSku}${product ? ` → ${product.sku}` : ''}` };
}
