/**
 * Better Auth sign-in against the WMS instance (replaces password-login.test.ts):
 * bcrypt-compat credential round-trip, the lockout plugin, the policy gate on
 * change-password, and the audit rows the plugin emits (blueprint §1.4).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppDb } from '@/server/api/db';
import { auditLog } from '@/server/db/schema';
import { passwordPolicyState } from '@kitstak/db/schema';
import { seededDb, TEST_PASSWORD, type SeededDb } from './fixtures';

let current: SeededDb;
vi.mock('@/server/api/db', () => ({ getAppDb: async (): Promise<AppDb> => current.db }));

const { getWmsAuth } = await import('@/server/auth/auth');
const { verifyCredentialPassword } = await import('@/server/auth/credentials');
const { signInCookie, forgetSignInCookies } = await import('../../setup/auth-session');

let ipCounter = 0;
function headersFor(extra: Record<string, string> = {}): Headers {
  ipCounter += 1;
  return new Headers({
    origin: 'http://localhost:3000',
    host: 'localhost:3000',
    'x-forwarded-for': `10.77.0.${(ipCounter % 250) + 1}`,
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

async function signInStatus(email: string, password: string): Promise<number> {
  const auth = await getWmsAuth();
  try {
    const response = await auth.api.signInEmail({
      body: { email, password },
      headers: headersFor(),
      asResponse: true,
    });
    return response.status;
  } catch (error: unknown) {
    return statusOf(error);
  }
}

async function changePasswordStatus(cookie: string, newPassword: string): Promise<number> {
  const auth = await getWmsAuth();
  try {
    const response = await auth.api.changePassword({
      body: { currentPassword: TEST_PASSWORD, newPassword, revokeOtherSessions: false },
      headers: headersFor({ cookie }),
      asResponse: true,
    });
    return response.status;
  } catch (error: unknown) {
    return statusOf(error);
  }
}

describe('Better Auth sign-in (WMS instance)', () => {
  afterEach(async () => {
    forgetSignInCookies(current.db);
    await current.close();
  });

  it('round-trips the seeded bcrypt credential through the compat verifier', async () => {
    current = await seededDb();
    // The stored hash is bcrypt ($2b$) — a 200 here proves the §1.4 migration contract.
    expect(await signInStatus('admin@kitstak.io', TEST_PASSWORD)).toBe(200);
    expect(await signInStatus('admin@kitstak.io', 'Wrong!password9')).toBe(401);
    expect(await verifyCredentialPassword(current.db, current.ids.admin, TEST_PASSWORD)).toBe(true);
    expect(await verifyCredentialPassword(current.db, current.ids.admin, 'nope')).toBe(false);
  });

  it('locks the account after repeated failures and audits every outcome', async () => {
    current = await seededDb();
    for (let i = 0; i < 5; i += 1) {
      expect(await signInStatus('viewer@kitstak.io', `Bad!password${i}1`)).toBe(401);
    }
    const [state] = await current.db.select().from(passwordPolicyState);
    expect(state?.email).toBe('viewer@kitstak.io');
    expect(state?.lockedUntil).toBeTruthy();
    // Locked: even the CORRECT password is refused until the lock expires.
    expect(await signInStatus('viewer@kitstak.io', TEST_PASSWORD)).toBe(401);
    const actions = (await current.db.select().from(auditLog)).map((row) => [row.action, row.outcome]);
    expect(actions).toContainEqual(['auth.login', 'failure']);
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

  it('change-password enforces the company policy and rehashes to scrypt', async () => {
    current = await seededDb();
    const cookie = await signInCookie(current.db, 'admin@kitstak.io');
    expect(await changePasswordStatus(cookie, 'short')).toBe(400);
    expect(await changePasswordStatus(cookie, 'Brand!new2026pass')).toBe(200);
    expect(await verifyCredentialPassword(current.db, current.ids.admin, 'Brand!new2026pass')).toBe(true);
    forgetSignInCookies(current.db);
    expect(await signInStatus('admin@kitstak.io', 'Brand!new2026pass')).toBe(200);
  });
});
