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
 *   - MLT-LP-01 stock on a carton LP nested in a pallet LP, order KS-FIXTURE-PLAN-LP allocated
 *     from it and an In Progress shipment plan holding that order (shipping.md REQ-5);
 *   - lookups adjustment_reason "Import" and damage_reason "Damaged";
 *   - missing Settings → Apps catalog rows (analytics apps active, as in the demo seed);
 *   - contract rates for extra services (VAS fees) and kitting (Work Order fees) on the approved
 *     demo contracts (seed/billing.ts `ensureContractRates`), and one extra service record that
 *     points at a completed work order (`ensureKittingVas`).
 */
import { and, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm';
import type { AppDb } from '@/server/api/db';
import * as schema from '@/server/db/schema';
import { DEFAULT_ROLE_PERMISSIONS, type DefaultRoleKey } from '@/server/auth/permission-catalog';
import { allocation, changeLog, licensePlates, sequences } from '@/server/domain';
import { ledger } from '@/server/domain/ledger';
import { createOrder } from '@/server/domain/orders';
import type { DomainCtx } from '@/server/domain/types';
import { syncAllClientsToCore, syncAllProductsToCore } from '@/server/repositories/core-sync';
import { seedStationFixtures } from '@/server/repositories/packing-fixtures';
import { ensureDemoSuggestedListings } from '@/server/repositories/listings-demo';
import { ensureContractRates, ensureKittingVas } from './billing';
import { SEED_APPS } from './platform';
import { dbGet } from '@/server/db/sql';

export const FIXTURE_WAREHOUSE_CODE = 'MLT1';
export const FIXTURE_CLIENT_CODE = 'APX';
export const FIXTURE_ORDER_REFERENCE = 'KS-FIXTURE-M06';
export const FIXTURE_PLAN_ORDER_REFERENCE = 'KS-FIXTURE-PLAN-LP';
const PLAN_LP_SKU = 'MLT-LP-01';

interface ProductFixture {
  readonly sku: string;
  readonly name: string;
  readonly barcode: string;
  readonly price: number;
  readonly kit?: boolean;
}

const PRODUCTS: readonly ProductFixture[] = [
  { sku: 'MLT-WIDGET-01', name: 'MLTest Widget 01', barcode: '850012300011', price: 12.5 },
  { sku: 'MLT-WIDGET-02', name: 'MLTest Widget 02', barcode: '850012300028', price: 14 },
  { sku: 'MLT-KIT-COMP', name: 'MLTest Kit Component', barcode: '850012300035', price: 6.25 },
  { sku: 'MLT-KIT-2PK', name: 'MLTest 2 Pack Kit', barcode: '850012300042', price: 19.99, kit: true },
  { sku: PLAN_LP_SKU, name: 'MLTest Pallet Item', barcode: '850012300059', price: 9.75 },
];

interface LocationFixture {
  readonly code: string;
  readonly type: 'Picking' | 'Reserve';
  readonly areaType: 'Picking' | 'Storage';
  readonly bay: string;
  readonly onlyOneSku: boolean;
}

const LOCATIONS: readonly LocationFixture[] = [
  { code: 'MLT1-A-01', type: 'Reserve', areaType: 'Storage', bay: 'A', onlyOneSku: true },
  { code: 'MLT1-B-01', type: 'Reserve', areaType: 'Storage', bay: 'B', onlyOneSku: false },
  { code: 'MLT1-C-01', type: 'Picking', areaType: 'Picking', bay: 'C', onlyOneSku: false },
];

const STOCK: readonly { readonly sku: string; readonly location: string; readonly qty: number }[] = [
  { sku: 'MLT-WIDGET-01', location: 'MLT1-A-01', qty: 20 },
  { sku: 'MLT-WIDGET-02', location: 'MLT1-C-01', qty: 4 },
  { sku: 'MLT-KIT-COMP', location: 'MLT1-C-01', qty: 22 },
];

const LOOKUPS: readonly { readonly type: 'adjustment_reason' | 'damage_reason'; readonly name: string }[] = [
  { type: 'adjustment_reason', name: 'Import' },
  { type: 'damage_reason', name: 'Damaged' },
];

export interface FixtureReport {
  readonly created: readonly string[];
  readonly skipped: readonly string[];
}

function required<T>(row: T | undefined, what: string): T {
  if (!row) throw new Error(`Acceptance fixtures: ${what} not found`);
  return row;
}

async function upsertLookups(tx: AppDb, created: string[], skipped: string[]): Promise<void> {
  for (const l of LOOKUPS) {
    const lv = schema.lookupValues;
    const found = (
      await tx
        .select({ id: lv.id })
        .from(lv)
        .where(and(eq(lv.type, l.type), eq(lv.name, l.name), isNull(lv.clientId), isNull(lv.warehouseId)))
        .limit(1)
    )[0];
    if (found) {
      skipped.push(`lookup ${l.type}/${l.name}`);
      continue;
    }
    const order =
      (
        await dbGet<{ n: number | null }>(
          tx,
          sql`SELECT MAX(sort_order) AS n FROM lookup_values WHERE type = ${l.type}`,
        )
      )?.n ?? -1;
    await tx.insert(lv).values({ type: l.type, name: l.name, isActive: true, sortOrder: Number(order) + 1 });
    created.push(`lookup ${l.type}/${l.name}`);
  }
}

async function upsertProducts(
  tx: AppDb,
  clientId: string,
  created: string[],
  skipped: string[],
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const p of PRODUCTS) {
    const found = (
      await tx
        .select({ id: schema.products.id })
        .from(schema.products)
        .where(and(eq(schema.products.clientId, clientId), eq(schema.products.sku, p.sku)))
        .limit(1)
    )[0];
    if (found) {
      ids.set(p.sku, found.id);
      skipped.push(`product ${p.sku}`);
      continue;
    }
    const row = (
      await tx
        .insert(schema.products)
        .values({
          clientId,
          sku: p.sku,
          barcode: p.barcode,
          name: p.name,
          category: 'General',
          uom: 'Each',
          weightOz: 8,
          lengthIn: 6,
          widthIn: 4,
          heightIn: 2,
          price: p.price,
          purchasePrice: Math.round(p.price * 42) / 100,
          isKit: Boolean(p.kit),
          status: 'Active',
          productCategory: p.kit ? 'Kit' : 'Product',
          kitType: p.kit ? 'Kit to Stock' : null,
          description: p.kit ? 'Acceptance kit: two MLTest kit components.' : 'Acceptance fixture SKU.',
        })
        .returning({ id: schema.products.id })
    )[0];
    const pack = (
      await tx
        .insert(schema.productPackTypes)
        .values({
          productId: row.id,
          packType: 'Each',
          kind: 'Primary',
          uomQty: 1,
          length: 6,
          width: 4,
          height: 2,
          volume: 48,
          weight: 0.5,
        })
        .returning({ id: schema.productPackTypes.id })
    )[0];
    await tx
      .insert(schema.productBarcodes)
      .values({ productId: row.id, packTypeId: pack.id, barcode: p.barcode });
    ids.set(p.sku, row.id);
    created.push(`product ${p.sku}`);
  }
  const kitId = required(ids.get('MLT-KIT-2PK'), 'kit');
  const compId = required(ids.get('MLT-KIT-COMP'), 'kit component');
  const kc = schema.kitComponents;
  if (
    !(
      await tx
        .select({ id: kc.id })
        .from(kc)
        .where(and(eq(kc.kitProductId, kitId), eq(kc.componentProductId, compId)))
        .limit(1)
    )[0]
  ) {
    await tx
      .insert(kc)
      .values({ kitProductId: kitId, componentProductId: compId, quantity: 2, packType: 'Each' });
    created.push('kit component MLT-KIT-2PK → MLT-KIT-COMP × 2');
  }
  return ids;
}

