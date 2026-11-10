/**
 * Minimal warehouse world for domain-engine tests, on an in-memory migrated database.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { jobTypeSettingsSchema } from "@/lib/domain-types";
import * as schema from "@/server/db/schema";
import type { DomainCtx } from "@/server/domain/types";
import { createFileStore, type FileStore } from "@/server/files";
import { createTestDb, type TestDb } from "../../../setup/test-db";

export interface World {
  readonly t: TestDb;
  readonly db: TestDb["db"];
  readonly ctx: DomainCtx;
  readonly userId: string;
  readonly warehouseId: string;
  readonly clientId: string;
  readonly otherClientId: string;
  readonly productId: string;
  readonly product2Id: string;
  readonly loc: { receiving: string; storageA: string; storageB: string; pick: string; pack: string; ship: string; returns: string; damaged: string };
  readonly jobTypeId: string;
  readonly carrierConnectionId: string;
  readonly serviceIds: { ground: string; priority: string; nextDay: string };
  readonly files: FileStore;
  readonly filesRoot: string;
  close(): void;
}

let counter = 0;

export function locationRow(warehouseId: string, code: string, extra: Partial<typeof schema.locations.$inferInsert> = {}): typeof schema.locations.$inferInsert {
  counter += 1;
  return {
    warehouseId, code, zone: "A", aisle: "01", bay: "01", level: "1", type: "Reserve", capacityUnits: 1000,
    walkingPathPriority: counter, ...extra,
  };
}

export function createWorld(): World {
  const t = createTestDb();
  const db = t.db;
  const userId = db.insert(schema.users).values({ email: "admin@test.io", name: "Admin", passwordHash: "x", role: "admin" }).returning().get().id;
  const warehouseId = db.insert(schema.warehouses).values({
    code: "MLT1", name: "Memphis", addressLine: "100 Main St", city: "Memphis", state: "TN", postalCode: "38118", timezone: "America/Chicago",
    mandatoryAdjustmentReason: false,
  }).returning().get().id;
  const client = (code: string) => db.insert(schema.clients).values({
    code, name: `${code} Inc`, contactName: "C", contactEmail: "c@x.io", phone: "1", billingPlan: "per-order", status: "Active",
  }).returning().get().id;
  const clientId = client("ACME");
  const otherClientId = client("BETA");
  const product = (sku: string, cid = clientId) => db.insert(schema.products).values({
    clientId: cid, sku, barcode: sku, name: sku, category: "General", weightOz: 8, lengthIn: 4, widthIn: 4, heightIn: 2, price: 10, status: "Active",
  }).returning().get().id;
  const productId = product("MLT-WIDGET-01");
  const product2Id = product("MLT-GADGET-02");
  const mk = (code: string, extra: Partial<typeof schema.locations.$inferInsert> = {}) => db.insert(schema.locations).values(locationRow(warehouseId, code, extra)).returning().get().id;
  const loc = {
    receiving: mk("RCV-01", { type: "Receiving", areaType: "Receiving" }),
    storageA: mk("A-01-01", { areaType: "Storage" }),
    storageB: mk("A-02-01", { areaType: "Picking", replenishmentType: "Target" }),
    pick: mk("TOTE-01", { type: "Picking", areaType: "Packing", preventAllocation: true }),
    pack: mk("PACK-01", { type: "Shipping", areaType: "Packing", preventAllocation: true }),
    ship: mk("SHIP-01", { type: "Shipping", areaType: "Shipment", preventAllocation: true }),
    returns: mk("RET-01", { type: "Returns", areaType: "Returns" }),
    damaged: mk("DMG-01", { type: "Damaged", onlyDamaged: true, preventAllocation: true }),
  };
  const jobTypeId = db.insert(schema.jobTypes).values({
    code: "MULTI", description: "Multi", warehouseId, operationType: "Picking", settings: jobTypeSettingsSchema.parse({}),
  }).returning().get().id;
  const carrierConnectionId = db.insert(schema.carrierConnections).values({
    provider: "kitstaks-sandbox", setupName: "Sandbox", accountPrefix: "SBX", warehouseId, settings: {},
  }).returning().get().id;
  const svc = (serviceCode: string, name: string, carrierCode: string, transitDays: number) => db.insert(schema.carrierServices).values({
    connectionId: carrierConnectionId, carrierCode, serviceCode, name, transitDays,
  }).returning().get().id;
  const serviceIds = {
    ground: svc("SBX_GROUND", "Ground", "UPS", 5),
    priority: svc("SBX_PRIORITY", "Priority Mail", "USPS", 3),
    nextDay: svc("SBX_NEXT_DAY", "Next Day Air", "UPS", 1),
  };
  const filesRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ks-f5-"));
  const files = createFileStore({ root: filesRoot });
  return {
    t, db, ctx: { userId, source: "admin@test.io" }, userId, warehouseId, clientId, otherClientId, productId, product2Id, loc,
    jobTypeId, carrierConnectionId, serviceIds, files, filesRoot,
    close() {
      t.close();
      fs.rmSync(filesRoot, { recursive: true, force: true });
    },
  };
}

export function orderInput(w: World, lines: { productId: string; quantity: number }[], extra: Record<string, unknown> = {}) {
  return {
    warehouseId: w.warehouseId, clientId: w.clientId, customerName: "Jane Doe", customerEmail: "jane@example.com",
    shipAddress: "200 Oak Ave", shipCity: "Little Rock", shipState: "Arkansas", shipZip: "72201", shipCountry: "USA",
    lines: lines.map((l) => ({ ...l, unitPrice: 10 })), ...extra,
  };
}

export function onHand(w: World, productId: string): number {
  return w.db.select().from(schema.inventory).where(eq(schema.inventory.productId, productId)).all().reduce((s, r) => s + r.onHand, 0);
}
