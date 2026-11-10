/**
 * Logiwa acceptance fixtures for MLT1 (docs/requests/inventory.md REQ-1, work-orders-kitting.md REQ-4).
 *
 * Idempotent upserts on natural keys (client + SKU, warehouse + location code, lookup type + name,
 * order client reference), safe to run against the live database any number of times:
 *   npm run db:fixtures
 * Stock goes through `ledger.add` (so `npm run db:verify` stays green) and is only added while the
 * fixture bucket is empty; the open order goes through `orders.createOrder`.
 *
 * Fixtures (client APX, the MLT1 demo client):
 *   - products MLT-WIDGET-01, MLT-WIDGET-02 (Each, untracked), kit MLT-KIT-2PK (Kit to Stock,
 *     component MLT-KIT-COMP × 2) and its component;
 *   - locations MLT1-A-01 (Only 1 SKU, Storage), MLT1-B-01 (Storage), MLT1-C-01 (Picking);
 *   - stock 20 × WIDGET-01 @ A-01, 4 × WIDGET-02 @ C-01, 22 × KIT-COMP @ C-01 (Net Kitting Capacity 11);
 *   - one open shipment order (2 × WIDGET-01), client reference KS-FIXTURE-M06;
 *   - lookups adjustment_reason "Import" and damage_reason "Damaged".
 */
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import * as schema from "@/server/db/schema";
import { DEFAULT_ROLE_PERMISSIONS, type DefaultRoleKey } from "@/server/auth/permission-catalog";
import { ledger } from "@/server/domain/ledger";
import { createOrder } from "@/server/domain/orders";
import type { DomainCtx } from "@/server/domain/types";

export const FIXTURE_WAREHOUSE_CODE = "MLT1";
export const FIXTURE_CLIENT_CODE = "APX";
export const FIXTURE_ORDER_REFERENCE = "KS-FIXTURE-M06";

interface ProductFixture {
  readonly sku: string;
  readonly name: string;
  readonly barcode: string;
  readonly price: number;
  readonly kit?: boolean;
}

const PRODUCTS: readonly ProductFixture[] = [
  { sku: "MLT-WIDGET-01", name: "MLTest Widget 01", barcode: "850012300011", price: 12.5 },
  { sku: "MLT-WIDGET-02", name: "MLTest Widget 02", barcode: "850012300028", price: 14 },
  { sku: "MLT-KIT-COMP", name: "MLTest Kit Component", barcode: "850012300035", price: 6.25 },
  { sku: "MLT-KIT-2PK", name: "MLTest 2 Pack Kit", barcode: "850012300042", price: 19.99, kit: true },
];

interface LocationFixture {
  readonly code: string;
  readonly type: "Picking" | "Reserve";
  readonly areaType: "Picking" | "Storage";
  readonly bay: string;
  readonly onlyOneSku: boolean;
}

const LOCATIONS: readonly LocationFixture[] = [
  { code: "MLT1-A-01", type: "Reserve", areaType: "Storage", bay: "A", onlyOneSku: true },
  { code: "MLT1-B-01", type: "Reserve", areaType: "Storage", bay: "B", onlyOneSku: false },
  { code: "MLT1-C-01", type: "Picking", areaType: "Picking", bay: "C", onlyOneSku: false },
];

const STOCK: readonly { readonly sku: string; readonly location: string; readonly qty: number }[] = [
  { sku: "MLT-WIDGET-01", location: "MLT1-A-01", qty: 20 },
  { sku: "MLT-WIDGET-02", location: "MLT1-C-01", qty: 4 },
  { sku: "MLT-KIT-COMP", location: "MLT1-C-01", qty: 22 },
];

const LOOKUPS: readonly { readonly type: "adjustment_reason" | "damage_reason"; readonly name: string }[] = [
  { type: "adjustment_reason", name: "Import" },
  { type: "damage_reason", name: "Damaged" },
];

export interface FixtureReport {
  readonly created: readonly string[];
  readonly skipped: readonly string[];
}

function required<T>(row: T | undefined, what: string): T {
  if (!row) throw new Error(`Acceptance fixtures: ${what} not found`);
  return row;
}

