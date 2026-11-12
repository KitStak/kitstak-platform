/**
 * Shipment-order plan for the history replay (pure: no DB access).
 *
 * Generates ~430 orders over the 30 days before the anchor (2026-11-05). Each plan says who
 * ordered what, where it ships, the service requested and its "fate" (normal flow, cancel,
 * hold, workflow block, pick short). The replay turns plans into real orders through the
 * domain engines; how far each one gets is decided by the clock, not by this file.
 */
import {
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
} from './seed-data';

export interface PlanProduct {
  readonly id: string;
  readonly clientId: string;
  readonly price: number;
  readonly isKit: boolean;
}

export interface PlanCustomer {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly phone: string;
  readonly address: {
    readonly line1: string;
    readonly city: string;
    readonly state: string;
    readonly zip: string;
    readonly country: string;
  };
}

export interface PlanClient {
  readonly id: string;
  readonly name: string;
  readonly weight: number;
  readonly hasChannelConnection: boolean;
}

export interface PlanRetailer {
  readonly id: string;
  readonly name: string;
  readonly businessName: string;
  readonly dc: PlanCustomer['address'];
}

export type WarehouseCode = 'MLT1' | 'KS2';
export type OrderFate = 'normal' | 'cancel' | 'hold' | 'holdRelease' | 'blocked' | 'pickShort';

export interface PlannedLine {
  readonly productId: string;
  readonly qty: number;
  readonly unitPrice: number;
}

export interface ShipTo {
  readonly customerName: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly email: string;
  readonly phone: string | null;
  readonly companyName: string | null;
  readonly line1: string;
  readonly city: string;
  readonly state: string;
  readonly zip: string;
  readonly country: string;
}

export interface OrderPlan {
  readonly key: number;
  readonly warehouse: WarehouseCode;
  readonly clientId: string;
  readonly channel: Channel;
  readonly createdMs: number;
  readonly lines: readonly PlannedLine[];
  readonly shipTo: ShipTo;
  readonly customerId: string | null;
  readonly retailerId: string | null;
  readonly storeName: string | null;
  readonly storeOrderNumber: string | null;
  readonly isPrime: boolean;
  readonly priority: 'None' | 'High' | 'Urgent';
  readonly isGift: boolean;
  readonly serviceCode: string;
  readonly useRatePreset: boolean;
  readonly fate: OrderFate;
  readonly packages: 1 | 2;
  readonly viaChannelConnection: boolean;
}

export interface PlanInput {
  readonly days: number;
  /** Epoch ms of `daysAgo` days before the anchor at `hour:minute` UTC. */
  readonly at: (daysAgo: number, hour: number, minute: number) => number;
  readonly endMs: number;
  readonly clients: readonly PlanClient[];
  /** Orderable products per warehouse, per client id. */
  readonly products: Readonly<Record<WarehouseCode, ReadonlyMap<string, readonly PlanProduct[]>>>;
  readonly customersByClient: ReadonlyMap<string, readonly PlanCustomer[]>;
  readonly retailers: readonly PlanRetailer[];
  readonly ks2ClientIds: ReadonlySet<string>;
}

const CHANNELS: ReadonlyArray<readonly [Channel, number]> = [
  ['Shopify', 36],
  ['Amazon', 26],
  ['TikTok Shop', 11],
  ['Walmart', 9],
  ['Wholesale', 8],
  ['Manual', 10],
];
const D2C_SERVICES: ReadonlyArray<readonly [string, number]> = [
  ['SBX_GROUND_ADVANTAGE', 44],
  ['SBX_PRIORITY', 20],
  ['SBX_GROUND', 22],
  ['SBX_2DAY', 10],
  ['SBX_NEXT_DAY', 4],
];
const EMAIL_DOMAINS = ['gmail.com', 'yahoo.com', 'outlook.com', 'icloud.com'] as const;
const BLOCKED_DAYS: ReadonlySet<number> = new Set([3, 9]);

function pickLines(rng: Rng, catalog: readonly PlanProduct[], b2b: boolean): PlannedLine[] {
  const want = Math.min(
    catalog.length,
    b2b
      ? rng.int(2, 4)
      : rng.weighted([
          [1, 58],
          [2, 30],
          [3, 12],
        ]),
  );
  const chosen = new Map<string, PlanProduct>();
  while (chosen.size < want) {
    const p = rng.pick(catalog);
    chosen.set(p.id, p);
  }
  return [...chosen.values()].map((p) => ({
    productId: p.id,
    qty: b2b
      ? rng.int(6, 24)
      : p.isKit
        ? 1
        : rng.weighted([
            [1, 70],
            [2, 22],
            [3, 8],
          ]),
    unitPrice: b2b ? Math.round(p.price * 55) / 100 : p.price,
  }));
}

function anonymousShipTo(rng: Rng, intl: boolean): ShipTo {
  const first = rng.pick(FIRST_NAMES);
  const last = rng.pick(LAST_NAMES);
  const city = intl ? rng.pick(INTL_CITIES) : rng.pick(US_CITIES);
  return {
    customerName: `${first} ${last}`,
    firstName: first,
    lastName: last,
    email: `${first.toLowerCase()}.${last.toLowerCase()}${rng.int(1, 99)}@${rng.pick(EMAIL_DOMAINS)}`,
    phone: `(${rng.int(201, 989)}) 555-${String(rng.int(200, 299)).padStart(4, '0')}`,
    companyName: null,
    line1: `${rng.int(100, 9899)} ${rng.pick(STREET_NAMES)} ${rng.pick(STREET_SUFFIXES)}`,
    city: city.city,
    state: city.state,
    zip: city.zip,
    country: city.country,
  };
}

