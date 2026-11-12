/**
 * Product wizard model (Wizards A/B/C, spec 05 §1). PURE: the client wizard validates
 * each step with the step schemas, and the server re-validates the whole payload with
 * `productInputSchema` (plus DB checks: SKU uniqueness, client scope, lookups).
 */
import { z } from 'zod';
import {
  CURRENCIES,
  DATE_FORMATS,
  DIMENSION_UNITS,
  HAZMAT_ATTRIBUTES,
  HAZMAT_CONTAINER_TYPES,
  HAZMAT_QUANTITY_TYPES,
  HAZMAT_QUANTITY_UNITS,
  HAZMAT_TYPES,
  KIT_TYPES,
  PRODUCT_CATEGORIES,
  SCAN_METHODS,
  SERIAL_METHODS,
  VOLUME_UNITS,
  WEIGHT_UNITS,
  computeVolume,
  hierarchicalUomQty,
} from './catalog-options';
import { COUNTRIES } from '@/lib/countries';
import { isDemoImageUrl } from './demo-images';

export const SKU_MAX = 100;
export const NAME_MAX = 200;
export const DESCRIPTION_MAX = 500;
export const INSTRUCTIONS_MAX = 250;
export const BARCODE_MAX = 100;
export const MAX_BARCODES_PER_PACK = 20;
export const MAX_PACK_TYPES = 20;
export const MAX_COMPONENTS = 200;

const PACK_KINDS = ['Primary', 'Hierarchical', 'Irregular'] as const;
export type PackKind = (typeof PACK_KINDS)[number];

/** Nullable number from a NumberInput: null/blank → 0. */
const num = (max = 1_000_000_000) =>
  z.preprocess(
    (v) => (v === null || v === undefined || v === '' ? 0 : v),
    z
      .number({ error: 'Enter a number' })
      .min(0, 'Must be 0 or more')
      .max(max, `Must be ${max.toLocaleString('en-US')} or less`),
  );
const int = (max = 1_000_000_000) =>
  z.preprocess(
    (v) => (v === null || v === undefined || v === '' ? 0 : v),
    z
      .number({ error: 'Enter a whole number' })
      .int('Enter a whole number')
      .min(0, 'Must be 0 or more')
      .max(max, `Must be ${max.toLocaleString('en-US')} or less`),
  );
const optText = (max: number) =>
  z
    .preprocess(
      (v) => (typeof v === 'string' ? v.trim() : (v ?? '')),
      z.string().max(max, `At most ${max} characters`),
    )
    .transform((v) => (v === '' ? null : v));
/**
 * Customs origin is stored as an ISO 3166-1 alpha-2 code. Legacy/imported values may hold the
 * country name ("Vietnam"); map those to the code so old records stay editable.
 */
const COUNTRY_ALIASES: Readonly<Record<string, string>> = {
  vietnam: 'VN',
  usa: 'US',
  'united states of america': 'US',
  uk: 'GB',
  'great britain': 'GB',
  england: 'GB',
  'south korea': 'KR',
  korea: 'KR',
  'north korea': 'KP',
  russia: 'RU',
  taiwan: 'TW',
  'hong kong sar': 'HK',
  turkey: 'TR',
  'czech republic': 'CZ',
  laos: 'LA',
  iran: 'IR',
  syria: 'SY',
  bolivia: 'BO',
  venezuela: 'VE',
  tanzania: 'TZ',
  moldova: 'MD',
};
export function normalizeCountryCode(raw: unknown): string {
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (v.length <= 2) return v.toUpperCase();
  const lower = v.toLowerCase();
  const alias = COUNTRY_ALIASES[lower];
  if (alias) return alias;
  const hit = COUNTRIES.find((c) => c.name.toLowerCase() === lower || c.code.toLowerCase() === lower);
  return hit?.code ?? v;
}
const optId = z.preprocess((v) => (v === '' || v === undefined ? null : v), z.string().max(64).nullable());
const optEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess((v) => (v === '' || v === undefined ? null : v), z.enum(values).nullable());

