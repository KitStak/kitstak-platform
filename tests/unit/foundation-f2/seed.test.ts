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

const SEED_TIMEOUT = 240_000;
/** Removing ~hundreds of label PDFs can be slow on Windows under load (AV scanning). */
const CLEANUP_TIMEOUT = 60_000;

describe.skipIf(!hasMigrations())("runSeed", () => {
  let testDb: TestDb;
  let report: SeedReport;
  let filesRoot: string;

  beforeAll(async () => {
    filesRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kitstak-seed-"));
    testDb = createTestDb();
    report = await runSeed(testDb.db, { files: createFileStore({ root: filesRoot }) });
  }, SEED_TIMEOUT);

  afterAll(() => {
    testDb?.close();
    if (filesRoot) fs.rmSync(filesRoot, { recursive: true, force: true, maxRetries: 3 });
  }, CLEANUP_TIMEOUT);

  const n = (table: string): number => testDb.db.get<{ n: number }>(sql.raw(`SELECT COUNT(*) AS n FROM "${table}"`))?.n ?? 0;

  it("reconciles every ledger invariant and uninstalls its runtime", () => {
    expect(report.ledgerIssues).toEqual([]);
    expect(verifyDatabase(testDb.db).issues).toEqual([]);
    expect(report.failures).toBe(0);
    expect(isRuntimeInstalled()).toBe(false);
  });

  it("keeps the demo admin login and seeds one user per role", () => {
    const admin = testDb.db.select().from(schema.users).where(eq(schema.users.email, "admin@kitstak.io")).get();
    expect(admin !== undefined && verifyPassword("KitStak!demo2026", admin.passwordHash)).toBe(true);
    expect(n("users")).toBe(10);
    const roleKeys = testDb.db.select({ key: schema.roles.key }).from(schema.roles).all().map((r) => r.key).sort();
    expect(roleKeys).toEqual(["admin", "client", "manager", "operator", "viewer"]);
    expect(n("user_roles")).toBe(10);
    expect(n("user_clients")).toBe(2);
    expect(testDb.db.select().from(schema.users).where(eq(schema.users.isApiUser, true)).all()).toHaveLength(1);
  });

  it("covers all lookup types and platform defaults", () => {
    const types = new Set(testDb.db.select({ type: schema.lookupValues.type }).from(schema.lookupValues).all().map((r) => r.type));
    expect([...types].sort()).toEqual([...LOOKUP_TYPES].sort());
    expect(n("printout_templates")).toBe(25);
    expect(n("tags")).toBe(15);
    expect(n("saved_views")).toBe(3);
    expect(n("notifications")).toBe(10);
    expect(n("warehouses")).toBe(2);
    expect(n("retailers")).toBe(4);
    expect(n("carrier_services")).toBeGreaterThanOrEqual(12);
  });

  it("replays a believable 30-day history", () => {
    expect(n("shipment_orders")).toBeGreaterThan(380);
    expect(n("purchase_orders")).toBeGreaterThanOrEqual(30);
    expect(n("receipts")).toBeGreaterThan(50);
    expect(n("waves")).toBeGreaterThan(50);
    expect(n("jobs")).toBeGreaterThan(50);
    expect(n("shipments")).toBeGreaterThan(300);
    expect(n("return_orders")).toBe(12);
    expect(n("count_plans")).toBeGreaterThanOrEqual(6);
    expect(n("work_orders")).toBe(8);
    expect(n("shipment_plans")).toBe(4);
    expect(n("channel_runs")).toBeGreaterThan(300);
    expect(n("channel_missing_orders")).toBe(9);
    expect(n("inventory_snapshots")).toBeGreaterThan(0);
    const statuses = new Set(testDb.db.select({ s: schema.shipmentOrders.status }).from(schema.shipmentOrders).all().map((r) => r.s));
    for (const s of ["Delivered", "Shipped", "Cancelled", "Open"] as const) expect(statuses.has(s)).toBe(true);
    const txnTypes = new Set(testDb.db.select({ t: schema.inventoryTransactions.type }).from(schema.inventoryTransactions).all().map((r) => r.t));
    for (const t of ["Receiving", "Picking", "Packing", "Shipment", "Return Receiving", "Count", "Kitting", "Replenishment", "Inventory Adjustment"] as const) {
      expect(txnTypes.has(t)).toBe(true);
    }
    expect(testDb.db.select().from(schema.carrierCallLogs).where(eq(schema.carrierCallLogs.status, "Error")).all()).toHaveLength(6);
    expect(testDb.db.select().from(schema.shipments).where(eq(schema.shipments.labelStatus, "Voided")).all()).toHaveLength(3);
  });

  it("stamps history inside the replay window", () => {
    const range = testDb.db.get<{ lo: string; hi: string }>(sql`SELECT MIN(at) AS lo, MAX(at) AS hi FROM inventory_transactions`);
    expect(range?.lo.startsWith("2026-10-0")).toBe(true);
    expect((range?.hi ?? "9") <= "2026-11-05T16:00:00.000Z").toBe(true);
  });

  it("detects a bucket that no longer matches its ledger", () => {
    const bucket = testDb.db.select().from(schema.inventory).where(sql`${schema.inventory.onHand} > 0`).get();
    if (!bucket) throw new Error("no stock seeded");
    testDb.db.update(schema.inventory).set({ onHand: bucket.onHand + 5 }).where(eq(schema.inventory.id, bucket.id)).run();
    const checks = new Set(verifyDatabase(testDb.db).issues.map((i) => i.check));
    expect(checks.has("bucket_balance")).toBe(true);
    testDb.db.update(schema.inventory).set({ onHand: bucket.onHand }).where(eq(schema.inventory.id, bucket.id)).run();
  });
});
