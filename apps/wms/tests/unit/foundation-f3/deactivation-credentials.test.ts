/**
 * Round-2 residuals NEW-2 (auth review 2026-11-11): the shared credential
 * `core.account` row must never exist for an inactive user.
 *
 *  - `resetUserPassword` refuses inactive users (a reset would otherwise re-create the
 *    credential and silently reactivate password sign-in on every instance, CRM included);
 *  - `updateUser` deletes/skips the credential whenever the RESULTING state is inactive —
 *    not only on the active→inactive transition — so a password submitted while editing
 *    an already-inactive user cannot resurrect it.
 */
import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { account } from '@kitstak/db/schema';
import type { AppDb } from '@/server/api/db';
import { users } from '@/server/db/schema';
import { assignRole, seededDb, type SeededDb } from './fixtures';

let current: SeededDb;
vi.mock('@/server/api/db', () => ({ getAppDb: async (): Promise<AppDb> => current.db }));

const { buildAuthContext } = await import('@/server/auth/context');
const { deleteCredentialAccount } = await import('@/server/auth/credentials');
const { resetUserPassword, updateUser } = await import('@/server/repositories/users');
const { verifyCredentialPassword } = await import('@/server/auth/credentials');

const ACTOR = { userId: null, source: 'test' } as const;

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
  });
}

async function credentialRow(db: SeededDb['db'], userId: string) {
  return (
    await db
      .select({ id: account.id })
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, 'credential')))
      .limit(1)
  )[0];
}

function saveInput(email: string, isActive: boolean, password: string, roleId: string) {
  return {
    firstName: 'Vera',
    lastName: 'Viewer',
    email,
    userType: 'Operation' as const,
    sendWelcomeEmail: false,
    isActive,
    password,
    confirmPassword: password,
    roleIds: [roleId],
    warehouseIds: [current.ids.wh1],
    allClients: true,
    clientIds: [],
    version: undefined,
  };
}

describe('NEW-2: inactive users never hold a shared credential', () => {
  afterEach(async () => {
    await current.close();
  });

  it('resetUserPassword refuses an inactive user and leaves no credential behind', async () => {
    current = await seededDb();
    const auth = await adminAuth(current.db, current.ids.admin);
    await current.db
      .update(users)
      .set({ isActive: false })
      .where(eq(users.id, current.ids.viewer));
    await deleteCredentialAccount(current.db, current.ids.viewer);

    await expect(resetUserPassword(current.db, auth, ACTOR, current.ids.viewer)).rejects.toThrow(
      /inactive/i,
    );
    expect(await credentialRow(current.db, current.ids.viewer)).toBeUndefined();

    // Control: an ACTIVE user still gets the temporary-password reset.
    const reset = await resetUserPassword(current.db, auth, ACTOR, current.ids.operator);
    expect(reset.email).toBe('op@kitstak.io');
    expect(await verifyCredentialPassword(current.db, current.ids.operator, reset.temporaryPassword)).toBe(
      true,
    );
  });

  it('updateUser deletes the credential on an active→inactive edit, even with a password submitted', async () => {
    current = await seededDb();
    const auth = await adminAuth(current.db, current.ids.admin);
    await assignRole(current, current.ids.viewer, 'viewer-x', []);
    expect(await credentialRow(current.db, current.ids.viewer)).toBeTruthy();

    await updateUser(
      current.db,
      auth,
      ACTOR,
      current.ids.viewer,
      saveInput('viewer@kitstak.io', false, 'Fresh!pass2026x', 'role-viewer-x'),
    );
    expect(await credentialRow(current.db, current.ids.viewer)).toBeUndefined();
  });

  it('updateUser keeps an ALREADY-inactive user credential-less when a password is submitted (resulting state, not transition)', async () => {
    current = await seededDb();
    const auth = await adminAuth(current.db, current.ids.admin);
    await assignRole(current, current.ids.viewer, 'viewer-y', []);
    await current.db
      .update(users)
      .set({ isActive: false })
      .where(eq(users.id, current.ids.viewer));
    await deleteCredentialAccount(current.db, current.ids.viewer);

    // Before the fix this inactive→inactive edit re-created the credential from the
    // submitted password (the delete only ran on the active→inactive transition).
    await updateUser(
      current.db,
      auth,
      ACTOR,
      current.ids.viewer,
      saveInput('viewer@kitstak.io', false, 'Fresh!pass2026x', 'role-viewer-y'),
    );
    expect(await credentialRow(current.db, current.ids.viewer)).toBeUndefined();
  });

  it('updateUser with an active resulting state still sets a submitted password', async () => {
    current = await seededDb();
    const auth = await adminAuth(current.db, current.ids.admin);
    await assignRole(current, current.ids.viewer, 'viewer-z', []);

    await updateUser(
      current.db,
      auth,
      ACTOR,
      current.ids.viewer,
      saveInput('viewer@kitstak.io', true, 'Fresh!pass2026x', 'role-viewer-z'),
    );
    expect(await credentialRow(current.db, current.ids.viewer)).toBeTruthy();
    expect(await verifyCredentialPassword(current.db, current.ids.viewer, 'Fresh!pass2026x')).toBe(true);
  });
});