export const packTypeSchema = z.object({
  /** Client-side key (stable across edits); the server id when editing. */
  key: z.string().min(1).max(64),
  id: z.string().max(64).nullish(),
  packType: z.string({ error: 'Select a pack type' }).trim().min(1, 'Select a pack type').max(50),
  kind: z.enum(PACK_KINDS),
  parentKey: z.string().max(64).nullish(),
  childQty: z.preprocess(
    (v) => (v === null || v === '' ? undefined : v),
    z.number().int().min(2, 'Child qty must be at least 2').max(100_000).optional(),
  ),
  uomQty: z.preprocess(
    (v) => (v === null || v === '' ? 1 : v),
    z.number().int('Enter a whole number').min(1, 'UOM quantity must be at least 1').max(10_000_000),
  ),
  dimensionUnit: z.enum(DIMENSION_UNITS).default('Inch'),
  length: num(100_000),
  width: num(100_000),
  height: num(100_000),
  volumeUnit: z.enum(VOLUME_UNITS).default('Cubic Inch'),
  volume: num(1_000_000_000),
  /** True once the user typed a volume (auto-compute stops overwriting it). */
  volumeOverridden: z.boolean().default(false),
  weightUnit: z.enum(WEIGHT_UNITS).default('Pound'),
  weight: num(100_000),
  useShipPackageId: optId,
  useOwnBox: z.boolean().default(false),
  usePrimaryBarcodes: z.boolean().default(false),
  barcodes: z
    .array(z.string().trim().min(1).max(BARCODE_MAX, `Barcodes are at most ${BARCODE_MAX} characters`))
    .max(MAX_BARCODES_PER_PACK)
    .default([]),
});
export type PackTypeInput = z.input<typeof packTypeSchema>;
export type PackTypeValue = z.output<typeof packTypeSchema>;

export const channelAllocationSchema = z.object({
  key: z.string().min(1).max(64),
  channelConnectionId: z.string({ error: 'Select a sales channel' }).min(1, 'Select a sales channel').max(64),
  warehouseId: optId,
  staticQty: z.preprocess(
    (v) => (v === '' || v === undefined ? null : v),
    z.number().int().min(0).max(10_000_000).nullable(),
  ),
  reserveQty: z.preprocess(
    (v) => (v === '' || v === undefined ? null : v),
    z.number().int().min(0).max(10_000_000).nullable(),
  ),
  allocationPct: z.preprocess(
    (v) => (v === '' || v === undefined ? null : v),
    z.number().min(0).max(100, 'At most 100%').nullable(),
  ),
});
export type ChannelAllocationValue = z.output<typeof channelAllocationSchema>;

export const replenishmentLevelSchema = z
  .object({
    warehouseId: z.string().min(1, 'Select a warehouse').max(64),
    minLevel: int(10_000_000),
    maxLevel: int(10_000_000),
  })
  .refine((v) => v.maxLevel >= v.minLevel, { message: 'Max must be at least min', path: ['maxLevel'] });
export type ReplenishmentLevelValue = z.output<typeof replenishmentLevelSchema>;

export const componentSchema = z.object({
  productId: z.string().min(1).max(64),
  sku: z.string().max(SKU_MAX).optional(),
  name: z.string().max(400).optional(),
  imageUrl: z.string().max(2000).nullish(),
  quantity: z.preprocess(
    (v) => (v === null || v === '' ? 0 : v),
    z.number().int('Enter a whole number').min(1, 'Quantity must be at least 1').max(100_000),
  ),
});
export type ComponentValue = z.output<typeof componentSchema>;

export const IMAGE_URL_MESSAGE = 'Enter a full image URL (https://…)';
const IMAGE_URL_RE = /^https?:\/\/\S+$/i;
/** Full http(s) URL, or a built-in demo illustration path (seed catalog). */
const isImageUrl = (v: string): boolean => IMAGE_URL_RE.test(v) || isDemoImageUrl(v);

/** The image-URL rule as a plain check (the wizard runs it on blur with the same message as Next). */
export function imageUrlError(value: string | null | undefined): string | null {
  const v = (value ?? '').trim();
  return v === '' || isImageUrl(v) ? null : IMAGE_URL_MESSAGE;
}

const imageUrl = z
  .preprocess(
    (v) => (typeof v === 'string' ? v.trim() : (v ?? '')),
    z
      .string()
      .max(2000)
      .refine((v) => v === '' || isImageUrl(v), IMAGE_URL_MESSAGE),
  )
  .transform((v) => (v === '' ? null : v));

/* ------------------------------------------------------------------ step schemas */

