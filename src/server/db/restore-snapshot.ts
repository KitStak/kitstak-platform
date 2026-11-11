/**
 * Replaces every public table's rows with a data snapshot inside one transaction.
 *
 * Used by the hosted bootstrap (`/api/admin/bootstrap`, action `restore-snapshot`) to load the
 * pre-verified demo dataset in seconds instead of replaying the seed over the network.
 * Foreign keys are made deferrable for the load (so table order does not matter) and restored
 * afterwards; user triggers are paused; serial/identity sequences are resynced.
 */
import { sql } from "drizzle-orm";
import type { AppDb } from "../api/db";
import { dbAll, takeWriteLock } from "./sql";

export interface DataSnapshot {
  readonly tables: ReadonlyArray<{ readonly name: string; readonly rows: ReadonlyArray<Record<string, unknown>> }>;
}

const ROWS_PER_INSERT = 500;
const quoteIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`;
const quoteLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`;

export async function restoreSnapshot(db: AppDb, snapshot: DataSnapshot): Promise<{ tables: number; rows: number }> {
  let rows = 0;
  await db.transaction(async (tx) => {
    await takeWriteLock(tx);
    const fks = await dbAll<{ t: string; c: string }>(tx, sql`
      SELECT conrelid::regclass::text AS t, conname AS c FROM pg_constraint
      WHERE contype = 'f' AND connamespace = 'public'::regnamespace AND NOT condeferrable`);
    for (const fk of fks) await tx.execute(sql.raw(`ALTER TABLE ${fk.t} ALTER CONSTRAINT ${quoteIdent(fk.c)} DEFERRABLE INITIALLY DEFERRED`));
    const triggered = await dbAll<{ t: string }>(tx, sql`
      SELECT DISTINCT t.tgrelid::regclass::text AS t FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace`);
    for (const t of triggered) await tx.execute(sql.raw(`ALTER TABLE ${t.t} DISABLE TRIGGER USER`));

    const tables = await dbAll<{ t: string }>(tx, sql`SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public'`);
    if (tables.length) {
      await tx.execute(sql.raw(`TRUNCATE ${tables.map((x) => `public.${quoteIdent(x.t)}`).join(", ")} RESTART IDENTITY CASCADE`));
    }

    for (const table of snapshot.tables) {
      const target = sql.raw(`public.${quoteIdent(table.name)}`);
      for (let i = 0; i < table.rows.length; i += ROWS_PER_INSERT) {
        const chunk = JSON.stringify(table.rows.slice(i, i + ROWS_PER_INSERT));
        await tx.execute(sql`INSERT INTO ${target} SELECT * FROM json_populate_recordset(NULL::${target}, ${chunk}::json)`);
      }
      rows += table.rows.length;
    }

    // Fire the queued foreign-key checks first: ALTER TABLE refuses tables with pending trigger events.
    await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
    for (const t of triggered) await tx.execute(sql.raw(`ALTER TABLE ${t.t} ENABLE TRIGGER USER`));
    for (const fk of fks) await tx.execute(sql.raw(`ALTER TABLE ${fk.t} ALTER CONSTRAINT ${quoteIdent(fk.c)} NOT DEFERRABLE`));

    const serials = await dbAll<{ t: string; c: string }>(tx, sql`
      SELECT table_name AS t, column_name AS c FROM information_schema.columns
      WHERE table_schema = 'public' AND (column_default LIKE 'nextval(%' OR is_identity = 'YES')`);
    for (const s of serials) {
      const table = `public.${quoteIdent(s.t)}`;
      await tx.execute(sql.raw(
        `SELECT setval(pg_get_serial_sequence(${quoteLiteral(table)}, ${quoteLiteral(s.c)}), COALESCE((SELECT max(${quoteIdent(s.c)}) FROM ${table}), 0) + 1, false)`,
      ));
    }
  });
  return { tables: snapshot.tables.length, rows };
}
