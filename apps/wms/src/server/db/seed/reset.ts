/**
 * Empties every table in place (keeps the schema and the Drizzle migration journal, which
 * lives in the separate `drizzle` schema), so `npm run db:seed` can re-run on a migrated database.
 */
import { sql } from 'drizzle-orm';
import type { AppDb } from '@/server/api/db';
import { dbAll, dbRun, withWriteTx } from '@/server/db/sql';

const KEEP_TABLES: ReadonlySet<string> = new Set(['__drizzle_migrations', '__tenant_migrations']);

const quoteIdent = (name: string): string => `"${name.replaceAll('"', '""')}"`;

/** Every app table in the `wms` schema (scheduler tables included), sorted by name. */
export async function listDataTables(db: AppDb): Promise<readonly string[]> {
  return (
    await dbAll<{ name: string }>(
      db,
      sql`SELECT tablename AS name FROM pg_tables WHERE schemaname = 'wms' ORDER BY tablename`,
    )
  )
    .map((r) => r.name)
    .filter((name) => !KEEP_TABLES.has(name));
}

/**
 * Deletes all rows from every data table in one TRUNCATE (FK-safe, resets identity columns).
 * Returns the number of tables emptied.
 */
export async function wipeAllRows(db: AppDb): Promise<number> {
  const tables = await listDataTables(db);
  if (tables.length === 0) return 0;
  await withWriteTx(db, async (tx) => {
    await dbRun(
      tx,
      sql.raw(`TRUNCATE ${tables.map((t) => `wms.${quoteIdent(t)}`).join(', ')} RESTART IDENTITY CASCADE`),
    );
  });
  return tables.length;
}
