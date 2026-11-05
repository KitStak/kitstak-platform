/**
 * Deterministic seed for the KitStak demo database.
 * Run with: npm run db:seed  (after npm run db:push)
 */
import { count } from "drizzle-orm";
import { hashPassword } from "../auth/password";
import { db, schema } from "./index";
import {
  buildAuditRows,
  buildInventoryRows,
  buildJobs,
  buildPurchaseOrders,
  type SeedProductRef,
} from "./seed-builders";
import {
  CLIENT_SEEDS,
  Rng,
  USER_SEEDS,
  buildLocationSeeds,
  buildProductSeeds,
} from "./seed-data";
import { buildOrders, isoDaysAgo, type ClientRef } from "./seed-orders";

const SEED = 20261105;

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

function chunks<T>(rows: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    result.push(rows.slice(i, i + size));
  }
  return result;
}

function wipe(): void {
  // FK-safe order: children before parents.
  db.delete(schema.auditLog).run();
  db.delete(schema.orderLines).run();
  db.delete(schema.shipmentOrders).run();
  db.delete(schema.purchaseOrderLines).run();
  db.delete(schema.purchaseOrders).run();
  db.delete(schema.jobs).run();
  db.delete(schema.inventory).run();
  db.delete(schema.locations).run();
  db.delete(schema.products).run();
  db.delete(schema.clients).run();
  db.delete(schema.warehouses).run();
  db.delete(schema.users).run();
}

