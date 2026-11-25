/**
 * Billing review round 5: an account a warehouse admin makes for an address is born UNVERIFIED,
 * and a proven mailbox is never handed a password by someone else.
 *
 * `core."user".email_verified` is the proof every invite door trusts (`requireProvenMailbox` in
 * `@kitstak/billing`). Before this fix the WMS "Add user" screen wrote it as true for any free
 * address, with a password the admin typed. So a warehouse admin could take an owner's billing
 * invite, and keep a password on an account a stranger later signed in to with an emailed code.
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { account, user } from '@kitstak/db/schema';
import type { AppDb } from '@/server/api/db';
import { users } from '@/server/db/schema';
import { assignRole, seededDb, type SeededDb } from '../foundation-f3/fixtures';

let current: SeededDb;
vi.mock('@/server/api/db', () => {
  const get = async (): Promise<AppDb> => current.db;
  return { getAppDb: get, getPlatformDb: get, getTenantDbFor: get };
});

const { buildAuthContext } = await import('@/server/auth/context');
const { mailboxProven, syncCoreUser, upsertCoreIdentity, verifyCredentialPassword, PASSWORD_IS_THEIRS_MESSAGE } = await import(
  '@/server/auth/credentials'
);
const { createUser, resetUserPassword, updateUser } = await import('@/server/repositories/users');

const ACTOR = { userId: null, source: 'test' } as const;
const ADMIN_TYPED = 'Typed-By-Admin-2026!x';

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

function saveInput(email: string, password: string, roleId: string, version?: number) {
  return {
    firstName: 'Nora',
    lastName: 'Newhire',
    email,
    userType: 'Operation' as const,
    sendWelcomeEmail: false,
    isActive: true,
    password,
    confirmPassword: password,
    roleIds: [roleId],
    warehouseIds: [current.ids.wh1],
    allClients: true,
    clientIds: [],
    version,
  };
}

async function coreUser(db: SeededDb['db'], id: string) {
  return (await db.select({ email: user.email, emailVerified: user.emailVerified }).from(user).where(eq(user.id, id)).limit(1))[0];
}

async function hasCredential(db: SeededDb['db'], userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, 'credential')))
    .limit(1);
  return rows.length > 0;
}

/** Stands in for the person proving the mailbox with the emailed code in the Portal. */
async function proveMailbox(db: SeededDb['db'], userId: string): Promise<void> {
  await db.update(user).set({ emailVerified: true }).where(eq(user.id, userId));
}

describe('round 5: an account made in the WMS is born unverified', () => {
  afterEach(async () => {
    await current.close();
  });

  it('upsertCoreIdentity makes a new identity with email_verified false', async () => {
    current = await seededDb();
    const id = randomUUID();
    await upsertCoreIdentity(current.db, {
      userId: id,
      email: 'Stranger@Elsewhere.example',
      name: 'Not Really Them',
      password: ADMIN_TYPED,
      legacyRole: 'operator',
      userType: 'Operation',
      isApiUser: false,
      allClients: true,
    });
    expect(await coreUser(current.db, id)).toEqual({ email: 'stranger@elsewhere.example', emailVerified: false });
    expect(await mailboxProven(current.db, id)).toBe(false);
  });

  it('only the demo seed may make a verified identity', async () => {
    current = await seededDb();
    const id = randomUUID();
    await upsertCoreIdentity(current.db, {
      seedVerified: true,
      userId: id,
      email: 'demo@kitstak.io',
      name: 'Demo',
      legacyRole: 'operator',
      userType: 'Operation',
      isApiUser: false,
      allClients: true,
    });
    expect((await coreUser(current.db, id))?.emailVerified).toBe(true);
  });

  it('"Add user" (createUser) makes the account unverified, whatever the admin types', async () => {
    current = await seededDb();
    const auth = await adminAuth(current.db, current.ids.admin);
    await assignRole(current, current.ids.viewer, 'r5-a', []);
    const made = await createUser(current.db, auth, ACTOR, saveInput('bookkeeper@victim.example', ADMIN_TYPED, 'role-r5-a'));
    expect((await coreUser(current.db, made.id))?.emailVerified).toBe(false);
  });

  it('a re-run of upsertCoreIdentity never turns an unverified identity into a verified one', async () => {
    current = await seededDb();
    expect((await coreUser(current.db, current.ids.operator))?.emailVerified).toBe(false);
    await upsertCoreIdentity(current.db, {
      userId: current.ids.operator,
      email: 'op@kitstak.io',
      name: 'Op',
      legacyRole: 'operator',
      userType: 'Operation',
      isApiUser: false,
      allClients: true,
    });
    expect((await coreUser(current.db, current.ids.operator))?.emailVerified).toBe(false);
  });
});

