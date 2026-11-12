/** Shared fixtures for F3 platform tests (in-memory PGlite with real migrations). */
import {
  clients,
  roles,
  rolePermissions,
  userClients,
  userRoles,
  users,
  userWarehouses,
  warehouses,
} from '@/server/db/schema';
import { upsertCoreIdentity } from '@/server/auth/credentials';
import { hashPassword } from '@/server/auth/password';
import { createTestDb, type TestDb } from '../../setup/test-db';

export const TEST_PASSWORD = 'KitStak!demo2026';
let cachedHash: string | null = null;
/** Low-cost bcrypt hash so tests stay fast (verified via the shared passwordCompat path). */
export function testHash(): string {
  cachedHash ??= hashPassword(TEST_PASSWORD, 4);
  return cachedHash;
}

export interface SeededDb extends TestDb {
  readonly ids: {
    readonly admin: string;
    readonly viewer: string;
    readonly operator: string;
    readonly wh1: string;
    readonly wh2: string;
    readonly c1: string;
    readonly c2: string;
  };
}

export async function seededDb(): Promise<SeededDb> {
  const testDb = await createTestDb();
  const { db } = testDb;
  // User ids are uuids: core."user".id (shared Better Auth table) is a uuid and keeps
  // the SAME value as wms.users.id (blueprint §1.4).
  const ids = {
    admin: '0a000000-0000-4000-8000-000000000001',
    viewer: '0a000000-0000-4000-8000-000000000002',
    operator: '0a000000-0000-4000-8000-000000000003',
    wh1: 'wh-1',
    wh2: 'wh-2',
    c1: 'c-1',
    c2: 'c-2',
  } as const;
  await db.insert(warehouses).values([
    { id: ids.wh1, code: 'W1', name: 'Dallas', addressLine: '1 Main', city: 'Dallas', state: 'TX' },
    { id: ids.wh2, code: 'W2', name: 'Reno', addressLine: '2 Main', city: 'Reno', state: 'NV' },
  ]);
  await db.insert(clients).values([
    {
      id: ids.c1,
      code: 'C1',
      name: 'Acme',
      contactName: 'A',
      contactEmail: 'a@x.io',
      phone: '1',
      billingPlan: 'monthly',
      status: 'Active',
    },
    {
      id: ids.c2,
      code: 'C2',
      name: 'Beta',
      contactName: 'B',
      contactEmail: 'b@x.io',
      phone: '2',
      billingPlan: 'monthly',
      status: 'Active',
    },
  ]);
  await db.insert(users).values([
    { id: ids.admin, email: 'admin@kitstak.io', name: 'Admin', passwordHash: testHash(), role: 'admin' },
    {
      id: ids.viewer,
      email: 'viewer@kitstak.io',
      name: 'Viewer',
      passwordHash: testHash(),
      role: 'viewer',
      allClients: false,
    },
    { id: ids.operator, email: 'op@kitstak.io', name: 'Op', passwordHash: testHash(), role: 'operator' },
  ]);
  await db.insert(userWarehouses).values({ userId: ids.viewer, warehouseId: ids.wh1 });
  await db.insert(userClients).values({ userId: ids.viewer, clientId: ids.c1 });
  // Shared Better Auth identities (core."user"/account/member + wms.user_profiles) so
  // auth.api.signInEmail works against this database.
  const identity = { userType: 'Operation', isApiUser: false, passwordHash: testHash() } as const;
  await upsertCoreIdentity(db, {
    ...identity,
    userId: ids.admin,
    email: 'admin@kitstak.io',
    name: 'Admin',
    legacyRole: 'admin',
    allClients: true,
  });
  await upsertCoreIdentity(db, {
    ...identity,
    userId: ids.viewer,
    email: 'viewer@kitstak.io',
    name: 'Viewer',
    legacyRole: 'viewer',
    allClients: false,
  });
  await upsertCoreIdentity(db, {
    ...identity,
    userId: ids.operator,
    email: 'op@kitstak.io',
    name: 'Op',
    legacyRole: 'operator',
    allClients: true,
  });
  return { ...testDb, ids };
}

/** Creates a role with the given keys/restrictions and assigns it to `userId`. */
export async function assignRole(
  testDb: TestDb,
  userId: string,
  key: string,
  permissions: readonly string[],
  restrictions: readonly ('carrier_cost' | 'carrier_account_data' | 'rate_shopping_data')[] = [],
): Promise<void> {
  const roleId = `role-${key}`;
  await testDb.db.insert(roles).values({ id: roleId, key, name: key, restrictions: [...restrictions] });
  if (permissions.length)
    await testDb.db.insert(rolePermissions).values(permissions.map((permission) => ({ roleId, permission })));
  await testDb.db.insert(userRoles).values({ userId, roleId });
}
