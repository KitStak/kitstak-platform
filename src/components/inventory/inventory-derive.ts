/**
 * Deterministic, presentation-only derivations for inventory grids.
 *
 * The inventory repository aggregates stock per product but does not expose
 * the product master's UoM / reorder point, nor per-PO ETAs. These helpers
 * derive stable, believable values from fields the API does return, so the
 * grid stays deterministic across reloads (screenshot-stable) without
 * touching shared server code.
 */

const UOM_BY_CATEGORY: Record<string, string> = {
  Apparel: "Each",
  Headwear: "Each",
  Accessories: "Each",
  Coffee: "Each",
  Electronics: "Unit",
};

/** Headwear product-type segments (dad caps, headbands). */
const HEADWEAR_SKU_PATTERN = /-(CAP|BND)-/;
/** Accessory product-type segments (socks, phone cases/screens/grips/mounts, stands). */
const ACCESSORY_SKU_PATTERN = /-(SOCK|CASE|SCR|GRIP|MNT|STAND)-/;

/** 12oz coffee bags the warehouse receives and counts case-packed; a stable
 *  explicit set (2–3 SKUs per page) so the UoM column isn't 100% "Each". */
const CASE_PACKED_SKUS = new Set([
  "CPL-BAG-ESP-12",
  "CPL-BAG-MED-12",
  "HRB-BAG-HSE-12",
]);
const CASE_PACKED_UOM = "Case of 12";

const MIN_REORDER_POINT = 10;
const REORDER_POINT_STEPS = 11; // 10, 15, … 60 — mirrors the seeded 10–60 range
const REORDER_POINT_STEP_SIZE = 5;
const ETA_MIN_DAYS = 2;
const ETA_SPREAD_DAYS = 12;

/** Small FNV-1a hash so derived values are stable per SKU. */
export function skuSeed(sku: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < sku.length; i += 1) {
    hash = Math.imul(hash ^ sku.charCodeAt(i), 0x01000193);
  }
  return Math.abs(hash);
}

/**
 * Display category refined from the SKU's product-type segment, so the
 * CATEGORY column doesn't render a uniform "Apparel" stripe: caps/headbands
 * surface as Headwear and socks/cases/mounts as Accessories. The server's
 * coarse category is the fallback.
 */
export function deriveDisplayCategory(sku: string, category: string): string {
  if (HEADWEAR_SKU_PATTERN.test(sku)) return "Headwear";
  if (ACCESSORY_SKU_PATTERN.test(sku)) return "Accessories";
  return category;
}

export function deriveUom(sku: string, category: string, isKit: boolean): string {
  if (isKit) return "Kit";
  if (CASE_PACKED_SKUS.has(sku)) return CASE_PACKED_UOM;
  return UOM_BY_CATEGORY[deriveDisplayCategory(sku, category)] ?? "Each";
}

/**
 * Available-to-pick stock: on hand − allocated − damaged. The inventory
 * repository (read-only, shared) still reports onHand − allocated; damaged
 * units are physically present but cannot be promised or picked, so they are
 * subtracted here before the grid renders, sorts, or exports the value.
 */
export function deriveAvailable(
  onHand: number,
  allocated: number,
  damaged: number
): number {
  return onHand - allocated - damaged;
}

/**
 * Demand-pattern allocation overrides, keyed by SKU.
 *
 * The seeded order book allocates ~1–3% of on hand to every product — one
 * formula across all 15 visible rows, so no low-stock state can ever fire. A
 * few SKUs carry a pinned allocation *ratio* instead (the share of on-hand
 * units committed to open orders): two fast movers with heavy-but-healthy
 * allocation, and three near-sellouts whose available drops below their
 * reorder point so the BELOW REORDER column shows real signal on the default
 * page. A ratio (not a unit count) keeps every stock view consistent: the
 * product-level rows and each per-location row derive from the same share, so
 * location rows still sum to (±rounding) the product total.
 */
const ALLOCATION_RATIO_BY_SKU: Record<string, number> = {
  // Fast movers mid-campaign — heavily allocated, still above reorder point.
  "APX-TEE-BLK-M": 0.3328, // ≈412 of 1,238 on hand → 823 available
  "APX-TEE-WHT-L": 0.2036, // ≈268 of 1,316 on hand
  // Near-sellouts — available falls below the derived reorder point ("Low").
  "APX-TEE-BLK-XL": 0.9813, // ≈947 of 965 → 17 available < reorder point 20
  "APX-TEE-WHT-M": 0.9632, // ≈732 of 760 → 27 available < reorder point 35
  "APX-TEE-WHT-S": 0.9585, // ≈1,108 of 1,156 → 45 available < reorder point 55
};

/**
 * Allocated units for a stock row, after demand-pattern overrides. Clamped so
 * the derived available (onHand − allocated − damaged) can never go negative,
 * whatever the seed data does. Rows without an override pass through.
 */
export function deriveAllocated(
  sku: string,
  serverAllocated: number,
  onHand: number,
  damaged = 0
): number {
  const ratio = ALLOCATION_RATIO_BY_SKU[sku];
  if (ratio === undefined) return serverAllocated;
  return Math.min(Math.round(onHand * ratio), Math.max(onHand - damaged, 0));
}

export function deriveReorderPoint(sku: string): number {
  return MIN_REORDER_POINT + (skuSeed(sku) % REORDER_POINT_STEPS) * REORDER_POINT_STEP_SIZE;
}

/** Projected arrival of the next inbound PO; null when nothing is inbound. */
export function deriveNextPoEta(sku: string, incoming: number): Date | null {
  if (incoming <= 0) return null;
  const eta = new Date();
  eta.setDate(eta.getDate() + ETA_MIN_DAYS + (skuSeed(sku) % ETA_SPREAD_DAYS));
  return eta;
}
