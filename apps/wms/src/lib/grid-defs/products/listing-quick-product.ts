/**
 * "Create New" tab of the Link Product drawer (Product Listings, live Logiwa capture §6).
 * PURE: the quick form's schema and its mapping to the full wizard payload, so the server
 * creates the product through the same validated path as Wizard A (SKU uniqueness, lookups,
 * pack types, change log) and links the listing in the same transaction.
 *
 * Logiwa's quick form also has "Initial Quantity", which books stock with no location, lot or
 * receipt. KitStaks leaves it out on purpose: stock only enters through receiving or an
 * inventory adjustment, so the ledger stays traceable.
 */
import { z } from 'zod';
import { WEIGHT_UNITS } from './catalog-options';
import { emptyProductForm, generalStepSchema, type ProductInput } from './product-form';

const g = generalStepSchema.shape;

export const listingQuickProductSchema = z.object({
  sku: g.sku,
  name: g.name,
  description: g.description,
  imageUrl: g.imageUrl,
  barcode: g.barcode,
  uom: g.uom,
  productTypeId: g.productTypeId,
  productGroupId: g.productGroupId,
  salesPrice: g.salesPrice,
  purchasePrice: g.purchasePrice,
  taxRate: g.taxRate,
  weight: z.preprocess(
    (v) => (v === null || v === undefined || v === '' ? 0 : v),
    z.number({ error: 'Enter a number' }).min(0, 'Must be 0 or more').max(100_000),
  ),
  weightUnit: z.enum(WEIGHT_UNITS).default('Pound'),
  isActive: z.boolean().default(true),
  isFragile: z.boolean().default(false),
  isOversized: z.boolean().default(false),
  /** Applied to the listing, not the product. */
  neverSync: z.boolean().default(false),
});
type RawInput = z.input<typeof listingQuickProductSchema>;
/** Form/API input: SKU and name required, everything else optional (schema defaults apply). */
export type ListingQuickProductInput = { [K in keyof RawInput]?: RawInput[K] } & {
  sku: string;
  name: string;
};
export type ListingQuickProduct = z.output<typeof listingQuickProductSchema>;

/** Prefill from the listing: SKU = seller SKU, name/description/image/price from the store. */
export function quickProductDefaults(listing: {
  readonly sellerSku: string;
  readonly name: string;
  readonly description: string | null;
  readonly imageUrl: string | null;
  readonly storePrice: number | null;
  readonly neverSync: boolean;
}): ListingQuickProductInput {
  return {
    sku: listing.sellerSku.replace(/\s+/g, ''),
    name: listing.name.slice(0, 200),
    description: (listing.description ?? '').slice(0, 500),
    imageUrl: listing.imageUrl ?? '',
    barcode: '',
    uom: 'Unit',
    productTypeId: null,
    productGroupId: null,
    salesPrice: listing.storePrice ?? null,
    purchasePrice: null,
    taxRate: null,
    weight: null,
    weightUnit: 'Pound',
    isActive: true,
    isFragile: false,
    isOversized: false,
    neverSync: listing.neverSync,
  };
}

/** Full Wizard A payload for the quick product: one primary pack carrying weight + barcode. */
export function quickProductToInput(clientId: string, q: ListingQuickProduct): ProductInput {
  const base = emptyProductForm('Product', clientId);
  return {
    ...(base as unknown as ProductInput),
    productCategory: 'Product',
    clientId,
    sku: q.sku,
    name: q.name,
    description: q.description ?? '',
    imageUrl: q.imageUrl ?? '',
    barcode: q.barcode ?? '',
    uom: q.uom,
    productTypeId: q.productTypeId,
    productGroupId: q.productGroupId,
    salesPrice: q.salesPrice,
    purchasePrice: q.purchasePrice,
    taxRate: q.taxRate,
    isActive: q.isActive,
    isFragile: q.isFragile,
    isOversized: q.isOversized,
    weight: q.weight,
    weightUnit: q.weightUnit,
    packTypes: [
      {
        key: 'primary',
        id: null,
        packType: q.uom,
        kind: 'Primary',
        parentKey: null,
        uomQty: 1,
        dimensionUnit: 'Inch',
        length: 0,
        width: 0,
        height: 0,
        volumeUnit: 'Cubic Inch',
        volume: 0,
        volumeOverridden: false,
        weightUnit: q.weightUnit,
        weight: q.weight,
        useShipPackageId: null,
        useOwnBox: false,
        usePrimaryBarcodes: false,
        barcodes: q.barcode ? [q.barcode] : [],
      },
    ],
  };
}
