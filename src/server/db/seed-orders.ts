/**
 * Shipment-order generation for the seed script (pure functions, no DB).
 * "Today" is anchored at 2026-11-05 so screenshots stay stable.
 */
import type { orderLines, shipmentOrders } from "./schema";
import {
  CARRIER_SEEDS,
  CHANNEL_WEIGHTS,
  FIRST_NAMES,
  INTL_CITIES,
  LAST_NAMES,
  Rng,
  STREET_NAMES,
  STREET_SUFFIXES,
  US_CITIES,
  storeNameFor,
  storeOrderNumberFor,
  type Channel,
} from "./seed-data";

export type OrderInsert = typeof shipmentOrders.$inferInsert;
export type OrderLineInsert = typeof orderLines.$inferInsert;

export const ANCHOR_UTC = Date.UTC(2026, 10, 5, 16, 0, 0);

export function isoDaysAgo(days: number, hour: number, minute: number): string {
  const base = ANCHOR_UTC - days * 86_400_000;
  const d = new Date(base);
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString();
}

export function isoShift(fromIso: string, hours: number): string {
  const t = new Date(fromIso).getTime() + hours * 3_600_000;
  return new Date(Math.min(t, ANCHOR_UTC - 1_800_000)).toISOString();
}

type OrderStatus = OrderInsert["status"];

const STAGE_INDEX: Record<string, number> = {
  Open: 0,
  "Ready to Pick": 1,
  "Picking Started": 2,
  "Ready to Pack": 3,
  "Packing Started": 4,
  "Ready to Ship": 5,
  Shipped: 6,
  Delivered: 7,
};

function pickStatus(rng: Rng, dayOffset: number): OrderStatus {
  if (dayOffset >= 4) {
    return rng.weighted<OrderStatus>([
      ["Delivered", 72],
      ["Shipped", 19],
      ["Cancelled", 5],
      ["On Hold", 2],
      ["Shortage", 2],
    ]);
  }
  if (dayOffset >= 2) {
    return rng.weighted<OrderStatus>([
      ["Shipped", 52],
      ["Delivered", 14],
      ["Ready to Ship", 6],
      ["Packing Started", 5],
      ["Ready to Pack", 5],
      ["Picking Started", 4],
      ["Ready to Pick", 5],
      ["Open", 3],
      ["Shortage", 3],
      ["Cancelled", 3],
    ]);
  }
  return rng.weighted<OrderStatus>([
    ["Open", 24],
    ["Ready to Pick", 22],
    ["Picking Started", 12],
    ["Ready to Pack", 10],
    ["Packing Started", 8],
    ["Ready to Ship", 8],
    ["Shipped", 9],
    ["Shortage", 4],
    ["On Hold", 3],
  ]);
}

export interface ProductRef {
  id: string;
  clientId: string;
  price: number;
  weightOz: number;
  isKit: boolean;
}

export interface ClientRef {
  id: string;
  name: string;
  weight: number;
}

const B2B_CUSTOMERS: readonly string[] = [
  "Westfield Outfitters",
  "Prairie Goods Market",
  "Harbor North Retail Group",
  "Cobalt Supply Co.",
  "Red Rock Mercantile",
  "Lakeland Hardware & Home",
];

const EMAIL_DOMAINS: readonly string[] = ["gmail.com", "yahoo.com", "outlook.com", "icloud.com"];

export interface OrderBundle {
  orders: OrderInsert[];
  lines: OrderLineInsert[];
}

