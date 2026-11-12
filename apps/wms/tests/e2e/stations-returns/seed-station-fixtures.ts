/**
 * M04 station fixtures, seeded straight through the domain (no dev server needed), idempotent:
 *   npx tsx tests/e2e/stations-returns/seed-station-fixtures.ts
 *
 * The same fixtures are part of the standard dataset (`npm run db:fixtures`, see
 * src/server/repositories/packing-fixtures.ts); this script only runs that step on its own:
 * a tote LP at PACK-01, PACK-02 location stock, a cell of cart MC-01, a PACK-04 order, and
 * HOSP-01 (Hospital group) holding a pack-short order. Dev databases only.
 */
import { closeDb, getDb } from '../../../src/server/db';
import { systemCtx } from '../../../src/server/domain/types';
import {
  seedStationFixtures,
  STATION_FIXTURE_WAREHOUSE,
} from '../../../src/server/repositories/packing-fixtures';
import { withWriteTx } from '../../../src/server/db/sql';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to write M04 fixtures in production.');
  // Local PGlite (.data/pglite) is single-process: stop `next dev` first, or set DATABASE_URL.
  const db = await getDb();
  try {
    const report = await withWriteTx(
      db,
      async (tx) => await seedStationFixtures(tx, systemCtx('M04 fixtures')),
    );
    for (const line of report.created) process.stdout.write(`  + ${line}\n`);
    for (const line of report.skipped) process.stdout.write(`  = ${line}\n`);
    process.stdout.write(`M04 fixtures (${STATION_FIXTURE_WAREHOUSE}): ${JSON.stringify(report.fixtures)}\n`);
  } finally {
    await closeDb();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `M04 fixtures failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