export const generalStepSchema = z
  .object({
    productCategory: z.enum(PRODUCT_CATEGORIES),
    kitType: optEnum(KIT_TYPES),
    clientId: z.string({ error: 'Select a client' }).min(1, 'Select a client').max(64),
    sku: z
      .string({ error: 'SKU is required' })
      .trim()
      .min(1, 'SKU is required')
      .max(SKU_MAX, `SKU is at most ${SKU_MAX} characters`)
      .refine((v) => !/[\s]/.test(v), 'SKU cannot contain spaces'),
    name: z
      .string({ error: 'Name is required' })
      .trim()
      .min(1, 'Name is required')
      .max(NAME_MAX, `Name is at most ${NAME_MAX} characters`),
    description: optText(DESCRIPTION_MAX),
    imageUrl,
    barcode: optText(BARCODE_MAX),
    productTypeId: optId,
    productGroupId: optId,
    uom: z.string().trim().min(1, 'Select a UOM pack type').max(50).default('Unit'),
    currency: z.enum(CURRENCIES).default('USD'),
    purchasePrice: num(10_000_000),
    salesPrice: num(10_000_000),
    taxRate: z.preprocess(
      (v) => (v === null || v === undefined || v === '' ? 0 : v),
      z
        .number({ error: 'Enter a number' })
        .min(0, 'Tax rate must be 0–100%')
        .max(100, 'Tax rate must be 0–100%'),
    ),
    minSafetyStock: int(10_000_000),
    fnsku: optText(BARCODE_MAX),
    isActive: z.boolean().default(true),
    isDigital: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.productCategory === 'Kit' && !v.kitType)
      ctx.addIssue({ code: 'custom', path: ['kitType'], message: 'Select a kit type' });
  });

export const packingStepSchema = z.object({
  packingInstructions: optText(INSTRUCTIONS_MAX),
  returnInstructions: optText(INSTRUCTIONS_MAX),
  isFoldable: z.boolean().default(false),
  isFragile: z.boolean().default(false),
  isOversized: z.boolean().default(false),
  isInsert: z.boolean().default(false),
  isStackable: z.boolean().default(false),
  isPoster: z.boolean().default(false),
  isLiquid: z.boolean().default(false),
  isNonReturnable: z.boolean().default(false),
  /* Kit / packaging dims (no Pack Type step). */
  weightUnit: z.enum(WEIGHT_UNITS).default('Pound'),
  weight: num(100_000),
  dimensionUnit: z.enum(DIMENSION_UNITS).default('Inch'),
  length: num(100_000),
  width: num(100_000),
  height: num(100_000),
  volumeUnit: z.enum(VOLUME_UNITS).default('Cubic Inch'),
  volume: num(1_000_000_000),
  volumeOverridden: z.boolean().default(false),
  useShipPackageId: optId,
});

export const packTypesStepSchema = z
  .object({
    packTypes: z.array(packTypeSchema).max(MAX_PACK_TYPES),
    productCategory: z.enum(PRODUCT_CATEGORIES),
  })
  .superRefine((v, ctx) => {
    if (v.productCategory !== 'Product') return;
    const primaries = v.packTypes.filter((p) => p.kind === 'Primary');
    if (primaries.length === 0)
      ctx.addIssue({ code: 'custom', path: ['packTypes'], message: 'Add a primary (UOM) pack type' });
    if (primaries.length > 1)
      ctx.addIssue({
        code: 'custom',
        path: ['packTypes'],
        message: 'Only one primary (UOM) pack type is allowed',
      });
    const names = new Set<string>();
    for (const p of v.packTypes) {
      const k = p.packType.toLowerCase();
      if (names.has(k))
        ctx.addIssue({
          code: 'custom',
          path: ['packTypes'],
          message: `Pack type ${p.packType} is used twice`,
        });
      names.add(k);
    }
    const codes = new Map<string, string>();
    for (const p of v.packTypes) {
      for (const b of p.barcodes) {
        const prev = codes.get(b.toLowerCase());
        if (prev && prev !== p.key)
          ctx.addIssue({ code: 'custom', path: ['packTypes'], message: `Barcode ${b} is on two pack types` });
        codes.set(b.toLowerCase(), p.key);
      }
    }
  });

export const componentsStepSchema = z
  .object({
    productCategory: z.enum(PRODUCT_CATEGORIES),
    components: z.array(componentSchema).max(MAX_COMPONENTS),
  })
  .superRefine((v, ctx) => {
    if (v.productCategory !== 'Kit') return;
    if (v.components.length === 0)
      ctx.addIssue({
        code: 'custom',
        path: ['components'],
        message: 'Add at least one component to the kit',
      });
    const ids = new Set<string>();
    for (const c of v.components) {
      if (ids.has(c.productId))
        ctx.addIssue({
          code: 'custom',
          path: ['components'],
          message: `${c.sku ?? 'A component'} is listed twice`,
        });
      ids.add(c.productId);
    }
  });