async function upsertLocations(
  tx: AppDb,
  warehouseId: string,
  created: string[],
  skipped: string[],
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const l of LOCATIONS) {
    const found = (
      await tx
        .select({ id: schema.locations.id })
        .from(schema.locations)
        .where(and(eq(schema.locations.warehouseId, warehouseId), eq(schema.locations.code, l.code)))
        .limit(1)
    )[0];
    if (found) {
      ids.set(l.code, found.id);
      skipped.push(`location ${l.code}`);
      continue;
    }
    const row = (
      await tx
        .insert(schema.locations)
        .values({
          warehouseId,
          code: l.code,
          barcode: l.code,
          zone: 'MLT',
          aisle: '01',
          bay: l.bay,
          level: '1',
          type: l.type,
          capacityUnits: 200,
          isActive: true,
          locationType: 'Shelves',
          areaType: l.areaType,
          onlyOneSku: l.onlyOneSku,
        })
        .returning({ id: schema.locations.id })
    )[0];
    ids.set(l.code, row.id);
    created.push(`location ${l.code}`);
  }
  return ids;
}

async function addStock(
  tx: AppDb,
  ctx: DomainCtx,
  refs: {
    warehouseId: string;
    clientId: string;
    products: Map<string, string>;
    locations: Map<string, string>;
  },
  created: string[],
  skipped: string[],
): Promise<void> {
  for (const s of STOCK) {
    const productId = required(refs.products.get(s.sku), s.sku);
    const locationId = required(refs.locations.get(s.location), s.location);
    const i = schema.inventory;
    const existing = (
      await tx
        .select({ id: i.id })
        .from(i)
        .where(and(eq(i.productId, productId), eq(i.locationId, locationId), gt(i.onHand, 0)))
        .limit(1)
    )[0];
    if (existing) {
      skipped.push(`stock ${s.sku} @ ${s.location}`);
      continue;
    }
    await ledger.add(tx, ctx, {
      warehouseId: refs.warehouseId,
      clientId: refs.clientId,
      productId,
      locationId,
      qty: s.qty,
      packType: 'Each',
      type: 'Inventory Adjustment',
      refs: { note: 'Acceptance fixture stock' },
    });
    created.push(`stock ${s.qty} × ${s.sku} @ ${s.location}`);
  }
}

