/**
 * `npx tsx scripts/catalog-test-data.ts [--apply] [--delete-only] [--idle-minutes=N]` (owner M09, REQ-25).
 *
 * Removes catalog records left by critic / e2e runs (SKU or seller SKU starting KS-CRIT- or
 * KS-E2E-) so a buyer demo does not open on test data. Products that pass the normal delete
 * guard are deleted; guarded ones (stock, orders, history) are deactivated through
 * `setProductStatus`, so the ledger stays intact and the change log records it. Only records
 * created more than N minutes ago (default 60) are touched, so a suite that is running now keeps
 * its fixtures. Without --apply it prints the plan and changes nothing.
 */
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../src/server/db/schema";
import type { AppDb } from "../src/server/api/db";
import { TEST_SKU_PREFIXES, planTestDataPurge, purgeTestCatalogData, type TestDataPlan } from "../src/server/repositories/products-test-data";

const DB_PATH = process.env.KITSTAK_DB_PATH ?? path.join(process.cwd(), ".data", "kitstak.db");
const apply = process.argv.includes("--apply");
/** Skip deactivations (use while other suites still have open orders on test products). */
const deleteOnly = process.argv.includes("--delete-only");
const idleArg = process.argv.find((a) => a.startsWith("--idle-minutes="));
const idleMinutes = idleArg ? Math.max(0, Number(idleArg.split("=")[1]) || 0) : 60;

function print(plan: TestDataPlan): void {
  const out = (s: string) => process.stdout.write(`${s}\n`);
  out(`  delete:     ${plan.deletable.length}${plan.deletable.length ? `  (${plan.deletable.map((r) => r.sku).join(", ")})` : ""}`);
  out(`  deactivate: ${plan.deactivate.length}`);
  for (const r of plan.deactivate) out(`    - ${r.sku}: ${r.reason}`);
  out(`  kept (already inactive, guarded): ${plan.keptInactive.length}`);
  out(`  listings:   ${plan.listingIds.length}`);
}

function main(): number {
  const sqlite = new Database(DB_PATH, { readonly: !apply, fileMustExist: true });
  try {
    sqlite.pragma("busy_timeout = 10000");
    if (apply) sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite, { schema }) as unknown as AppDb;
    const createdBefore = new Date(Date.now() - idleMinutes * 60_000).toISOString();
    process.stdout.write(`Catalog test data (${TEST_SKU_PREFIXES.join(", ")}) created before ${createdBefore}\n`);
    if (!apply) {
      print(planTestDataPurge(db, TEST_SKU_PREFIXES, { createdBefore }));
      process.stdout.write("Dry run. Re-run with --apply to change data.\n");
      return 0;
    }
    const warehouseIds = db.select({ id: schema.warehouses.id }).from(schema.warehouses).all().map((r) => r.id);
    const ctx = { userId: null, source: "Test data cleanup", scope: { warehouseIds, clientIds: "all" as const } };
    const plan = sqlite.transaction(() => purgeTestCatalogData(db, ctx, TEST_SKU_PREFIXES, { createdBefore, deleteOnly }))();
    print(plan);
    process.stdout.write("Applied.\n");
    return 0;
  } finally {
    sqlite.close();
  }
}

process.exitCode = main();