function seed(): void {
  const rng = new Rng(SEED);
  wipe();

  /* users */
  const passwordHash = hashPassword("KitStak!demo2026");
  const userRows = USER_SEEDS.map((u, i) => ({
    id: `usr-${String(i + 1).padStart(2, "0")}`,
    email: u.email,
    name: u.name,
    passwordHash,
    role: u.role,
    isActive: true,
    createdAt: isoDaysAgo(420 - i * 30, 10, 15),
  }));
  db.insert(schema.users).values(userRows).run();
  const operatorIds = userRows.filter((u) => u.role === "operator").map((u) => u.id);

  /* warehouses */
  const MLT1 = "wh-mlt1";
  db.insert(schema.warehouses)
    .values([
      { id: MLT1, code: "MLT1", name: "MLT1 – Main Fulfillment", addressLine: "2200 Commerce Park Dr", city: "Louisville", state: "KY", isDefault: true },
      { id: "wh-ks2", code: "KS2", name: "KS2 – Overflow", addressLine: "480 Gateway Logistics Blvd", city: "Shepherdsville", state: "KY", isDefault: false },
    ])
    .run();

  /* clients */
  const clientRows = CLIENT_SEEDS.map((c, i) => ({
    id: `cli-${String(i + 1).padStart(2, "0")}`,
    code: c.code,
    name: c.name,
    contactName: c.contactName,
    contactEmail: c.contactEmail,
    phone: c.phone,
    billingPlan: c.billingPlan,
    status: c.status,
    createdAt: isoDaysAgo(700 - i * 55, 9, 30),
  }));
  db.insert(schema.clients).values(clientRows).run();
  const clientIdByCode = new Map(clientRows.map((c) => [c.code, c.id]));

  /* products */
  const productSeeds = buildProductSeeds();
  const productRows = productSeeds.map((p, i) => ({
    id: `prd-${String(i + 1).padStart(3, "0")}`,
    clientId: clientIdByCode.get(p.clientCode) ?? clientRows[0].id,
    sku: p.sku,
    barcode: String(841000000000 + i * 37),
    name: p.name,
    category: p.category,
    uom: "Each",
    weightOz: p.weightOz,
    lengthIn: p.lengthIn,
    widthIn: p.widthIn,
    heightIn: p.heightIn,
    price: p.price,
    isKit: p.isKit,
    isFragile: p.isFragile,
    isHazmat: false,
    status: rng.chance(0.05) ? ("Inactive" as const) : ("Active" as const),
    reorderPoint: rng.int(10, 60),
    createdAt: isoDaysAgo(rng.int(90, 540), rng.int(8, 17), rng.int(0, 59)),
  }));
  for (const chunk of chunks(productRows, 40)) {
    db.insert(schema.products).values(chunk).run();
  }

  const productRefs: SeedProductRef[] = productRows.map((row) => ({
    id: row.id,
    clientId: row.clientId,
    price: row.price,
    weightOz: row.weightOz,
    isKit: row.isKit,
    category: row.category,
  }));
  const productsByClient = new Map<string, SeedProductRef[]>();
  for (const ref of productRefs) {
    const list = productsByClient.get(ref.clientId) ?? [];
    list.push(ref);
    productsByClient.set(ref.clientId, list);
  }

  /* locations (all in MLT1) */
  const locationSeeds = buildLocationSeeds();
  const locationRows = locationSeeds.map((l, i) => ({
    id: `loc-${String(i + 1).padStart(4, "0")}`,
    warehouseId: MLT1,
    code: l.code,
    zone: l.zone,
    aisle: l.aisle,
    bay: l.bay,
    level: l.level,
    type: l.type,
    capacityUnits: l.capacityUnits,
    isActive: true,
  }));
  for (const chunk of chunks(locationRows, 60)) {
    db.insert(schema.locations).values(chunk).run();
  }

  /* inventory */
  const inventoryRows = buildInventoryRows(
    rng,
    MLT1,
    productRefs,
    locationRows.map((l) => ({ id: l.id, type: l.type }))
  );
  for (const chunk of chunks(inventoryRows, 80)) {
    db.insert(schema.inventory).values(chunk).run();
  }

  /* jobs (before orders so orders can reference pick jobs) */
  const jobRows = buildJobs(rng, MLT1, clientRows.map((c) => c.id), operatorIds);
  db.insert(schema.jobs).values(jobRows).run();
  const pickJobIds = jobRows
    .filter((j) => (j.status === "Pending" || j.status === "In Progress") && j.waveNumber !== null)
    .map((j) => j.id);

  /* shipment orders */
  const activeWeights: Record<string, number> = {
    APX: 20, NOVA: 18, CPL: 14, BLB: 12, VLT: 12, SMT: 9, HRB: 8, PXP: 7,
  };
  const clientRefs: ClientRef[] = clientRows.map((c) => ({
    id: c.id,
    name: c.name,
    weight: activeWeights[c.code] ?? 5,
  }));
  const { orders, lines } = buildOrders(rng, MLT1, clientRefs, productsByClient, pickJobIds);
  for (const chunk of chunks(orders, 30)) {
    db.insert(schema.shipmentOrders).values(chunk).run();
  }
  for (const chunk of chunks(lines, 100)) {
    db.insert(schema.orderLines).values(chunk).run();
  }

  /* purchase orders */
  const poClients = clientRows.map((c, i) => ({ id: c.id, category: CLIENT_SEEDS[i].category }));
  const { purchaseOrders: poRows, lines: poLines } = buildPurchaseOrders(rng, MLT1, poClients, productsByClient);
  db.insert(schema.purchaseOrders).values(poRows).run();
  for (const chunk of chunks(poLines, 100)) {
    db.insert(schema.purchaseOrderLines).values(chunk).run();
  }

  /* audit log */
  db.insert(schema.auditLog).values(buildAuditRows(rng, userRows.slice(0, 6).map((u) => u.id))).run();
}

function report(): void {
  const tables = [
    ["users", schema.users],
    ["warehouses", schema.warehouses],
    ["clients", schema.clients],
    ["products", schema.products],
    ["locations", schema.locations],
    ["inventory", schema.inventory],
    ["shipment_orders", schema.shipmentOrders],
    ["order_lines", schema.orderLines],
    ["purchase_orders", schema.purchaseOrders],
    ["purchase_order_lines", schema.purchaseOrderLines],
    ["jobs", schema.jobs],
    ["audit_log", schema.auditLog],
  ] as const;
  out("Seed complete. Row counts:");
  for (const [name, table] of tables) {
    const row = db.select({ n: count() }).from(table).get();
    out(`  ${name.padEnd(22)} ${row?.n ?? 0}`);
  }
}

try {
  seed();
  report();
} catch (error: unknown) {
  console.error("Seed failed:", error);
  process.exitCode = 1;
}
