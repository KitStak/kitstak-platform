/**
 * Minimal raw-SQL handle for the plain-Node helper scripts (*.mjs / *.cjs) that cannot import
 * the TypeScript app modules. Same target as the app: Postgres when DATABASE_URL is set,
 * otherwise the local PGlite directory `.data/pglite` (stop `next dev` first: PGlite is
 * single-process). Placeholders are Postgres-style ($1, $2, ...).
 *
 *   const db = await openRawDb();
 *   await db.transaction(async (q) => { const rows = await q("SELECT ...", [x]); ... });
 *   await db.close();
 */
import path from "node:path";

export async function openRawDb() {
  const url = process.env.DATABASE_URL?.trim();
  if (url) {
    const { default: postgres } = await import("postgres");
    const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
    const runner = (client) => async (text, params = []) => [...(await client.unsafe(text, params))];
    return {
      query: runner(sql),
      transaction: (fn) => sql.begin(async (tx) => fn(runner(tx))),
      close: () => sql.end({ timeout: 5 }),
    };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = await PGlite.create(path.join(process.cwd(), ".data", "pglite"));
  const runner = (client) => async (text, params = []) => (await client.query(text, params)).rows;
  return {
    query: runner(pg),
    transaction: (fn) => pg.transaction(async (tx) => fn(runner(tx))),
    close: () => pg.close(),
  };
}
