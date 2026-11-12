/**
 * eBay Sell APIs adapter (M12). Auth: an OAuth user access token (scopes sell.fulfillment and
 * sell.inventory), stored as `accessToken`. Orders come from the Fulfillment API (not started /
 * in progress), shipments post a shipping fulfillment, inventory uses bulk_update_price_quantity.
 */
import {
  ChannelApiError, arr, fetchJson, num, rec, strOrNull,
  type AdapterContext, type ChannelAdapter, type ChannelOrder,
} from "./channel-adapter";

const API = "https://api.ebay.com";
const BULK = 25;

function token(ctx: Pick<AdapterContext, "credentials">): string {
  const t = ctx.credentials?.accessToken;
  if (!t) throw new ChannelApiError("eBay needs an OAuth user access token; reconnect the store", 401);
  return t;
}

async function call(ctx: Pick<AdapterContext, "credentials">, path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  return rec(await fetchJson(`${API}${path}`, {
    ...init, headers: { authorization: `Bearer ${token(ctx)}`, "content-type": "application/json", accept: "application/json", "content-language": "en-US", ...(init.headers ?? {}) },
  }));
}

const COUNTRY: Readonly<Record<string, string>> = { US: "United States", CA: "Canada", GB: "United Kingdom", AU: "Australia" };

/** Maps one Fulfillment API order to the channel order shape. */
export function ebayToOrder(o: Record<string, unknown>): ChannelOrder {
  const instr = arr(o.fulfillmentStartInstructions).map(rec);
  const shipTo = rec(rec(instr[0]?.shippingStep).shipTo);
  const addr = rec(shipTo.contactAddress);
  const fullName = strOrNull(shipTo.fullName);
  const [firstName, ...rest] = (fullName ?? "").split(" ");
  const lines = arr(o.lineItems).map(rec).map((l) => {
    const qty = num(l.quantity);
    return {
      sku: strOrNull(l.sku), title: String(l.title ?? "Item"), quantity: qty, price: qty > 0 ? num(rec(l.lineItemCost).value) / qty : 0,
      requiresShipping: true, isCustom: false, fulfilledQuantity: l.lineItemFulfillmentStatus === "FULFILLED" ? qty : 0,
    };
  });
  const country = String(addr.countryCode ?? "US");
  return {
    id: String(o.orderId), number: String(o.orderId), createdAt: String(o.creationDate ?? new Date().toISOString()), updatedAt: String(o.lastModifiedDate ?? o.creationDate ?? new Date().toISOString()),
    financialStatus: o.orderPaymentStatus === "PAID" ? "paid" : String(o.orderPaymentStatus ?? "pending").toLowerCase(),
    tags: [], email: strOrNull(rec(rec(o.buyer).buyerRegistrationAddress).email), locationId: null, hasFulfillmentOrders: instr.length > 0,
    shipTo: strOrNull(addr.addressLine1) ? {
      name: fullName ?? "Customer", firstName: firstName || null, lastName: rest.join(" ") || null, company: strOrNull(shipTo.companyName),
      line1: String(addr.addressLine1 ?? ""), line2: strOrNull(addr.addressLine2), city: String(addr.city ?? ""), state: strOrNull(addr.stateOrProvince), zip: String(addr.postalCode ?? ""),
      country: COUNTRY[country] ?? country, phone: strOrNull(rec(shipTo.primaryPhone).phoneNumber),
    } : null,
    lines, totalPrice: num(rec(rec(o.pricingSummary).total).value), note: strOrNull(o.buyerCheckoutNotes), isGift: false, raw: o,
  };
}

