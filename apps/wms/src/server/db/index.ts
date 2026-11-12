/**
 * The process-wide database (BUILD_PLAN F0; docs/POSTGRES_MIGRATION.md).
 *
 * Driver selection:
 * - `DATABASE_URL` set (Vercel / Supabase pooler, transaction mode): postgres-js +
 *   drizzle-orm/postgres-js, `prepare: false`, a small pool. Migrations are NOT applied
 *   here; run `npm run db:migrate` (uses DIRECT_URL when present).
 * - otherwise (local dev, scripts): PGlite persisted at `.data/pglite` +
 *   drizzle-orm/pglite. Pending migrations are applied on first open. PGlite is
 *   single-process: a lock file stops a second process (e.g. `npm run db:seed` while
 *   `next dev` runs) from opening the same directory.
 *
 * Use `await getDb()` (or `getAppDb()` from `@/server/api/db`); there is no synchronous
 * `db` export any more. Scripts call `closeDb()` (or `close()` on `openDatabase()`) so
 * the process can exit and PGlite flushes to disk.
 *
 * Relative imports only: tsx scripts and drizzle-kit load this without the `@/` alias.
 */
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";
import type { AppDb } from "../api/db";
import { applyMigrations, MIGRATIONS_FOLDER, sanitizeDatabaseUrl } from "./migrate";

export const DATA_DIR = path.join(/* turbopackIgnore: true */ process.cwd(), ".data");
export const PGLITE_DIR = path.join(/* turbopackIgnore: true */ DATA_DIR, "pglite");

export type DatabaseKind = "postgres" | "pglite";

export interface OpenDatabase {
  readonly db: AppDb;
  readonly kind: DatabaseKind;
  /** Ends the pool / closes PGlite (flushing it to disk) and releases the directory lock. */
  close(): Promise<void>;
}

type Env = Readonly<Record<string, string | undefined>>;

/**
 * The runtime connection string, or null to use local PGlite. DATABASE_URL wins; otherwise
 * POSTGRES_URL, the pooled URL the Supabase ↔ Vercel integration sets.
 */
export function databaseUrl(env: Env = process.env): string | null {
  const url = env.DATABASE_URL?.trim() || env.POSTGRES_URL?.trim();
  return url ? sanitizeDatabaseUrl(url) : null;
}

/** Pool size per server instance. Serverless instances keep it tiny (Supabase pooler does the fan-in). */
export function poolMax(env: Env = process.env): number {
  const configured = Number(env.DATABASE_POOL_MAX);
  if (Number.isInteger(configured) && configured > 0) return configured;
  return env.VERCEL ? 3 : 5;
}

/**
 * int8 (COUNT, SUM of integers, bigint columns) as a JS number when it is a safe integer,
 * else a BigInt. This matches PGlite exactly, so code tested on PGlite behaves the same on
 * postgres-js (which would otherwise return int8 as a string). numeric stays a string on
 * both drivers: cast AVG/numeric results to ::float8.
 */
export function parseInt8(value: string): number | bigint {
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : BigInt(value);
}

export async function openPostgres(url: string, options: { readonly max?: number } = {}): Promise<OpenDatabase> {
  const { default: postgres } = await import("postgres");
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const client = postgres(url, {
    // Supabase transaction-mode pooler: no server-side prepared statements.
    prepare: false,
    max: options.max ?? poolMax(),
    idle_timeout: 20,
    connect_timeout: 15,
    onnotice: () => {},
    connection: { application_name: "kitstak-wms" },
  });
  const db = drizzle(client, { schema });
  // After drizzle(): it installs its own (transparent) date parsers on the same table.
  (client.options.parsers as Record<string, (value: string) => unknown>)["20"] = parseInt8;
  return {
    db: db as unknown as AppDb,
    kind: "postgres",
    close: () => client.end({ timeout: 5 }),
  };
}

