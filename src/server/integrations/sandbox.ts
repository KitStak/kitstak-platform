/**
 * KitStak Sandbox store (M12): a deterministic, Shopify-shaped channel so every screen has real
 * data paths without credentials. Traffic is a pure function of (connection id, run number):
 * - 2–6 orders per run (every 7th run returns no data), mostly paid, real client SKUs;
 * - scheduled runs sell only the client's real SKUs, so monitoring stays green during a demo;
 * - "Simulate error" (Channel Methods › Download Orders, sandbox only) runs once with
 *   `ctx.simulateError`: its first order carries an unknown SKU ("<PREFIX>-SIM-<run>", order id
 *   "sbx-<run>-0-sim", payload `simulated: true`) so Missing Orders and Retry Download can be
 *   exercised on demand; create that SKU and the retry succeeds. Pre-R5 rows ("sbx-<run>-0")
 *   re-fetch without the unknown SKU, so Retry Download clears them.
 * - every 4th run's second order ships to a PO Box, so workflows have something to block.
 */
import type { AdapterContext, ChannelAdapter, ChannelLocation, ChannelOrder, ChannelProduct } from "./channel-adapter";

export const SANDBOX_KEY = "kitstaks-sandbox";
export const SANDBOX_LOCATIONS: readonly ChannelLocation[] = [
  { id: "sbx-loc-main", name: "Main Street Fulfillment" },
  { id: "sbx-loc-popup", name: "SoHo Pop-up Store" },
];

export interface SandboxSku { readonly sku: string; readonly title: string; readonly price: number }

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PEOPLE = [
  ["Olivia", "Martinez"], ["Liam", "Johnson"], ["Emma", "Nguyen"], ["Noah", "Williams"], ["Ava", "Patel"], ["Mason", "Brown"],
  ["Sophia", "Kim"], ["Ethan", "Davis"], ["Isabella", "Garcia"], ["Lucas", "Wilson"], ["Mia", "Anderson"], ["Elijah", "Thomas"],
] as const;
const PLACES = [
  ["742 Evergreen Terrace", "Springfield", "IL", "62704"], ["1600 Amphitheatre Pkwy", "Mountain View", "CA", "94043"],
  ["350 Fifth Ave", "New York", "NY", "10118"], ["233 S Wacker Dr", "Chicago", "IL", "60606"], ["1 Microsoft Way", "Redmond", "WA", "98052"],
  ["400 Broad St", "Seattle", "WA", "98109"], ["600 Congress Ave", "Austin", "TX", "78701"], ["100 Peachtree St NW", "Atlanta", "GA", "30303"],
  ["2 Harbor Dr", "Boston", "MA", "02210"], ["1200 Getty Center Dr", "Los Angeles", "CA", "90049"],
] as const;

const prefixOf = (sku: string) => (sku.includes("-") ? sku.split("-")[0] : sku.slice(0, 3)).toUpperCase();

/**
 * Demo feed options: a seeded store of a live channel (Shopify, ShipStation…) saved without
 * credentials runs on this same deterministic feed until real credentials are added. It keeps the
 * store's own mapped locations and existing listing ids, and its scheduled traffic is sparse
 * (1–2 orders on every 4th run) so a demo workspace does not fill up with orders.
 */
export interface SandboxOptions {
  readonly demo?: boolean;
  readonly locations?: readonly ChannelLocation[];
  /** SKU → existing channel product id, so Download Products updates listings instead of duplicating them. */
  readonly listingIds?: ReadonlyMap<string, string>;
}

/** Orders a feed returns for one run (pure; exported for tests). */
export function feedOrderCount(connectionId: string, run: number, opts: { readonly demo?: boolean; readonly manual?: boolean; readonly simulateError?: boolean }): number {
  const h = hash(`${connectionId}:${run}`);
  if (opts.simulateError) return 2 + (h % 5);
  if (opts.demo) {
    if (opts.manual) return 1 + (h % 3);
    return run % 4 === 0 ? 1 + (h % 2) : 0;
  }
  return run % 7 === 0 ? 0 : 2 + (h % 5);
}

