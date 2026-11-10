/**
 * `npx tsx scripts/catalog-demo-images.ts [--apply]` (owner M09).
 *
 * Gives every seed-catalog product without an image the built-in demo illustration
 * (`/api/products/demo-image/<kind>-<hex>.svg`), so the grid image column, listings and detail
 * header are not all placeholders in a demo. Products that already have an image and test SKUs
 * (KS-CRIT-/KS-E2E-) are left alone. Each update bumps the product version and writes the
 * change log. Without --apply it prints the plan and changes nothing.
 */
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../src/server/db/schema";
import type { AppDb } from "../src/server/api/db";
import { applyDemoImages, planDemoImages } from "../src/server/repositories/products-demo-images";

const DB_PATH = process.env.KITSTAK_DB_PATH ?? path.join(process.cwd(), ".data", "kitstak.db");
const apply = process.argv.includes("--apply");

function main(): number {
  const sqlite = new Database(DB_PATH, { readonly: !apply, fileMustExist: true });
  try {
    sqlite.pragma("busy_timeout = 10000");
    const db = drizzle(sqlite, { schema }) as unknown as AppDb;
    const rows = apply
      ? sqlite.transaction(() => applyDemoImages(db, { userId: null, source: "Demo catalog images" }))()
      : planDemoImages(db);
    for (const r of rows) process.stdout.write(`  ${r.sku.padEnd(22)} ${r.imageUrl}\n`);
    process.stdout.write(`${apply ? "Applied" : "Dry run"}: ${rows.length} product(s).${apply ? "" : " Re-run with --apply to change data."}\n`);
    return 0;
  } finally {
    sqlite.close();
  }
}

process.exitCode = main();