export function buildOrders(
  rng: Rng,
  warehouseId: string,
  clientRefs: readonly ClientRef[],
  productsByClient: ReadonlyMap<string, readonly ProductRef[]>,
  pickJobIds: readonly string[]
): OrderBundle {
  const orders: OrderInsert[] = [];
  const lines: OrderLineInsert[] = [];
  const clientWeights = clientRefs.map((c) => [c, c.weight] as const);
  let rmaCount = 0;

  for (let i = 0; i < 420; i += 1) {
    const client = rng.weighted(clientWeights);
    const catalog = productsByClient.get(client.id) ?? [];
    if (catalog.length === 0) continue;

    const channel = rng.weighted<Channel>(CHANNEL_WEIGHTS);
    const isB2B = channel === "Wholesale";
    const dayOffset = rng.int(0, 29);
    const status = pickStatus(rng, dayOffset);
    const stage = STAGE_INDEX[status] ?? -1;
    const orderDate = isoDaysAgo(dayOffset, rng.int(6, 20), rng.int(0, 59));

    const lineCount = isB2B ? rng.int(2, 5) : rng.weighted([[1, 60], [2, 30], [3, 10]]);
    const chosen: ProductRef[] = [];
    const used = new Set<number>();
    while (chosen.length < Math.min(lineCount, catalog.length)) {
      const idx = rng.int(0, catalog.length - 1);
      if (!used.has(idx)) {
        used.add(idx);
        chosen.push(catalog[idx]);
      }
    }

    const orderId = `so-${String(i + 1).padStart(4, "0")}`;
    let totalQuantity = 0;
    let totalWeightOz = 0;
    let salesPrice = 0;
    const orderLineRows: OrderLineInsert[] = chosen.map((p, li) => {
      const qty = isB2B ? rng.int(12, 60) : p.isKit ? 1 : rng.int(1, 3);
      totalQuantity += qty;
      totalWeightOz += qty * p.weightOz;
      salesPrice += qty * p.price;
      const fullyPicked = stage >= 3 || status === "Shipped" || status === "Delivered";
      const partialPick = status === "Picking Started" || status === "Shortage";
      const picked = fullyPicked ? qty : partialPick ? Math.max(0, qty - rng.int(1, qty)) : 0;
      const fullyPacked = stage >= 5;
      const packed = fullyPacked ? qty : status === "Packing Started" && li === 0 ? Math.min(qty, rng.int(0, qty)) : 0;
      return {
        id: `sol-${String(i + 1).padStart(4, "0")}-${li + 1}`,
        orderId,
        productId: p.id,
        quantity: qty,
        pickedQuantity: picked,
        packedQuantity: packed,
        unitPrice: p.price,
      };
    });

    const city =
      (channel === "Shopify" || channel === "Manual") && rng.chance(0.07)
        ? rng.pick(INTL_CITIES)
        : rng.pick(US_CITIES);
    const first = rng.pick(FIRST_NAMES);
    const last = rng.pick(LAST_NAMES);
    const customerName = isB2B ? rng.pick(B2B_CUSTOMERS) : `${first} ${last}`;
    const customerEmail = isB2B
      ? `purchasing@${customerName.toLowerCase().replace(/[^a-z]+/g, "")}.com`
      : `${first.toLowerCase()}.${last.toLowerCase()}${rng.int(1, 99)}@${rng.pick(EMAIL_DOMAINS)}`;
    const shipAddress = `${rng.int(100, 9899)} ${rng.pick(STREET_NAMES)} ${rng.pick(STREET_SUFFIXES)}${rng.chance(0.18) ? ` Apt ${rng.int(1, 40)}` : ""}`;

    const shipped = status === "Shipped" || status === "Delivered";
    const carrierSeed = rng.pick(CARRIER_SEEDS);
    const hasCarrier = shipped || stage === 5 || (stage >= 3 && rng.chance(0.5));
    const service = isB2B ? carrierSeed.services[carrierSeed.services.length - 1] : rng.pick(carrierSeed.services);
    const shippedAt = shipped
      ? isoShift(orderDate, dayOffset <= 2 ? rng.int(18, 52) : rng.int(5, 40))
      : null;
    const deliveredAt =
      status === "Delivered" && shippedAt !== null
        ? isoShift(shippedAt, rng.int(44, 110))
        : null;

    let note: string | null = null;
    if (status === "Delivered" && rmaCount < 12 && rng.chance(0.08)) {
      rmaCount += 1;
      note = `RMA-${5100 + rmaCount} — customer return requested (${rng.pick(["wrong size", "damaged in transit", "ordered by mistake", "changed mind"])})`;
    } else if (status === "On Hold") {
      note = rng.pick(["Payment verification pending", "Address confirmation requested", "Client asked to hold until Friday"]);
    } else if (status === "Shortage") {
      note = "Allocation shortage — awaiting replenishment";
    } else if (rng.chance(0.04)) {
      note = rng.pick(["Gift order — no invoice in box", "Fragile — double box", "Leave at front desk"]);
    }

    orders.push({
      id: orderId,
      code: `SO-${100100 + i}`,
      warehouseId,
      clientId: client.id,
      channel,
      storeName: storeNameFor(channel, client.name),
      storeOrderNumber: storeOrderNumberFor(channel, rng),
      customerName,
      customerEmail,
      shipAddress,
      shipCity: city.city,
      shipState: city.state,
      shipZip: city.zip,
      shipCountry: city.country,
      status,
      orderType: isB2B ? "B2B" : "D2C",
      priority: rng.weighted([["None", 93], ["High", 5], ["Urgent", 2]]),
      carrier: hasCarrier ? carrierSeed.carrier : null,
      shippingService: hasCarrier ? service : null,
      trackingNumber: shipped ? `${carrierSeed.trackingPrefix}${rng.digits(carrierSeed.trackingDigits)}` : null,
      totalQuantity,
      totalWeightOz: Math.round(totalWeightOz * 10) / 10,
      salesPrice: Math.round(salesPrice * 100) / 100,
      jobId:
        (status === "Ready to Pick" || status === "Picking Started") && pickJobIds.length > 0 && rng.chance(0.6)
          ? rng.pick(pickJobIds)
          : null,
      orderDate,
      expectedShipDate: status === "Cancelled" ? null : isoShift(orderDate, rng.int(20, 44)),
      shippedAt,
      deliveredAt,
      note,
      createdAt: orderDate,
    });
    lines.push(...orderLineRows);
  }

  return { orders, lines };
}
