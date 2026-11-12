/**
 * Amazon Selling Partner API adapter (M12), merchant-fulfilled (MFN) orders.
 * Auth: Login with Amazon client ID + secret and the seller's refresh token (LWA), plus the
 * seller ID and marketplace ID. A Restricted Data Token is requested so getOrders returns the
 * buyer's shipping address (PII role). Shipments use confirmShipment; inventory patches the
 * listing's fulfillment_availability; products come from searchListingsItems.
 */
import {
  ChannelApiError, arr, fetchJson, num, rec, strOrNull,
  type AdapterContext, type ChannelAdapter, type ChannelOrder,
} from "./channel-adapter";
import type { Credentials } from "./crypto";

const LWA = "https://api.amazon.com/auth/o2/token";
export const DEFAULT_MARKETPLACE = "ATVPDKIKX0DER";
const LOOKBACK_DAYS = 30;
const MAX_ORDERS = 50;

const EU = new Set(["A1F83G8C2ARO7P", "A1PA6795UKMFR9", "A13V1IB3VIYZZH", "APJ6JRA9NG5V4", "A1RKKUPIHCS9HS", "A1805IZSGTT6HS", "A1C3SOZRARQ6R3", "A2NODRKZP88ZB9", "AMEN7PMS3EDWL", "A33AVAJ2PDY3EV", "A2VIGQ35RCS4UG", "A17E79C6D8DWNP", "ARBP9OOSHTCHU", "A21TJRUUN4KGV"]);
const FE = new Set(["A1VC38T7YXB528", "A39IBJ37TRP1C6", "A19VAU5U5O7RUS"]);

/** SP-API regional endpoint for a marketplace. */
export function spApiHost(marketplaceId: string): string {
  if (EU.has(marketplaceId)) return "https://sellingpartnerapi-eu.amazon.com";
  if (FE.has(marketplaceId)) return "https://sellingpartnerapi-fe.amazon.com";
  return "https://sellingpartnerapi-na.amazon.com";
}

interface AmazonCreds { readonly clientId: string; readonly clientSecret: string; readonly refreshToken: string; readonly sellerId: string; readonly marketplaceId: string }

function credsOf(creds: Credentials | null): AmazonCreds {
  const c = creds ?? {};
  const refreshToken = c.refreshToken ?? c.accessToken;
  if (!c.clientId || !c.clientSecret || !refreshToken) throw new ChannelApiError("Amazon needs the LWA client ID, client secret and refresh token; reconnect the store", 401);
  return { clientId: c.clientId, clientSecret: c.clientSecret, refreshToken, sellerId: c.sellerId ?? "", marketplaceId: c.marketplaceId || DEFAULT_MARKETPLACE };
}

async function lwaToken(c: AmazonCreds): Promise<string> {
  const body = rec(await fetchJson(LWA, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: c.refreshToken, client_id: c.clientId, client_secret: c.clientSecret }).toString(),
  }));
  const t = strOrNull(body.access_token);
  if (!t) throw new ChannelApiError("Amazon did not return an access token for this refresh token", 401);
  return t;
}

async function call(c: AmazonCreds, token: string, path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  return rec(await fetchJson(`${spApiHost(c.marketplaceId)}${path}`, { ...init, headers: { "x-amz-access-token": token, "content-type": "application/json", accept: "application/json", ...(init.headers ?? {}) } }));
}

/** Restricted Data Token for getOrders with the shipping address; falls back to the LWA token. */
async function ordersToken(c: AmazonCreds, token: string): Promise<string> {
  try {
    const body = await call(c, token, "/tokens/2021-03-01/restrictedDataToken", {
      method: "POST", body: JSON.stringify({ restrictedResources: [{ method: "GET", path: "/orders/v0/orders", dataElements: ["buyerInfo", "shippingAddress"] }] }),
    });
    return strOrNull(body.restrictedDataToken) ?? token;
  } catch {
    return token;
  }
}

const COUNTRY: Readonly<Record<string, string>> = { US: "United States", CA: "Canada", MX: "Mexico", GB: "United Kingdom" };

