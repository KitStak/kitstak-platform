/**
 * Applies the committed Postgres migrations in `drizzle/`.
 * Run with: npm run db:migrate  (step 2 of `npm run db:reset`).
 *
 * - DIRECT_URL (preferred: Supabase direct/session connection) or DATABASE_URL set:
 *   migrates that server. A session advisory lock stops two concurrent runs (skipped on a
 *   transaction-mode pooler URL, where it could leak; use DIRECT_URL).
 * - neither set: migrates the local PGlite database at `.data/pglite`.
 *
 * Idempotent: already-applied migrations are skipped via `drizzle.__drizzle_migrations`.
 * Relative imports only (tsx script entry).
 */
import fs from 'node:fs';
import path from 'node:path';
import { is, sql } from 'drizzle-orm';
import type { AppDb } from '../api/db';

export const MIGRATIONS_FOLDER = path.join(process.cwd(), 'drizzle');
/** Session lock key for concurrent `db:migrate` runs (distinct from the app write lock). */
const MIGRATE_LOCK_KEY = 7_202_611_502;

export interface MigrationResult {
  readonly applied: number;
  readonly total: number;
}

interface JournalFile {
  entries: readonly { tag: string }[];
}

export function readJournalSize(migrationsFolder: string = MIGRATIONS_FOLDER): number {
  const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');
  if (!fs.existsSync(journalPath)) {
    throw new Error(`No migration journal at ${journalPath}. Run "npm run db:generate" first.`);
  }
  const parsed = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as JournalFile;
  if (!Array.isArray(parsed.entries)) {
    throw new Error(`Malformed migration journal at ${journalPath}.`);
  }
  return parsed.entries.length;
}

function firstRow(result: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(result)) return result[0] as Record<string, unknown> | undefined;
  const rows = (result as { rows?: unknown[] } | null)?.rows;
  return Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined;
}

/**
 * WMS-owned migrations tracking table. MUST differ from drizzle's default
 * (`drizzle.__drizzle_migrations`): on a shared platform database the CRM's migrator
 * records there, and drizzle-orm's migrator skips any journal entry older than the
 * newest recorded timestamp — the CRM's newer entries would silently mask every WMS
 * migration ("applied 0 of N").
 */
export const WMS_MIGRATIONS_TABLE = '__drizzle_migrations_wms';

export async function countAppliedMigrations(db: AppDb): Promise<number> {
  const exists = firstRow(
    await db.execute(
      sql`SELECT to_regclass(${'drizzle.' + WMS_MIGRATIONS_TABLE}) IS NOT NULL AS "exists"`,
    ),
  );
  if (!exists?.exists) return 0;
  const row = firstRow(
    await db.execute(sql.raw(`SELECT count(*)::int AS n FROM drizzle.${WMS_MIGRATIONS_TABLE}`)),
  );
  return Number(row?.n ?? 0);
}

/**
 * Applies pending migrations to an open database (either driver); returns how many were applied.
 *
 * `search_path` is pinned to `public` for the run: 0000-0005 create unqualified objects that
 * must land in `public` even when the `wms` schema already exists (packages/db core migrations
 * create core/crm/wms up front) and even though app connections open with `wms, public`
 * (src/server/db/index.ts). 0006 then moves everything into `wms` explicitly. The app
 * search_path is restored afterwards.
 */
export async function applyMigrations(
  db: AppDb,
  migrationsFolder: string = MIGRATIONS_FOLDER,
): Promise<MigrationResult> {
  const total = readJournalSize(migrationsFolder);
  const before = await countAppliedMigrations(db);
  const { PgliteDatabase } = await import('drizzle-orm/pglite');
  await db.execute(sql`SET search_path TO public`);
  try {
    if (is(db, PgliteDatabase)) {
      const { migrate } = await import('drizzle-orm/pglite/migrator');
      await migrate(db as unknown as Parameters<typeof migrate>[0], {
        migrationsFolder,
        migrationsTable: WMS_MIGRATIONS_TABLE,
      });
    } else {
      const { migrate } = await import('drizzle-orm/postgres-js/migrator');
      await migrate(db as unknown as Parameters<typeof migrate>[0], {
        migrationsFolder,
        migrationsTable: WMS_MIGRATIONS_TABLE,
      });
    }
  } finally {
    const { APP_SEARCH_PATH } = await import('./index');
    await db.execute(sql.raw(`SET search_path TO ${APP_SEARCH_PATH}`));
  }
  const after = await countAppliedMigrations(db);
  // Then the tenant stream: `wms` and every org's warehouse schema (src/server/tenancy).
  const { applyTenantMigrations } = await import('../tenancy/migrations');
  await applyTenantMigrations(db);
  return { applied: after - before, total };
}

