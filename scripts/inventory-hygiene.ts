/**
 * `npx tsx scripts/inventory-hygiene.ts [--apply] [--purge-fixtures]` (owner M06).
 *
 * --purge-fixtures (with --apply) also removes free stock left in KS-CRIT-* / KS-E2E-* test
 * locations idle for 60+ minutes (--idle-minutes=N), through the ledger ("Inventory Adjustment", note "Test fixture purge").
 *
 * Without --apply: lists inventory hygiene issues (untracked lot/expiry/production values,
 * impossible dates, empty unreferenced buckets) and exits 1 when any exist.
 * With --apply: repairs them through the ledger (Attributes Change rows) and prunes empty
 * buckets, then re-checks. It also adds the default adjustment / damage reasons (Found,
 * Import, Damaged) to databases seeded before they existed. Safe to run more than once.
 */
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../src/server/db/schema";
import type { AppDb } from "../src/server/api/db";
import { findFixtureStock, findInventoryHygieneIssues, purgeFixtureStock, repairInventoryHygiene } from "../src/server/repositories/inventory-hygiene";
import { ensureDefaultInventoryReasons } from "../src/server/repositories/inventory-lookups";

const DB_PATH = process.env.KITSTAK_DB_PATH ?? path.join(process.cwd(), ".data", "kitstak.db");
const apply = process.argv.includes("--apply");
const purgeFixtures = process.argv.includes("--purge-fixtures");
const idleArg = process.argv.find((a) => a.startsWith("--idle-minutes="));
const idleMinutes = idleArg ? Math.max(0, Number(idleArg.split("=")[1]) || 60) : 60;

function summarize(db: AppDb): number {
  const issues = findInventoryHygieneIssues(db);
  const byCheck = new Map<string, number>();
  for (const i of issues) byCheck.set(i.check, (byCheck.get(i.check) ?? 0) + 1);
  process.stdout.write(`  issues: ${issues.length}${issues.length ? ` (${[...byCheck].map(([c, n]) => `${c}=${n}`).join(", ")})` : ""}\n`);
  for (const i of issues.filter((x) => x.check !== "empty-bucket").slice(0, 30)) process.stdout.write(`  - [${i.check}] ${i.id}: ${i.message}\n`);
  return issues.length;
}

function main(): number {
  const sqlite = new Database(DB_PATH, { readonly: !apply, fileMustExist: true });
  try {
    sqlite.pragma("busy_timeout = 10000");
    if (apply) sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite, { schema }) as unknown as AppDb;
    process.stdout.write(`inventory hygiene - ${path.relative(process.cwd(), DB_PATH)}\n`);
    const before = summarize(db);
    if (!apply) return before === 0 ? 0 : 1;
    const reasons = ensureDefaultInventoryReasons(db);
    process.stdout.write(`  default reasons added: ${reasons.length ? reasons.join(", ") : "none (already present)"}\n`);
    const fixtures = findFixtureStock(db, new Date(), idleMinutes);
    process.stdout.write(`  idle fixture stock: ${fixtures.length} bucket(s)${fixtures.length ? ` (${fixtures.map((f) => `${f.sku}@${f.location}=${f.free}`).join(", ")})` : ""}\n`);
    if (purgeFixtures) {
      const p = purgeFixtureStock(db, undefined, new Date(), idleMinutes);
      process.stdout.write(`  purged ${p.units} fixture unit(s) from ${p.removed} bucket(s), skipped ${p.skipped.length}\n`);
      for (const s of p.skipped) process.stdout.write(`  ~ [${s.check}] ${s.id}: ${s.message}\n`);
    }
    const res = repairInventoryHygiene(db);
    process.stdout.write(`  repaired ${res.repaired} bucket(s), deleted ${res.deleted} empty bucket(s), skipped ${res.skipped.length}\n`);
    for (const s of res.skipped.slice(0, 30)) process.stdout.write(`  ~ [${s.check}] ${s.id}: ${s.message}\n`);
    process.stdout.write("after:\n");
    summarize(db);
    return 0;
  } finally {
    sqlite.close();
  }
}

try {
  process.exitCode = main();
} catch (error: unknown) {
  process.stderr.write(`inventory hygiene failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
