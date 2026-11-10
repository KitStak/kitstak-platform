/** Shared fixtures for F3 platform tests (in-memory SQLite with real migrations). */
import { clients, roles, rolePermissions, userClients, userRoles, users, userWarehouses, warehouses } from "@/server/db/schema";
import { hashPassword } from "@/server/auth/password";
import { createTestDb, type TestDb } from "../../setup/test-db";

export const TEST_PASSWORD = "KitStak!demo2026";
let cachedHash: string | null = null;
/** Low-cost hash so tests stay fast. */
export function testHash(): string {
  cachedHash ??= hashPassword(TEST_PASSWORD, 4);
  return cachedHash;
}

export interface SeededDb extends TestDb {
  readonly ids: { readonly admin: string; readonly viewer: string; readonly operator: string; readonly wh1: string; readonly wh2: string; readonly c1: string; readonly c2: string };
}

export function seededDb(): SeededDb {
  const testDb = createTestDb();
  const { db } = testDb;
  const ids = { admin: "u-admin", viewer: "u-viewer", operator: "u-operator", wh1: "wh-1", wh2: "wh-2", c1: "c-1", c2: "c-2" } as const;
  db.insert(warehouses).values([
    { id: ids.wh1, code: "W1", name: "Dallas", addressLine: "1 Main", city: "Dallas", state: "TX" },
    { id: ids.wh2, code: "W2", name: "Reno", addressLine: "2 Main", city: "Reno", state: "NV" },
  ]).run();
  db.insert(clients).values([
    { id: ids.c1, code: "C1", name: "Acme", contactName: "A", contactEmail: "a@x.io", phone: "1", billingPlan: "monthly", status: "Active" },
    { id: ids.c2, code: "C2", name: "Beta", contactName: "B", contactEmail: "b@x.io", phone: "2", billingPlan: "monthly", status: "Active" },
  ]).run();
  db.insert(users).values([
    { id: ids.admin, email: "admin@kitstak.io", name: "Admin", passwordHash: testHash(), role: "admin" },
    { id: ids.viewer, email: "viewer@kitstak.io", name: "Viewer", passwordHash: testHash(), role: "viewer", allClients: false },
    { id: ids.operator, email: "op@kitstak.io", name: "Op", passwordHash: testHash(), role: "operator" },
  ]).run();
  db.insert(userWarehouses).values({ userId: ids.viewer, warehouseId: ids.wh1 }).run();
  db.insert(userClients).values({ userId: ids.viewer, clientId: ids.c1 }).run();
  return { ...testDb, ids };
}

/** Creates a role with the given keys/restrictions and assigns it to `userId`. */
export function assignRole(
  testDb: TestDb,
  userId: string,
  key: string,
  permissions: readonly string[],
  restrictions: readonly ("carrier_cost" | "carrier_account_data" | "rate_shopping_data")[] = [],
): void {
  const roleId = `role-${key}`;
  testDb.db.insert(roles).values({ id: roleId, key, name: key, restrictions: [...restrictions] }).run();
  if (permissions.length) testDb.db.insert(rolePermissions).values(permissions.map((permission) => ({ roleId, permission }))).run();
  testDb.db.insert(userRoles).values({ userId, roleId }).run();
}
