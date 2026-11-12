/**
 * `npx tsx scripts/catalog-demo-listings.ts [--apply] [--reset]` (owner M09).
 *
 * Adds the Bluebird & Main Shopify demo listings that show Product Listings' **Suggested** state
 * (seller SKU equals a product SKU: amber pill, Match / Don't match) and one "No match" listing.
 * Idempotent: only missing listings are inserted. `--reset` also returns the demo listings to
 * unlinked and withdraws "Don't match" dismissals so the demo can be replayed. Without --apply it
 * runs in a rolled-back transaction and prints what would change.
 */
import { closeDb, getDb } from "../src/server/db";
import { systemCtx } from "../src/server/domain/types";
import { ensureDemoSuggestedListings } from "../src/server/repositories/listings-demo";
import { withWriteTx } from "../src/server/db/sql";

const apply = process.argv.includes("--apply");
const reset = process.argv.includes("--reset");

class DryRun extends Error {}

async function main(): Promise<number> {
  if (process.env.NODE_ENV === "production" && !process.env.ALLOW_PROD_SEED) throw new Error("Refusing to write demo listings in production.");
  try {
    const db = await getDb();
    let report: Awaited<ReturnType<typeof ensureDemoSuggestedListings>> = { created: [], reset: [], skipped: [] };
    try {
      await withWriteTx(db, async (tx) => {
        report = await ensureDemoSuggestedListings(tx, systemCtx("Demo listings"), { reset });
        if (!apply) throw new DryRun();
      });
    } catch (error) {
      if (!(error instanceof DryRun)) throw error;
    }
    process.stdout.write(`${apply ? "Applied" : "Dry run"}: ${report.created.length} created, ${report.reset.length} reset, ${report.skipped.length} unchanged.\n`);
    for (const s of report.created) process.stdout.write(`  + ${s}\n`);
    for (const s of report.reset) process.stdout.write(`  ~ ${s}\n`);
    for (const s of report.skipped) process.stdout.write(`  = ${s}\n`);
    return 0;
  } finally {
    await closeDb();
  }
}

void main().then((code) => { process.exitCode = code; }, (error: unknown) => { console.error(error); process.exitCode = 1; });
