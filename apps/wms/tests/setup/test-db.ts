/**
 * In-memory Postgres (PGlite) + Drizzle database for repository / domain tests.
 *
 * Applies the committed migrations in `drizzle/` so tests run against exactly the schema
 * production uses. Each call returns an isolated, empty database:
 *
 *   const testDb = await createTestDb();
 *   afterEach(() => testDb.close());
 *
 * Fast path (docs/POSTGRES_MIGRATION.md §6): each vitest worker migrates ONE template database
 * and keeps a tar dump of it; new databases load that dump (~150 ms) instead of migrating.
 * `close()` truncates the database and parks it in a small per-worker pool, so the next
 * `createTestDb()` usually reuses it (~40 ms). A database whose schema a test changed (extra or
 * dropped tables) is closed instead of pooled.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { AppDb } from '@/server/api/db';
import * as schema from '@/server/db/schema';

export const MIGRATIONS_DIR = path.join(process.cwd(), 'drizzle');

export type TestDatabase = AppDb;

export interface TestDb {
  readonly db: AppDb;
  /** The raw PGlite instance (for `exec` / `query` of plain SQL in tests). */
  readonly pg: PGlite;
  /** Empties the database and returns it to the pool (or closes it). Safe to call twice. */
  close(): Promise<void>;
}

export function hasMigrations(dir: string = MIGRATIONS_DIR): boolean {
  return fs.existsSync(path.join(dir, 'meta', '_journal.json'));
}

interface Template {
  readonly dump: Blob;
  /** `"wms"."t1", ...` of every table in the migrated schema. */
  readonly tables: readonly string[];
}

const templates = new Map<string, Promise<Template>>();
const pools = new Map<string, PGlite[]>();
const POOL_LIMIT = 2;

async function appTables(pg: PGlite): Promise<string[]> {
  // `core` included: the shared Better Auth tables (0007_core_auth) must be truncated
  // between tests like every other app table.
  const res = await pg.query<{ t: string }>(
    `SELECT format('%I.%I', schemaname, tablename) AS t FROM pg_tables WHERE schemaname IN ('public', 'wms', 'core') ORDER BY 1`,
  );
  return res.rows.map((r) => r.t);
}

function template(migrationsFolder: string): Promise<Template> {
  let pending = templates.get(migrationsFolder);
  if (!pending) {
    pending = (async () => {
      const pg = await PGlite.create();
      try {
        await migrate(drizzle(pg, { schema }), { migrationsFolder });
        const tables = await appTables(pg);
        const dump = await pg.dumpDataDir('none');
        return { dump, tables };
      } finally {
        await pg.close();
      }
    })();
    pending.catch(() => templates.delete(migrationsFolder));
    templates.set(migrationsFolder, pending);
  }
  return pending;
}

async function reset(pg: PGlite, tables: readonly string[]): Promise<boolean> {
  const now = await appTables(pg);
  if (now.length !== tables.length || now.some((t, i) => t !== tables[i])) return false;
  await pg.exec(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
  return true;
}

export async function createTestDb(migrationsFolder: string = MIGRATIONS_DIR): Promise<TestDb> {
  if (!hasMigrations(migrationsFolder)) {
    throw new Error(`No Drizzle migrations found in ${migrationsFolder}. Run "npm run db:generate" first.`);
  }
  const tpl = await template(migrationsFolder);
  const pool = pools.get(migrationsFolder) ?? [];
  pools.set(migrationsFolder, pool);
  const pg = pool.pop() ?? (await PGlite.create({ loadDataDir: tpl.dump }));
  // SQLite's datetime('now') was UTC; keep the session clock in UTC (as src/server/db does).
  await pg.exec("SET TIME ZONE 'UTC'");
  // Raw SQL resolves against the wms schema, as the app drivers do (src/server/db/index.ts).
  await pg.exec('SET search_path TO wms, public');
  const db = drizzle(pg, { schema }) as unknown as AppDb;
  let closed = false;
  return {
    db,
    pg,
    close: async () => {
      if (closed) return;
      closed = true;
      if (pg.closed) return;
      try {
        if (pool.length < POOL_LIMIT && (await reset(pg, tpl.tables))) {
          pool.push(pg);
          return;
        }
      } catch {
        // fall through: a broken instance is closed, never pooled
      }
      await pg.close();
    },
  };
}
