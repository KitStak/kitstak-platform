/**
 * Full seed against an in-memory database: the replay must reconcile (db:verify), cover
 * every entity the plan lists, and keep the demo login working.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOOKUP_TYPES } from "@/lib/enums";
import { verifyPassword } from "@/server/auth/password";
import * as schema from "@/server/db/schema";
import { runSeed, type SeedReport } from "@/server/db/seed/index";
import { isRuntimeInstalled } from "@/server/db/seed/runtime";
import { verifyDatabase } from "@/server/db/seed/verify";
import { createFileStore } from "@/server/files";
import { createTestDb, hasMigrations, type TestDb } from "../../setup/test-db";
import { dbGet } from "@/server/db/sql";

const SEED_TIMEOUT = 240_000;
/** Removing ~hundreds of label PDFs can be slow on Windows under load (AV scanning). */
const CLEANUP_TIMEOUT = 60_000;

describe.skipIf(!hasMigrations())("runSeed", () => {
  let testDb: TestDb;
  let report: SeedReport;
  let filesRoot: string;

  beforeAll(async () => {
    filesRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kitstak-seed-"));
    testDb = await createTestDb();
    report = await runSeed(testDb.db, { files: createFileStore({ root: filesRoot }) });
  }, SEED_TIMEOUT);

  afterAll(async () => {
    await testDb?.close();
    if (filesRoot) fs.rmSync(filesRoot, { recursive: true, force: true, maxRetries: 3 });
  }, CLEANUP_TIMEOUT);

  const n = async (table: string): Promise<number> => (await dbGet<{ n: number }>(testDb.db, sql.raw(`SELECT COUNT(*) AS n FROM "${table}"`)))?.n ?? 0;

  it("reconciles every ledger invariant and uninstalls its runtime", async () => {
    expect(report.ledgerIssues).toEqual([]);
    expect((await verifyDatabase(testDb.db)).issues).toEqual([]);
    expect(report.failures).toBe(0);
    expect(isRuntimeInstalled()).toBe(false);
  });

  it("keeps the demo admin login and seeds one user per role", async () => {
    const admin = (await testDb.db.select().from(schema.users).where(eq(schema.users.email, "admin@kitstak.io")).limit(1))[0];
    expect(admin !== undefined && verifyPassword("KitStak!demo2026", admin.passwordHash)).toBe(true);
    expect(await n("users")).toBe(10);
    const roleKeys = (await testDb.db.select({ key: schema.roles.key }).from(schema.roles)).map((r) => r.key).sort();
    expect(roleKeys).toEqual(["admin", "client", "manager", "operator", "viewer"]);
    expect(await n("user_roles")).toBe(10);
    expect(await n("user_clients")).toBe(2);
    expect(await testDb.db.select().from(schema.users).where(eq(schema.users.isApiUser, true))).toHaveLength(1);
  });

  it("covers all lookup types and platform defaults", async () => {
    const types = new Set((await testDb.db.select({ type: schema.lookupValues.type }).from(schema.lookupValues)).map((r) => r.type));
    expect([...types].sort()).toEqual([...LOOKUP_TYPES].sort());
    expect(await n("printout_templates")).toBe(25);
    expect(await n("tags")).toBe(15);
    expect(await n("saved_views")).toBe(3);
    expect(await n("notifications")).toBe(10);
    expect(await n("warehouses")).toBe(2);
    expect(await n("retailers")).toBe(4);
    expect(await n("carrier_services")).toBeGreaterThanOrEqual(12);
  });

  it("replays a believable 30-day history", async () => {
    expect(await n("shipment_orders")).toBeGreaterThan(380);
    expect(await n("purchase_orders")).toBeGreaterThanOrEqual(30);
    expect(await n("receipts")).toBeGreaterThan(50);
    expect(await n("waves")).toBeGreaterThan(50);
    expect(await n("jobs")).toBeGreaterThan(50);
    expect(await n("shipments")).toBeGreaterThan(300);
    expect(await n("return_orders")).toBe(12);
    expect(await n("count_plans")).toBeGreaterThanOrEqual(6);
    expect(await n("work_orders")).toBe(8);
    expect(await n("shipment_plans")).toBe(4);
    expect(await n("channel_runs")).toBeGreaterThan(300);
    expect(await n("channel_missing_orders")).toBe(9);
    expect(await n("inventory_snapshots")).toBeGreaterThan(0);
    const statuses = new Set((await testDb.db.select({ s: schema.shipmentOrders.status }).from(schema.shipmentOrders)).map((r) => r.s));
    for (const s of ["Delivered", "Shipped", "Cancelled", "Open"] as const) expect(statuses.has(s)).toBe(true);
    const txnTypes = new Set((await testDb.db.select({ t: schema.inventoryTransactions.type }).from(schema.inventoryTransactions)).map((r) => r.t));
    for (const t of ["Receiving", "Picking", "Packing", "Shipment", "Return Receiving", "Count", "Kitting", "Replenishment", "Inventory Adjustment"] as const) {
      expect(txnTypes.has(t)).toBe(true);
    }
    expect(await testDb.db.select().from(schema.carrierCallLogs).where(eq(schema.carrierCallLogs.status, "Error"))).toHaveLength(6);
    expect(await testDb.db.select().from(schema.shipments).where(eq(schema.shipments.labelStatus, "Voided"))).toHaveLength(3);
  });

  it("stamps history inside the replay window", async () => {
    const range = await dbGet<{ lo: string; hi: string }>(testDb.db, sql`SELECT MIN(at) AS lo, MAX(at) AS hi FROM inventory_transactions`);
    expect(range?.lo.startsWith("2026-10-0")).toBe(true);
    expect((range?.hi ?? "9") <= "2026-11-05T16:00:00.000Z").toBe(true);
  });

  it("detects a bucket that no longer matches its ledger", async () => {
    const bucket = (await testDb.db.select().from(schema.inventory).where(sql`${schema.inventory.onHand} > 0`).limit(1))[0];
    if (!bucket) throw new Error("no stock seeded");
    await testDb.db.update(schema.inventory).set({ onHand: bucket.onHand + 5 }).where(eq(schema.inventory.id, bucket.id));
    const checks = new Set((await verifyDatabase(testDb.db)).issues.map((i) => i.check));
    expect(checks.has("bucket_balance")).toBe(true);
    await testDb.db.update(schema.inventory).set({ onHand: bucket.onHand }).where(eq(schema.inventory.id, bucket.id));
  });
});
