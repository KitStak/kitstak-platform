/**
 * Etsy Open API v3 adapter (M12). Auth: the app keystring (`x-api-key`) plus a seller's
 * OAuth 2.0 access token (`Authorization: Bearer`, scopes transactions_r/w, listings_r/w),
 * stored as `apiKey` / `accessToken`, and the numeric shop ID (`shopId`).
 * Paid, unshipped receipts are downloaded; Send Shipment Info posts tracking to the
 * receipt (Etsy marks it shipped); inventory updates the listing offering quantity per SKU.
 */
import {
  ChannelApiError, arr, fetchJson, num, rec, strOrNull,
  type AdapterContext, type ChannelAdapter, type ChannelOrder, type ChannelProduct,
} from "./channel-adapter";
import type { Credentials } from "./crypto";

const BASE = "https://openapi.etsy.com/v3/application";
const PAGE_SIZE = 100;
const MAX_PAGES = 5;

type Ctx = Pick<AdapterContext, "connection" | "credentials">;

function auth(creds: Credentials | null): { apiKey: string; token: string; shopId: string } {
  const apiKey = creds?.apiKey;
  const token = creds?.accessToken;
  const shopId = creds?.shopId?.trim();
  if (!apiKey || !(token || creds?.refreshToken) || !shopId) throw new ChannelApiError("Etsy needs the app keystring, an OAuth access token and the shop ID; reconnect the store", 401);
  if (!/^\d+$/.test(shopId)) throw new ChannelApiError("The Etsy shop ID is numeric", 400);
  return { apiKey, token: token ?? "", shopId };
}

/** Etsy access tokens last one hour; with a refresh token (90 days) they are renewed in memory. */
const tokenCache = new Map<string, { token: string; expiresAt: number }>();
/** Per connection and credential (a rotated token starts fresh); never for the unsaved validation draft. */
const cacheKey = (ctx: Ctx): string | null => (ctx.connection.id === "draft" ? null : `${ctx.connection.id}|${(ctx.credentials?.refreshToken ?? "").slice(-16)}`);
async function bearerToken(ctx: Ctx, apiKey: string, token: string): Promise<string> {
  const refresh = ctx.credentials?.refreshToken;
  if (!refresh) return token;
  const hit = (cacheKey(ctx) ? tokenCache.get(cacheKey(ctx) as string) : undefined);
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token;
  const body = rec(await fetchJson("https://api.etsy.com/v3/public/oauth/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: apiKey, refresh_token: refresh }).toString(),
  }));
  const next = strOrNull(body.access_token);
  if (!next) throw new ChannelApiError("Etsy refused the refresh token; reconnect the shop", 401);
  if (cacheKey(ctx)) tokenCache.set(cacheKey(ctx) as string, { token: next, expiresAt: Date.now() + num(body.expires_in, 3600) * 1000 });
  return next;
}

