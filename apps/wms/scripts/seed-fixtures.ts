/**
 * `npm run db:fixtures`: idempotent Logiwa acceptance fixtures for MLT1
 * (src/server/db/seed/acceptance-fixtures.ts). Safe on the live database; never wipes anything.
 * Also chained after `db:seed` in `db:reset`.
 */
import { closeDb, getDb } from '../src/server/db';
import { seedAcceptanceFixtures } from '../src/server/db/seed/acceptance-fixtures';
import { systemCtx } from '../src/server/domain/types';
import { withWriteTx } from '../src/server/db/sql';

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_PROD_SEED) {
    throw new Error('Refusing to write demo fixtures in production. Set ALLOW_PROD_SEED=1 to override.');
  }
  const db = await getDb();
  try {
    const report = await withWriteTx(db, async (tx) => await seedAcceptanceFixtures(tx, systemCtx('Seed')));
    out(`db:fixtures - ${report.created.length} created, ${report.skipped.length} already present`);
    for (const line of report.created) out(`  + ${line}`);
  } finally {
    await closeDb();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Fixtures failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
