/**
 * `npm run db:verify`: asserts the inventory invariants of BUILD_PLAN 0.4 #6 against
 * `.data/kitstak.db` and exits non-zero when anything does not reconcile:
 *   - ledger sum = bucket on-hand for every bucket (and on-hand >= 0)
 *   - allocated = sum of active inventory_allocations; allocated <= on-hand - damaged
 *   - order line picked <= allocated <= quantity (and shipped <= packed <= picked)
 *   - PO received = sum of non-cancelled receipts (header and line level)
 *   - every bucket / transaction has a client; no rows written outside the ledger
 *   - return lines, serial-tracked stock and shipped orders' labels are consistent
 * Every module's e2e suite ends by running it.
 */
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../src/server/db/schema";
import { verifyDatabase } from "../src/server/db/seed/verify";

const DB_PATH = process.env.KITSTAK_DB_PATH ?? path.join(process.cwd(), ".data", "kitstak.db");
const MAX_LISTED = 40;

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

function main(): number {
  const sqlite = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  try {
    sqlite.pragma("busy_timeout = 10000");
    const { issues, stats } = verifyDatabase(drizzle(sqlite, { schema }));
    out(`db:verify - ${path.relative(process.cwd(), DB_PATH)}`);
    out(`  ${Object.entries(stats).map(([k, v]) => `${k}=${v}`).join("  ")}`);
    if (issues.length === 0) {
      out("  OK: every invariant reconciles.");
      return 0;
    }
    const byCheck = new Map<string, number>();
    for (const i of issues) byCheck.set(i.check, (byCheck.get(i.check) ?? 0) + 1);
    out(`  FAILED: ${issues.length} issue(s): ${[...byCheck].map(([c, n]) => `${c}=${n}`).join(", ")}`);
    for (const i of issues.slice(0, MAX_LISTED)) out(`  - [${i.check}] ${i.id}: ${i.message}`);
    if (issues.length > MAX_LISTED) out(`  ... and ${issues.length - MAX_LISTED} more`);
    return 1;
  } finally {
    sqlite.close();
  }
}

try {
  process.exitCode = main();
} catch (error: unknown) {
  process.stderr.write(`db:verify failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
