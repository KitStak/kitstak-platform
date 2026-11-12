/**
 * Drops the `public` + `crm` + `drizzle` schemas (recreating `public`), re-applies migrations and seeds.
 * Refuses to run when NODE_ENV=production or against a non-local database.
 */
import './load-env';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { loadEnv } from '../src/server/env';

function runScript(name: string): void {
  const result = spawnSync('npm', ['run', name], { stdio: 'inherit', shell: true });
  if (result.status !== 0) throw new Error(`npm run ${name} failed`);
}

async function main(): Promise<void> {
  const env = loadEnv();
  const host = new URL(env.DATABASE_URL).hostname;
  if (env.NODE_ENV === 'production' || !['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error(`Refusing to reset non-local database (${host}, NODE_ENV=${env.NODE_ENV})`);
  }
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
    await client.query('DROP SCHEMA IF EXISTS crm CASCADE');
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }
  process.stdout.write('Database schemas dropped\n');
  runScript('db:migrate');
  runScript('db:seed');
}

main().catch((error: unknown) => {
  process.stderr.write(`db:reset failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