async function call(ctx: Ctx, path: string, init: RequestInit = {}): Promise<unknown> {
  const { apiKey, shopId, token: given } = auth(ctx.credentials);
  const token = await bearerToken(ctx, apiKey, given);
  return fetchJson(`${BASE}${path.replace("{shop}", shopId)}`, {
    ...init, headers: { "x-api-key": apiKey, authorization: `Bearer ${token}`, accept: "application/json", "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

/** Etsy money: { amount: 1999, divisor: 100 }. */
export const etsyMoney = (v: unknown): number => {
  const m = rec(v);
  const d = num(m.divisor, 100) || 100;
  return Math.round((num(m.amount) / d) * 100) / 100;
};
const fromUnix = (v: unknown): string => (num(v) > 0 ? new Date(num(v) * 1000).toISOString() : new Date().toISOString());

export function etsyToOrder(r: Record<string, unknown>): ChannelOrder {
  const name = strOrNull(r.name) ?? "Customer";
  const [first, ...rest] = name.split(/\s+/);
  return {
    id: String(r.receipt_id), number: `#${String(r.receipt_id)}`, createdAt: fromUnix(r.create_timestamp ?? r.created_timestamp), updatedAt: fromUnix(r.update_timestamp ?? r.updated_timestamp ?? r.create_timestamp),
    financialStatus: r.is_paid === true ? "paid" : "pending", tags: [], email: strOrNull(r.buyer_email), locationId: null, hasFulfillmentOrders: true,
    shipTo: strOrNull(r.first_line) ? {
      name, firstName: first ?? null, lastName: rest.join(" ") || null, company: null, line1: String(r.first_line), line2: strOrNull(r.second_line),
      city: String(r.city ?? ""), state: strOrNull(r.state), zip: String(r.zip ?? ""), country: String(r.country_iso ?? "US") === "US" ? "United States" : String(r.country_iso), phone: null,
    } : null,
    lines: arr(r.transactions).map(rec).map((t) => ({
      sku: strOrNull(t.sku), title: String(t.title ?? "Item"), quantity: num(t.quantity), price: etsyMoney(t.price),
      requiresShipping: t.is_digital !== true, isCustom: !num(t.listing_id), fulfilledQuantity: t.shipped_timestamp ? num(t.quantity) : 0,
    })),
    totalPrice: etsyMoney(r.grandtotal), note: strOrNull(r.message_from_buyer), isGift: r.is_gift === true, raw: r,
  };
}

async function offsetPages(ctx: Ctx, path: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const body = rec(await call(ctx, `${path}${sep}limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`));
    const batch = arr(body.results).map(rec);
    out.push(...batch);
    if (batch.length < PAGE_SIZE || out.length >= num(body.count)) break;
  }
  return out;
}

/** Listing inventory → one product per offering SKU; id = "listingId:productId". */
export function etsyProducts(listing: Record<string, unknown>, inventory: Record<string, unknown>): ChannelProduct[] {
  const image = strOrNull(rec(arr(listing.images)[0]).url_570xN);
  return arr(inventory.products).map(rec).filter((p) => p.is_deleted !== true).map((p) => {
    const offering = rec(arr(p.offerings)[0]);
    const values = arr(p.property_values).map(rec).flatMap((v) => arr(v.values).map(String));
    return {
      id: `${String(listing.listing_id)}:${String(p.product_id)}`, sku: strOrNull(p.sku), price: etsyMoney(offering.price), barcode: null, weightOz: 0, imageUrl: image,
      title: values.length > 0 ? `${String(listing.title ?? "Listing")} — ${values.join(" / ")}` : String(listing.title ?? "Listing"),
    };
  });
}

export const etsyAdapter: ChannelAdapter = {
  key: "etsy",
  async validate(ctx) {
    const shop = rec(await call(ctx, "/shops/{shop}"));
    return { ok: true, message: `Connected to ${String(shop.shop_name ?? ctx.connection.storeName)}`, locations: [{ id: "default", name: `${String(shop.shop_name ?? "Etsy shop")} (single location)` }] };
  },
  async fetchOrders(ctx, since) {
    const q = new URLSearchParams({ was_paid: "true", was_shipped: "false", was_canceled: "false", sort_on: "created", sort_order: "asc" });
    if (since) q.set("min_last_modified", String(Math.floor(new Date(since).getTime() / 1000)));
    return (await offsetPages(ctx, `/shops/{shop}/receipts?${q.toString()}`)).map(etsyToOrder);
  },
  async fetchOrdersById(ctx, ids) {
    const out: ChannelOrder[] = [];
    for (const raw of ids) {
      const id = raw.replace(/^#/, "");
      if (!/^\d+$/.test(id)) continue;
      out.push(etsyToOrder(rec(await call(ctx, `/shops/{shop}/receipts/${id}`))));
    }
    return out;
  },
  async fetchProducts(ctx) {
    const listings = await offsetPages(ctx, "/shops/{shop}/listings/active?includes=Images");
    const out: ChannelProduct[] = [];
    for (const l of listings) {
      if (l.is_digital === true) continue;
      out.push(...etsyProducts(l, rec(await call(ctx, `/listings/${String(l.listing_id)}/inventory`))));
    }
    return out;
  },
  async pushInventory(ctx, items) {
    // Etsy replaces a listing's whole inventory: group by listing, edit quantities, PUT once.
    const byListing = new Map<string, typeof items[number][]>();
    for (const i of items) {
      const listing = i.channelProductId.split(":")[0] ?? "";
      byListing.set(listing, [...(byListing.get(listing) ?? []), i]);
    }
    const out: { sellerSku: string; ok: boolean; error?: string }[] = [];
    for (const [listing, group] of byListing) {
      try {
        const inv = rec(await call(ctx, `/listings/${listing}/inventory`));
        const qty = new Map(group.map((g) => [g.channelProductId.split(":")[1] ?? "", g.qty]));
        const products = arr(inv.products).map(rec).filter((p) => p.is_deleted !== true).map((p) => ({
          sku: p.sku ?? "", property_values: arr(p.property_values).map(rec).map((v) => ({ property_id: v.property_id, value_ids: v.value_ids, scale_id: v.scale_id ?? null, property_name: v.property_name, values: v.values })),
          offerings: arr(p.offerings).map(rec).map((o) => ({ price: etsyMoney(o.price), quantity: qty.get(String(p.product_id)) ?? num(o.quantity), is_enabled: o.is_enabled !== false })),
        }));
        await call(ctx, `/listings/${listing}/inventory`, { method: "PUT", body: JSON.stringify({ products, price_on_property: inv.price_on_property ?? [], quantity_on_property: inv.quantity_on_property ?? [], sku_on_property: inv.sku_on_property ?? [] }) });
        for (const g of group) out.push({ sellerSku: g.sellerSku, ok: true });
      } catch (e) {
        for (const g of group) out.push({ sellerSku: g.sellerSku, ok: false, error: e instanceof Error ? e.message : "Inventory update failed" });
      }
    }
    return out;
  },
  async pushShipment(ctx, s) {
    const id = s.channelOrderId.replace(/^#/, "");
    await call(ctx, `/shops/{shop}/receipts/${id}/tracking`, { method: "POST", body: JSON.stringify({ tracking_code: s.trackingNumber, carrier_name: s.carrier, send_bcc: false }) });
    return { ok: true };
  },
};