function buildOrder(ctx: AdapterContext, skus: readonly SandboxSku[], run: number, index: number, simulated = false, locationId = "sbx-loc-main"): ChannelOrder {
  const r = rng(hash(`${ctx.connection.id}:${run}:${index}`));
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(r() * list.length)] as T;
  const [first, last] = pick(PEOPLE);
  const [street, city, state, zip] = pick(PLACES);
  const poBox = run % 4 === 1 && index === 1;
  const unknown = simulated && index === 0;
  const lineCount = 1 + Math.floor(r() * 3);
  const chosen = new Set<SandboxSku>();
  while (chosen.size < Math.min(lineCount, skus.length)) chosen.add(pick(skus));
  const lines = [...chosen].map((p) => ({ sku: p.sku, title: p.title, quantity: 1 + Math.floor(r() * 3), price: p.price, requiresShipping: true, isCustom: false, fulfilledQuantity: 0 }));
  if (unknown) {
    const prefix = prefixOf(skus[0]?.sku ?? "SBX");
    lines.push({ sku: `${prefix}-SIM-${run}`, title: `Simulated unknown SKU #${run}`, quantity: 1, price: 34, requiresShipping: true, isCustom: false, fulfilledQuantity: 0 });
  }
  const created = new Date(ctx.now.getTime() - (6 - index) * 60_000);
  const number = `#${21000 + run * 8 + index}`;
  const id = unknown ? `sbx-${run}-${index}-sim` : `sbx-${run}-${index}`;
  const financialStatus = r() < 0.12 ? "pending" : "paid";
  const tags = r() < 0.15 ? ["wholesale"] : r() < 0.2 ? ["vip"] : [];
  const shipTo = {
    name: `${first} ${last}`, firstName: first, lastName: last, company: null,
    line1: poBox ? `PO Box ${1000 + Math.floor(r() * 8999)}` : street, line2: null, city, state, zip, country: "United States", phone: `555${String(1000000 + Math.floor(r() * 8999999))}`,
  };
  const total = Math.round(lines.reduce((s, l) => s + l.price * l.quantity, 0) * 100) / 100;
  const raw = {
    id: `gid://shopify/Order/${5700000000 + run * 10 + index}`, name: number, created_at: created.toISOString(), updated_at: created.toISOString(),
    financial_status: financialStatus, fulfillment_status: null, tags: tags.join(", "), email: `${first}.${last}@example.com`.toLowerCase(), total_price: total.toFixed(2), currency: "USD",
    shipping_address: { first_name: first, last_name: last, address1: shipTo.line1, city, province_code: state, zip, country: "United States", phone: shipTo.phone },
    line_items: lines.map((l, i) => ({ id: 14000000000 + run * 100 + index * 10 + i, sku: l.sku, title: l.title, quantity: l.quantity, price: l.price.toFixed(2), requires_shipping: true, fulfillable_quantity: l.quantity })),
    fulfillment_orders: [{ id: 6100000000 + run * 10 + index, status: "open", assigned_location_id: locationId }],
    source: "KitStak Sandbox",
    kitstaks_ref: id,
    ...(unknown ? { simulated: true, note: "Simulated error order (KitStak Sandbox): one SKU does not exist on purpose." } : {}),
  };
  return {
    id, number, createdAt: created.toISOString(), updatedAt: created.toISOString(), financialStatus, tags, email: raw.email, locationId,
    hasFulfillmentOrders: true, shipTo, lines, totalPrice: total, note: null, isGift: false, raw,
  };
}

/** Catalog the sandbox sells: the client's own active SKUs (passed in by the runtime). */
export function sandboxAdapter(skus: readonly SandboxSku[], opts: SandboxOptions = {}): ChannelAdapter {
  const locations = opts.locations && opts.locations.length > 0 ? opts.locations : SANDBOX_LOCATIONS;
  const locationId = locations[0]?.id ?? "sbx-loc-main";
  return {
    key: SANDBOX_KEY,
    async validate() {
      return { ok: true, message: opts.demo ? "Demo feed is ready (no store credentials yet)" : "KitStak Sandbox store is ready", locations };
    },
    async fetchOrders(ctx) {
      if (skus.length === 0) return [];
      const count = feedOrderCount(ctx.connection.id, ctx.runNumber, { demo: opts.demo, manual: ctx.manual, simulateError: ctx.simulateError });
      return Array.from({ length: count }, (_, i) => buildOrder(ctx, skus, ctx.runNumber, i, ctx.simulateError === true, locationId));
    },
    async fetchOrdersById(ctx, ids) {
      return ids.flatMap((id) => {
        const m = /^sbx-(\d+)-(\d+)(-sim)?$/.exec(id);
        return m ? [buildOrder(ctx, skus, Number(m[1]), Number(m[2]), Boolean(m[3]), locationId)] : [];
      });
    },
    async fetchProducts(): Promise<readonly ChannelProduct[]> {
      return skus.map((s, i) => ({ id: opts.listingIds?.get(s.sku) ?? `sbx-var-${hash(s.sku)}`, sku: s.sku, title: s.title, price: s.price, barcode: null, weightOz: 8 + (i % 5) * 4, imageUrl: null }));
    },
    async pushInventory(_ctx, items) {
      return items.map((i) => ({ sellerSku: i.sellerSku, ok: true }));
    },
    async pushShipment() {
      return { ok: true };
    },
  };
}
