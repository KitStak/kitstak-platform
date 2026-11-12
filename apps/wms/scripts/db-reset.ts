/**
 * Step 1 of `npm run db:reset` (`npm run db:drop`): drops every app object from the database.
 * (`db:reset` then runs `db:migrate`, `db:seed` and `db:fixtures`.)
 *
 * Targets local PGlite (.data/pglite) by default, or DIRECT_URL / DATABASE_URL when set.
 * PGlite is single-process: stop `next dev` first. Refuses to run in production unless
 * ALLOW_PROD_SEED=1.
 */
import { openPglite, openPostgres, PGLITE_DIR } from '../src/server/db';
import { migrationUrl } from '../src/server/db/migrate';
import { dropAllObjects } from './lib/drop-all';

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_PROD_SEED) {
    throw new Error('Refusing to reset the database in production. Set ALLOW_PROD_SEED=1 to override.');
  }
  const url = migrationUrl();
  const handle = url ? await openPostgres(url, { max: 1 }) : await openPglite(PGLITE_DIR, { migrate: false });
  try {
    const dropped = await dropAllObjects(handle.db);
    out(
      `db:drop - dropped ${dropped} schema objects from ${url ? 'DIRECT_URL/DATABASE_URL' : 'local PGlite (.data/pglite)'}`,
    );
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`db:reset failed: ${message}\n`);
  process.exitCode = 1;
});
