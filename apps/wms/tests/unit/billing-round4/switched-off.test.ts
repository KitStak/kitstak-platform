/**
 * Billing review round 4, security: being switched off is a fact of its own.
 *
 * Before, a deactivated person was "a person with no password row". Then the Portal got "Forgot
 * password" by email, and that door made a new password row: the person was back in. Now the WMS
 * writes a row in `core.sign_in_blocks` when it deactivates a person, the shared sign in layer reads
 * it at every door of every app, and activating the person removes it.
 */
import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isSignInBlocked, type RawSqlExecutor } from '@kitstak/auth';
import { account, organization, member, session as coreSession } from '@kitstak/db/schema';
import type { AppDb } from '@/server/api/db';
import { users } from '@/server/db/schema';
import { dbAll } from '@/server/db/sql';
import { sql } from 'drizzle-orm';
import { assignRole, seededDb, type SeededDb } from '../foundation-f3/fixtures';

let current: SeededDb;
vi.mock('@/server/api/db', () => {
  const get = async (): Promise<AppDb> => current.db;
  return { getAppDb: get, getPlatformDb: get, getTenantDbFor: get };
});

const { buildAuthContext } = await import('@/server/auth/context');
const { switchOffSignIn, switchOnSignIn } = await import('@/server/auth/credentials');
const { setUsersActive, updateUser } = await import('@/server/repositories/users');

const ACTOR = { userId: null, source: 'test' } as const;
const raw = (db: SeededDb['db']) => db as unknown as RawSqlExecutor;

async function adminAuth(db: SeededDb['db'], adminId: string) {
  const [row] = await db.select().from(users).where(eq(users.id, adminId)).limit(1);
  if (!row) throw new Error('missing admin fixture');
  return await buildAuthContext(db, {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    userType: row.userType,
    allClients: row.allClients,
    isApiUser: row.isApiUser,
    sessionId: 's-test',
    sessionVersion: row.sessionVersion,
    sessionExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    orgId: '00000000-0000-4000-8000-000000000000',
    orgName: 'KitStak',
    orgSlug: 'kitstak',
    tenantSchema: 'wms',
  });
}

async function passwordRow(db: SeededDb['db'], userId: string) {
  return (
    await db
      .select({ id: account.id })
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, 'credential')))
      .limit(1)
  )[0];
}

function saveInput(email: string, isActive: boolean, roleId: string, wh: string) {
  return {
    firstName: 'Vera',
    lastName: 'Viewer',
    email,
    userType: 'Operation' as const,
    sendWelcomeEmail: false,
    isActive,
    password: '',
    confirmPassword: '',
    roleIds: [roleId],
    warehouseIds: [wh],
    allClients: true,
    clientIds: [],
    version: undefined,
  };
}

describe('deactivating a person in the WMS switches their account off for every app', () => {
  afterEach(async () => {
    await current.close();
  });

  it('the migration made the table, with the user as its key', async () => {
    current = await seededDb();
    const columns = await dbAll<{ column_name: string }>(
      current.db,
      sql`SELECT column_name FROM information_schema.columns WHERE table_schema = 'core' AND table_name = 'sign_in_blocks' ORDER BY ordinal_position`,
    );
    expect(columns.map((c) => c.column_name)).toEqual(['user_id', 'reason', 'blocked_by', 'created_at']);
  });

  it('setUsersActive(false) writes the block row, removes the password row and ends the sessions; (true) lifts the block', async () => {
    current = await seededDb();
    const auth = await adminAuth(current.db, current.ids.admin);
    const viewer = current.ids.viewer;
    await current.db.insert(coreSession).values({ token: 'tok-viewer-1', userId: viewer, expiresAt: new Date(Date.now() + 86_400_000), createdAt: new Date(), updatedAt: new Date() });
    expect(await isSignInBlocked(raw(current.db), viewer)).toBe(false);
    expect(await passwordRow(current.db, viewer)).toBeTruthy();

    const off = await setUsersActive(current.db, auth, ACTOR, [viewer], false);
    expect(off.failed ?? []).toEqual([]);
    expect(await isSignInBlocked(raw(current.db), viewer)).toBe(true);
    expect(await passwordRow(current.db, viewer)).toBeUndefined();
    expect(await current.db.select({ id: coreSession.id }).from(coreSession).where(eq(coreSession.userId, viewer))).toHaveLength(0);

    const on = await setUsersActive(current.db, auth, ACTOR, [viewer], true);
    expect(on.failed ?? []).toEqual([]);
    expect(await isSignInBlocked(raw(current.db), viewer)).toBe(false);
    // The password is not brought back: an administrator resets it, or the person uses "Forgot password".
    expect(await passwordRow(current.db, viewer)).toBeUndefined();
  });

  it('updateUser follows the resulting state: inactive blocks, active lifts the block', async () => {
    current = await seededDb();
    const auth = await adminAuth(current.db, current.ids.admin);
    const viewer = current.ids.viewer;
    await assignRole(current, viewer, 'viewer-r4', []);
    await updateUser(current.db, auth, ACTOR, viewer, saveInput('viewer@kitstak.io', false, 'role-viewer-r4', current.ids.wh1));
    expect(await isSignInBlocked(raw(current.db), viewer)).toBe(true);
    expect(await passwordRow(current.db, viewer)).toBeUndefined();
    // An edit of a person who is already inactive keeps the block.
    await updateUser(current.db, auth, ACTOR, viewer, saveInput('viewer@kitstak.io', false, 'role-viewer-r4', current.ids.wh1));
    expect(await isSignInBlocked(raw(current.db), viewer)).toBe(true);
    await updateUser(current.db, auth, ACTOR, viewer, saveInput('viewer@kitstak.io', true, 'role-viewer-r4', current.ids.wh1));
    expect(await isSignInBlocked(raw(current.db), viewer)).toBe(false);
  });

  it('an account shared with another organization is not this warehouse\'s to switch off', async () => {
    current = await seededDb();
    const auth = await adminAuth(current.db, current.ids.admin);
    const viewer = current.ids.viewer;
    const [other] = await current.db.insert(organization).values({ name: 'Other Org', slug: 'other-org-r4', createdAt: new Date() }).returning({ id: organization.id });
    await current.db.insert(member).values({ organizationId: other!.id, userId: viewer, role: 'member', createdAt: new Date() });
    await setUsersActive(current.db, auth, ACTOR, [viewer], false);
    // Inactive in this warehouse only: the account, its password and its other organization are untouched.
    expect(await isSignInBlocked(raw(current.db), viewer)).toBe(false);
    expect(await passwordRow(current.db, viewer)).toBeTruthy();
  });

  it('switchOffSignIn and switchOnSignIn can be called twice', async () => {
    current = await seededDb();
    const viewer = current.ids.viewer;
    await switchOffSignIn(current.db, viewer, current.ids.admin);
    await switchOffSignIn(current.db, viewer);
    expect(await isSignInBlocked(raw(current.db), viewer)).toBe(true);
    await switchOnSignIn(current.db, viewer);
    await switchOnSignIn(current.db, viewer);
    expect(await isSignInBlocked(raw(current.db), viewer)).toBe(false);
  });
});