async function ensureOpenOrder(
  tx: AppDb,
  ctx: DomainCtx,
  refs: { warehouseId: string; clientId: string; products: Map<string, string> },
  created: string[],
  skipped: string[],
): Promise<void> {
  const so = schema.shipmentOrders;
  const found = (
    await tx
      .select({ id: so.id })
      .from(so)
      .where(
        and(
          eq(so.clientId, refs.clientId),
          eq(so.clientReferenceCode, FIXTURE_ORDER_REFERENCE),
          isNull(so.deletedAt),
        ),
      )
      .limit(1)
  )[0];
  if (found) {
    skipped.push(`order ${FIXTURE_ORDER_REFERENCE}`);
    return;
  }
  const order = await createOrder(tx, ctx, {
    warehouseId: refs.warehouseId,
    clientId: refs.clientId,
    clientReferenceCode: FIXTURE_ORDER_REFERENCE,
    customerName: 'Dana Whitfield',
    customerEmail: 'dana.whitfield@example.com',
    shipAddress: '418 Larkspur Lane',
    shipCity: 'Columbus',
    shipState: 'OH',
    shipZip: '43215',
    shipCountry: 'United States',
    skipAddressVerification: true,
    note: 'Acceptance fixture: open order for MLT-WIDGET-01.',
    lines: [
      {
        productId: required(refs.products.get('MLT-WIDGET-01'), 'MLT-WIDGET-01'),
        quantity: 2,
        unitPrice: 12.5,
      },
    ],
  });
  created.push(`order ${order.code} (2 × MLT-WIDGET-01)`);
}

/* ------------------------------------------------- shipment plan on LP stock (shipping REQ-5) */

/**
 * A shipment plan whose order is allocated from license-plate stock, so `/shipment-plans/lps`
 * and the plan detail "License plates" card have believable data: a pallet (PLT) parent LP
 * holding a carton (PC) LP with 12 × MLT-LP-01 at MLT1-C-01; order KS-FIXTURE-PLAN-LP for 6 ×
 * MLT-LP-01 allocated through `allocation.allocateOrders` (the LP bucket is the SKU's only stock)
 * and an In Progress plan at gate LOAD-01. Everything goes through the ledger / domain, so
 * `db:verify` stays green.
 */
