/** Catalog: products, pack types (Primary + Case), barcodes, kits, packaging, tracking flags. */
import { eq } from 'drizzle-orm';
import * as schema from '@/server/db/schema';
import type { Tx } from '@/server/domain/types';
import { buildProductSeeds, type ProductSeed } from '../seed-data';
import {
  CUSTOMS_BY_CATEGORY,
  EXTRA_PRODUCTS,
  KIT_DEFS,
  LOT_SKUS,
  RETIRED_SKUS,
  SERIAL_SKUS,
  caseGtinFor,
  caseQtyFor,
  taxonomyFor,
  upcFor,
} from './catalog-data';
import { lookupKey, type LookupRefs } from './lookups';
import type { OrgRefs } from './org';
import { isoOf, utcAt } from './runtime';
import type { Id, SeedEnv } from './types';
import { round2 } from './types';
import { mapSeq } from '@/server/db/sql';

export interface ProductRef {
  readonly id: Id;
  readonly clientId: Id;
  readonly clientCode: string;
  readonly sku: string;
  readonly name: string;
  readonly category: string;
  readonly price: number;
  readonly weightOz: number;
  readonly dims: readonly [number, number, number];
  readonly uom: string;
  readonly kitType: 'Kit to Stock' | 'Kit to Order' | null;
  readonly isPackaging: boolean;
  readonly trackSerial: boolean;
  readonly trackLot: boolean;
  readonly caseQty: number | null;
}

export interface CatalogRefs {
  readonly products: readonly ProductRef[];
  readonly bySku: ReadonlyMap<string, ProductRef>;
  /** Products customers can order (no Kit to Order, no packaging), per client id. */
  readonly sellableByClient: ReadonlyMap<Id, readonly ProductRef[]>;
}

const SHELF_LIFE_DAYS = 270;

function productRow(
  p: ProductSeed,
  index: number,
  clientId: Id,
  lookups: LookupRefs,
  env: SeedEnv,
): typeof schema.products.$inferInsert {
  const kit = KIT_DEFS.find((k) => k.sku === p.sku);
  const isPackaging = p.category === 'Packaging';
  const taxonomy = taxonomyFor(p.category, p.sku);
  const lot = LOT_SKUS.has(p.sku);
  const serial = SERIAL_SKUS.has(p.sku);
  return {
    clientId,
    sku: p.sku,
    barcode: upcFor(index),
    name: p.name,
    category: p.category,
    uom: p.category === 'Coffee' ? 'Unit' : 'Each',
    weightOz: p.weightOz,
    lengthIn: p.lengthIn,
    widthIn: p.widthIn,
    heightIn: p.heightIn,
    price: p.price,
    purchasePrice: round2(p.price * (isPackaging ? 0.8 : 0.42)),
    isKit: Boolean(kit),
    isFragile: p.isFragile,
    status: 'Active',
    reorderPoint: isPackaging ? 500 : env.rng.int(10, 60),
    minSafetyStock: isPackaging ? 250 : env.rng.int(4, 20),
    productCategory: kit ? 'Kit' : isPackaging ? 'Packaging Material' : 'Product',
    kitType: kit?.kitType ?? null,
    description: `${p.name}. ${isPackaging ? 'Consumable packing material, issued at the pack station.' : `${p.category} item sold D2C and wholesale.`}`,
    productTypeId: lookups.byClient.get(lookupKey(clientId, 'product_type', taxonomy.type)) ?? null,
    productGroupId: lookups.byClient.get(lookupKey(clientId, 'product_group', taxonomy.group)) ?? null,
    customs: { declaredValue: p.price, ...CUSTOMS_BY_CATEGORY[p.category] },
    isLiquid: false,
    isStackable: p.category === 'Coffee',
    isNonReturnable: p.category === 'Coffee',
    trackLot: lot,
    lotReceivingOnly: lot,
    trackExpiry: lot,
    expiryReceivingOnly: lot,
    expiryFormat: lot ? 'yyyy-MM-dd' : null,
    shelfLifeDays: lot ? SHELF_LIFE_DAYS : null,
    trackSerial: serial,
    serialMethod: serial ? 'Both Receiving and Packing' : null,
    serialRegex: serial ? '^[A-Z0-9]{10,14}$' : null,
    packingInstructions: p.isFragile ? 'Fragile: wrap in bubble and use a box, never a poly mailer.' : null,
    createdAt: isoOf(utcAt(env.rng.int(120, 540), 15, env.rng.int(0, 59))),
  };
}

