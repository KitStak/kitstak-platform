/** Organization: warehouses, clients, vendors, customers, retailers and their addresses. */
import * as schema from "@/server/db/schema";
import type { Tx } from "@/server/domain/types";
import { CLIENT_SEEDS, FIRST_NAMES, LAST_NAMES, STREET_NAMES, STREET_SUFFIXES, US_CITIES, VENDORS_BY_CATEGORY, type ClientSeed } from "../seed-data";
import {
  CLIENT_ADDRESSES, CLIENT_OFFICIAL_NAMES, EXTRA_VENDORS, RETAILER_SEEDS, VENDOR_ADDRESSES, WAREHOUSE_SEEDS,
  streetLine, type StreetAddress,
} from "./org-data";
import { isoOf, utcAt } from "./runtime";
import type { Id, SeedEnv } from "./types";

export interface ClientRef {
  readonly id: Id;
  readonly code: string;
  readonly name: string;
  readonly category: ClientSeed["category"];
  readonly active: boolean;
  /** Relative order volume. */
  readonly weight: number;
}

export interface CustomerRef {
  readonly id: Id;
  readonly clientId: Id;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly phone: string;
  readonly address: StreetAddress;
}

export interface NamedRef {
  readonly id: Id;
  readonly name: string;
}

export interface RetailerRef extends NamedRef {
  readonly businessName: string;
  readonly dc: StreetAddress;
}

export interface OrgRefs {
  readonly mlt1: Id;
  readonly ks2: Id;
  readonly clients: readonly ClientRef[];
  readonly clientByCode: ReadonlyMap<string, ClientRef>;
  readonly vendorsByClient: ReadonlyMap<Id, readonly NamedRef[]>;
  readonly customersByClient: ReadonlyMap<Id, readonly CustomerRef[]>;
  readonly retailers: readonly RetailerRef[];
}

const ORDER_WEIGHTS: Readonly<Record<string, number>> = { APX: 20, NVF: 18, CPL: 14, BLB: 12, VLT: 12, SMT: 9, HRB: 8, PXP: 4 };
const CUSTOMERS_PER_WEIGHT = 0.75;

function insertAddress(tx: Tx, owner: { type: (typeof schema.addresses.$inferInsert)["ownerType"]; id: Id }, a: StreetAddress,
  extra: Partial<typeof schema.addresses.$inferInsert> = {}): void {
  tx.insert(schema.addresses).values({
    ownerType: owner.type, ownerId: owner.id, line1: a.line1, city: a.city, state: a.state, postalCode: a.zip, country: a.country,
    addressType: "Commercial", isDefault: true, ...extra,
  }).run();
}

function seedWarehouses(tx: Tx): { mlt1: Id; ks2: Id } {
  const ids = WAREHOUSE_SEEDS.map((w, i) => tx.insert(schema.warehouses).values({
    code: w.code, name: w.name, prefix: w.code, addressLine: w.addressLine, city: w.city, state: w.state, postalCode: w.postalCode,
    contactName: w.contactName, contactPhone: w.contactPhone, email: w.email, isDefault: w.isDefault, timezone: "America/New_York",
    dayShiftStart: "07:00", dayShiftEnd: "17:30", createdAt: isoOf(utcAt(900 - i * 300, 14)),
  }).returning({ id: schema.warehouses.id }).get().id);
  WAREHOUSE_SEEDS.forEach((w, i) => insertAddress(tx, { type: "warehouse", id: ids[i] },
    { line1: w.addressLine, city: w.city, state: w.state, zip: w.postalCode, country: "United States" }, { companyName: w.name, phone: w.contactPhone }));
  return { mlt1: ids[0], ks2: ids[1] };
}

function seedClients(tx: Tx): ClientRef[] {
  return CLIENT_SEEDS.map((c, i) => {
    const id = tx.insert(schema.clients).values({
      code: c.code, name: c.name, officialName: CLIENT_OFFICIAL_NAMES[c.code] ?? c.name, contactName: c.contactName,
      contactEmail: c.contactEmail, phone: c.phone, billingPlan: c.billingPlan, status: "Active",
      taxId: `${36 + i}-${String(4410021 + i * 7919).slice(0, 7)}`, settings: {}, createdAt: isoOf(utcAt(700 - i * 55, 14, 30)),
    }).returning({ id: schema.clients.id }).get().id;
    const hq = CLIENT_ADDRESSES[c.code];
    if (hq) {
      insertAddress(tx, { type: "client", id }, hq, { usageType: "Billing", companyName: c.name, phone: c.phone, email: c.contactEmail });
      // Every client has a default Shipping address (the client Overview otherwise reads "Shipping · Not set").
      insertAddress(tx, { type: "client", id }, hq, { usageType: "Shipping", companyName: c.name, phone: c.phone, email: c.contactEmail });
      insertAddress(tx, { type: "client", id }, hq, { usageType: "Return", companyName: `${c.name} Returns`, isDefault: false });
    }
    // PXP is offboarded at the end of the replay (status flips to Inactive then).
    return { id, code: c.code, name: c.name, category: c.category, active: c.status === "Active", weight: ORDER_WEIGHTS[c.code] ?? 5 };
  });
}