async function ensurePlanOnLps(
  tx: AppDb,
  ctx: DomainCtx,
  refs: {
    warehouseId: string;
    clientId: string;
    products: Map<string, string>;
    locations: Map<string, string>;
  },
  created: string[],
  skipped: string[],
): Promise<void> {
  const productId = required(refs.products.get(PLAN_LP_SKU), PLAN_LP_SKU);
  const locationId = required(refs.locations.get('MLT1-C-01'), 'MLT1-C-01');
  const i = schema.inventory;
  const lpStock = (
    await tx
      .select({ id: i.id })
      .from(i)
      .where(and(eq(i.productId, productId), isNotNull(i.lpId)))
      .limit(1)
  )[0];
  if (lpStock) skipped.push(`LP stock ${PLAN_LP_SKU}`);
  else {
    const lpType = async (code: string) =>
      required(
        (
          await tx
            .select({ id: schema.lpTypes.id })
            .from(schema.lpTypes)
            .where(and(eq(schema.lpTypes.warehouseId, refs.warehouseId), eq(schema.lpTypes.code, code)))
            .limit(1)
        )[0],
        `LP type ${code}`,
      ).id;
    const pallet = await licensePlates.create(tx, ctx, {
      warehouseId: refs.warehouseId,
      lpTypeId: await lpType('PLT'),
      locationId,
      clientId: refs.clientId,
    });
    const carton = await licensePlates.create(tx, ctx, {
      warehouseId: refs.warehouseId,
      lpTypeId: await lpType('PC'),
      locationId,
      clientId: refs.clientId,
    });
    await tx
      .update(schema.licensePlates)
      .set({ parentLpId: pallet.id, status: 'Occupied' })
      .where(eq(schema.licensePlates.id, carton.id));
    await ledger.add(tx, ctx, {
      warehouseId: refs.warehouseId,
      clientId: refs.clientId,
      productId,
      locationId,
      lpId: carton.id,
      qty: 12,
      packType: 'Each',
      type: 'Inventory Adjustment',
      refs: { note: 'Acceptance fixture LP stock' },
    });
    await tx
      .update(schema.licensePlates)
      .set({ status: 'Occupied' })
      .where(eq(schema.licensePlates.id, pallet.id));
    created.push(`LPs ${pallet.number} > ${carton.number} with 12 × ${PLAN_LP_SKU} @ MLT1-C-01`);
  }

  const so = schema.shipmentOrders;
  let order = (
    await tx
      .select({ id: so.id, code: so.code, status: so.status })
      .from(so)
      .where(
        and(
          eq(so.clientId, refs.clientId),
          eq(so.clientReferenceCode, FIXTURE_PLAN_ORDER_REFERENCE),
          isNull(so.deletedAt),
        ),
      )
      .limit(1)
  )[0];
  if (order) skipped.push(`order ${FIXTURE_PLAN_ORDER_REFERENCE}`);
  else {
    const row = await createOrder(tx, ctx, {
      warehouseId: refs.warehouseId,
      clientId: refs.clientId,
      clientReferenceCode: FIXTURE_PLAN_ORDER_REFERENCE,
      customerName: 'Harbor Point Outfitters',
      customerEmail: 'receiving@harborpoint.example.com',
      shipAddress: '2200 Commerce Pkwy',
      shipCity: 'Louisville',
      shipState: 'KY',
      shipZip: '40218',
      shipCountry: 'United States',
      skipAddressVerification: true,
      note: 'Acceptance fixture: wholesale order on a shipment plan, allocated from LP stock.',
      lines: [{ productId, quantity: 6, unitPrice: 9.75 }],
    });
    order = { id: row.id, code: row.code, status: row.status };
    created.push(`order ${row.code} (6 × ${PLAN_LP_SKU})`);
  }
  if (order.status === 'Open' || order.status === 'Shortage') {
    const result = await allocation.allocateOrders(tx, ctx, {
      orderIds: [order.id],
      warehouseId: refs.warehouseId,
      runBy: 'Seed',
    });
    if (result.allocated.length !== 1)
      throw new Error(`Acceptance fixtures: ${FIXTURE_PLAN_ORDER_REFERENCE} did not allocate from LP stock`);
    created.push(`allocation ${order.code} from LP stock`);
  }

  const spo = schema.shipmentPlanOrders;
  if ((await tx.select({ p: spo.planId }).from(spo).where(eq(spo.orderId, order.id)).limit(1))[0]) {
    skipped.push(`shipment plan for ${order.code}`);
    return;
  }
  const gate = (
    await tx
      .select({ id: schema.locations.id })
      .from(schema.locations)
      .where(
        and(eq(schema.locations.warehouseId, refs.warehouseId), eq(schema.locations.areaType, 'Loading')),
      )
      .orderBy(schema.locations.code)
      .limit(1)
  )[0];
  const code = await sequences.next(tx, 'shipmentPlan');
  const planned = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
  const plan = (
    await tx
      .insert(schema.shipmentPlans)
      .values({
        code,
        warehouseId: refs.warehouseId,
        clientId: refs.clientId,
        status: 'In Progress',
        truckPlateNumber: 'KY 4318-TR',
        loadingGateLocationId: gate?.id ?? null,
        plannedShipmentAt: planned,
        expectedTotalWeight: 4,
        note: 'Acceptance fixture: plan order allocated from license plates.',
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: schema.shipmentPlans.id })
  )[0];
  await tx.insert(spo).values({ planId: plan.id, orderId: order.id, status: 'In Progress' });
  await changeLog.recordCreate(tx, ctx, { entityType: 'shipment_plan', entityId: plan.id, entityCode: code });
  created.push(`shipment plan ${code} (${order.code}, LP-allocated)`);
}

