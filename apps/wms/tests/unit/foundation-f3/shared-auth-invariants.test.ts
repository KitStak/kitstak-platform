/**
 * Instance-independent auth invariants (auth review 2026-11-11):
 *
 *  - H1: lockout is FACTORY behaviour — brute-forcing through a CRM-configured
 *    instance (no WMS gate, no injected policy/audit) increments the shared
 *    core.password_policy_state and locks the account for every instance.
 *  - C1: a core user with NO wms.user_profiles row is an explicit deny — session
 *    resolution answers `no_profile`, permissions are empty, scope has zero warehouses.
 *  - M3 residual: `/change-password` (served on CRM) verifies the CURRENT password, so
 *    repeated wrong guesses there increment the SAME per-email lockout state as sign-in
 *    failures, and a locked account's change-password answers the generic message.
 *  - NEW-4: the WMS audit sink keeps events for core-only subjects (no wms.users row)
 *    by writing `user_id = NULL` with the email in `detail`, instead of dropping the
 *    row on the FK failure.
 */
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createAuth } from '@kitstak/auth';
import { account, passwordPolicyState, user } from '@kitstak/db/schema';
import type { AppDb } from '@/server/api/db';
import { auditLog } from '@/server/db/schema';
import { seededDb, testHash, TEST_PASSWORD, type SeededDb } from './fixtures';

let current: SeededDb;
vi.mock('@/server/api/db', () => {
  const get = async (): Promise<AppDb> => current.db;
  return { getAppDb: get, getPlatformDb: get, getTenantDbFor: get };
});

const { wmsAuthSchema } = await import('@/server/auth/auth');
const { resolveSession } = await import('@/server/auth/session-store');
const { loadPermissions } = await import('@/server/auth/permissions');
const { getScope } = await import('@/server/auth/scope');
const { signInCookie, forgetSignInCookies } = await import('../../setup/auth-session');

/**
 * A Better Auth instance configured the way CRM configures it: shared factory, same
 * database/tables, but NO WMS extras (no sign-in gate, no policy loader, no audit sink).
 */
function crmLikeAuth(db: AppDb) {
  return createAuth({
    db,
    schema: wmsAuthSchema,
    secret: 'crm-test-secret-crm-test-secret-crm-test-secret',
    baseURL: 'http://localhost:3100',
    trustedOrigins: ['http://localhost:3100'],
  });
}

let ipCounter = 0;
function crmHeaders(): Headers {
  ipCounter += 1;
  return new Headers({
    origin: 'http://localhost:3100',
    host: 'localhost:3100',
    'x-forwarded-for': `10.88.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`,
  });
}

interface Outcome {
  readonly status: number;
  readonly message: string | null;
}

function toOutcome(error: unknown): Outcome {
  const err = error as { statusCode?: number; status?: string; body?: { message?: string } };
  const byName: Record<string, number> = { BAD_REQUEST: 400, UNAUTHORIZED: 401, FORBIDDEN: 403 };
  const status =
    typeof err.statusCode === 'number' ? err.statusCode : (err.status && byName[err.status]) || 500;
  return { status, message: err.body?.message ?? null };
}

async function crmSignIn(auth: ReturnType<typeof crmLikeAuth>, email: string, password: string): Promise<Outcome> {
  try {
    const response = await auth.api.signInEmail({
      body: { email, password },
      headers: crmHeaders(),
      asResponse: true,
    });
    return { status: response.status, message: null };
  } catch (error: unknown) {
    return toOutcome(error);
  }
}

function sessionCookieFrom(response: Response): string {
  const header = response.headers as Headers & { getSetCookie?: () => string[] };
  const cookies = header.getSetCookie ? header.getSetCookie() : [response.headers.get('set-cookie') ?? ''];
  for (const cookie of cookies) {
    if (cookie.includes('session_token=')) {
      const value = cookie.split(';')[0];
      if (value && !value.endsWith('=')) return value;
    }
  }
  throw new Error('sign-in response carried no session cookie');
}

async function crmChangePassword(
  auth: ReturnType<typeof crmLikeAuth>,
  cookie: string,
  currentPassword: string,
): Promise<Outcome> {
  const headers = crmHeaders();
  headers.set('cookie', cookie);
  try {
    const response = await auth.api.changePassword({
      body: { currentPassword, newPassword: 'Brand!new2026pass', revokeOtherSessions: false },
      headers,
      asResponse: true,
    });
    return { status: response.status, message: null };
  } catch (error: unknown) {
    return toOutcome(error);
  }
}