function upsertLookups(tx: AppDb, created: string[], skipped: string[]): void {
  for (const l of LOOKUPS) {
    const lv = schema.lookupValues;
    const found = tx.select({ id: lv.id }).from(lv)
      .where(and(eq(lv.type, l.type), eq(lv.name, l.name), isNull(lv.clientId), isNull(lv.warehouseId))).get();
    if (found) { skipped.push(`lookup ${l.type}/${l.name}`); continue; }
    const order = tx.get<{ n: number | null }>(sql`SELECT MAX(sort_order) AS n FROM lookup_values WHERE type = ${l.type}`)?.n ?? -1;
    tx.insert(lv).values({ type: l.type, name: l.name, isActive: true, sortOrder: Number(order) + 1 }).run();
    created.push(`lookup ${l.type}/${l.name}`);
  }
}

function upsertProducts(tx: AppDb, clientId: string, created: string[], skipped: string[]): Map<string, string> {
  const ids = new Map<string, string>();
  for (const p of PRODUCTS) {
    const found = tx.select({ id: schema.products.id }).from(schema.products)
      .where(and(eq(schema.products.clientId, clientId), eq(schema.products.sku, p.sku))).get();
    if (found) { ids.set(p.sku, found.id); skipped.push(`product ${p.sku}`); continue; }
    const row = tx.insert(schema.products).values({
      clientId, sku: p.sku, barcode: p.barcode, name: p.name, category: "General", uom: "Each",
      weightOz: 8, lengthIn: 6, widthIn: 4, heightIn: 2, price: p.price, purchasePrice: Math.round(p.price * 42) / 100,
      isKit: Boolean(p.kit), status: "Active", productCategory: p.kit ? "Kit" : "Product", kitType: p.kit ? "Kit to Stock" : null,
      description: p.kit ? "Logiwa acceptance kit: two MLTest kit components." : "Logiwa acceptance fixture SKU.",
    }).returning({ id: schema.products.id }).get();
    const pack = tx.insert(schema.productPackTypes).values({
      productId: row.id, packType: "Each", kind: "Primary", uomQty: 1, length: 6, width: 4, height: 2, volume: 48, weight: 0.5,
    }).returning({ id: schema.productPackTypes.id }).get();
    tx.insert(schema.productBarcodes).values({ productId: row.id, packTypeId: pack.id, barcode: p.barcode }).run();
    ids.set(p.sku, row.id);
    created.push(`product ${p.sku}`);
  }
  const kitId = required(ids.get("MLT-KIT-2PK"), "kit");
  const compId = required(ids.get("MLT-KIT-COMP"), "kit component");
  const kc = schema.kitComponents;
  if (!tx.select({ id: kc.id }).from(kc).where(and(eq(kc.kitProductId, kitId), eq(kc.componentProductId, compId))).get()) {
    tx.insert(kc).values({ kitProductId: kitId, componentProductId: compId, quantity: 2, packType: "Each" }).run();
    created.push("kit component MLT-KIT-2PK → MLT-KIT-COMP × 2");
  }
  return ids;
}

function upsertLocations(tx: AppDb, warehouseId: string, created: string[], skipped: string[]): Map<string, string> {
  const ids = new Map<string, string>();
  for (const l of LOCATIONS) {
    const found = tx.select({ id: schema.locations.id }).from(schema.locations)
      .where(and(eq(schema.locations.warehouseId, warehouseId), eq(schema.locations.code, l.code))).get();
    if (found) { ids.set(l.code, found.id); skipped.push(`location ${l.code}`); continue; }
    const row = tx.insert(schema.locations).values({
      warehouseId, code: l.code, barcode: l.code, zone: "MLT", aisle: "01", bay: l.bay, level: "1", type: l.type,
      capacityUnits: 200, isActive: true, locationType: "Shelves", areaType: l.areaType, onlyOneSku: l.onlyOneSku,
    }).returning({ id: schema.locations.id }).get();
    ids.set(l.code, row.id);
    created.push(`location ${l.code}`);
  }
  return ids;
}

