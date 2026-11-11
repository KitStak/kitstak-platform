/**
 * Deterministic seed for the KitStaks demo database (BUILD_PLAN F2).
 * Run with `npm run db:seed` (or `npm run db:reset` = drop + migrate + seed).
 *
 * All the work happens in `./seed/index.ts` (`runSeed`), which replays 30 days of warehouse
 * operations through the domain engines so the ledger reconciles. This file is only the
 * CLI entrypoint: production guard, the report and the exit code. Targets local PGlite
 * (.data/pglite) by default, DATABASE_URL when set.
 */
import { createFileStore } from "../files";
import { closeDb, configuredDatabaseKind, getDb } from "./index";
import { runSeed, type SeedReport } from "./seed/index";

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

function printReport(report: SeedReport, ms: number): void {
  out(`Seed complete in ${(ms / 1000).toFixed(1)}s (${report.events} replay events).`);
  const rows = Object.entries(report.counts).filter(([, n]) => n > 0).sort(([a], [b]) => a.localeCompare(b));
  for (const [table, n] of rows) out(`  ${table.padEnd(34)} ${n}`);
  if (report.failures > 0) {
    out(`${report.failures} replay step(s) were rejected by the domain (kept as realistic exceptions):`);
    for (const sample of report.failureSamples) out(`  - ${sample}`);
  }
  if (report.ledgerIssues.length > 0) {
    out(`Ledger issues: ${report.ledgerIssues.length}`);
    for (const issue of report.ledgerIssues.slice(0, 20)) out(`  - [${issue.check}] ${issue.id}: ${issue.message}`);
  }
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production" && !process.env.ALLOW_PROD_SEED) {
    throw new Error("Refusing to seed demo data in production. Set ALLOW_PROD_SEED=1 to override.");
  }
  const db = await getDb();
  out(`Seeding ${configuredDatabaseKind() === "postgres" ? "DATABASE_URL" : "local PGlite (.data/pglite)"}...`);
  const started = performance.now();
  const report = await runSeed(db, { files: createFileStore(), password: process.env.SEED_PASSWORD || undefined });
  printReport(report, performance.now() - started);
  if (report.ledgerIssues.length > 0) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`Seed failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
