#!/usr/bin/env node
/**
 * Removes critic / E2E test records (names or emails starting "KS-CRIT") from the admin
 * entities a buyer sees in Settings: users, printout templates, screen configurations,
 * saved views, roles and Data Setup lookups. Operational records (orders, POs, jobs) are
 * left alone: they carry ledger history and belong to their own modules.
 *
 *   node scripts/purge-critic-data.mjs            # dry run, prints what would go
 *   node scripts/purge-critic-data.mjs --apply    # deletes
 *
 * Local dev database by default (.data/pglite; stop `next dev` first), DATABASE_URL when set.
 * Audit rows written by a purged user keep their action and detail; only the dangling user
 * reference is cleared.
 */
import { openRawDb } from "./lib/raw-db.mjs";

const apply = process.argv.includes("--apply");
if (process.env.NODE_ENV === "production") {
  console.error("Refusing to purge in production.");
  process.exit(1);
}

// SQLite LIKE was case-insensitive: ILIKE keeps the same matches.
const like = (col) => `(${col} ILIKE 'KS-CRIT%' OR ${col} ILIKE 'KS CRIT%')`;

const plan = [
  { label: "Users", select: `SELECT id, email AS name FROM users WHERE ${like("email")} OR ${like("name")} ORDER BY id`, table: "users",
    before: async (q, ids) => {
      await q(`UPDATE audit_log SET user_id = NULL WHERE user_id = ANY($1)`, [ids]);
      for (const [t, c] of [["background_tasks", "user_id"], ["entity_notes", "user_id"], ["import_batches", "uploaded_by"], ["jobs", "assigned_to_user_id"]]) {
        await q(`UPDATE ${t} SET ${c} = NULL WHERE ${c} = ANY($1)`, [ids]);
      }
    } },
  { label: "Printout templates", select: `SELECT id, name FROM printout_templates WHERE ${like("name")} ORDER BY id`, table: "printout_templates" },
  { label: "Screen configurations", select: `SELECT id, name FROM screen_configs WHERE ${like("name")} ORDER BY id`, table: "screen_configs" },
  { label: "Saved views", select: `SELECT id, name FROM saved_views WHERE ${like("name")} ORDER BY id`, table: "saved_views" },
  { label: "Roles", select: `SELECT id, name FROM roles WHERE ${like("name")} AND id NOT IN (SELECT role_id FROM user_roles WHERE user_id NOT IN (SELECT id FROM users WHERE ${like("email")})) ORDER BY id`, table: "roles" },
  { label: "Data Setup lookups", select: `SELECT id, type || ': ' || name AS name FROM lookup_values WHERE ${like("name")} ORDER BY id`, table: "lookup_values" },
];

const db = await openRawDb();
let total = 0;
try {
  await db.transaction(async (q) => {
    await q("SELECT pg_advisory_xact_lock(7202611501)"); // the app's write lock (src/server/db/sql.ts)
    for (const step of plan) {
      const rows = await q(step.select);
      if (rows.length === 0) continue;
      total += rows.length;
      console.log(`${step.label} (${rows.length}): ${rows.map((r) => r.name).join(", ")}`);
      if (!apply) continue;
      const ids = rows.map((r) => r.id);
      await step.before?.(q, ids);
      await q(`DELETE FROM ${step.table} WHERE id = ANY($1)`, [ids]);
    }
  });
} finally {
  await db.close();
}
console.log(total === 0 ? "Nothing to purge." : apply ? `Purged ${total} records.` : `${total} records would be purged. Re-run with --apply.`);
