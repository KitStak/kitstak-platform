/**
 * Catalog option lists (spec 05 §1). PURE: shared by the product wizard, the server
 * validators and the import handlers.
 */
import { CURRENCIES, DATE_FORMATS, DIMENSION_UNITS, HAZMAT_TYPES, KIT_TYPES, PRODUCT_CATEGORIES, SCAN_METHODS, SERIAL_METHODS, VOLUME_UNITS, WEIGHT_UNITS } from "@/lib/enums";

export { CURRENCIES, DATE_FORMATS, DIMENSION_UNITS, HAZMAT_TYPES, KIT_TYPES, PRODUCT_CATEGORIES, SCAN_METHODS, SERIAL_METHODS, VOLUME_UNITS, WEIGHT_UNITS };

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];
export type KitType = (typeof KIT_TYPES)[number];

export const CURRENCY_LABELS: Readonly<Record<(typeof CURRENCIES)[number], string>> = {
  AUD: "Australian Dollar (AUD) $",
  CAD: "Canadian Dollar (CAD) $",
  EUR: "Euro (EUR) €",
  INR: "Indian Rupee (INR) ₹",
  IDR: "Indonesian Rupiah (IDR) Rp",
  MYR: "Malaysian Ringgit (MYR) RM",
  MXN: "Mexican Peso (MXN) $",
  MAD: "Moroccan Dirham (MAD) .د.م.",
  NZD: "New Zealand Dollar (NZD) NZ$",
  NGN: "Nigerian Naira (NGN) ₦",
  PKR: "Pakistani Rupee (PKR) Rs",
  PHP: "Philippine Peso (PHP) ₱",
  GBP: "British Pound (GBP) £",
  SGD: "Singapore Dollar (SGD) $",
  THB: "Thai Baht (THB) ฿",
  TRY: "Turkish Lira (TRY) ₺",
  USD: "U.S. Dollar (USD) $",
  XOF: "West African CFA Franc (XOF) F.CFA",
};

export const HAZMAT_ATTRIBUTES = [
  "Contains Lithium Ion", "Contains Lithium Metal", "Packaged Lithium Ion", "Packaged Lithium Metal",
  "Lithium Ion Battery Only", "Lithium Metal Battery Only",
] as const;

export const HAZMAT_QUANTITY_TYPES = ["Gross", "Net"] as const;

/** Logiwa spells "Milliter"; KitStaks uses the correct spelling. */
export const HAZMAT_QUANTITY_UNITS = ["Pound", "Ounce", "Kilogram", "Gram", "Milliliter", "Liter"] as const;

export const HAZMAT_CONTAINER_TYPES = [
  "Fiberboard Box", "Wooden Box", "Plastic Jerrican", "Metal Box", "Steel Drum", "Plastic Box", "Plastic Drum", "Other",
  "Styrofoam Box", "Cylinder", "Envirotainer", "Plywood Box", "Aluminum Drum", "Aluminum Cylinder", "Plastic Pail",
  "Plywood Drum", "Fiber Drum", "Steel Jerrican", "Aluminum Jerrican", "Steel Box", "Carton", "Aluminum Box",
] as const;

/** Fallback pack-type master when the lookup table has none. */
export const DEFAULT_PACK_TYPES = ["Unit", "Each", "Case", "Pallet"] as const;

/** The eight packing flags (Wizard A step 2). Packaging Material omits Liquid. */
export const PACKING_FLAGS = [
  { key: "isFoldable", label: "Foldable" },
  { key: "isFragile", label: "Fragile" },
  { key: "isOversized", label: "Oversized" },
  { key: "isInsert", label: "Insert" },
  { key: "isStackable", label: "Stackable" },
  { key: "isPoster", label: "Poster" },
  { key: "isLiquid", label: "Liquid" },
  { key: "isNonReturnable", label: "Non-returnable" },
] as const;

export type PackingFlagKey = (typeof PACKING_FLAGS)[number]["key"];

export function packingFlagsFor(category: ProductCategory): readonly (typeof PACKING_FLAGS)[number][] {
  return category === "Packaging Material" ? PACKING_FLAGS.filter((f) => f.key !== "isLiquid") : PACKING_FLAGS;
}

