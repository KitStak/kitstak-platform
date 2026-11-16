/**
 * Better Auth sign-in against the WMS instance (replaces password-login.test.ts):
 * bcrypt-compat credential round-trip + rehash-to-scrypt (auth review M1), closed
 * sign-up (C1), the lockout plugin with its generic locked answer (M5), the blocked
 * /change-password endpoint (M3), and the audit rows the plugin emits (blueprint §1.4).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { isBcryptHash } from '@kitstak/auth';
import type { AppDb } from '@/server/api/db';
import { auditLog } from '@/server/db/schema';
import { account, passwordPolicyState } from '@kitstak/db/schema';
import { seededDb, TEST_PASSWORD, type SeededDb } from './fixtures';

let current: SeededDb;
vi.mock('@/server/api/db', () => {
  const get = async (): Promise<AppDb> => current.db;
  return { getAppDb: get, getPlatformDb: get, getTenantDbFor: get };
});

const { getWmsAuth } = await import('@/server/auth/auth');
const { verifyCredentialPassword } = await import('@/server/auth/credentials');
const { signInCookie, forgetSignInCookies } = await import('../../setup/auth-session');

let ipCounter = 0;
function headersFor(extra: Record<string, string> = {}): Headers {
  ipCounter += 1;
  return new Headers({
    origin: 'http://localhost:3000',
    host: 'localhost:3000',
    'x-forwarded-for': `10.77.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`,
    ...extra,
  });
}

const STATUS_BY_NAME: Record<string, number> = { BAD_REQUEST: 400, UNAUTHORIZED: 401, FORBIDDEN: 403 };

/** Plugin `before` hooks throw APIError even with asResponse; normalize to a status. */
function statusOf(error: unknown): number {
  const err = error as { statusCode?: number; status?: string };
  if (typeof err.statusCode === 'number') return err.statusCode;
  return (err.status && STATUS_BY_NAME[err.status]) || 500;
}

interface SignInFailure {
  readonly status: number;
  readonly message: string | null;
  readonly code: string | null;
}

async function signInOutcome(email: string, password: string): Promise<SignInFailure> {
  const auth = await getWmsAuth();
  try {
    const response = await auth.api.signInEmail({
      body: { email, password },
      headers: headersFor(),
      asResponse: true,
    });
    return { status: response.status, message: null, code: null };
  } catch (error: unknown) {
    const err = error as { body?: { message?: string; code?: string } };
    return {
      status: statusOf(error),
      message: err.body?.message ?? null,
      code: err.body?.code ?? null,
    };
  }
}

async function signInStatus(email: string, password: string): Promise<number> {
  return (await signInOutcome(email, password)).status;
}

async function credentialHash(db: AppDb, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ password: account.password })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, 'credential')))
    .limit(1);
  return row?.password ?? null;
}

describe('Better Auth sign-in (WMS instance)', () => {
  afterEach(async () => {
    forgetSignInCookies(current.db);
    await current.close();
  });

  it('round-trips the seeded bcrypt credential and rehashes it to scrypt (M1)', async () => {
    current = await seededDb();
    // The stored hash is bcrypt ($2b$) — a 200 here proves the §1.4 migration contract.
    expect(isBcryptHash((await credentialHash(current.db, current.ids.admin)) ?? '')).toBe(true);
    expect(await signInStatus('admin@kitstak.io', TEST_PASSWORD)).toBe(200);
    // M1: the successful bcrypt login upgraded the stored credential to scrypt...
    const upgraded = await credentialHash(current.db, current.ids.admin);
    expect(upgraded).toBeTruthy();
    expect(isBcryptHash(upgraded ?? '')).toBe(false);
    // ...and the SAME password still signs in through the scrypt verifier.
    expect(await signInStatus('admin@kitstak.io', TEST_PASSWORD)).toBe(200);
    expect(await signInStatus('admin@kitstak.io', 'Wrong!password9')).toBe(401);
    expect(await verifyCredentialPassword(current.db, current.ids.admin, TEST_PASSWORD)).toBe(true);
    expect(await verifyCredentialPassword(current.db, current.ids.admin, 'nope')).toBe(false);
  });

  it('sign-up is closed on the WMS instance (C1)', async () => {
    current = await seededDb();
    const auth = await getWmsAuth();
    let status: number;
    try {
      const response = await auth.api.signUpEmail({
        body: { email: 'intruder@evil.example', password: 'Str0ng!Passw0rd', name: 'Intruder' },
        headers: headersFor(),
        asResponse: true,
      });
      status = response.status;
    } catch (error: unknown) {
      status = statusOf(error);
    }
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('locks after repeated failures, answers the GENERIC error while locked (M5), audits reasons', async () => {
    current = await seededDb();
    for (let i = 0; i < 5; i += 1) {
      expect(await signInStatus('viewer@kitstak.io', `Bad!password${i}1`)).toBe(401);
    }
    const [state] = await current.db.select().from(passwordPolicyState);
    expect(state?.email).toBe('viewer@kitstak.io');
    expect(state?.lockedUntil).toBeTruthy();
    // Locked: even the CORRECT password is refused — and the answer is byte-for-byte the
    // invalid-credentials contract, never a distinct "account locked" oracle.
    const locked = await signInOutcome('viewer@kitstak.io', TEST_PASSWORD);
    expect(locked.status).toBe(401);
    expect(locked.message).toBe('Invalid email or password');
    expect(locked.code).not.toBe('ACCOUNT_LOCKED');
    const audits = await current.db.select().from(auditLog);
    const actions = audits.map((row) => [row.action, row.outcome]);
    expect(actions).toContainEqual(['auth.login', 'failure']);
    // The specific reason is audit-only (M5).
    expect(audits.some((row) => JSON.stringify(row.detail).includes('locked'))).toBe(true);
  });

  it('a successful sign-in clears the failure counter and writes a success audit row', async () => {
    current = await seededDb();
    expect(await signInStatus('op@kitstak.io', 'Bad!password91')).toBe(401);
    expect(await signInStatus('op@kitstak.io', TEST_PASSWORD)).toBe(200);
    const [state] = await current.db.select().from(passwordPolicyState);
    expect(state?.failedLoginCount ?? 0).toBe(0);
    const success = (await current.db.select().from(auditLog)).find(
      (row) => row.action === 'auth.login' && row.outcome === 'success',
    );
    expect(success?.userId).toBe(current.ids.operator);
  });

  it("Better Auth's own /change-password and /update-user are blocked on WMS (M3)", async () => {
    current = await seededDb();
    const cookie = await signInCookie(current.db, 'admin@kitstak.io');
    const auth = await getWmsAuth();
    let changeStatus: number;
    try {
      const response = await auth.api.changePassword({
        body: { currentPassword: TEST_PASSWORD, newPassword: 'Brand!new2026pass', revokeOtherSessions: false },
        headers: headersFor({ cookie }),
        asResponse: true,
      });
      changeStatus = response.status;
    } catch (error: unknown) {
      changeStatus = statusOf(error);
    }
    expect(changeStatus).toBe(403);
    let updateStatus: number;
    try {
      const response = await auth.api.updateUser({
        body: { name: 'Hijacked' },
        headers: headersFor({ cookie }),
        asResponse: true,
      });
      updateStatus = response.status;
    } catch (error: unknown) {
      updateStatus = statusOf(error);
    }
    expect(updateStatus).toBe(403);
    // The password is unchanged: the guarded /api/account/password flow is the only door.
    forgetSignInCookies(current.db);
    expect(await signInStatus('admin@kitstak.io', TEST_PASSWORD)).toBe(200);
  });
});
