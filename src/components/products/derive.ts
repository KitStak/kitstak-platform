import type { ListingRow, ProductRow } from "./types";

/**
 * Deterministic derivations shared by the Products list and detail views.
 * The repository list payload omits handling flags and created dates, so we
 * derive them from stable product fields — same input, same output, so
 * screenshots stay reproducible.
 */

/** Stable 32-bit FNV-1a hash. */
export function hashOf(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Fixed anchor so derived dates don't drift between renders/screenshots. */
const ANCHOR_MS = Date.UTC(2026, 10, 1, 14, 30);
const DAY_MS = 86_400_000;

const FRAGILE_HINTS = [
  "charger",
  "charging",
  "speaker",
  "earbud",
  "glass",
  "screen protector",
  "mug",
  "grinder",
  "webcam",
  "keyboard",
  "powercell",
  "puck",
  "hub",
] as const;

const HAZMAT_HINTS = ["powercell", "battery", "mah", "aerosol"] as const;

const OVERSIZED_WEIGHT_OZ = 40;
const OVERSIZED_DIM_IN = 18;

export function isFragileHint(name: string): boolean {
  const n = name.toLowerCase();
  return FRAGILE_HINTS.some((hint) => n.includes(hint));
}

export function isHazmatHint(name: string): boolean {
  const n = name.toLowerCase();
  return HAZMAT_HINTS.some((hint) => n.includes(hint));
}

export function isOversized(weightOz: number, maxDimIn?: number): boolean {
  return weightOz >= OVERSIZED_WEIGHT_OZ || (maxDimIn ?? 0) >= OVERSIZED_DIM_IN;
}

/** Deterministic "created" timestamp 90–540 days before the anchor. */
export function createdAtFor(id: string): string {
  const h = hashOf(`created:${id}`);
  const daysAgo = 90 + (h % 450);
  const minuteJitter = (h >>> 8) % 540;
  return new Date(ANCHOR_MS - daysAgo * DAY_MS - minuteJitter * 60_000).toISOString();
}

/** Soft category-tinted tile classes for the image placeholder. */
const CATEGORY_TILES: Record<string, string> = {
  Electronics: "bg-primary-soft text-primary/70",
  Coffee: "bg-warning-soft text-warning/70",
  Apparel: "bg-info-soft text-info/70",
};

const DEFAULT_TILE = "bg-neutral-soft text-neutral/70";

export function categoryTileClass(category: string): string {
  return CATEGORY_TILES[category] ?? DEFAULT_TILE;
}

/* ============ default browse ordering (Products grid) ============ */

/** Rows the first viewport shows at 1440x900; used to guarantee variety up top. */
const BROWSE_WINDOW = 12;

/**
 * If no row in the first BROWSE_WINDOW rows matches, pull the first matching
 * row up into `slot`. Pure — returns a new array (or the input when untouched).
 */
function promoteIntoWindow(
  rows: readonly ProductRow[],
  matches: (row: ProductRow) => boolean,
  slot: number
): readonly ProductRow[] {
  if (rows.slice(0, BROWSE_WINDOW).some(matches)) return rows;
  const index = rows.findIndex(matches);
  if (index === -1) return rows;
  const next = [...rows];
  const [row] = next.splice(index, 1);
  next.splice(Math.min(slot, next.length), 0, row);
  return next;
}

/**
 * Default order for the Products grid: newest first by the derived created
 * date (hash-based, so clients/categories/prices interleave instead of the
 * raw SKU-ascending payload showing a wall of identical rows), then nudge a
 * kit and an Inactive product into the first viewport when the page has one.
 * Deterministic — same rows in, same order out.
 */
export function orderForBrowsing(rows: readonly ProductRow[]): ProductRow[] {
  const byNewest = [...rows].sort(
    (a, b) =>
      createdAtFor(b.id).localeCompare(createdAtFor(a.id)) ||
      a.sku.localeCompare(b.sku)
  );
  const withKit = promoteIntoWindow(byNewest, (r) => r.isKit, 4);
  return [...promoteIntoWindow(withKit, (r) => r.status === "Inactive", 8)];
}

/* ============ channel listings (synthesized client-side) ============ */

interface ChannelDef {
  channel: string;
  suffix: string;
  store: (clientName: string) => string;
  priceFactor: number;
}

function slugOf(clientName: string): string {
  return clientName.split(/[\s—-]+/)[0]?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? "store";
}

const CHANNEL_DEFS: readonly ChannelDef[] = [
  {
    channel: "Shopify",
    suffix: "-SHOP",
    store: (c) => `${slugOf(c)}.myshopify.com`,
    priceFactor: 1,
  },
  {
    channel: "Amazon",
    suffix: "-AMZ",
    store: () => "Amazon US — FBM",
    priceFactor: 1.06,
  },
  {
    channel: "TikTok Shop",
    suffix: "-TT",
    store: () => "TikTok Shop US",
    priceFactor: 0.97,
  },
  {
    channel: "Walmart",
    suffix: "-WMT",
    store: () => "Walmart Marketplace",
    priceFactor: 1.03,
  },
];

function roundPrice(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Deterministic sync timestamp within ~48h before the anchor. */
function lastSyncedAtFor(seed: string): string {
  const h = hashOf(`sync:${seed}`);
  const minutesAgo = 20 + (h % (48 * 60));
  return new Date(ANCHOR_MS - minutesAgo * 60_000).toISOString();
}

/** Map each product to 1–3 channel listings, deterministically. */
export function synthesizeListings(rows: readonly ProductRow[]): ListingRow[] {
  return rows.flatMap((row) => {
    const h = hashOf(`listing:${row.id}`);
    const listingCount = 1 + (h % 3);
    const start = (h >>> 4) % CHANNEL_DEFS.length;
    return Array.from({ length: listingCount }, (_, i) => {
      const def = CHANNEL_DEFS[(start + i) % CHANNEL_DEFS.length];
      const seed = `${row.id}:${def.channel}`;
      const paused = row.status === "Inactive" || hashOf(seed) % 9 === 0;
      const buffer = hashOf(`buf:${seed}`) % 5;
      return {
        id: seed,
        productId: row.id,
        listingSku: `${row.sku}${def.suffix}`,
        channel: def.channel,
        store: def.store(row.clientName),
        productName: row.name,
        clientName: row.clientName,
        masterSku: row.sku,
        price: roundPrice(row.price * def.priceFactor),
        qtyAvailable: Math.max(0, row.available - buffer),
        status: paused ? "Paused" : "Live",
        lastSyncedAt: lastSyncedAtFor(seed),
      } satisfies ListingRow;
    });
  });
}

/* ============ kit components (detail page) ============ */

export interface KitComponent {
  sku: string;
  name: string;
  qty: number;
  /** Deterministic component depth so the BOM card can show stock without a repo join. */
  onHand: number;
  /** On hand − allocated − damaged, matching the availability math used everywhere else. */
  available: number;
}

/** Component stock bounds: deep enough to be believable behind a 1k+ unit kit. */
const COMPONENT_STOCK_MIN = 240;
const COMPONENT_STOCK_SPAN = 1400;
const COMPONENT_ALLOC_SPAN = 48;
const COMPONENT_DAMAGE_SPAN = 3;

/** Deterministic on-hand/available pair for a component SKU. */
function componentStockFor(sku: string): { onHand: number; available: number } {
  const onHand = COMPONENT_STOCK_MIN + (hashOf(`stock:${sku}`) % COMPONENT_STOCK_SPAN);
  const allocated = hashOf(`alloc:${sku}`) % COMPONENT_ALLOC_SPAN;
  const damaged = hashOf(`dmg:${sku}`) % COMPONENT_DAMAGE_SPAN;
  return { onHand, available: onHand - allocated - damaged };
}

/**
 * Parse kit contents from the parenthetical in seeded kit names, e.g.
 * "Desk Setup Kit (Mouse + Keyboard + Stand)" → three component rows.
 */
export function kitComponentsFor(sku: string, name: string): KitComponent[] {
  const match = /\(([^)]+)\)/.exec(name);
  const brand = name.split(" ")[0] ?? "";
  const base = sku.split("-")[0] ?? sku;
  const parts = match
    ? match[1].split(/[+,]/).map((p) => p.trim()).filter(Boolean)
    : ["Primary Unit", "Accessory Pack", "Insert Card"];
  return parts.map((part, i) => {
    const qtyMatch = /^(\d+)\s*[×x]\s*(.+)$/.exec(part);
    const label = qtyMatch ? qtyMatch[2] : part;
    const qty = qtyMatch ? Number(qtyMatch[1]) : 1;
    const slug = label.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 12);
    const componentSku = `${base}-${slug || `CMP${i + 1}`}`;
    const stock = componentStockFor(componentSku);
    return {
      sku: componentSku,
      name: brand ? `${brand} ${label}` : label,
      qty,
      onHand: stock.onHand,
      available: stock.available,
    };
  });
}
