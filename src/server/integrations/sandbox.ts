/**
 * KitStaks Sandbox store (M12): a deterministic, Shopify-shaped channel so every screen has real
 * data paths without credentials. Traffic is a pure function of (connection id, run number):
 * - 2–6 orders per run (every 7th run returns no data), mostly paid, real client SKUs;
 * - every 3rd run's first order carries an unknown SKU ("<PREFIX>-NEW-<run>") so Missing Orders
 *   and Retry Download can be exercised; create that SKU and the retry succeeds;
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

function buildOrder(ctx: AdapterContext, skus: readonly SandboxSku[], run: number, index: number): ChannelOrder {
  const r = rng(hash(`${ctx.connection.id}:${run}:${index}`));
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(r() * list.length)] as T;
  const [first, last] = pick(PEOPLE);
  const [street, city, state, zip] = pick(PLACES);
  const poBox = run % 4 === 1 && index === 1;
  const unknown = run % 3 === 0 && index === 0;
  const lineCount = 1 + Math.floor(r() * 3);
  const chosen = new Set<SandboxSku>();
  while (chosen.size < Math.min(lineCount, skus.length)) chosen.add(pick(skus));
  const lines = [...chosen].map((p) => ({ sku: p.sku, title: p.title, quantity: 1 + Math.floor(r() * 3), price: p.price, requiresShipping: true, isCustom: false, fulfilledQuantity: 0 }));
  if (unknown) {
    const prefix = prefixOf(skus[0]?.sku ?? "SBX");
    lines.push({ sku: `${prefix}-NEW-${run}`, title: `Limited drop #${run}`, quantity: 1, price: 34, requiresShipping: true, isCustom: false, fulfilledQuantity: 0 });
  }
  const created = new Date(ctx.now.getTime() - (6 - index) * 60_000);
  const number = `#${21000 + run * 8 + index}`;
  const id = `sbx-${run}-${index}`;
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
    fulfillment_orders: [{ id: 6100000000 + run * 10 + index, status: "open", assigned_location_id: "sbx-loc-main" }],
    source: "KitStaks Sandbox",
    kitstaks_ref: `sbx-${run}-${index}`,
  };
  return {
    id, number, createdAt: created.toISOString(), updatedAt: created.toISOString(), financialStatus, tags, email: raw.email, locationId: "sbx-loc-main",
    hasFulfillmentOrders: true, shipTo, lines, totalPrice: total, note: null, isGift: false, raw,
  };
}

/** Catalog the sandbox sells: the client's own active SKUs (passed in by the runtime). */
export function sandboxAdapter(skus: readonly SandboxSku[]): ChannelAdapter {
  return {
    key: SANDBOX_KEY,
    async validate() {
      return { ok: true, message: "KitStaks Sandbox store is ready", locations: SANDBOX_LOCATIONS };
    },
    async fetchOrders(ctx) {
      if (skus.length === 0 || ctx.runNumber % 7 === 0) return [];
      const count = 2 + (hash(`${ctx.connection.id}:${ctx.runNumber}`) % 5);
      return Array.from({ length: count }, (_, i) => buildOrder(ctx, skus, ctx.runNumber, i));
    },
    async fetchOrdersById(ctx, ids) {
      return ids.flatMap((id) => {
        const m = /^sbx-(\d+)-(\d+)$/.exec(id);
        return m ? [buildOrder(ctx, skus, Number(m[1]), Number(m[2]))] : [];
      });
    },
    async fetchProducts(): Promise<readonly ChannelProduct[]> {
      return skus.map((s, i) => ({ id: `sbx-var-${hash(s.sku)}`, sku: s.sku, title: s.title, price: s.price, barcode: null, weightOz: 8 + (i % 5) * 4, imageUrl: null }));
    },
    async pushInventory(_ctx, items) {
      return items.map((i) => ({ sellerSku: i.sellerSku, ok: true }));
    },
    async pushShipment() {
      return { ok: true };
    },
  };
}
