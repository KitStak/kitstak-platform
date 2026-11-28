/**
 * Applies the KitStak Crew migrations in `drizzle/` (the `crew` schema), in journal order,
 * idempotently, under a pg advisory lock. Same contract as packages/db/scripts/db-migrate.ts,
 * with this app's own bookkeeping table and lock key.
 *
 * Run with: pnpm --filter kitstak-crew db:migrate [connection-string]
 * Connection: argv[2], else DIRECT_URL, else DATABASE_URL (loaded from .env.local / .env).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import pg from 'pg';

const APP_ROOT = path.join(__dirname, '..');
export const MIGRATIONS_FOLDER = path.join(APP_ROOT, 'drizzle');
/** Session lock key (taken: 501 WMS write lock, 502 WMS migrate, 503 @kitstak/db, 504 Projects, 505 Pulse; 507 is Ledger). */
const MIGRATE_LOCK_KEY = 7_202_611_506;
const MIGRATIONS_TABLE = 'drizzle.__kitstak_crew_migrations';

interface JournalEntry {
  readonly idx: number;
  readonly tag: string;
}

export function readJournal(folder: string = MIGRATIONS_FOLDER): readonly JournalEntry[] {
  const journalPath = path.join(folder, 'meta', '_journal.json');
  if (!fs.existsSync(journalPath)) throw new Error(`No migration journal at ${journalPath}.`);
  const parsed = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as { entries?: JournalEntry[] };
  if (!Array.isArray(parsed.entries)) throw new Error(`Malformed migration journal at ${journalPath}.`);
  return [...parsed.entries].sort((a, b) => a.idx - b.idx);
}

export function splitStatements(sqlText: string): readonly string[] {
  return sqlText
    .split(/^\s*-->\s*statement-breakpoint\s*$/m)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

export function isTransactionPoolerUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.port === '6543' || parsed.searchParams.get('pgbouncer') === 'true';
  } catch {
    return false;
  }
}

const fileHash = (contents: string): string => createHash('sha256').update(contents).digest('hex');

async function applyPending(client: pg.Client, folder: string): Promise<{ applied: number; total: number }> {
  await client.query('CREATE SCHEMA IF NOT EXISTS drizzle');
  await client.query(
    `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      tag        text PRIMARY KEY,
      hash       text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`,
  );
  const { rows } = await client.query<{ tag: string; hash: string }>(`SELECT tag, hash FROM ${MIGRATIONS_TABLE}`);
  const applied = new Map(rows.map((row) => [row.tag, row.hash]));
  const entries = readJournal(folder);
  let appliedNow = 0;
  for (const entry of entries) {
    const contents = fs.readFileSync(path.join(folder, `${entry.tag}.sql`), 'utf8');
    const hash = fileHash(contents);
    const existing = applied.get(entry.tag);
    if (existing !== undefined) {
      if (existing !== hash) {
        throw new Error(
          `Migration ${entry.tag} changed after being applied (hash mismatch). Applied migrations are immutable; add a new migration instead.`,
        );
      }
      continue;
    }
    await client.query('BEGIN');
    try {
      for (const statement of splitStatements(contents)) await client.query(statement);
      await client.query(`INSERT INTO ${MIGRATIONS_TABLE} (tag, hash) VALUES ($1, $2)`, [entry.tag, hash]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    appliedNow += 1;
    process.stdout.write(`db:migrate - applied ${entry.tag}\n`);
  }
  return { applied: appliedNow, total: entries.length };
}

export async function migrateUrl(url: string, folder: string = MIGRATIONS_FOLDER) {
  const client = new pg.Client({ connectionString: url, application_name: 'kitstak-crew-migrate' });
  await client.connect();
  try {
    if (isTransactionPoolerUrl(url)) {
      process.stderr.write('db:migrate: transaction-mode pooler detected; running without the advisory lock.\n');
      return await applyPending(client, folder);
    }
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATE_LOCK_KEY]);
    try {
      return await applyPending(client, folder);
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATE_LOCK_KEY]);
    }
  } finally {
    await client.end();
  }
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (entry === undefined || typeof __filename === 'undefined') return false;
  const strip = (p: string): string => path.resolve(p).replace(/\.[cm]?[jt]s$/, '');
  return strip(entry) === strip(__filename);
}

if (isDirectRun()) {
  if (process.env.VERCEL_ENV === 'preview') {
    // Preview deploys share the production database. Unmerged branches must never change it.
    process.stdout.write('db:migrate - skipped on a Vercel preview build (production deploys apply migrations).\n');
    process.exit(0);
  }
  loadDotenv({ path: path.join(APP_ROOT, '.env.local'), quiet: true });
  loadDotenv({ path: path.join(APP_ROOT, '.env'), quiet: true });
  const url = process.argv[2]?.trim() || process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!url) {
    process.stderr.write('db:migrate: no connection string. Pass one or set DIRECT_URL / DATABASE_URL.\n');
    process.exit(1);
  }
  migrateUrl(url)
    .then(({ applied, total }) => {
      process.stdout.write(`db:migrate - applied ${applied} migration(s); ${total} total in drizzle/\n`);
    })
    .catch((error: unknown) => {
      process.stderr.write(`db:migrate failed: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
