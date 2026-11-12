/**
 * `npm run db:verify`: asserts the inventory invariants of BUILD_PLAN 0.4 #6 against
 * the database (local PGlite .data/pglite, or DATABASE_URL when set) and exits non-zero when anything does not reconcile:
 *   - ledger sum = bucket on-hand for every bucket (and on-hand >= 0)
 *   - allocated = sum of active inventory_allocations; allocated <= on-hand - damaged
 *   - order line picked <= allocated <= quantity (and shipped <= packed <= picked)
 *   - PO received = sum of non-cancelled receipts (header and line level)
 *   - every bucket / transaction has a client; no rows written outside the ledger
 *   - return lines, serial-tracked stock and shipped orders' labels are consistent
 * Every module's e2e suite ends by running it.
 */
import { closeDb, configuredDatabaseKind, getDb } from '../src/server/db';
import { verifyDatabase } from '../src/server/db/seed/verify';
const MAX_LISTED = 40;

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function main(): Promise<number> {
  try {
    const { issues, stats, warnings = [] } = await verifyDatabase(await getDb());
    out(
      `db:verify - ${configuredDatabaseKind() === 'postgres' ? 'DATABASE_URL' : 'local PGlite (.data/pglite)'}`,
    );
    out(
      `  ${Object.entries(stats)
        .map(([k, v]) => `${k}=${v}`)
        .join('  ')}`,
    );
    if (warnings.length > 0)
      out(
        `  warnings (not failing): ${warnings.length} (${[...new Set(warnings.map((w) => w.check))].join(', ')})`,
      );
    if (issues.length === 0) {
      out('  OK: every invariant reconciles.');
      return 0;
    }
    const byCheck = new Map<string, number>();
    for (const i of issues) byCheck.set(i.check, (byCheck.get(i.check) ?? 0) + 1);
    out(`  FAILED: ${issues.length} issue(s): ${[...byCheck].map(([c, n]) => `${c}=${n}`).join(', ')}`);
    for (const i of issues.slice(0, MAX_LISTED)) out(`  - [${i.check}] ${i.id}: ${i.message}`);
    if (issues.length > MAX_LISTED) out(`  ... and ${issues.length - MAX_LISTED} more`);
    return 1;
  } finally {
    await closeDb();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`db:verify failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