/** Maps an SP-API order + its order items to the channel order shape. */
export function amazonToOrder(o: Record<string, unknown>, items: readonly Record<string, unknown>[]): ChannelOrder {
  const a = rec(o.ShippingAddress);
  const name = strOrNull(a.Name) ?? "Customer";
  const [firstName, ...rest] = name.split(" ");
  const lines = items.map((i) => {
    const qty = num(i.QuantityOrdered);
    return { sku: strOrNull(i.SellerSKU), title: String(i.Title ?? i.SellerSKU ?? "Item"), quantity: qty, price: qty > 0 ? num(rec(i.ItemPrice).Amount) / qty : 0, requiresShipping: true, isCustom: false, fulfilledQuantity: num(i.QuantityShipped) };
  });
  const country = String(a.CountryCode ?? "US");
  return {
    id: String(o.AmazonOrderId), number: String(o.AmazonOrderId), createdAt: String(o.PurchaseDate ?? new Date().toISOString()), updatedAt: String(o.LastUpdateDate ?? o.PurchaseDate ?? new Date().toISOString()),
    financialStatus: o.OrderStatus === "Pending" ? "pending" : "paid", tags: o.IsPrime === true ? ["Prime"] : [], email: strOrNull(rec(o.BuyerInfo).BuyerEmail), locationId: null,
    hasFulfillmentOrders: o.FulfillmentChannel !== "AFN",
    shipTo: strOrNull(a.AddressLine1) ? {
      name, firstName: firstName || null, lastName: rest.join(" ") || null, company: strOrNull(a.CompanyName), line1: String(a.AddressLine1), line2: strOrNull(a.AddressLine2),
      city: String(a.City ?? ""), state: strOrNull(a.StateOrRegion), zip: String(a.PostalCode ?? ""), country: COUNTRY[country] ?? country, phone: strOrNull(a.Phone),
    } : null,
    lines, totalPrice: num(rec(o.OrderTotal).Amount), note: null, isGift: items.some((i) => i.IsGift === true || i.IsGift === "true"), raw: { ...o, OrderItems: items },
  };
}

async function withItems(c: AmazonCreds, token: string, orders: readonly Record<string, unknown>[]): Promise<ChannelOrder[]> {
  const out: ChannelOrder[] = [];
  for (const o of orders.slice(0, MAX_ORDERS)) {
    const items = arr(rec((await call(c, token, `/orders/v0/orders/${encodeURIComponent(String(o.AmazonOrderId))}/orderItems`)).payload).OrderItems).map(rec);
    out.push(amazonToOrder(o, items));
  }
  return out;
}

function requireSeller(c: AmazonCreds): string {
  if (!c.sellerId) throw new ChannelApiError("Add the Amazon seller ID to this connection to sync listings", 422);
  return c.sellerId;
}

