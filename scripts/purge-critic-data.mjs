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
 * Local dev database only (.data/kitstak.db). Audit rows written by a purged user keep
 * their action and detail; only the dangling user reference is cleared.
 */
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const apply = process.argv.includes("--apply");
const dbPath = process.env.DATABASE_PATH ?? path.join(process.cwd(), ".data", "kitstak.db");
if (process.env.NODE_ENV === "production") {
  console.error("Refusing to purge in production.");
  process.exit(1);
}
const db = new Database(dbPath);
db.pragma("busy_timeout = 5000");

const LIKE = "KS-CRIT%";
const like = (col) => `(${col} LIKE '${LIKE}' OR ${col} LIKE 'KS CRIT%' OR ${col} LIKE 'ks-crit%')`;

const plan = [
  { label: "Users", select: `SELECT id, email AS name FROM users WHERE ${like("email")} OR ${like("name")}`, table: "users",
    before: (ids, inList) => {
      db.prepare(`UPDATE audit_log SET user_id = NULL WHERE user_id IN ${inList}`).run(...ids);
      for (const [t, c] of [["background_tasks", "user_id"], ["entity_notes", "user_id"], ["import_batches", "uploaded_by"], ["jobs", "assigned_to_user_id"]]) {
        db.prepare(`UPDATE ${t} SET ${c} = NULL WHERE ${c} IN ${inList}`).run(...ids);
      }
    } },
  { label: "Printout templates", select: `SELECT id, name FROM printout_templates WHERE ${like("name")}`, table: "printout_templates" },
  { label: "Screen configurations", select: `SELECT id, name FROM screen_configs WHERE ${like("name")}`, table: "screen_configs" },
  { label: "Saved views", select: `SELECT id, name FROM saved_views WHERE ${like("name")}`, table: "saved_views" },
  { label: "Roles", select: `SELECT id, name FROM roles WHERE ${like("name")} AND id NOT IN (SELECT role_id FROM user_roles WHERE user_id NOT IN (SELECT id FROM users WHERE ${like("email")}))`, table: "roles" },
  { label: "Data Setup lookups", select: `SELECT id, type || ': ' || name AS name FROM lookup_values WHERE ${like("name")}`, table: "lookup_values" },
];

let total = 0;
const run = db.transaction(() => {
  for (const step of plan) {
    let rows;
    try { rows = db.prepare(step.select).all(); } catch (e) { console.warn(`${step.label}: skipped (${e.message})`); continue; }
    if (rows.length === 0) continue;
    total += rows.length;
    console.log(`${step.label} (${rows.length}): ${rows.map((r) => r.name).join(", ")}`);
    if (!apply) continue;
    const ids = rows.map((r) => r.id);
    const inList = `(${ids.map(() => "?").join(",")})`;
    step.before?.(ids, inList);
    db.prepare(`DELETE FROM ${step.table} WHERE id IN ${inList}`).run(...ids);
  }
});
run();
console.log(total === 0 ? "Nothing to purge." : apply ? `Purged ${total} records.` : `${total} records would be purged. Re-run with --apply.`);
