/**
 * Applies the committed Drizzle migrations in `drizzle/` to `.data/kitstak.db`.
 * Run with: npm run db:migrate  (step 2 of `npm run db:reset`).
 *
 * Opens its own connection (the dev server may hold the file open; WAL mode +
 * busy_timeout let both coexist). Idempotent: already-applied migrations are
 * skipped via the `__drizzle_migrations` journal.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

export const DEFAULT_DB_PATH = path.join(process.cwd(), ".data", "kitstak.db");
export const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");
const BUSY_TIMEOUT_MS = 10_000;

export interface MigrationResult {
  readonly applied: number;
  readonly total: number;
}

interface JournalFile {
  entries: readonly { tag: string }[];
}

function readJournalSize(migrationsFolder: string): number {
  const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
  if (!fs.existsSync(journalPath)) {
    throw new Error(`No migration journal at ${journalPath}. Run "npm run db:generate" first.`);
  }
  const parsed = JSON.parse(fs.readFileSync(journalPath, "utf8")) as JournalFile;
  if (!Array.isArray(parsed.entries)) {
    throw new Error(`Malformed migration journal at ${journalPath}.`);
  }
  return parsed.entries.length;
}

function countApplied(sqlite: Database.Database): number {
  const table = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
    .get();
  if (!table) return 0;
  const row = sqlite.prepare("SELECT COUNT(*) AS n FROM __drizzle_migrations").get() as { n: number };
  return row.n;
}

/** Applies pending migrations to an open connection; returns how many were applied. */
export function runMigrations(sqlite: Database.Database, migrationsFolder: string = MIGRATIONS_FOLDER): MigrationResult {
  const total = readJournalSize(migrationsFolder);
  const before = countApplied(sqlite);
  migrate(drizzle(sqlite), { migrationsFolder });
  const after = countApplied(sqlite);
  return { applied: after - before, total };
}

export function migrateFile(dbPath: string = DEFAULT_DB_PATH, migrationsFolder: string = MIGRATIONS_FOLDER): MigrationResult {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  try {
    sqlite.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    return runMigrations(sqlite, migrationsFolder);
  } finally {
    sqlite.close();
  }
}

/** True when executed as a script (`tsx src/server/db/migrate.ts`), false when imported. */
function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (entry === undefined || typeof __filename === "undefined") return false;
  const strip = (p: string): string => path.resolve(p).replace(/\.[cm]?[jt]s$/, "");
  return strip(entry) === strip(__filename);
}

if (isDirectRun()) {
  try {
    const { applied, total } = migrateFile();
    process.stdout.write(
      `db:migrate - applied ${applied} migration(s); ${total} total in ${path.relative(process.cwd(), MIGRATIONS_FOLDER)}\n`
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`db:migrate failed: ${message}\n`);
    process.exit(1);
  }
}