describe('shared-factory auth invariants', () => {
  afterEach(async () => {
    forgetSignInCookies(current.db);
    await current.close();
  });

  it('H1: brute-force through a CRM-configured instance increments and enforces the shared lockout', async () => {
    current = await seededDb();
    const crmAuth = crmLikeAuth(current.db);
    for (let i = 0; i < 4; i += 1) {
      expect((await crmSignIn(crmAuth, 'viewer@kitstak.io', `Bad!password${i}1`)).status).toBe(401);
    }
    // The shared state table accrued the failures (previously untouched from CRM).
    let [state] = await current.db.select().from(passwordPolicyState);
    expect(state?.email).toBe('viewer@kitstak.io');
    expect(state?.failedLoginCount).toBe(4);
    // Fifth failure crosses the default threshold and locks.
    expect((await crmSignIn(crmAuth, 'viewer@kitstak.io', 'Bad!password51')).status).toBe(401);
    [state] = await current.db.select().from(passwordPolicyState);
    expect(state?.lockedUntil).toBeTruthy();
    // Locked on the CRM instance too, with the GENERIC message (M5)...
    const locked = await crmSignIn(crmAuth, 'viewer@kitstak.io', TEST_PASSWORD);
    expect(locked.status).toBe(401);
    expect(locked.message).toBe('Invalid email or password');
    // ...and the WMS instance sees the same lock (shared core.password_policy_state);
    // its gate throws the generic invalid-credentials APIError even for the right password.
    await expect(signInCookie(current.db, 'viewer@kitstak.io')).rejects.toThrow(
      /Invalid email or password|401/,
    );
  });

  it('M1: a migrated bcrypt credential verifies AND rehashes through a CRM-configured instance', async () => {
    current = await seededDb();
    const crmAuth = crmLikeAuth(current.db);
    // Previously this 500'd (CRM had no compat verifier) and bypassed lockout accounting.
    expect((await crmSignIn(crmAuth, 'op@kitstak.io', TEST_PASSWORD)).status).toBe(200);
    const [credential] = await current.db
      .select({ password: account.password })
      .from(account)
      .where(eq(account.userId, current.ids.operator));
    expect(credential?.password?.startsWith('$2')).toBe(false);
    // Same password still works post-rehash, on the WMS instance too.
    expect((await crmSignIn(crmAuth, 'op@kitstak.io', TEST_PASSWORD)).status).toBe(200);
    await expect(signInCookie(current.db, 'op@kitstak.io')).resolves.toBeTruthy();
  });

  it('M3 residual: wrong current-password guesses on /change-password lock the account (CRM-configured instance)', async () => {
    current = await seededDb();
    const crmAuth = crmLikeAuth(current.db);
    const signIn = await crmAuth.api.signInEmail({
      body: { email: 'op@kitstak.io', password: TEST_PASSWORD },
      headers: crmHeaders(),
      asResponse: true,
    });
    expect(signIn.status).toBe(200);
    const cookie = sessionCookieFrom(signIn);
    // Five wrong CURRENT passwords: each one is a credential guess and counts toward the
    // SAME per-email lockout state as a failed sign-in (previously uncounted — M3 residual).
    for (let i = 0; i < 5; i += 1) {
      expect((await crmChangePassword(crmAuth, cookie, `Guess!password${i}1`)).status).toBe(400);
    }
    const [state] = await current.db.select().from(passwordPolicyState);
    expect(state?.email).toBe('op@kitstak.io');
    expect(state?.lockedUntil).toBeTruthy();
    // Locked: change-password is refused even for the RIGHT current password (keyed on
    // the session user's email, never the request body) — and the answer is byte-for-byte
    // the wrong-current-password answer (400 INVALID_PASSWORD), so the lock state is not
    // distinguishable by status code (NEW-7).
    const locked = await crmChangePassword(crmAuth, cookie, TEST_PASSWORD);
    expect(locked.status).toBe(400);
    expect(locked.message).toBe('Invalid password');
    // ...and password sign-in is locked everywhere too (shared state).
    const lockedSignIn = await crmSignIn(crmAuth, 'op@kitstak.io', TEST_PASSWORD);
    expect(lockedSignIn.status).toBe(401);
    expect(lockedSignIn.message).toBe('Invalid email or password');
  });

  it('C1: a core user without a wms.user_profiles row resolves to an explicit deny', async () => {
    current = await seededDb();
    const now = new Date();
    const crmOnlyId = randomUUID();
    const email = 'crm-only@kitstak.io';
    // A CRM-provisioned platform identity: core."user" + credential, NO wms rows at all.
    await current.db.insert(user).values({
      id: crmOnlyId,
      name: 'CRM Only',
      email,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await current.db.insert(account).values({
      id: randomUUID(),
      accountId: crmOnlyId,
      providerId: 'credential',
      userId: crmOnlyId,
      password: testHash(),
      createdAt: now,
      updatedAt: now,
    });
    // The shared session is real — but WMS refuses it, never viewer defaults. This identity
    // belongs to no org with a warehouse, so the refusal reads `no_warehouse` (one separate
    // warehouse per organization); a member WITHOUT a profile reads `no_profile`.
    const cookie = await signInCookie(current.db, email);
    // NEW-4: that sign-in went through the WMS instance, whose audit sink previously
    // dropped the event on the wms.users FK — the row must exist with user_id NULL and
    // the email preserved in detail.
    const audits = await current.db.select().from(auditLog);
    const crmOnlyLogin = audits.find(
      (row) => row.action === 'auth.login' && row.outcome === 'success' && row.detail?.includes(email),
    );
    expect(crmOnlyLogin).toBeTruthy();
    expect(crmOnlyLogin?.userId).toBeNull();
    expect(await resolveSession(current.db, new Headers({ cookie }))).toEqual({
      ok: false,
      reason: 'no_warehouse',
    });
    // Defence in depth: even if a grant were computed, it would be empty...
    const grant = await loadPermissions(current.db, { id: crmOnlyId, role: 'viewer' });
    expect(grant.permissions.size).toBe(0);
    // ...and the scope would cover zero warehouses (no all-warehouse fallback).
    const scope = await getScope(current.db, { id: crmOnlyId, role: 'viewer', allClients: false });
    expect(scope.warehouseIds).toEqual([]);
    expect(scope.clientIds).toEqual([]);
  });

  it('C1 control: seeded users with profiles still resolve and keep their defaults', async () => {
    current = await seededDb();
    const cookie = await signInCookie(current.db, 'op@kitstak.io');
    const res = await resolveSession(current.db, new Headers({ cookie }));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.user.role).toBe('operator');
  });
});