export const ebayAdapter: ChannelAdapter = {
  key: "ebay",
  async validate(ctx) {
    await call(ctx, "/sell/fulfillment/v1/order?limit=1");
    let locations = [{ id: "default", name: "eBay default ship-from location" }];
    try {
      const list = arr((await call(ctx, "/sell/inventory/v1/location?limit=100")).locations).map(rec);
      if (list.length > 0) locations = list.map((l) => ({ id: String(l.merchantLocationKey), name: String(l.name ?? l.merchantLocationKey) }));
    } catch {
      // Inventory locations are optional for merchant-fulfilled sellers.
    }
    return { ok: true, message: `Connected to eBay seller ${ctx.connection.storeName}`, locations };
  },
  async fetchOrders(ctx, since) {
    const filter = [`orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}`, since ? `lastmodifieddate:[${since}..]` : null].filter(Boolean).join(",");
    return arr((await call(ctx, `/sell/fulfillment/v1/order?filter=${encodeURIComponent(filter)}&limit=200`)).orders).map(rec).map(ebayToOrder);
  },
  async fetchOrdersById(ctx, ids) {
    const clean = ids.filter((i) => /^[\w-]+$/.test(i)).slice(0, 50);
    if (clean.length === 0) return [];
    return arr((await call(ctx, `/sell/fulfillment/v1/order?orderIds=${encodeURIComponent(clean.join(","))}`)).orders).map(rec).map(ebayToOrder);
  },
  async fetchProducts(ctx) {
    const items = arr((await call(ctx, "/sell/inventory/v1/inventory_item?limit=200")).inventoryItems).map(rec);
    return items.map((i) => {
      const product = rec(i.product);
      const w = rec(rec(i.packageWeightAndSize).weight);
      const unit = String(w.unit ?? "OUNCE");
      const value = num(w.value);
      return {
        id: String(i.sku), sku: strOrNull(i.sku), title: String(product.title ?? i.sku), price: 0, barcode: strOrNull(arr(product.upc)[0]) ?? strOrNull(arr(product.ean)[0]),
        weightOz: unit === "POUND" ? value * 16 : unit === "KILOGRAM" ? value * 35.274 : unit === "GRAM" ? value / 28.3495 : value, imageUrl: strOrNull(arr(product.imageUrls)[0]),
      };
    });
  },
  async pushInventory(ctx, items) {
    const out: { sellerSku: string; ok: boolean; error?: string }[] = [];
    for (let i = 0; i < items.length; i += BULK) {
      const chunk = items.slice(i, i + BULK);
      try {
        const res = await call(ctx, "/sell/inventory/v1/bulk_update_price_quantity", { method: "POST", body: JSON.stringify({ requests: chunk.map((x) => ({ sku: x.sellerSku, shipToLocationAvailability: { quantity: x.qty } })) }) });
        const responses = arr(res.responses).map(rec);
        for (const x of chunk) {
          const r = responses.find((y) => y.sku === x.sellerSku);
          const ok = r ? num(r.statusCode) < 300 : true;
          out.push(ok ? { sellerSku: x.sellerSku, ok } : { sellerSku: x.sellerSku, ok, error: String(rec(arr(r?.errors)[0]).message ?? "eBay rejected the quantity") });
        }
      } catch (e) {
        for (const x of chunk) out.push({ sellerSku: x.sellerSku, ok: false, error: e instanceof Error ? e.message : "Inventory update failed" });
      }
    }
    return out;
  },
  async pushShipment(ctx, s) {
    const order = await call(ctx, `/sell/fulfillment/v1/order/${encodeURIComponent(s.channelOrderId)}`);
    const lineItems = arr(order.lineItems).map(rec).flatMap((l) => {
      const shipped = s.lines.find((x) => x.sku === l.sku);
      return shipped ? [{ lineItemId: String(l.lineItemId), quantity: Math.min(num(l.quantity), shipped.quantity) }] : [];
    });
    if (lineItems.length === 0) return { ok: false, error: "None of the shipped SKUs are on the eBay order" };
    await call(ctx, `/sell/fulfillment/v1/order/${encodeURIComponent(s.channelOrderId)}/shipping_fulfillment`, {
      method: "POST", body: JSON.stringify({ lineItems, shippedDate: new Date().toISOString(), shippingCarrierCode: s.carrier, trackingNumber: s.trackingNumber }),
    });
    return { ok: true };
  },
};