/** Cubic-inch factor per dimension unit (L×W×H in the unit → cubic inches). */
const CUBIC_INCHES_PER_UNIT: Readonly<Record<string, number>> = { Inch: 1, Foot: 1728, Centimeter: 0.0610237, Meter: 61023.7 };
/** Cubic inches per volume unit. */
const CUBIC_INCHES_PER_VOLUME: Readonly<Record<string, number>> = {
  "Cubic Inch": 1, "Cubic Foot": 1728, "Cubic Meter": 61023.7, "Cubic Centimeter": 0.0610237, Liter: 61.0237, Gallon: 231,
};

/** Volume from L×W×H converted into `volumeUnit` (5 dp, Logiwa's display precision). Beyond Logiwa. */
export function computeVolume(length: number, width: number, height: number, dimensionUnit: string, volumeUnit: string): number {
  const dim = CUBIC_INCHES_PER_UNIT[dimensionUnit] ?? 1;
  const vol = CUBIC_INCHES_PER_VOLUME[volumeUnit] ?? 1;
  const cubicInches = Math.max(0, length) * Math.max(0, width) * Math.max(0, height) * dim;
  return Math.round((cubicInches / vol) * 100_000) / 100_000;
}

const OUNCES_PER_UNIT: Readonly<Record<string, number>> = { Pound: 16, Ounce: 1, Kilogram: 35.274, Gram: 0.035274 };
const INCHES_PER_UNIT: Readonly<Record<string, number>> = { Inch: 1, Foot: 12, Centimeter: 0.393701, Meter: 39.3701 };

export function toOunces(weight: number, unit: string): number {
  return Math.round(Math.max(0, weight) * (OUNCES_PER_UNIT[unit] ?? 16) * 100) / 100;
}

export function toInches(value: number, unit: string): number {
  return Math.round(Math.max(0, value) * (INCHES_PER_UNIT[unit] ?? 1) * 100) / 100;
}

/** Hierarchical pack: UOM qty = child qty × parent UOM qty. */
export function hierarchicalUomQty(childQty: number, parentUomQty: number): number {
  return Math.max(1, Math.floor(childQty)) * Math.max(1, Math.floor(parentUomQty));
}

/**
 * One volume format for every catalog surface (wizard cards, detail tab): 3 decimals, more only
 * when that would print 0.000 for a real (tiny) volume.
 */
export function formatVolume(v: number | null | undefined): string {
  const x = typeof v === "number" && Number.isFinite(v) ? v : 0;
  if (x > 0 && x < 0.001) return x.toPrecision(2);
  return x.toFixed(3);
}

/** A pack type is "incomplete" when any of L / W / H is missing or 0 (cubing and box selection need all three). */
export function hasIncompleteDimensions(pack: { readonly length?: number | null; readonly width?: number | null; readonly height?: number | null }): boolean {
  return [pack.length, pack.width, pack.height].some((d) => typeof d !== "number" || !(d > 0));
}

/** Converts a weight between units (via ounces), 4 dp. Unknown units are treated as pounds. */
export function convertWeight(weight: number, fromUnit: string, toUnit: string): number {
  const oz = Math.max(0, weight) * (OUNCES_PER_UNIT[fromUnit] ?? 16);
  return Math.round((oz / (OUNCES_PER_UNIT[toUnit] ?? 16)) * 10_000) / 10_000;
}

/** Converts a volume between volume units (via cubic inches), 5 dp. */
export function convertVolume(volume: number, fromUnit: string, toUnit: string): number {
  const ci = Math.max(0, volume) * (CUBIC_INCHES_PER_VOLUME[fromUnit] ?? 1);
  return Math.round((ci / (CUBIC_INCHES_PER_VOLUME[toUnit] ?? 1)) * 100_000) / 100_000;
}

/** A pack has no usable weight when it is missing or 0 (rate shopping and labels would use 0). */
export function hasMissingWeight(pack: { readonly weight?: number | null }): boolean {
  return typeof pack.weight !== "number" || !(pack.weight > 0);
}
