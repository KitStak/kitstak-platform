/**
 * Create/edit wizard helpers (M01): customer prefill (Step 2) and draft rate shopping
 * (Step 4 "Get Rates" before the order exists). Reads only; scoped.
 */
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppDb } from "@/server/api/db";
import type { Scope } from "@/server/auth/scope";
import { hasClient, hasWarehouse } from "@/server/auth/scope";
import { schema } from "@/server/db";
import { shipping } from "@/server/domain";
import { DomainError } from "@/server/domain/errors";
import type { OrderRow } from "@/server/domain/facts";

/* ------------------------------------------------------- customer prefill */

export interface CustomerPrefillAddress {
  readonly id: string;
  readonly title: string;
  readonly usageType: string;
  readonly isDefault: boolean;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly companyName: string | null;
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string;
  readonly state: string | null;
  readonly postalCode: string;
  readonly country: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly addressType: string | null;
}

export interface CustomerPrefill {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly phone: string;
  readonly addresses: readonly CustomerPrefillAddress[];
}

/** Prefix for a one-time customer taken from a previous order (no customers row): `order:<orderId>`. */
export const ORDER_CUSTOMER_PREFIX = "order:";

export interface CustomerSearchItem {
  readonly value: string;
  readonly label: string;
  readonly description: string;
  readonly source: "customer" | "order";
}