function customerShipTo(c: PlanCustomer): ShipTo {
  return {
    customerName: `${c.firstName} ${c.lastName}`,
    firstName: c.firstName,
    lastName: c.lastName,
    email: c.email,
    phone: c.phone,
    companyName: null,
    line1: c.address.line1,
    city: c.address.city,
    state: c.address.state,
    zip: c.address.zip,
    country: c.address.country,
  };
}

function retailerShipTo(r: PlanRetailer): ShipTo {
  return {
    customerName: r.businessName,
    firstName: null,
    lastName: null,
    email: `vendor-ops@${r.name.toLowerCase().replace(/[^a-z]+/g, '')}.com`,
    phone: '(800) 555-0199',
    companyName: `${r.name} Distribution Center`,
    line1: r.dc.line1,
    city: r.dc.city,
    state: r.dc.state,
    zip: r.dc.zip,
    country: r.dc.country,
  };
}

function fateFor(rng: Rng, daysAgo: number, b2b: boolean): OrderFate {
  if (b2b) return rng.chance(0.04) ? 'cancel' : 'normal';
  return rng.weighted<OrderFate>([
    ['normal', 92],
    ['cancel', 4],
    ['hold', daysAgo <= 2 ? 3 : 0],
    ['holdRelease', daysAgo > 2 ? 1 : 0],
    ['pickShort', daysAgo > 1 && daysAgo < 20 ? 1.2 : 0],
  ]);
}

interface DaySlot {
  readonly daysAgo: number;
  readonly ms: number;
  readonly warehouse: WarehouseCode;
}

function daySlots(rng: Rng, input: PlanInput): DaySlot[] {
  const slots: DaySlot[] = [];
  for (let daysAgo = input.days - 1; daysAgo >= 0; daysAgo -= 1) {
    const dow = new Date(input.at(daysAgo, 12, 0)).getUTCDay();
    const weekend = dow === 0 || dow === 6;
    const mlt1 = weekend ? rng.int(6, 10) : rng.int(12, 18);
    const ks2 = weekend ? rng.int(0, 1) : rng.int(1, 2);
    for (const [warehouse, n] of [
      ['MLT1', mlt1],
      ['KS2', ks2],
    ] as const) {
      for (let i = 0; i < n; i += 1) {
        const ms = input.at(daysAgo, rng.int(10, 23), rng.int(0, 59));
        if (ms < input.endMs - 600_000) slots.push({ daysAgo, ms, warehouse });
      }
    }
  }
  return slots.sort((a, b) => a.ms - b.ms);
}

export function buildOrderPlans(rng: Rng, input: PlanInput): OrderPlan[] {
  const plans: OrderPlan[] = [];
  const blockedDone = new Set<number>();
  for (const slot of daySlots(rng, input)) {
    const eligible = input.clients.filter((c) => slot.warehouse === 'MLT1' || input.ks2ClientIds.has(c.id));
    const client = rng.weighted(eligible.map((c) => [c, c.weight] as const));
    const catalog = input.products[slot.warehouse].get(client.id) ?? [];
    if (catalog.length === 0) continue;
    const channel =
      slot.warehouse === 'KS2' ? rng.pick<Channel>(['Shopify', 'Amazon', 'Manual']) : rng.weighted(CHANNELS);
    const b2b = channel === 'Wholesale';
    const intl = !b2b && (channel === 'Shopify' || channel === 'Manual') && rng.chance(0.05);
    const customers = input.customersByClient.get(client.id) ?? [];
    const customer = !b2b && !intl && customers.length > 0 && rng.chance(0.62) ? rng.pick(customers) : null;
    const retailer = b2b ? rng.pick(input.retailers) : null;
    let shipTo = retailer
      ? retailerShipTo(retailer)
      : customer
        ? customerShipTo(customer)
        : anonymousShipTo(rng, intl);
    let fate = fateFor(rng, slot.daysAgo, b2b);
    if (
      slot.warehouse === 'MLT1' &&
      !b2b &&
      BLOCKED_DAYS.has(slot.daysAgo) &&
      !blockedDone.has(slot.daysAgo)
    ) {
      blockedDone.add(slot.daysAgo);
      fate = 'blocked';
      shipTo = { ...shipTo, line1: `PO Box ${rng.int(100, 4999)}` };
    }
    const isPrime = channel === 'Amazon' && rng.chance(0.5);
    plans.push({
      key: plans.length + 1,
      warehouse: slot.warehouse,
      clientId: client.id,
      channel,
      createdMs: slot.ms,
      lines: pickLines(rng, catalog, b2b),
      shipTo,
      customerId: customer?.id ?? null,
      retailerId: retailer?.id ?? null,
      storeName: storeNameFor(channel, client.name),
      storeOrderNumber: storeOrderNumberFor(channel, rng),
      isPrime,
      priority: isPrime ? 'High' : rng.chance(0.015) ? 'Urgent' : 'None',
      isGift: !b2b && rng.chance(0.06),
      serviceCode: intl ? 'SBX_INTL' : b2b ? 'SBX_GROUND' : rng.weighted(D2C_SERVICES),
      useRatePreset: !b2b && !intl && rng.chance(0.12),
      fate,
      packages: b2b || rng.chance(0.06) ? 2 : 1,
      viaChannelConnection:
        client.hasChannelConnection &&
        (channel === 'Shopify' || channel === 'Amazon') &&
        slot.warehouse === 'MLT1',
    });
  }
  return plans;
}