// ── PGlite directory lock (single process per data dir) ─────────────────────────────

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function acquireDirLock(dataDir: string): () => void {
  const lockPath = `${dataDir}.lock`;
  fs.mkdirSync(/* turbopackIgnore: true */ path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(/* turbopackIgnore: true */ lockPath, String(process.pid), { flag: "wx" });
      let released = false;
      const release = (): void => {
        if (released) return;
        released = true;
        try {
          if (fs.readFileSync(lockPath, "utf8").trim() === String(process.pid)) fs.rmSync(lockPath, { force: true });
        } catch {
          // already gone
        }
      };
      process.once("exit", release);
      return release;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const owner = Number(fs.readFileSync(lockPath, "utf8").trim());
      if (owner === process.pid) return () => {};
      if (Number.isInteger(owner) && owner > 0 && pidAlive(owner)) {
        throw new Error(
          `The local PGlite database ${path.relative(process.cwd(), dataDir)} is in use by process ${owner} ` +
            `(PGlite is single-process). Stop that process (usually "next dev") first, or set DATABASE_URL to use a Postgres server.`
        );
      }
      fs.rmSync(lockPath, { force: true }); // stale lock from a crashed process
    }
  }
  throw new Error(`Could not lock ${dataDir}`);
}

/**
 * Opens PGlite: persisted at `dataDir`, or in memory when `dataDir` is null (tests).
 * Applies pending migrations unless `migrate: false`.
 */
export async function openPglite(
  dataDir: string | null = PGLITE_DIR,
  options: { readonly migrate?: boolean; readonly migrationsFolder?: string } = {}
): Promise<OpenDatabase> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  let release: () => void = () => {};
  if (dataDir) {
    fs.mkdirSync(/* turbopackIgnore: true */ dataDir, { recursive: true });
    release = acquireDirLock(dataDir);
  }
  try {
    const client = dataDir ? await PGlite.create(dataDir) : await PGlite.create();
    // SQLite's datetime('now') was UTC; keep every session clock in UTC.
    await client.exec("SET TIME ZONE 'UTC'");
    const db = drizzle(client, { schema }) as unknown as AppDb;
    if (options.migrate !== false) await applyMigrations(db, options.migrationsFolder ?? MIGRATIONS_FOLDER);
    return {
      db,
      kind: "pglite",
      close: async () => {
        try {
          if (!client.closed) await client.close();
        } finally {
          release();
        }
      },
    };
  } catch (error: unknown) {
    release();
    throw error;
  }
}

/** DATABASE_URL → postgres-js; otherwise the persisted local PGlite (auto-migrated). */
export async function openDatabase(env: Env = process.env): Promise<OpenDatabase> {
  const url = databaseUrl(env);
  if (url) return await openPostgres(url);
  // Vercel's file system is read-only: falling back to local PGlite would fail every request
  // with an opaque EROFS (e.g. a Preview deployment without DATABASE_URL). Fail clearly.
  if (env.VERCEL) {
    throw new Error("DATABASE_URL is not set for this Vercel environment. Set it to the Supabase pooler URL (transaction mode, port 6543).");
  }
  return await openPglite(PGLITE_DIR);
}

declare global {
  var __kitstakDb: Promise<OpenDatabase> | undefined;
}

/** The process-wide database (singleton across Next.js hot reloads). */
export async function getDb(): Promise<AppDb> {
  if (!globalThis.__kitstakDb) {
    const opening = openDatabase();
    globalThis.__kitstakDb = opening;
    opening.catch(() => {
      if (globalThis.__kitstakDb === opening) globalThis.__kitstakDb = undefined;
    });
  }
  return (await globalThis.__kitstakDb).db;
}

/** Closes the singleton (scripts: call before exit so PGlite flushes and the pool drains). */
export async function closeDb(): Promise<void> {
  const opening = globalThis.__kitstakDb;
  globalThis.__kitstakDb = undefined;
  if (opening) await (await opening).close();
}

/** Which driver the singleton uses (for /api/health and scripts' log lines). */
export function configuredDatabaseKind(env: Env = process.env): DatabaseKind {
  return databaseUrl(env) ? "postgres" : "pglite";
}

export { schema };
