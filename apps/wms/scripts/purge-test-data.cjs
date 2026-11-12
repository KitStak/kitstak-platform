// Removes critic/e2e test-data users and roles (KS-CRIT*, KS-Test*, ks-crit-*/ks-r5-* emails) from the dev DB.
// Usage: node scripts/purge-test-data.cjs   (local PGlite .data/pglite, or DATABASE_URL when set; stop `next dev` first)
async function main() {
  const { openRawDb } = await import("./lib/raw-db.mjs");
  const db = await openRawDb();
  try {
    // SQLite LIKE was case-insensitive (ILIKE); GLOB-free patterns map 1:1.
    const users = (await db.query("select id from users where email ilike 'ks-crit%' or email ilike 'ks-r%-%@%' or name ilike 'KS-CRIT%' or name ilike 'KS-Test%' order by id")).map((r) => r.id);
    const roles = (await db.query("select id from roles where name ilike 'KS-CRIT%' or name ilike 'KS-Test%' order by id")).map((r) => r.id);
    await db.transaction(async (q) => {
      await q("select pg_advisory_xact_lock(7202611501)"); // the app's write lock (src/server/db/sql.ts)
      for (const id of users) {
        for (const [t, c] of [["audit_log", "user_id"], ["background_tasks", "user_id"], ["entity_notes", "user_id"], ["import_batches", "uploaded_by"], ["jobs", "assigned_to_user_id"]]) {
          await q(`update ${t} set ${c} = null where ${c} = $1`, [id]);
        }
        await q("delete from users where id = $1", [id]);
      }
      for (const id of roles) await q("delete from roles where id = $1", [id]);
    });
    console.log(`purged ${users.length} users, ${roles.length} roles`);
  } finally {
    await db.close();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