/**
 * Grants catalog keys added after the seed (e.g. `inventory.return_station.receive_return`) to the
 * system roles that get them by default. Only inserts missing grants; never revokes custom changes.
 */
export async function syncSystemRoleGrants(tx: AppDb, created: string[]): Promise<void> {
  const roles = await tx.select().from(schema.roles).where(eq(schema.roles.isSystem, true));
  for (const role of roles) {
    const keys = DEFAULT_ROLE_PERMISSIONS[role.key as DefaultRoleKey];
    if (!keys) continue;
    const have = new Set(
      (
        await tx
          .select({ p: schema.rolePermissions.permission })
          .from(schema.rolePermissions)
          .where(eq(schema.rolePermissions.roleId, role.id))
      ).map((r) => r.p),
    );
    const missing = keys.filter((k) => !have.has(k));
    if (missing.length === 0) continue;
    await tx
      .insert(schema.rolePermissions)
      .values(missing.map((permission) => ({ roleId: role.id, permission })))
      .onConflictDoNothing();
    created.push(
      `${missing.length} grant(s) for role ${role.key}: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', …' : ''}`,
    );
  }
}

/**
 * Inserts app catalog rows (Settings → Apps) that are missing, with their demo-seed activation
 * (Labor / Operational Analytics active). Existing rows, and so any activation change made in
 * the UI, are never touched.
 */
export async function upsertAppCatalog(tx: AppDb, created: string[]): Promise<void> {
  const have = new Set((await tx.select({ key: schema.apps.key }).from(schema.apps)).map((r) => r.key));
  const now = new Date().toISOString();
  const missing = SEED_APPS.filter(([key]) => !have.has(key));
  if (missing.length === 0) return;
  await tx.insert(schema.apps).values(
    missing.map(([key, name, description, category, active]) => ({
      key,
      name,
      description,
      category,
      isActive: active,
      activatedAt: active ? now : null,
      activatedBy: null,
    })),
  );
  created.push(`${missing.length} app catalog row(s): ${missing.map(([key]) => key).join(', ')}`);
}

/** Upserts every fixture. Run inside a transaction. */
export async function seedAcceptanceFixtures(tx: AppDb, ctx: DomainCtx): Promise<FixtureReport> {
  const created: string[] = [];
  const skipped: string[] = [];
  const wh = required(
    (
      await tx
        .select()
        .from(schema.warehouses)
        .where(eq(schema.warehouses.code, FIXTURE_WAREHOUSE_CODE))
        .limit(1)
    )[0],
    `warehouse ${FIXTURE_WAREHOUSE_CODE}`,
  );
  const client = required(
    (await tx.select().from(schema.clients).where(eq(schema.clients.code, FIXTURE_CLIENT_CODE)).limit(1))[0],
    `client ${FIXTURE_CLIENT_CODE}`,
  );
  await syncSystemRoleGrants(tx, created);
  await upsertAppCatalog(tx, created);
  await upsertLookups(tx, created, skipped);
  const products = await upsertProducts(tx, client.id, created, skipped);
  const locations = await upsertLocations(tx, wh.id, created, skipped);
  await addStock(tx, ctx, { warehouseId: wh.id, clientId: client.id, products, locations }, created, skipped);
  await ensureOpenOrder(tx, ctx, { warehouseId: wh.id, clientId: client.id, products }, created, skipped);
  await ensurePlanOnLps(
    tx,
    ctx,
    { warehouseId: wh.id, clientId: client.id, products, locations },
    created,
    skipped,
  );
  // M04: hospital HOSP-01 (Hospital group) + packable tote / location / cart / pack-short orders.
  const stations = await seedStationFixtures(tx, ctx);
  created.push(...stations.created);
  skipped.push(...stations.skipped);
  // M09: Product Listings "Suggested" demo rows (Bluebird & Main Shopify).
  const listings = await ensureDemoSuggestedListings(tx, ctx);
  created.push(...listings.created.map((sku) => `listing ${sku}`));
  skipped.push(...listings.skipped.map((sku) => `listing ${sku}`));
  // Contract rates for extra services and kitting (what KitStak Pulse prices from).
  const rates = await ensureContractRates(tx);
  created.push(...rates.created);
  skipped.push(...rates.skipped);
  const kittingVas = await ensureKittingVas(tx);
  created.push(...kittingVas.created);
  skipped.push(...kittingVas.skipped);
  // Fixture products are inserted directly (not via the wizard commands), so mirror the
  // final state into the shared core registry (§2.4) the same way db:seed does.
  await syncAllClientsToCore(tx);
  await syncAllProductsToCore(tx);
  return { created, skipped };
}
