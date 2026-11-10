// Removes critic/e2e test-data users and roles (KS-CRIT*, KS-Test*, ks-crit-*/ks-r5-* emails) from the dev DB.
// Usage: node scripts/purge-test-data.cjs [path/to/db]
const D = require("better-sqlite3");
const db = new D(process.argv[2] || ".data/kitstak.db");
db.pragma("busy_timeout = 10000");
db.pragma("foreign_keys = ON");
const users = db.prepare("select id from users where email like 'ks-crit%' or email like 'ks-r%-%@%' or name like 'KS-CRIT%' or name like 'KS-Test%'").all().map(r => r.id);
const roles = db.prepare("select id from roles where name like 'KS-CRIT%' or name like 'KS-Test%'").all().map(r => r.id);
const tx = db.transaction(() => {
  for (const id of users) {
    for (const [t, c] of [["audit_log", "user_id"], ["background_tasks", "user_id"], ["entity_notes", "user_id"], ["import_batches", "uploaded_by"], ["jobs", "assigned_to_user_id"]]) {
      db.prepare(`update ${t} set ${c} = null where ${c} = ?`).run(id);
    }
    db.prepare("delete from users where id = ?").run(id);
  }
  for (const id of roles) db.prepare("delete from roles where id = ?").run(id);
});
tx();
console.log(`purged ${users.length} users, ${roles.length} roles`);