async function insertPackTypes(tx: Tx, product: ProductRef, upc: string): Promise<void> {
  const [l, w, h] = product.dims;
  const primary = (
    await tx
      .insert(schema.productPackTypes)
      .values({
        productId: product.id,
        packType: product.uom,
        kind: 'Primary',
        uomQty: 1,
        length: l,
        width: w,
        height: h,
        volume: round2(l * w * h),
        weight: round2(product.weightOz / 16),
      })
      .returning({ id: schema.productPackTypes.id })
  )[0];
  await tx
    .insert(schema.productBarcodes)
    .values({ productId: product.id, packTypeId: primary.id, barcode: upc });
  if (!product.caseQty) return;
  const caseDims: [number, number, number] = [
    round2(l * 3),
    round2(w * 2),
    round2(h * Math.ceil(product.caseQty / 6)),
  ];
  const casePack = (
    await tx
      .insert(schema.productPackTypes)
      .values({
        productId: product.id,
        packType: 'Case',
        kind: 'Hierarchical',
        parentPackTypeId: primary.id,
        childQty: product.caseQty,
        uomQty: product.caseQty,
        length: caseDims[0],
        width: caseDims[1],
        height: caseDims[2],
        volume: round2(caseDims[0] * caseDims[1] * caseDims[2]),
        weight: round2((product.weightOz * product.caseQty) / 16 + 1.2),
      })
      .returning({ id: schema.productPackTypes.id })
  )[0];
  await tx
    .insert(schema.productBarcodes)
    .values({ productId: product.id, packTypeId: casePack.id, barcode: caseGtinFor(upc) });
}

export async function seedCatalog(
  env: SeedEnv,
  tx: Tx,
  org: OrgRefs,
  lookups: LookupRefs,
): Promise<CatalogRefs> {
  const seeds = [...buildProductSeeds(), ...EXTRA_PRODUCTS];
  const products = await mapSeq(seeds, async (p, i): Promise<ProductRef> => {
    const client = org.clientByCode.get(p.clientCode);
    if (!client) throw new Error(`Seed product ${p.sku} references unknown client ${p.clientCode}`);
    const row = productRow(p, i + 1, client.id, lookups, env);
    const id = (await tx.insert(schema.products).values(row).returning({ id: schema.products.id }))[0].id;
    const ref: ProductRef = {
      id,
      clientId: client.id,
      clientCode: client.code,
      sku: p.sku,
      name: p.name,
      category: p.category,
      price: p.price,
      weightOz: p.weightOz,
      dims: [p.lengthIn, p.widthIn, p.heightIn],
      uom: row.uom ?? 'Each',
      kitType: row.kitType ?? null,
      isPackaging: p.category === 'Packaging',
      trackSerial: Boolean(row.trackSerial),
      trackLot: Boolean(row.trackLot),
      caseQty: caseQtyFor(p.category, p.sku),
    };
    await insertPackTypes(tx, ref, row.barcode);
    return ref;
  });
  const bySku = new Map(products.map((p) => [p.sku, p]));
  for (const kit of KIT_DEFS) {
    const kitRef = bySku.get(kit.sku);
    if (!kitRef) throw new Error(`Seed kit ${kit.sku} is missing`);
    await tx.insert(schema.kitComponents).values(
      kit.components.map(([sku, quantity]) => {
        const component = bySku.get(sku);
        if (!component || component.clientId !== kitRef.clientId)
          throw new Error(`Seed kit ${kit.sku}: bad component ${sku}`);
        return {
          kitProductId: kitRef.id,
          componentProductId: component.id,
          quantity,
          packType: component.uom,
        };
      }),
    );
  }
  const sellableByClient = new Map<Id, ProductRef[]>();
  for (const p of products) {
    if (p.isPackaging || p.kitType === 'Kit to Order') continue;
    sellableByClient.set(p.clientId, [...(sellableByClient.get(p.clientId) ?? []), p]);
  }
  return { products, bySku, sellableByClient };
}

/** Retires a few SKUs at the end of the replay (they keep their history). */
export async function retireProducts(tx: Tx, catalog: CatalogRefs): Promise<number> {
  let n = 0;
  for (const sku of RETIRED_SKUS) {
    const p = catalog.bySku.get(sku);
    if (!p) continue;
    await tx.update(schema.products).set({ status: 'Inactive' }).where(eq(schema.products.id, p.id));
    n += 1;
  }
  return n;
}