function likeTerm(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

/**
 * Step 2 customer search for one client: saved customers (name / email / phone contain the term),
 * then one-time customers from the client's previous orders (latest order per name + postal code).
 * Logiwa lists both, so typing "Oli" finds Olivia Martinez even when she only exists on orders.
 */
export function customerSearch(db: AppDb, scope: Scope, clientId: string, q: string, limit = 20): readonly CustomerSearchItem[] {
  if (!hasClient(scope, clientId)) return [];
  const term = likeTerm(q.trim());
  const cu = schema.customers;
  const saved = db
    .select({ id: cu.id, firstName: cu.firstName, lastName: cu.lastName, email: cu.email })
    .from(cu)
    .where(and(eq(cu.clientId, clientId), eq(cu.isActive, true), sql`(${cu.firstName} || ' ' || ${cu.lastName} LIKE ${term} ESCAPE '\\' OR ${cu.email} LIKE ${term} ESCAPE '\\' OR ${cu.phone} LIKE ${term} ESCAPE '\\')`))
    .orderBy(asc(cu.firstName), asc(cu.lastName))
    .limit(limit)
    .all()
    .map((c): CustomerSearchItem => ({ value: c.id, label: `${c.firstName} ${c.lastName}`.trim(), description: c.email || "Saved customer", source: "customer" }));
  const so = schema.shipmentOrders;
  const savedNames = new Set(saved.map((s) => s.label.toLowerCase()));
  const fromOrders = db
    .select({ id: so.id, code: so.code, name: so.customerName, city: so.shipCity, state: so.shipState, zip: so.shipZip, at: sql<string>`MAX(${so.orderDate})` })
    .from(so)
    .where(and(eq(so.clientId, clientId), isNull(so.deletedAt), isNull(so.customerId), sql`(${so.customerName} LIKE ${term} ESCAPE '\\' OR ${so.customerEmail} LIKE ${term} ESCAPE '\\')`))
    .groupBy(sql`lower(${so.customerName})`, sql`lower(COALESCE(${so.shipZip}, ''))`)
    .orderBy(sql`MAX(${so.orderDate}) DESC`)
    .limit(limit)
    .all()
    .filter((r) => r.name && !savedNames.has(r.name.toLowerCase()))
    .map((r): CustomerSearchItem => ({
      value: `${ORDER_CUSTOMER_PREFIX}${r.id}`,
      label: r.name ?? "",
      description: `From order ${r.code} · ${[r.city, r.state].filter(Boolean).join(", ")}`,
      source: "order",
    }));
  return [...saved, ...fromOrders].slice(0, limit);
}

/** Contact + ship-to of a previous order, shaped like a saved customer with one address. */
function orderCustomerPrefill(db: AppDb, scope: Scope, orderId: string): CustomerPrefill | null {
  const so = schema.shipmentOrders;
  const o = db.select().from(so).where(and(eq(so.id, orderId), isNull(so.deletedAt))).get();
  if (!o || !hasClient(scope, o.clientId)) return null;
  const [first, ...rest] = (o.customerName ?? "").trim().split(/\s+/);
  return {
    id: `${ORDER_CUSTOMER_PREFIX}${o.id}`,
    firstName: o.customerFirstName ?? first ?? "",
    lastName: o.customerLastName ?? rest.join(" "),
    email: o.customerEmail ?? "",
    phone: o.customerPhone ?? "",
    addresses: o.shipAddress && o.shipCity
      ? [{
          id: `ship-${o.id}`, title: `Ship-to on ${o.code}`, usageType: "Shipping", isDefault: true, firstName: o.customerFirstName, lastName: o.customerLastName,
          companyName: o.companyName, line1: o.shipAddress, line2: o.shipAddress2, city: o.shipCity, state: o.shipState, postalCode: o.shipZip ?? "",
          country: o.shipCountry ?? "US", phone: o.customerPhone, email: o.customerEmail, addressType: o.addressType,
        }]
      : [],
  };
}

export function customerPrefill(db: AppDb, scope: Scope, customerId: string): CustomerPrefill | null {
  if (customerId.startsWith(ORDER_CUSTOMER_PREFIX)) return orderCustomerPrefill(db, scope, customerId.slice(ORDER_CUSTOMER_PREFIX.length));
  const c = db.select().from(schema.customers).where(eq(schema.customers.id, customerId)).get();
  if (!c || !hasClient(scope, c.clientId)) return null;
  const a = schema.addresses;
  const addresses = db.select().from(a).where(and(eq(a.ownerType, "customer"), eq(a.ownerId, c.id), eq(a.isActive, true)))
    .orderBy(asc(a.usageType), asc(a.name)).all()
    .map((r) => ({
      id: r.id, title: r.name ?? `${r.line1}, ${r.city}`, usageType: r.usageType, isDefault: r.isDefault, firstName: r.firstName, lastName: r.lastName,
      companyName: r.companyName, line1: r.line1, line2: r.line2, city: r.city, state: r.state, postalCode: r.postalCode, country: r.country,
      phone: r.phone, email: r.email, addressType: r.addressType,
    }));
  return { id: c.id, firstName: c.firstName, lastName: c.lastName, email: c.email, phone: c.phone, addresses };
}

/* ------------------------------------------------------------ draft rates */

export const draftRatesSchema = z.object({
  warehouseId: z.string().min(1).max(64),
  clientId: z.string().min(1).max(64),
  presetId: z.string().max(64).nullish(),
  weightOz: z.number().positive("Add products with a weight to get rates").max(100_000),
  package: z.object({ length: z.number().min(0).max(500), width: z.number().min(0).max(500), height: z.number().min(0).max(500) }).optional(),
  to: z.object({
    name: z.string().trim().max(200).default(""),
    company: z.string().trim().max(200).nullish(),
    line1: z.string().trim().min(1, "Enter the ship-to address first").max(300),
    line2: z.string().trim().max(300).nullish(),
    city: z.string().trim().min(1, "Enter the ship-to city first").max(100),
    state: z.string().trim().max(100).nullish(),
    postalCode: z.string().trim().min(1, "Enter the ship-to postal code first").max(20),
    country: z.string().trim().min(1).max(100),
  }),
});

export interface DraftRateQuote {
  readonly carrierConnectionId: string;
  readonly carrierServiceId: string;
  readonly serviceName: string;
  readonly carrierCode: string;
  readonly transitDays: number;
  readonly price: number;
}

export interface DraftRatesResult {
  readonly quotes: readonly DraftRateQuote[];
  readonly errors: readonly { readonly carrierConnectionId: string; readonly message: string }[];
}

const DEFAULT_BOX = { length: 10, width: 8, height: 4 };

/** Rates every active connection of the warehouse for an unsaved order (no call log; nothing written). */
export async function draftRates(db: AppDb, scope: Scope, input: z.output<typeof draftRatesSchema>): Promise<DraftRatesResult> {
  if (!hasWarehouse(scope, input.warehouseId) || !hasClient(scope, input.clientId)) throw new DomainError("NOT_FOUND", "Warehouse not found");
  const pseudo = { warehouseId: input.warehouseId, clientId: input.clientId } as OrderRow;
  const preset = input.presetId ? db.select().from(schema.rateShoppingPresets).where(eq(schema.rateShoppingPresets.id, input.presetId)).get() : undefined;
  const presetServiceIds = preset && !preset.useAllServices
    ? new Set(db.select().from(schema.rateShoppingPresetServices)
      .where(and(eq(schema.rateShoppingPresetServices.presetId, preset.id), eq(schema.rateShoppingPresetServices.isSelected, true))).all().map((r) => r.carrierServiceId))
    : null;
  const conns = db.select().from(schema.carrierConnections)
    .where(and(eq(schema.carrierConnections.warehouseId, input.warehouseId), eq(schema.carrierConnections.isActive, true))).all();
  const quotes: DraftRateQuote[] = [];
  const errors: { carrierConnectionId: string; message: string }[] = [];
  const box = input.package && input.package.length > 0 ? input.package : DEFAULT_BOX;
  for (const conn of conns) {
    try {
      const { connection, adapter } = shipping.loadCarrier(db, conn.id, pseudo);
      const services = db.select().from(schema.carrierServices)
        .where(and(eq(schema.carrierServices.connectionId, conn.id), eq(schema.carrierServices.isActive, true))).all()
        .filter((s) => !presetServiceIds || presetServiceIds.has(s.id));
      if (services.length === 0) continue;
      const result = await adapter.rate({
        connection, services, from: shipping.warehouseAddress(db, input.warehouseId, connection),
        to: { ...input.to, name: input.to.name || "Recipient" }, packages: [{ weightOz: input.weightOz, ...box }],
      });
      for (const q of result) {
        quotes.push({
          carrierConnectionId: conn.id, carrierServiceId: q.carrierServiceId, serviceName: q.serviceName, carrierCode: q.carrierCode,
          transitDays: q.transitDays, price: shipping.applyMarkup(db, connection, input.clientId, q.amount),
        });
      }
    } catch (error) {
      errors.push({ carrierConnectionId: conn.id, message: error instanceof Error ? error.message : "Rate call failed" });
    }
  }
  const method = preset?.method ?? "Cheapest";
  quotes.sort((a, b) => (method === "Fastest" ? a.transitDays - b.transitDays || a.price - b.price : a.price - b.price || a.transitDays - b.transitDays));
  return { quotes, errors };
}

/* ---------------------------------------------------------- product facts */

export interface OrderProductFacts {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly imageUrl: string | null;
  readonly uom: string;
  readonly price: number;
  readonly weightOz: number;
  readonly isKit: boolean;
  readonly atp: number | null;
  /**
   * Of the ATP, units allocation can actually take now: active, unlocked, allocation-enabled,
   * undamaged locations (allocation-rule area filters can narrow it further per order). The
   * wizard labels the gap so "ATP 625" never hides "0 allocatable" (critic r5).
   */
  readonly allocatable: number | null;
  readonly packTypes: readonly { readonly packType: string; readonly uomQty: number }[];
}

/** Price / weight / kit flag / pack types / live ATP for products being added to an order (client-scoped). */
export function productFacts(db: AppDb, scope: Scope, input: { ids: readonly string[]; warehouseId?: string | null }): readonly OrderProductFacts[] {
  if (input.ids.length === 0) return [];
  const p = schema.products;
  const rows = db.select().from(p).where(inArray(p.id, [...input.ids])).all().filter((r) => hasClient(scope, r.clientId));
  if (rows.length === 0) return [];
  const packs = db.select().from(schema.productPackTypes).where(inArray(schema.productPackTypes.productId, rows.map((r) => r.id))).all();
  const wh = input.warehouseId && hasWarehouse(scope, input.warehouseId) ? input.warehouseId : null;
  const atp = new Map<string, number>();
  const allocatable = new Map<string, number>();
  if (wh) {
    const i = schema.inventory;
    for (const r of db.select({ productId: i.productId, n: sql<number>`COALESCE(SUM(${i.onHand} - ${i.allocated} - ${i.damaged}), 0)` }).from(i)
      .where(and(inArray(i.productId, rows.map((x) => x.id)), eq(i.warehouseId, wh), eq(i.status, "Stock"))).groupBy(i.productId).all()) {
      atp.set(r.productId, Math.max(0, Number(r.n)));
    }
    const l = schema.locations;
    for (const r of db.select({ productId: i.productId, n: sql<number>`COALESCE(SUM(${i.onHand} - ${i.allocated}), 0)` }).from(i)
      .innerJoin(l, eq(l.id, i.locationId))
      .where(and(inArray(i.productId, rows.map((x) => x.id)), eq(i.warehouseId, wh), eq(i.status, "Stock"), isNull(i.damageReason),
        eq(l.isActive, true), eq(l.isLocked, false), eq(l.preventAllocation, false), sql`${i.onHand} - ${i.allocated} > 0`)).groupBy(i.productId).all()) {
      allocatable.set(r.productId, Math.max(0, Number(r.n)));
    }
  }
  return rows.map((r) => ({
    id: r.id, sku: r.sku, name: r.name, imageUrl: r.imageUrl ?? null, uom: r.uom, price: r.price, weightOz: r.weightOz, isKit: Boolean(r.isKit),
    atp: wh ? atp.get(r.id) ?? 0 : null,
    allocatable: wh ? Math.min(atp.get(r.id) ?? 0, allocatable.get(r.id) ?? 0) : null,
    packTypes: [{ packType: r.uom, uomQty: 1 }, ...packs.filter((x) => x.productId === r.id && x.packType !== r.uom).map((x) => ({ packType: x.packType, uomQty: x.uomQty }))],
  }));
}

/* ------------------------------------------------------------ order ledger */

export interface OrderLedgerEntry {
  readonly id: string;
  readonly type: string;
  readonly quantity: number;
  readonly at: string;
  readonly source: string | null;
  readonly sku: string | null;
  readonly detail: string | null;
}

/** Inventory events for the detail activity timeline: ledger transactions + allocations (newest first). */
export function orderLedger(db: AppDb, orderId: string): readonly OrderLedgerEntry[] {
  const t = schema.inventoryTransactions;
  const p = schema.products;
  const txns = db.select({ id: t.id, type: t.type, qty: t.uomQty, at: t.at, source: t.source, sku: p.sku, loc: sql<string | null>`(SELECT code FROM locations WHERE id = COALESCE(${t.fromLocationId}, ${t.toLocationId}))` })
    .from(t).innerJoin(p, eq(p.id, t.productId)).where(eq(t.orderId, orderId)).orderBy(sql`${t.seq} DESC`).limit(200).all()
    .map((r) => ({ id: r.id, type: r.type, quantity: r.qty, at: r.at, source: r.source, sku: r.sku, detail: r.loc ? `Location ${r.loc}` : null }));
  const a = schema.inventoryAllocations;
  const allocs = db.select({ id: a.id, qty: a.qty, status: a.status, at: a.createdAt, rule: a.ruleName, sku: p.sku, loc: sql<string | null>`(SELECT l.code FROM inventory i JOIN locations l ON l.id = i.location_id WHERE i.id = ${a.inventoryId})` })
    .from(a).innerJoin(schema.orderLines, eq(schema.orderLines.id, a.orderLineId)).innerJoin(p, eq(p.id, schema.orderLines.productId))
    .where(eq(a.orderId, orderId)).limit(200).all()
    .map((r) => ({ id: r.id, type: r.status === "Allocated" ? "Allocated" : `Allocation ${r.status.toLowerCase()}`, quantity: r.qty, at: r.at, source: r.rule ? `Rule ${r.rule}` : "Allocation", sku: r.sku, detail: r.loc ? `Location ${r.loc}` : null }));
  return [...txns, ...allocs].sort((x, y) => y.at.localeCompare(x.at));
}
