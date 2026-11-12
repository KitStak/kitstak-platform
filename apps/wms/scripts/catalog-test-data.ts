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
import { closeDb, getDb, schema } from "../src/server/db";
import { withWriteTx } from "../src/server/db/sql";
import { TEST_SKU_PREFIXES, planTestDataPurge, purgeTestCatalogData, type TestDataPlan } from "../src/server/repositories/products-test-data";

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

async function main(): Promise<number> {
  try {
    const db = await getDb();
    const createdBefore = new Date(Date.now() - idleMinutes * 60_000).toISOString();
    process.stdout.write(`Catalog test data (${TEST_SKU_PREFIXES.join(", ")}) created before ${createdBefore}\n`);
    if (!apply) {
      print(await planTestDataPurge(db, TEST_SKU_PREFIXES, { createdBefore }));
      process.stdout.write("Dry run. Re-run with --apply to change data.\n");
      return 0;
    }
    const warehouseIds = (await db.select({ id: schema.warehouses.id }).from(schema.warehouses)).map((r) => r.id);
    const ctx = { userId: null, source: "Test data cleanup", scope: { warehouseIds, clientIds: "all" as const } };
    const plan = await withWriteTx(db, async (tx) => await purgeTestCatalogData(tx, ctx, TEST_SKU_PREFIXES, { createdBefore, deleteOnly }));
    print(plan);
    process.stdout.write("Applied.\n");
    return 0;
  } finally {
    await closeDb();
  }
}

void main().then((code) => { process.exitCode = code; }, (error: unknown) => { console.error(error); process.exitCode = 1; });