export const amazonAdapter: ChannelAdapter = {
  key: "amazon",
  async validate(ctx) {
    const c = credsOf(ctx.credentials);
    const token = await lwaToken(c);
    const parts = arr((await call(c, token, "/sellers/v1/marketplaceParticipations")).payload).map(rec);
    const market = parts.map((p) => rec(p.marketplace)).find((m) => m.id === c.marketplaceId);
    if (parts.length > 0 && !market) throw new ChannelApiError(`This seller account does not participate in marketplace ${c.marketplaceId}`, 403);
    return { ok: true, message: `Connected to Amazon ${String(market?.name ?? c.marketplaceId)}`, locations: [{ id: "default", name: "Amazon merchant-fulfilled (MFN)" }] };
  },
  async fetchOrders(ctx, since) {
    const c = credsOf(ctx.credentials);
    const token = await lwaToken(c);
    const q = new URLSearchParams({
      MarketplaceIds: c.marketplaceId, FulfillmentChannels: "MFN", OrderStatuses: "Unshipped,PartiallyShipped",
      LastUpdatedAfter: since ?? new Date(ctx.now.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString(), MaxResultsPerPage: String(MAX_ORDERS),
    });
    const rdt = await ordersToken(c, token);
    const orders = arr(rec((await call(c, rdt, `/orders/v0/orders?${q.toString()}`)).payload).Orders).map(rec);
    return withItems(c, token, orders);
  },
  async fetchOrdersById(ctx, ids) {
    const clean = ids.filter((i) => /^\d{3}-\d{7}-\d{7}$/.test(i)).slice(0, MAX_ORDERS);
    if (clean.length === 0) return [];
    const c = credsOf(ctx.credentials);
    const token = await lwaToken(c);
    const rdt = await ordersToken(c, token);
    const q = new URLSearchParams({ MarketplaceIds: c.marketplaceId, AmazonOrderIds: clean.join(",") });
    return withItems(c, token, arr(rec((await call(c, rdt, `/orders/v0/orders?${q.toString()}`)).payload).Orders).map(rec));
  },
  async fetchProducts(ctx) {
    const c = credsOf(ctx.credentials);
    const seller = requireSeller(c);
    const token = await lwaToken(c);
    const q = new URLSearchParams({ marketplaceIds: c.marketplaceId, includedData: "summaries,offers", pageSize: "20" });
    return arr((await call(c, token, `/listings/2021-08-01/items/${encodeURIComponent(seller)}?${q.toString()}`)).items).map(rec).map((i) => {
      const summary = rec(arr(i.summaries)[0]);
      const offer = rec(arr(i.offers)[0]);
      return {
        id: String(i.sku), sku: strOrNull(i.sku), title: String(summary.itemName ?? i.sku), price: num(rec(offer.price).amount), barcode: strOrNull(summary.asin),
        weightOz: 0, imageUrl: strOrNull(rec(summary.mainImage).link),
      };
    });
  },
  async pushInventory(ctx, items) {
    const c = credsOf(ctx.credentials);
    const seller = requireSeller(c);
    const token = await lwaToken(c);
    const out: { sellerSku: string; ok: boolean; error?: string }[] = [];
    for (const i of items) {
      try {
        const res = await call(c, token, `/listings/2021-08-01/items/${encodeURIComponent(seller)}/${encodeURIComponent(i.sellerSku)}?marketplaceIds=${c.marketplaceId}`, {
          method: "PATCH", body: JSON.stringify({ productType: "PRODUCT", patches: [{ op: "replace", path: "/attributes/fulfillment_availability", value: [{ fulfillment_channel_code: "DEFAULT", quantity: i.qty }] }] }),
        });
        const ok = res.status !== "INVALID";
        out.push(ok ? { sellerSku: i.sellerSku, ok } : { sellerSku: i.sellerSku, ok, error: String(rec(arr(res.issues)[0]).message ?? "Amazon rejected the quantity") });
      } catch (e) {
        out.push({ sellerSku: i.sellerSku, ok: false, error: e instanceof Error ? e.message : "Inventory update failed" });
      }
    }
    return out;
  },
  async pushShipment(ctx, s) {
    const c = credsOf(ctx.credentials);
    const token = await lwaToken(c);
    const items = arr(rec((await call(c, token, `/orders/v0/orders/${encodeURIComponent(s.channelOrderId)}/orderItems`)).payload).OrderItems).map(rec);
    const orderItems = items.flatMap((i) => {
      const shipped = s.lines.find((x) => x.sku === i.SellerSKU);
      return shipped ? [{ orderItemId: String(i.OrderItemId), quantity: Math.min(num(i.QuantityOrdered), shipped.quantity) }] : [];
    });
    if (orderItems.length === 0) return { ok: false, error: "None of the shipped SKUs are on the Amazon order" };
    await call(c, token, `/orders/v0/orders/${encodeURIComponent(s.channelOrderId)}/shipmentConfirmation`, {
      method: "POST", body: JSON.stringify({ marketplaceId: c.marketplaceId, packageDetail: { packageReferenceId: "1", carrierCode: s.carrier, trackingNumber: s.trackingNumber, shipDate: new Date().toISOString(), orderItems } }),
    });
    return { ok: true };
  },
};
