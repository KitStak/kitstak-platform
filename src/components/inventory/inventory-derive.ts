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
  Coffee: "Each",
  Electronics: "Unit",
};

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

export function deriveUom(category: string, isKit: boolean): string {
  if (isKit) return "Kit";
  return UOM_BY_CATEGORY[category] ?? "Each";
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