/**
 * True for a transaction-mode pooler URL (Supabase pooler port 6543, or `pgbouncer=true`).
 * There, consecutive statements can run on different backends, so a SESSION advisory lock
 * taken by one statement may be held by a backend the unlock never reaches (the lock leaks on
 * a pooled session and a later run waits on it forever).
 */
export function isTransactionPoolerUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.port === '6543' || u.searchParams.get('pgbouncer') === 'true';
  } catch {
    return false;
  }
}

/**
 * Migrates a Postgres server over one dedicated connection. On a direct/session connection a
 * session advisory lock stops two concurrent runs; on a transaction-mode pooler the lock is
 * skipped (see isTransactionPoolerUrl) and the migrations still apply in drizzle's single
 * transaction, which the pooler keeps on one backend. Prefer DIRECT_URL for migrations.
 */
export async function migrateUrl(
  url: string,
  migrationsFolder: string = MIGRATIONS_FOLDER,
): Promise<MigrationResult> {
  const { openPostgres } = await import('./index');
  // search_path pinned at connection startup too: on a transaction pooler a session-level SET
  // may not stick to the backend the migrator's transaction runs on.
  // statementTimeoutMs: null — migration DDL may legitimately run longer than the app's 30 s cap.
  const handle = await openPostgres(url, { max: 1, searchPath: 'public', statementTimeoutMs: null });
  try {
    if (isTransactionPoolerUrl(url)) {
      process.stderr.write(
        'db:migrate: the target is a transaction-mode pooler (port 6543); running without the concurrency lock. ' +
          'Set DIRECT_URL to the direct or session connection to guard concurrent runs.\n',
      );
      return await applyMigrations(handle.db, migrationsFolder);
    }
    await handle.db.execute(sql`SELECT pg_advisory_lock(${sql.raw(String(MIGRATE_LOCK_KEY))})`);
    try {
      return await applyMigrations(handle.db, migrationsFolder);
    } finally {
      await handle.db.execute(sql`SELECT pg_advisory_unlock(${sql.raw(String(MIGRATE_LOCK_KEY))})`);
    }
  } finally {
    await handle.close();
  }
}

/** Migrates the local PGlite directory (default `.data/pglite`). */
export async function migratePglite(
  dataDir?: string,
  migrationsFolder: string = MIGRATIONS_FOLDER,
): Promise<MigrationResult> {
  const { openPglite, PGLITE_DIR } = await import('./index');
  const handle = await openPglite(dataDir ?? PGLITE_DIR, { migrate: false });
  try {
    return await applyMigrations(handle.db, migrationsFolder);
  } finally {
    await handle.close();
  }
}

/**
 * Drops query parameters postgres-js would forward to the server as runtime settings. The
 * Supabase ↔ Vercel integration's POSTGRES_URL carries `supa=base-pooler.x`, which Postgres
 * rejects ("unrecognized configuration parameter"). sslmode is kept (postgres-js reads it).
 */
export function sanitizeDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete('supa');
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * The URL `db:migrate` targets: DIRECT_URL, then POSTGRES_URL_NON_POOLING (the direct URL the
 * Supabase ↔ Vercel integration sets), then the runtime URL; null = local PGlite.
 */
export function migrationUrl(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  const url =
    env.DIRECT_URL?.trim() ||
    env.POSTGRES_URL_NON_POOLING?.trim() ||
    env.DATABASE_URL?.trim() ||
    env.POSTGRES_URL?.trim();
  return url ? sanitizeDatabaseUrl(url) : null;
}

/** True when executed as a script (`tsx src/server/db/migrate.ts`), false when imported. */
function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (entry === undefined || typeof __filename === 'undefined') return false;
  const strip = (p: string): string => path.resolve(p).replace(/\.[cm]?[jt]s$/, '');
  return strip(entry) === strip(__filename);
}

if (isDirectRun()) {
  const url = migrationUrl();
  const target = url ? 'Postgres (DIRECT_URL/DATABASE_URL)' : 'local PGlite (.data/pglite)';
  (url ? migrateUrl(url) : migratePglite())
    .then(({ applied, total }) => {
      process.stdout.write(
        `db:migrate - ${target}: applied ${applied} migration(s); ${total} total in ${path.relative(process.cwd(), MIGRATIONS_FOLDER)}\n`,
      );
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`db:migrate failed: ${message}\n`);
      process.exit(1);
    });
}