function seedVendors(env: SeedEnv, tx: Tx, clients: readonly ClientRef[]): Map<Id, NamedRef[]> {
  const out = new Map<Id, NamedRef[]>();
  clients.forEach((c, ci) => {
    const pool = [...VENDORS_BY_CATEGORY[c.category], ...EXTRA_VENDORS[c.category]];
    const count = 2 + ((ci + env.rng.int(0, 2)) % 3);
    const refs = pool.slice(0, Math.min(count, pool.length)).map((name, vi) => {
      const id = tx.insert(schema.vendors).values({ clientId: c.id, displayName: name, vendorName: name, createdAt: isoOf(utcAt(500 - ci * 20 - vi, 15)) })
        .returning({ id: schema.vendors.id }).get().id;
      insertAddress(tx, { type: "vendor", id }, VENDOR_ADDRESSES[(ci * 3 + vi) % VENDOR_ADDRESSES.length], { companyName: name, phone: `(800) 555-${String(2100 + ci * 10 + vi)}` });
      return { id, name };
    });
    out.set(c.id, refs);
  });
  return out;
}

function customerAddress(env: SeedEnv): StreetAddress {
  const city = env.rng.pick(US_CITIES);
  const unit = env.rng.chance(0.18) ? `Apt ${env.rng.int(1, 40)}` : null;
  return { ...city, line1: streetLine(env.rng.int(100, 9899), env.rng.pick(STREET_NAMES), env.rng.pick(STREET_SUFFIXES), unit) };
}

function seedCustomers(env: SeedEnv, tx: Tx, clients: readonly ClientRef[]): Map<Id, CustomerRef[]> {
  const out = new Map<Id, CustomerRef[]>();
  const domains = ["gmail.com", "yahoo.com", "outlook.com", "icloud.com"] as const;
  for (const c of clients) {
    const count = Math.round(c.weight * CUSTOMERS_PER_WEIGHT * 2.2);
    const refs: CustomerRef[] = [];
    for (let i = 0; i < count; i += 1) {
      const firstName = env.rng.pick(FIRST_NAMES);
      const lastName = env.rng.pick(LAST_NAMES);
      const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${env.rng.int(1, 99)}@${env.rng.pick(domains)}`;
      const phone = `(${env.rng.int(201, 989)}) 555-${String(env.rng.int(100, 199)).padStart(4, "0")}`;
      const address = customerAddress(env);
      const id = tx.insert(schema.customers).values({ clientId: c.id, firstName, lastName, email, phone, createdAt: isoOf(utcAt(env.rng.int(35, 400), 15)) })
        .returning({ id: schema.customers.id }).get().id;
      const person = { firstName, lastName, phone, email };
      insertAddress(tx, { type: "customer", id }, address, { ...person, usageType: "Shipping", addressType: "Residential" });
      const billing = env.rng.chance(0.8) ? address : customerAddress(env);
      insertAddress(tx, { type: "customer", id }, billing, { ...person, usageType: "Billing", addressType: "Residential" });
      refs.push({ id, clientId: c.id, firstName, lastName, email, phone, address });
    }
    out.set(c.id, refs);
  }
  return out;
}

function seedRetailers(tx: Tx): RetailerRef[] {
  return RETAILER_SEEDS.map((r, i) => {
    const id = tx.insert(schema.retailers).values({
      name: r.name, businessName: r.businessName, description: r.description, createCaseLabels: r.createCaseLabels,
      caseLabelPrintQty: r.caseLabelPrintQty, lpLabelPrintQty: r.lpLabelPrintQty, createdAt: isoOf(utcAt(300 - i * 30, 15)),
    }).returning({ id: schema.retailers.id }).get().id;
    insertAddress(tx, { type: "retailer", id }, r.dc, { companyName: `${r.name} Distribution Center`, usageType: "Shipping" });
    return { id, name: r.name, businessName: r.businessName, dc: r.dc };
  });
}

export function seedOrg(env: SeedEnv, tx: Tx): OrgRefs {
  const { mlt1, ks2 } = seedWarehouses(tx);
  const clients = seedClients(tx);
  return {
    mlt1, ks2, clients,
    clientByCode: new Map(clients.map((c) => [c.code, c])),
    vendorsByClient: seedVendors(env, tx, clients),
    customersByClient: seedCustomers(env, tx, clients),
    retailers: seedRetailers(tx),
  };
}