const hazmatSchema = z.object({
  hazmatId: optText(100),
  type: optEnum(HAZMAT_TYPES),
  attribute: optEnum(HAZMAT_ATTRIBUTES),
  quantity: num(1_000_000),
  quantityType: optEnum(HAZMAT_QUANTITY_TYPES),
  quantityUnit: optEnum(HAZMAT_QUANTITY_UNITS),
  containerType: optEnum(HAZMAT_CONTAINER_TYPES),
  properShippingName: optText(200),
  classDivision: optText(50),
});

const customsSchema = z.object({
  declaredValue: num(10_000_000),
  hsCode: optText(20),
  originCountry: z
    .preprocess(normalizeCountryCode, z.string().max(2, 'Pick a country from the list'))
    .transform((v) => (v === '' ? null : v)),
  notDeclared: z.boolean().default(false),
  manufacturer: optText(200),
  manufacturerProductId: optText(300),
  description: optText(200),
});

const isRegex = (v: string | null): boolean => {
  if (!v) return true;
  try {
    new RegExp(v);
    return true;
  } catch {
    return false;
  }
};

/** Optional sub-objects: API callers may omit them (a non-hazardous product needs no hazmat block). */
const orEmpty = (v: unknown) => (v === undefined || v === null ? {} : v);

export const advancedStepSchema = z
  .object({
    customs: z.preprocess(orEmpty, customsSchema),
    isHazmat: z.boolean().default(false),
    hazmat: z.preprocess(orEmpty, hazmatSchema),
    channelAllocations: z.array(channelAllocationSchema).max(100).default([]),
    trackExpiry: z.boolean().default(false),
    expiryReceivingOnly: z.boolean().default(false),
    expiryFormat: optEnum(DATE_FORMATS),
    expiryScanMethod: optEnum(SCAN_METHODS),
    useProductionDate: z.boolean().default(false),
    shelfLifeDays: int(100_000),
    trackLot: z.boolean().default(false),
    lotReceivingOnly: z.boolean().default(false),
    autoCreateLot: z.boolean().default(false),
    lotRegex: optText(200).refine(isRegex, 'Enter a valid regular expression'),
    lotScanMethod: optEnum(SCAN_METHODS),
    trackProductionDate: z.boolean().default(false),
    productionReceivingOnly: z.boolean().default(false),
    productionFormat: optEnum(DATE_FORMATS),
    productionScanMethod: optEnum(SCAN_METHODS),
    replenishmentStrategy: z.enum(['Global', 'Per Warehouse']).default('Global'),
    replenishmentMin: int(10_000_000),
    replenishmentMax: int(10_000_000),
    replenishmentLevels: z.array(replenishmentLevelSchema).max(50).default([]),
    trackSerial: z.boolean().default(false),
    trackSecondarySerial: z.boolean().default(false),
    serialMethod: optEnum(SERIAL_METHODS),
    skipSerialScan: z.boolean().default(false),
    serialRegex: optText(200).refine(isRegex, 'Enter a valid regular expression'),
  })
  .superRefine((v, ctx) => {
    if (v.trackExpiry && !v.expiryFormat)
      ctx.addIssue({ code: 'custom', path: ['expiryFormat'], message: 'Select an expiry date format' });
    if (v.trackProductionDate && !v.productionFormat)
      ctx.addIssue({
        code: 'custom',
        path: ['productionFormat'],
        message: 'Select a production date format',
      });
    if (v.trackSerial && !v.serialMethod)
      ctx.addIssue({ code: 'custom', path: ['serialMethod'], message: 'Select a tracking method' });
    if (v.isHazmat && !v.hazmat.type)
      ctx.addIssue({ code: 'custom', path: ['hazmat', 'type'], message: 'Select a hazmat type' });
    if (v.replenishmentStrategy === 'Global' && v.replenishmentMax < v.replenishmentMin) {
      ctx.addIssue({ code: 'custom', path: ['replenishmentMax'], message: 'Max must be at least min' });
    }
    const whs = new Set<string>();
    for (const l of v.replenishmentLevels) {
      if (whs.has(l.warehouseId))
        ctx.addIssue({
          code: 'custom',
          path: ['replenishmentLevels'],
          message: 'A warehouse has two replenishment levels',
        });
      whs.add(l.warehouseId);
    }
    for (const a of v.channelAllocations) {
      if (a.staticQty === null && a.reserveQty === null && a.allocationPct === null) {
        ctx.addIssue({
          code: 'custom',
          path: ['channelAllocations'],
          message: 'Each allocation needs a static qty, reserve qty or percentage',
        });
      }
    }
  });

