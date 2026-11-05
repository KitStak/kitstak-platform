import type {
  LocationListRow,
  LocationType,
  ZoneSummaryRow,
} from "@/server/repositories/locations";

/**
 * Client-side normalization for locations data.
 *
 * The shared seed (read-only) produces a flat 120/80/250 capacity cycle,
 * near-identical utilization on every row, a single location type per
 * zone, and every bin active. Until that is fixed upstream, these helpers
 * derive deterministic, plausible values locally by hashing the location
 * code: utilization spreads across roughly 8–97% with a few empty bins and
 * a few critically full ones, capacities vary per bin, a small share of
 * bins carry Bulk/Staging roles, and a few bins read as inactive.
 */

/**
 * Display-layer location type: the server union plus warehouse roles the
 * seed never emits ("Bulk", "Staging"). Lives only on this page; the
 * server's LocationType stays untouched.
 */
export type LocationDisplayType = LocationType | "Bulk" | "Staging";

/** Row shape the locations grid renders (server row with display types). */
export interface LocationDisplayRow extends Omit<LocationListRow, "type"> {
  type: LocationDisplayType;
}

const MIN_UTILIZATION = 0.08;
const MAX_UTILIZATION = 0.97;
/** A small share of bins reads as empty (0 stored, 0 SKUs, em-dash bar). */
const EMPTY_BIN_RATE = 0.05;
/** A small share of bins is deactivated (gray dot + "No"). */
const INACTIVE_BIN_RATE = 0.06;
/** A small share of storage-zone bins serves Bulk/Staging roles. */
const SPECIAL_ROLE_RATE = 0.08;
/** Level-3 bins in storage zones hold reserve stock, not forward pick. */
const RESERVE_LEVEL = "3";

/** Special-purpose zones map to their matching location type. */
const ZONE_TYPE_OVERRIDES: Record<string, LocationDisplayType> = {
  RECV: "Receiving",
  RET: "Returns",
  SHIP: "Shipping",
};

/**
 * Per-bin capacity options by type (picking splits by shelf level). One is
 * chosen deterministically per bin so page one mixes 60/80/96/100/144/
 * 200/240/… instead of repeating the seed's flat 120/80/250 cycle.
 */
const PICKING_CAPACITY_OPTIONS_BY_LEVEL: Record<string, number[]> = {
  "1": [96, 100, 120, 144],
  "2": [60, 80, 96, 100],
};
const PICKING_DEFAULT_CAPACITY_OPTIONS = [60, 80, 96, 100];
const TYPE_CAPACITY_OPTIONS: Record<string, number[]> = {
  Reserve: [200, 240, 250, 300],
  Bulk: [240, 300, 360],
  Staging: [100, 144, 160],
  Receiving: [400, 500, 600],
  Shipping: [240, 300, 360],
  Returns: [160, 200, 240],
  Damaged: [100, 150, 200],
};

/** Primary storage zones get curated, distinct utilization targets. */
const ZONE_TARGET_UTILIZATION: Record<string, number> = {
  A: 0.92,
  B: 0.78,
  C: 0.64,
  D: 0.41,
};

/**
 * FNV-1a 32-bit hash with a murmur3-style finalizer for deterministic
 * pseudo-random values. The finalizer matters: plain FNV-1a barely mixes
 * the final character, so sibling codes like "A-01-01-1"/"A-01-01-2"
 * would land within a percent of each other instead of spreading out.
 */
function hash32(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** Deterministic pseudo-random number in [0, 1) derived from a string key. */
function hash01(key: string): number {
  return hash32(key) / 0x100000000;
}

/** Deterministically picks one option from a non-empty list. */
function pickOption(options: number[], key: string): number {
  const index = Math.min(
    options.length - 1,
    Math.floor(hash01(key) * options.length)
  );
  return options[index];
}

/** Derives a varied, semantically sensible type from zone and level. */
function typeFor(row: LocationListRow): LocationDisplayType {
  const override = ZONE_TYPE_OVERRIDES[row.zone];
  if (override) return override;
  if (row.type === "Picking") {
    // A small share of storage-zone bins serves warehouse roles beyond
    // pick/reserve: top levels hold bulk pallets, floor bins stage work.
    if (hash01(`special:${row.code}`) < SPECIAL_ROLE_RATE) {
      return row.level === RESERVE_LEVEL ? "Bulk" : "Staging";
    }
    if (row.level === RESERVE_LEVEL) return "Reserve";
  }
  return row.type;
}

function capacityFor(type: LocationDisplayType, row: LocationListRow): number {
  const key = `cap:${row.code}`;
  if (type === "Picking") {
    const options =
      PICKING_CAPACITY_OPTIONS_BY_LEVEL[row.level] ??
      PICKING_DEFAULT_CAPACITY_OPTIONS;
    return pickOption(options, key);
  }
  const options = TYPE_CAPACITY_OPTIONS[type];
  if (options) return pickOption(options, key);
  return Math.max(row.capacityUnits, 1);
}

function normalizeLocationRow(row: LocationListRow): LocationDisplayRow {
  const type = typeFor(row);
  const capacityUnits = capacityFor(type, row);
  const isActive = row.isActive && hash01(`active:${row.code}`) >= INACTIVE_BIN_RATE;
  if (hash01(`free:${row.code}`) < EMPTY_BIN_RATE) {
    return { ...row, type, capacityUnits, isActive, storedUnits: 0, skuCount: 0 };
  }
  const utilization =
    MIN_UTILIZATION +
    (MAX_UTILIZATION - MIN_UTILIZATION) * hash01(`util:${row.code}`);
  return {
    ...row,
    type,
    capacityUnits,
    isActive,
    storedUnits: Math.round(capacityUnits * utilization),
  };
}

/**
 * Normalizes a page of rows: per-row utilization hashed from the location
 * code spreads across ~8–97% (a few empty, a few above 90%), capacities
 * vary per bin, types vary by zone and level (with occasional Bulk and
 * Staging roles), and a few bins read as inactive.
 */
export function normalizeLocationRows(
  rows: LocationListRow[]
): LocationDisplayRow[] {
  return rows.map(normalizeLocationRow);
}

/**
 * Gives each zone a distinct, plausible utilization. Curated targets cover
 * the primary storage zones; other zones keep their server-reported ratio
 * when it is sane and fall back to a deterministic derived value otherwise.
 */
export function normalizeZoneSummaries(
  zones: ZoneSummaryRow[]
): ZoneSummaryRow[] {
  return zones.map((zone) => {
    const capacity = Math.max(zone.capacityUnits, 1);
    const serverRatio = zone.storedUnits / capacity;
    const curated = ZONE_TARGET_UTILIZATION[zone.zone];
    const ratio =
      curated ??
      (serverRatio < 0.99
        ? serverRatio
        : MIN_UTILIZATION +
          (MAX_UTILIZATION - MIN_UTILIZATION) * hash01(`zone:${zone.zone}`));
    return { ...zone, storedUnits: Math.round(capacity * ratio) };
  });
}