function addStock(tx: AppDb, ctx: DomainCtx, refs: { warehouseId: string; clientId: string; products: Map<string, string>; locations: Map<string, string> }, created: string[], skipped: string[]): void {
  for (const s of STOCK) {
    const productId = required(refs.products.get(s.sku), s.sku);
    const locationId = required(refs.locations.get(s.location), s.location);
    const i = schema.inventory;
    const existing = tx.select({ id: i.id }).from(i)
      .where(and(eq(i.productId, productId), eq(i.locationId, locationId), gt(i.onHand, 0))).get();
    if (existing) { skipped.push(`stock ${s.sku} @ ${s.location}`); continue; }
    ledger.add(tx, ctx, {
      warehouseId: refs.warehouseId, clientId: refs.clientId, productId, locationId, qty: s.qty, packType: "Each",
      type: "Inventory Adjustment", refs: { note: "Acceptance fixture stock" },
    });
    created.push(`stock ${s.qty} × ${s.sku} @ ${s.location}`);
  }
}

function ensureOpenOrder(tx: AppDb, ctx: DomainCtx, refs: { warehouseId: string; clientId: string; products: Map<string, string> }, created: string[], skipped: string[]): void {
  const so = schema.shipmentOrders;
  const found = tx.select({ id: so.id }).from(so)
    .where(and(eq(so.clientId, refs.clientId), eq(so.clientReferenceCode, FIXTURE_ORDER_REFERENCE), isNull(so.deletedAt))).get();
  if (found) { skipped.push(`order ${FIXTURE_ORDER_REFERENCE}`); return; }
  const order = createOrder(tx, ctx, {
    warehouseId: refs.warehouseId, clientId: refs.clientId, clientReferenceCode: FIXTURE_ORDER_REFERENCE,
    customerName: "Dana Whitfield", customerEmail: "dana.whitfield@example.com",
    shipAddress: "418 Larkspur Lane", shipCity: "Columbus", shipState: "OH", shipZip: "43215", shipCountry: "United States",
    skipAddressVerification: true, note: "Acceptance fixture: open order for MLT-WIDGET-01.",
    lines: [{ productId: required(refs.products.get("MLT-WIDGET-01"), "MLT-WIDGET-01"), quantity: 2, unitPrice: 12.5 }],
  });
  created.push(`order ${order.code} (2 × MLT-WIDGET-01)`);
}

/**
 * Grants catalog keys added after the seed (e.g. `inventory.return_station.receive_return`) to the
 * system roles that get them by default. Only inserts missing grants; never revokes custom changes.
 */
export function syncSystemRoleGrants(tx: AppDb, created: string[]): void {
  const roles = tx.select().from(schema.roles).where(eq(schema.roles.isSystem, true)).all();
  for (const role of roles) {
    const keys = DEFAULT_ROLE_PERMISSIONS[role.key as DefaultRoleKey];
    if (!keys) continue;
    const have = new Set(tx.select({ p: schema.rolePermissions.permission }).from(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, role.id)).all().map((r) => r.p));
    const missing = keys.filter((k) => !have.has(k));
    if (missing.length === 0) continue;
    tx.insert(schema.rolePermissions).values(missing.map((permission) => ({ roleId: role.id, permission }))).onConflictDoNothing().run();
    created.push(`${missing.length} grant(s) for role ${role.key}: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ", …" : ""}`);
  }
}

/** Upserts every fixture. Run inside a transaction. */
export function seedAcceptanceFixtures(tx: AppDb, ctx: DomainCtx): FixtureReport {
  const created: string[] = [];
  const skipped: string[] = [];
  const wh = required(tx.select().from(schema.warehouses).where(eq(schema.warehouses.code, FIXTURE_WAREHOUSE_CODE)).get(), `warehouse ${FIXTURE_WAREHOUSE_CODE}`);
  const client = required(tx.select().from(schema.clients).where(eq(schema.clients.code, FIXTURE_CLIENT_CODE)).get(), `client ${FIXTURE_CLIENT_CODE}`);
  syncSystemRoleGrants(tx, created);
  upsertLookups(tx, created, skipped);
  const products = upsertProducts(tx, client.id, created, skipped);
  const locations = upsertLocations(tx, wh.id, created, skipped);
  addStock(tx, ctx, { warehouseId: wh.id, clientId: client.id, products, locations }, created, skipped);
  ensureOpenOrder(tx, ctx, { warehouseId: wh.id, clientId: client.id, products }, created, skipped);
  return { created, skipped };
}
