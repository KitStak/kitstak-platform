import './load-env';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { loadEnv } from '../src/server/env';

async function main(): Promise<void> {
  if (process.env.VERCEL_ENV === 'preview') {
    // Preview deploys share the production database. Unmerged branches must never change it.
    process.stdout.write('db:migrate - skipped on a Vercel preview build (production deploys apply migrations).\n');
    return;
  }
  const env = loadEnv();
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL_UNPOOLED ?? env.DATABASE_URL, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
    process.stdout.write('Migrations applied\n');
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `db:migrate failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
