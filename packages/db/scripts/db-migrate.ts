/**
 * Applies the committed @kitstak/db migrations in `drizzle/`, in journal order,
 * idempotently, under a pg advisory lock (modeled on apps/wms/src/server/db/migrate.ts).
 *
 * Run with: pnpm --filter @kitstak/db db:migrate [connection-string]
 * Connection: argv[2], else DIRECT_URL, else DATABASE_URL. Prefer the direct/session
 * connection (DIRECT_URL, :5432) — on a transaction-mode pooler URL (:6543 or
 * `pgbouncer=true`) the session advisory lock could leak, so it is skipped with a warning.
 *
 * Hand-rolled on purpose (not drizzle-kit, never `drizzle-kit push`): only migrations
 * listed in drizzle/meta/_journal.json are applied, so deferred files such as
 * 0001_core_fks.sql (Phase 3) stay out of the run. Applied tags are recorded in
 * `drizzle.__kitstak_db_migrations` with a content hash; a hash mismatch on an applied
 * file aborts, since editing applied migrations breaks fresh-from-zero rebuilds.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

export const MIGRATIONS_FOLDER = path.join(__dirname, '..', 'drizzle');
/** Session lock key for concurrent runs (distinct from WMS's 7_202_611_502). */
const MIGRATE_LOCK_KEY = 7_202_611_503;
const MIGRATIONS_TABLE = 'drizzle.__kitstak_db_migrations';

interface JournalEntry {
  readonly idx: number;
  readonly tag: string;
}

interface JournalFile {
  readonly entries: readonly JournalEntry[];
}

export interface MigrationResult {
  readonly applied: number;
  readonly total: number;
}

export function readJournal(migrationsFolder: string = MIGRATIONS_FOLDER): readonly JournalEntry[] {
  const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');
  if (!fs.existsSync(journalPath)) {
    throw new Error(`No migration journal at ${journalPath}.`);
  }
  const parsed = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as JournalFile;
  if (!Array.isArray(parsed.entries)) {
    throw new Error(`Malformed migration journal at ${journalPath}.`);
  }
  return [...parsed.entries].sort((a, b) => a.idx - b.idx);
}

/** Splits a migration file on drizzle-style `--> statement-breakpoint` lines. */
export function splitStatements(sqlText: string): readonly string[] {
  return sqlText
    .split(/^\s*-->\s*statement-breakpoint\s*$/m)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

/**
 * True for a transaction-mode pooler URL (Supabase pooler port 6543, or `pgbouncer=true`),
 * where a session advisory lock taken on one pooled backend can leak.
 */
export function isTransactionPoolerUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.port === '6543' || parsed.searchParams.get('pgbouncer') === 'true';
  } catch {
    return false;
  }
}

/** Drops query params postgres-js would forward as runtime settings (Supabase `supa=...`). */
export function sanitizeDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete('supa');
    return parsed.toString();
  } catch {
    return url;
  }
}

function fileHash(contents: string): string {
  return createHash('sha256').update(contents).digest('hex');
}

async function ensureBookkeeping(sql: postgres.Sql): Promise<void> {
  await sql.unsafe('CREATE SCHEMA IF NOT EXISTS drizzle');
  await sql.unsafe(
    `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      tag        text PRIMARY KEY,
      hash       text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`,
  );
}

async function appliedTags(sql: postgres.Sql): Promise<ReadonlyMap<string, string>> {
  const rows = await sql.unsafe<{ tag: string; hash: string }[]>(
    `SELECT tag, hash FROM ${MIGRATIONS_TABLE}`,
  );
  return new Map(rows.map((row) => [row.tag, row.hash]));
}

async function applyPending(
  sql: postgres.Sql,
  migrationsFolder: string,
): Promise<MigrationResult> {
  await ensureBookkeeping(sql);
  const entries = readJournal(migrationsFolder);
  const applied = await appliedTags(sql);
  let appliedNow = 0;
  for (const entry of entries) {
    const filePath = path.join(migrationsFolder, `${entry.tag}.sql`);
    const contents = fs.readFileSync(filePath, 'utf8');
    const hash = fileHash(contents);
    const existing = applied.get(entry.tag);
    if (existing !== undefined) {
      if (existing !== hash) {
        throw new Error(
          `Migration ${entry.tag} changed after being applied (hash mismatch). ` +
            'Applied migrations are immutable; add a new migration instead.',
        );
      }
      continue;
    }
    await sql.begin(async (tx) => {
      for (const statement of splitStatements(contents)) {
        await tx.unsafe(statement);
      }
      await tx.unsafe(`INSERT INTO ${MIGRATIONS_TABLE} (tag, hash) VALUES ($1, $2)`, [
        entry.tag,
        hash,
      ]);
    });
    appliedNow += 1;
    process.stdout.write(`db:migrate - applied ${entry.tag}\n`);
  }
  return { applied: appliedNow, total: entries.length };
}

/** Migrates a Postgres server over one dedicated connection, under the advisory lock. */
export async function migrateUrl(
  url: string,
  migrationsFolder: string = MIGRATIONS_FOLDER,
): Promise<MigrationResult> {
  const sql = postgres(sanitizeDatabaseUrl(url), {
    prepare: false,
    max: 1,
    onnotice: () => {},
    connection: { application_name: 'kitstak-db-migrate' },
  });
  try {
    if (isTransactionPoolerUrl(url)) {
      process.stderr.write(
        'db:migrate: the target is a transaction-mode pooler (port 6543); running without the ' +
          'concurrency lock. Set DIRECT_URL to the direct or session connection to guard concurrent runs.\n',
      );
      return await applyPending(sql, migrationsFolder);
    }
    await sql`SELECT pg_advisory_lock(${MIGRATE_LOCK_KEY})`;
    try {
      return await applyPending(sql, migrationsFolder);
    } finally {
      await sql`SELECT pg_advisory_unlock(${MIGRATE_LOCK_KEY})`;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** True when executed as a script (`tsx scripts/db-migrate.ts`), false when imported. */
function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (entry === undefined || typeof __filename === 'undefined') return false;
  const strip = (p: string): string => path.resolve(p).replace(/\.[cm]?[jt]s$/, '');
  return strip(entry) === strip(__filename);
}

if (isDirectRun()) {
  const url = process.argv[2]?.trim() || process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!url) {
    process.stderr.write(
      'db:migrate: no connection string. Pass one as an argument or set DIRECT_URL / DATABASE_URL.\n',
    );
    process.exit(1);
  }
  migrateUrl(url)
    .then(({ applied, total }) => {
      process.stdout.write(`db:migrate - applied ${applied} migration(s); ${total} total in drizzle/\n`);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`db:migrate failed: ${message}\n`);
      process.exit(1);
    });
}
