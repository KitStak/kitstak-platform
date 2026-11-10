/**
 * Re-applies the default permission sets to the system operator / viewer / client roles of an
 * existing database (after a permission-catalog default change), without a full re-seed.
 * Usage: npx tsx scripts/sync-system-roles.ts
 */
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { DEFAULT_ROLE_PERMISSIONS } from "@/server/auth/permission-catalog";
import { CLIENT_ROLE_KEY, CLIENT_ROLE_PERMISSIONS } from "@/server/db/seed/access";

const targets: Record<string, readonly string[]> = {
  operator: DEFAULT_ROLE_PERMISSIONS.operator,
  viewer: DEFAULT_ROLE_PERMISSIONS.viewer,
  [CLIENT_ROLE_KEY]: CLIENT_ROLE_PERMISSIONS,
};

const rows = db.select().from(schema.roles).where(inArray(schema.roles.key, Object.keys(targets))).all();
db.transaction((tx) => {
  for (const role of rows) {
    if (!role.isSystem) continue;
    const perms = targets[role.key]!;
    tx.delete(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, role.id)).run();
    if (perms.length) tx.insert(schema.rolePermissions).values(perms.map((permission) => ({ roleId: role.id, permission }))).run();
    console.log(`${role.key}: ${perms.length} permissions`);
  }
  // Admin / Supervisor: additive only, so a new catalog action (e.g. LP Numbers Delete) reaches
  // them without dropping keys an admin granted by hand.
  const additive = tx.select().from(schema.roles).where(inArray(schema.roles.key, ["admin", "manager"])).all();
  for (const role of additive) {
    if (!role.isSystem) continue;
    const wanted = DEFAULT_ROLE_PERMISSIONS[role.key as "admin" | "manager"];
    const have = new Set(tx.select({ p: schema.rolePermissions.permission }).from(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, role.id)).all().map((r) => r.p));
    const missing = wanted.filter((p) => !have.has(p));
    if (missing.length) tx.insert(schema.rolePermissions).values(missing.map((permission) => ({ roleId: role.id, permission }))).run();
    console.log(`${role.key}: +${missing.length} permissions`);
  }
});
