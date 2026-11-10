/**
 * Step 1 of `npm run db:reset`: empty the SQLite database in-process.
 * (`db:reset` then runs `db:migrate` and `db:seed`.)
 *
 * Never deletes the file, because the dev server may be holding it open.
 * Refuses to run in production unless ALLOW_PROD_SEED=1.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { dropAllObjects } from "./lib/drop-all";

const DB_PATH = path.join(process.cwd(), ".data", "kitstak.db");
const BUSY_TIMEOUT_MS = 10_000;

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

function main(): void {
  if (process.env.NODE_ENV === "production" && !process.env.ALLOW_PROD_SEED) {
    throw new Error("Refusing to reset the database in production. Set ALLOW_PROD_SEED=1 to override.");
  }
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const sqlite = new Database(DB_PATH);
  try {
    sqlite.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
    sqlite.pragma("journal_mode = WAL");
    const dropped = dropAllObjects(sqlite);
    try {
      sqlite.exec("VACUUM");
    } catch (error: unknown) {
      // Space reclamation only; another connection (dev server) can block it.
      const reason = error instanceof Error ? error.message : String(error);
      out(`db:reset - VACUUM skipped (${reason})`);
    }
    out(`db:reset - dropped ${dropped} schema objects from ${path.relative(process.cwd(), DB_PATH)}`);
  } finally {
    sqlite.close();
  }
}

try {
  main();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`db:reset failed: ${message}\n`);
  process.exit(1);
}