export const otherStepSchema = z.object({
  customFields: z
    .record(z.string().max(30), z.union([z.string().max(500), z.boolean(), z.null()]))
    .default({}),
});

/* ------------------------------------------------------------------ full payload */

export const productInputSchema = z
  .object({
    ...generalStepSchema.shape,
    ...packingStepSchema.shape,
    packTypes: z.array(packTypeSchema).max(MAX_PACK_TYPES).default([]),
    components: z.array(componentSchema).max(MAX_COMPONENTS).default([]),
    ...advancedStepSchema.shape,
    ...otherStepSchema.shape,
    version: z.number().int().min(1).optional(),
  })
  .superRefine((v, ctx) => {
    for (const schema of [generalStepSchema, packTypesStepSchema, componentsStepSchema, advancedStepSchema]) {
      const r = schema.safeParse(v);
      if (!r.success)
        for (const issue of r.error.issues)
          ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
    }
  });
export type ProductInput = z.input<typeof productInputSchema>;
export type ProductValue = z.output<typeof productInputSchema>;

/* ------------------------------------------------------------------ derivations */

/** Recomputes hierarchical UOM qty from parent chains; primary is always 1. */
export interface PackChainItem {
  readonly key: string;
  readonly kind: PackKind;
  readonly parentKey?: string | null;
  readonly childQty?: number | null;
  readonly uomQty: number | null;
}

export function normalizePackTypes<T extends PackChainItem>(packs: readonly T[]): (T & { uomQty: number })[] {
  const byKey = new Map(packs.map((p) => [p.key, p]));
  const resolved = new Map<string, number>();
  const resolve = (p: T, depth: number): number => {
    const cached = resolved.get(p.key);
    if (cached !== undefined) return cached;
    let qty: number;
    if (p.kind === 'Primary') qty = 1;
    else if (p.kind === 'Irregular') qty = Math.max(1, p.uomQty ?? 1);
    else {
      const parent =
        (p.parentKey ? byKey.get(p.parentKey) : undefined) ?? packs.find((x) => x.kind === 'Primary');
      const parentQty = parent && parent.key !== p.key && depth < 10 ? resolve(parent, depth + 1) : 1;
      qty = hierarchicalUomQty(p.childQty ?? 2, parentQty);
    }
    resolved.set(p.key, qty);
    return qty;
  };
  return packs.map((p) => ({ ...p, uomQty: resolve(p, 0) }));
}

/** Volume for a pack/kit unless the user overrode it. */
export function derivedVolume(v: {
  length: number | null;
  width: number | null;
  height: number | null;
  dimensionUnit: string;
  volumeUnit: string;
  volume: number | null;
  volumeOverridden?: boolean;
}): number {
  if (v.volumeOverridden) return v.volume ?? 0;
  return computeVolume(v.length ?? 0, v.width ?? 0, v.height ?? 0, v.dimensionUnit, v.volumeUnit);
}

export const EMPTY_HAZMAT = {
  hazmatId: '',
  type: null,
  attribute: null,
  quantity: null,
  quantityType: null,
  quantityUnit: null,
  containerType: null,
  properShippingName: '',
  classDivision: '',
} as const;

export const EMPTY_CUSTOMS = {
  declaredValue: null,
  hsCode: '',
  originCountry: '',
  notDeclared: false,
  manufacturer: '',
  manufacturerProductId: '',
  description: '',
} as const;

