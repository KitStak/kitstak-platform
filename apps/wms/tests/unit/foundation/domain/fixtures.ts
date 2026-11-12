/**
 * Minimal warehouse world for domain-engine tests, on an in-memory migrated database.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { jobTypeSettingsSchema } from '@/lib/domain-types';
import * as schema from '@/server/db/schema';
import type { DomainCtx } from '@/server/domain/types';
import { createFileStore, type FileStore } from '@/server/files';
import { createTestDb, type TestDb } from '../../../setup/test-db';

export interface World {
  readonly t: TestDb;
  readonly db: TestDb['db'];
  readonly ctx: DomainCtx;
  readonly userId: string;
  readonly warehouseId: string;
  readonly clientId: string;
  readonly otherClientId: string;
  readonly productId: string;
  readonly product2Id: string;
  readonly loc: {
    receiving: string;
    storageA: string;
    storageB: string;
    pick: string;
    pack: string;
    ship: string;
    returns: string;
    damaged: string;
  };
  readonly jobTypeId: string;
  readonly carrierConnectionId: string;
  readonly serviceIds: { ground: string; priority: string; nextDay: string };
  readonly files: FileStore;
  readonly filesRoot: string;
  close(): Promise<void>;
}

let counter = 0;

export function locationRow(
  warehouseId: string,
  code: string,
  extra: Partial<typeof schema.locations.$inferInsert> = {},
): typeof schema.locations.$inferInsert {
  counter += 1;
  return {
    warehouseId,
    code,
    zone: 'A',
    aisle: '01',
    bay: '01',
    level: '1',
    type: 'Reserve',
    capacityUnits: 1000,
    walkingPathPriority: counter,
    ...extra,
  };
}

export async function createWorld(): Promise<World> {
  const t = await createTestDb();
  const db = t.db;
  const userId = (
    await db
      .insert(schema.users)
      .values({ email: 'admin@test.io', name: 'Admin', passwordHash: 'x', role: 'admin' })
      .returning()
  )[0].id;
  const warehouseId = (
    await db
      .insert(schema.warehouses)
      .values({
        code: 'MLT1',
        name: 'Memphis',
        addressLine: '100 Main St',
        city: 'Memphis',
        state: 'TN',
        postalCode: '38118',
        timezone: 'America/Chicago',
        mandatoryAdjustmentReason: false,
      })
      .returning()
  )[0].id;
  const client = async (code: string) =>
    (
      await db
        .insert(schema.clients)
        .values({
          code,
          name: `${code} Inc`,
          contactName: 'C',
          contactEmail: 'c@x.io',
          phone: '1',
          billingPlan: 'per-order',
          status: 'Active',
        })
        .returning()
    )[0].id;
  const clientId = await client('ACME');
  const otherClientId = await client('BETA');
  const product = async (sku: string, cid = clientId) =>
    (
      await db
        .insert(schema.products)
        .values({
          clientId: cid,
          sku,
          barcode: sku,
          name: sku,
          category: 'General',
          weightOz: 8,
          lengthIn: 4,
          widthIn: 4,
          heightIn: 2,
          price: 10,
          status: 'Active',
        })
        .returning()
    )[0].id;
  const productId = await product('MLT-WIDGET-01');
  const product2Id = await product('MLT-GADGET-02');
  const mk = async (code: string, extra: Partial<typeof schema.locations.$inferInsert> = {}) =>
    (
      await db
        .insert(schema.locations)
        .values(locationRow(warehouseId, code, extra))
        .returning()
    )[0].id;
  const loc = {
    receiving: await mk('RCV-01', { type: 'Receiving', areaType: 'Receiving' }),
    storageA: await mk('A-01-01', { areaType: 'Storage' }),
    storageB: await mk('A-02-01', { areaType: 'Picking', replenishmentType: 'Target' }),
    pick: await mk('TOTE-01', { type: 'Picking', areaType: 'Packing', preventAllocation: true }),
    pack: await mk('PACK-01', { type: 'Shipping', areaType: 'Packing', preventAllocation: true }),
    ship: await mk('SHIP-01', { type: 'Shipping', areaType: 'Shipment', preventAllocation: true }),
    returns: await mk('RET-01', { type: 'Returns', areaType: 'Returns' }),
    damaged: await mk('DMG-01', { type: 'Damaged', onlyDamaged: true, preventAllocation: true }),
  };
  const jobTypeId = (
    await db
      .insert(schema.jobTypes)
      .values({
        code: 'MULTI',
        description: 'Multi',
        warehouseId,
        operationType: 'Picking',
        settings: jobTypeSettingsSchema.parse({}),
      })
      .returning()
  )[0].id;
  const carrierConnectionId = (
    await db
      .insert(schema.carrierConnections)
      .values({
        provider: 'kitstaks-sandbox',
        setupName: 'Sandbox',
        accountPrefix: 'SBX',
        warehouseId,
        settings: {},
      })
      .returning()
  )[0].id;
  const svc = async (serviceCode: string, name: string, carrierCode: string, transitDays: number) =>
    (
      await db
        .insert(schema.carrierServices)
        .values({
          connectionId: carrierConnectionId,
          carrierCode,
          serviceCode,
          name,
          transitDays,
        })
        .returning()
    )[0].id;
  const serviceIds = {
    ground: await svc('SBX_GROUND', 'Ground', 'UPS', 5),
    priority: await svc('SBX_PRIORITY', 'Priority Mail', 'USPS', 3),
    nextDay: await svc('SBX_NEXT_DAY', 'Next Day Air', 'UPS', 1),
  };
  const filesRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ks-f5-'));
  const files = createFileStore({ root: filesRoot });
  return {
    t,
    db,
    ctx: { userId, source: 'admin@test.io' },
    userId,
    warehouseId,
    clientId,
    otherClientId,
    productId,
    product2Id,
    loc,
    jobTypeId,
    carrierConnectionId,
    serviceIds,
    files,
    filesRoot,
    async close() {
      await t.close();
      fs.rmSync(filesRoot, { recursive: true, force: true });
    },
  };
}

export function orderInput(
  w: World,
  lines: { productId: string; quantity: number }[],
  extra: Record<string, unknown> = {},
) {
  return {
    warehouseId: w.warehouseId,
    clientId: w.clientId,
    customerName: 'Jane Doe',
    customerEmail: 'jane@example.com',
    shipAddress: '200 Oak Ave',
    shipCity: 'Little Rock',
    shipState: 'Arkansas',
    shipZip: '72201',
    shipCountry: 'USA',
    lines: lines.map((l) => ({ ...l, unitPrice: 10 })),
    ...extra,
  };
}

export async function onHand(w: World, productId: string): Promise<number> {
  return (await w.db.select().from(schema.inventory).where(eq(schema.inventory.productId, productId))).reduce(
    (s, r) => s + r.onHand,
    0,
  );
}
