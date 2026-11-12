/**
 * `npx tsx scripts/seed-labor-history.ts`: idempotent labor-history backfill for the demo
 * database (M13). Adds a floor team, shares the seed's untimed jobs across it and records
 * real start scans on untimed completed tasks, so the labor analytics show measured work.
 * See src/server/repositories/analytics-labor-backfill.ts. Never rewrites a timed task.
 */
import { closeDb, getDb } from '../src/server/db';
import { backfillLaborHistory } from '../src/server/repositories/analytics-labor-backfill';
import { withWriteTx } from '../src/server/db/sql';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_PROD_SEED) {
    throw new Error('Refusing to write demo labor history in production. Set ALLOW_PROD_SEED=1 to override.');
  }
  const db = await getDb();
  try {
    const report = await withWriteTx(db, async (tx) => await backfillLaborHistory(tx));
    process.stdout.write(`labor history - ${JSON.stringify(report)}\n`);
  } finally {
    await closeDb();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `Labor history backfill failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