/** Form values (inputs) for a brand-new product of `category`. */
export function emptyProductForm(
  category: (typeof PRODUCT_CATEGORIES)[number],
  clientId: string | null = null,
): ProductFormValues {
  return {
    productCategory: category,
    kitType: category === 'Kit' ? 'Kit to Order' : null,
    clientId: clientId ?? '',
    sku: '',
    name: '',
    description: '',
    imageUrl: '',
    barcode: '',
    productTypeId: null,
    productGroupId: null,
    uom: 'Unit',
    currency: 'USD',
    purchasePrice: null,
    salesPrice: null,
    taxRate: null,
    minSafetyStock: null,
    fnsku: '',
    isActive: true,
    isDigital: false,
    packingInstructions: '',
    returnInstructions: '',
    isFoldable: false,
    isFragile: false,
    isOversized: false,
    isInsert: false,
    isStackable: false,
    isPoster: false,
    isLiquid: false,
    isNonReturnable: false,
    weightUnit: 'Pound',
    weight: null,
    dimensionUnit: 'Inch',
    length: null,
    width: null,
    height: null,
    volumeUnit: 'Cubic Inch',
    volume: null,
    volumeOverridden: false,
    useShipPackageId: null,
    packTypes: [],
    components: [],
    customs: { ...EMPTY_CUSTOMS },
    isHazmat: false,
    hazmat: { ...EMPTY_HAZMAT },
    channelAllocations: [],
    trackExpiry: false,
    expiryReceivingOnly: false,
    expiryFormat: null,
    expiryScanMethod: 'During Picking',
    useProductionDate: false,
    shelfLifeDays: null,
    trackLot: false,
    lotReceivingOnly: false,
    autoCreateLot: false,
    lotRegex: '',
    lotScanMethod: 'During Picking',
    trackProductionDate: false,
    productionReceivingOnly: false,
    productionFormat: null,
    productionScanMethod: 'During Picking',
    replenishmentStrategy: 'Global',
    replenishmentMin: null,
    replenishmentMax: null,
    replenishmentLevels: [],
    trackSerial: false,
    trackSecondarySerial: false,
    serialMethod: null,
    skipSerialScan: false,
    serialRegex: '',
    customFields: {},
  };
}

/** Loosely typed form values (numbers may be null while editing). */
export interface ProductFormValues {
  [key: string]: unknown;
  productCategory: (typeof PRODUCT_CATEGORIES)[number];
  kitType: string | null;
  clientId: string;
  sku: string;
  name: string;
  packTypes: PackTypeFormValue[];
  components: ComponentFormValue[];
  channelAllocations: ChannelAllocationFormValue[];
  replenishmentLevels: { warehouseId: string; minLevel: number | null; maxLevel: number | null }[];
  customFields: Record<string, string | boolean | null>;
  customs: Record<string, unknown>;
  hazmat: Record<string, unknown>;
  isHazmat: boolean;
  version?: number;
}

export interface PackTypeFormValue {
  key: string;
  id?: string | null;
  packType: string;
  kind: PackKind;
  parentKey?: string | null;
  childQty?: number | null;
  uomQty: number | null;
  dimensionUnit: string;
  length: number | null;
  width: number | null;
  height: number | null;
  volumeUnit: string;
  volume: number | null;
  volumeOverridden: boolean;
  weightUnit: string;
  weight: number | null;
  useShipPackageId: string | null;
  useOwnBox: boolean;
  usePrimaryBarcodes: boolean;
  barcodes: string[];
}

export interface ComponentFormValue {
  productId: string;
  sku: string;
  name: string;
  imageUrl?: string | null;
  quantity: number | null;
}

export interface ChannelAllocationFormValue {
  key: string;
  channelConnectionId: string;
  warehouseId: string | null;
  staticQty: number | null;
  reserveQty: number | null;
  allocationPct: number | null;
}

export function newPackType(kind: PackKind, packs: readonly PackTypeFormValue[]): PackTypeFormValue {
  const primary = packs.find((p) => p.kind === 'Primary');
  const lastHier = [...packs].reverse().find((p) => p.kind === 'Hierarchical');
  return {
    key: `pk_${Math.random().toString(36).slice(2, 10)}`,
    id: null,
    packType: '',
    kind,
    parentKey: kind === 'Hierarchical' ? ((lastHier ?? primary)?.key ?? null) : null,
    childQty: kind === 'Hierarchical' ? 2 : null,
    uomQty: 1,
    dimensionUnit: primary?.dimensionUnit ?? 'Inch',
    length: null,
    width: null,
    height: null,
    volumeUnit: primary?.volumeUnit ?? 'Cubic Inch',
    volume: null,
    volumeOverridden: false,
    weightUnit: primary?.weightUnit ?? 'Pound',
    weight: null,
    useShipPackageId: null,
    useOwnBox: false,
    usePrimaryBarcodes: false,
    barcodes: [],
  };
}

/** Barcodes repeated across this product's own pack types (case-sensitive, trimmed). Returns `[barcode, packTypes[]]`. */
export function duplicateBarcodesWithin(
  packs: readonly { packType: string; barcodes: readonly string[] }[],
): [string, string[]][] {
  const seen = new Map<string, string[]>();
  for (const pack of packs) {
    for (const code of new Set(pack.barcodes.map((b) => b.trim()).filter(Boolean))) {
      seen.set(code, [...(seen.get(code) ?? []), pack.packType]);
    }
  }
  return [...seen].filter(([, owners]) => owners.length > 1);
}