describe('round 5: the verified flag never moves to a new address', () => {
  afterEach(async () => {
    await current.close();
  });

  it('an admin edit that changes the email makes the account unverified again', async () => {
    current = await seededDb();
    const auth = await adminAuth(current.db, current.ids.admin);
    await assignRole(current, current.ids.viewer, 'r5-b', []);
    await proveMailbox(current.db, current.ids.operator);
    const [before] = await current.db.select({ version: users.version }).from(users).where(eq(users.id, current.ids.operator));
    await updateUser(current.db, auth, ACTOR, current.ids.operator, saveInput('invited@victim.example', '', 'role-r5-b', before?.version));
    expect(await coreUser(current.db, current.ids.operator)).toEqual({ email: 'invited@victim.example', emailVerified: false });
  });

  it('an edit that keeps the email keeps the flag', async () => {
    current = await seededDb();
    const auth = await adminAuth(current.db, current.ids.admin);
    await assignRole(current, current.ids.viewer, 'r5-c', []);
    await proveMailbox(current.db, current.ids.operator);
    const [before] = await current.db.select({ version: users.version }).from(users).where(eq(users.id, current.ids.operator));
    await updateUser(current.db, auth, ACTOR, current.ids.operator, saveInput('OP@kitstak.io', '', 'role-r5-c', before?.version));
    expect((await coreUser(current.db, current.ids.operator))?.emailVerified).toBe(true);
  });

  it('a person who changes their own email in the WMS is unverified at the new address', async () => {
    current = await seededDb();
    await proveMailbox(current.db, current.ids.operator);
    await syncCoreUser(current.db, current.ids.operator, { name: 'Op' });
    expect((await coreUser(current.db, current.ids.operator))?.emailVerified).toBe(true);
    await syncCoreUser(current.db, current.ids.operator, { email: 'someone-else@victim.example', name: 'Op' });
    expect(await coreUser(current.db, current.ids.operator)).toEqual({ email: 'someone-else@victim.example', emailVerified: false });
  });
});

describe('round 5: a proven mailbox is never handed a password by a warehouse admin', () => {
  afterEach(async () => {
    await current.close();
  });

  it('admin reset works while the mailbox is unproven and is refused once it is proven', async () => {
    current = await seededDb();
    const auth = await adminAuth(current.db, current.ids.admin);
    const first = await resetUserPassword(current.db, auth, ACTOR, current.ids.operator);
    expect(await verifyCredentialPassword(current.db, current.ids.operator, first.temporaryPassword)).toBe(true);

    await proveMailbox(current.db, current.ids.operator);
    await expect(resetUserPassword(current.db, auth, ACTOR, current.ids.operator)).rejects.toThrow(PASSWORD_IS_THEIRS_MESSAGE);
    // Nothing changed: the password from before still is the password.
    expect(await verifyCredentialPassword(current.db, current.ids.operator, first.temporaryPassword)).toBe(true);
  });

  it('an admin edit with a new password is refused once the mailbox is proven', async () => {
    current = await seededDb();
    const auth = await adminAuth(current.db, current.ids.admin);
    await assignRole(current, current.ids.viewer, 'r5-d', []);
    await proveMailbox(current.db, current.ids.operator);
    const [before] = await current.db.select({ version: users.version }).from(users).where(eq(users.id, current.ids.operator));
    await expect(
      updateUser(current.db, auth, ACTOR, current.ids.operator, saveInput('op@kitstak.io', ADMIN_TYPED, 'role-r5-d', before?.version)),
    ).rejects.toThrow(/only they can change their password/);
    expect(await verifyCredentialPassword(current.db, current.ids.operator, ADMIN_TYPED)).toBe(false);
  });

  it('upsertCoreIdentity itself never writes a password onto a proven mailbox', async () => {
    current = await seededDb();
    await proveMailbox(current.db, current.ids.operator);
    await upsertCoreIdentity(current.db, {
      userId: current.ids.operator,
      email: 'op@kitstak.io',
      name: 'Op',
      password: ADMIN_TYPED,
      legacyRole: 'operator',
      userType: 'Operation',
      isApiUser: false,
      allClients: true,
    });
    expect(await hasCredential(current.db, current.ids.operator)).toBe(true);
    expect(await verifyCredentialPassword(current.db, current.ids.operator, ADMIN_TYPED)).toBe(false);
  });
});
