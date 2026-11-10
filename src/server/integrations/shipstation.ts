/** ShipStation API adapter (M12): Basic auth with API key + secret (v1 REST). */
import {
  ChannelApiError, arr, fetchJson, num, rec, strOrNull, type AdapterContext, type ChannelAdapter, type ChannelOrder,
} from "./channel-adapter";
import type { Credentials } from "./crypto";

const BASE = "https://ssapi.shipstation.com";

function auth(creds: Credentials | null): string {
  const key = creds?.accessToken ?? creds?.clientId;
  const secret = creds?.clientSecret ?? creds?.apiSecret;
  if (!key || !secret) throw new ChannelApiError("ShipStation needs an API key and API secret; reconnect the store", 401);
  return `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`;
}

const get = async (creds: Credentials | null, path: string) => rec(await fetchJson(`${BASE}${path}`, { headers: { authorization: auth(creds) } }));

function toOrder(o: Record<string, unknown>): ChannelOrder {
  const ship = rec(o.shipTo);
  return {
    id: String(o.orderId), number: String(o.orderNumber ?? o.orderId), createdAt: String(o.createDate ?? o.orderDate ?? new Date().toISOString()), updatedAt: String(o.modifyDate ?? o.createDate ?? new Date().toISOString()),
    financialStatus: o.paymentDate ? "paid" : "pending", tags: arr(o.tagIds).map(String), email: strOrNull(o.customerEmail), locationId: strOrNull(rec(o.advancedOptions).warehouseId),
    hasFulfillmentOrders: true,
    shipTo: Object.keys(ship).length > 0 ? {
      name: String(ship.name ?? "Customer"), company: strOrNull(ship.company), line1: String(ship.street1 ?? ""), line2: strOrNull(ship.street2), city: String(ship.city ?? ""),
      state: strOrNull(ship.state), zip: String(ship.postalCode ?? ""), country: String(ship.country ?? "US") === "US" ? "United States" : String(ship.country), phone: strOrNull(ship.phone),
    } : null,
    lines: arr(o.items).map(rec).map((l) => ({ sku: strOrNull(l.sku), title: String(l.name ?? "Item"), quantity: num(l.quantity), price: num(l.unitPrice), requiresShipping: true, isCustom: false, fulfilledQuantity: 0 })),
    totalPrice: num(o.orderTotal), note: strOrNull(o.customerNotes), isGift: o.gift === true, raw: o,
  };
}

export const shipstationAdapter: ChannelAdapter = {
  key: "shipstation",
  async validate(ctx) {
    const stores = arr(await fetchJson(`${BASE}/stores`, { headers: { authorization: auth(ctx.credentials) } })).map(rec);
    const warehouses = arr(await fetchJson(`${BASE}/warehouses`, { headers: { authorization: auth(ctx.credentials) } })).map(rec);
    return { ok: true, message: `Connected · ${stores.length} store${stores.length === 1 ? "" : "s"}`, locations: warehouses.map((w) => ({ id: String(w.warehouseId), name: String(w.warehouseName) })) };
  },
  async fetchOrders(ctx: AdapterContext, since) {
    const q = new URLSearchParams({ orderStatus: "awaiting_shipment", pageSize: "500" });
    if (since) q.set("modifyDateStart", since.slice(0, 19));
    return arr((await get(ctx.credentials, `/orders?${q.toString()}`)).orders).map(rec).map(toOrder);
  },
  async fetchOrdersById(ctx, ids) {
    const out: ChannelOrder[] = [];
    for (const id of ids) out.push(toOrder(await get(ctx.credentials, `/orders/${encodeURIComponent(id)}`)));
    return out;
  },
  async fetchProducts(ctx) {
    return arr((await get(ctx.credentials, "/products?pageSize=500")).products).map(rec).map((p) => ({
      id: String(p.productId), sku: strOrNull(p.sku), title: String(p.name ?? p.sku ?? "Product"), price: num(p.price), barcode: strOrNull(p.upc), weightOz: num(p.weightOz), imageUrl: strOrNull(p.thumbnailUrl),
    }));
  },
  async pushInventory(_ctx, items) {
    return items.map((i) => ({ sellerSku: i.sellerSku, ok: false, error: "ShipStation does not hold store inventory; sync inventory from the store integration instead" }));
  },
  async pushShipment(ctx, s) {
    await fetchJson(`${BASE}/orders/markasshipped`, {
      method: "POST", headers: { authorization: auth(ctx.credentials), "content-type": "application/json" },
      body: JSON.stringify({ orderId: Number(s.channelOrderId), carrierCode: s.carrier.toLowerCase(), trackingNumber: s.trackingNumber, notifyCustomer: true, notifySalesChannel: true }),
    });
    return { ok: true };
  },
};
