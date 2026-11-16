import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { session as coreSession } from '@kitstak/db/schema';
import { users } from '@/server/db/schema';
import type { AppDb } from '@/server/api/db';
import { seededDb, type SeededDb } from './fixtures';

let current: SeededDb;
vi.mock('@/server/api/db', () => {
  const get = async (): Promise<AppDb> => current.db;
  return { getAppDb: get, getPlatformDb: get, getTenantDbFor: get };
});

const { resolveSession, revokeSession, revokeUserSessions, bumpSessionVersion, listActiveSessions } =
  await import('@/server/auth/session-store');
const { signInCookie, forgetSignInCookies, SESSION_COOKIE_NAME } = await import('../../setup/auth-session');

const headersWith = (cookie: string): Headers => new Headers({ cookie });

async function sessionIdOf(cookie: string): Promise<string> {
  const res = await resolveSession(current.db, headersWith(cookie));
  if (!res.ok) throw new Error(`expected a live session, got ${res.reason}`);
  return res.user.sessionId;
}

describe('sessions (shared Better Auth core.session)', () => {
  afterEach(async () => {
    forgetSignInCookies(current.db);
    await current.close();
  });

  it('a real sign-in resolves to the SessionUser shape (profile-backed role/scope)', async () => {
    current = await seededDb();
    const cookie = await signInCookie(current.db, 'admin@kitstak.io');
    expect(cookie.startsWith(`${SESSION_COOKIE_NAME}=`)).toBe(true);
    const res = await resolveSession(current.db, headersWith(cookie));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.user).toMatchObject({
        id: current.ids.admin,
        email: 'admin@kitstak.io',
        role: 'admin',
        userType: 'Operation',
        allClients: true,
        isApiUser: false,
        sessionVersion: 1,
      });
      expect(res.user.sessionId).toBeTruthy();
      expect(Date.parse(res.user.sessionExpiresAt)).toBeGreaterThan(Date.now());
    }
  });

  it('missing/garbage cookies resolve to unauthenticated, never throw', async () => {
    current = await seededDb();
    expect(await resolveSession(current.db, new Headers())).toEqual({
      ok: false,
      reason: 'unauthenticated',
    });
    expect(
      await resolveSession(current.db, headersWith(`${SESSION_COOKIE_NAME}=not-a-real-token.sig`)),
    ).toEqual({ ok: false, reason: 'unauthenticated' });
  });

  it('rejects a revoked session (sign-out semantics)', async () => {
    current = await seededDb();
    const cookie = await signInCookie(current.db, 'admin@kitstak.io');
    const sessionId = await sessionIdOf(cookie);
    expect(await revokeSession(current.db, sessionId)).toBe(true);
    expect(await revokeSession(current.db, sessionId)).toBe(false);
    expect((await resolveSession(current.db, headersWith(cookie))).ok).toBe(false);
  });

  it('bumpSessionVersion (legacy seam) revokes every open session of the user', async () => {
    current = await seededDb();
    const a = await signInCookie(current.db, 'admin@kitstak.io');
    forgetSignInCookies(current.db);
    const b = await signInCookie(current.db, 'admin@kitstak.io');
    expect(a).not.toBe(b);
    expect(await bumpSessionVersion(current.db, current.ids.admin)).toBe(2);
    expect((await resolveSession(current.db, headersWith(a))).ok).toBe(false);
    expect((await resolveSession(current.db, headersWith(b))).ok).toBe(false);
    forgetSignInCookies(current.db);
    const fresh = await signInCookie(current.db, 'admin@kitstak.io');
    expect((await resolveSession(current.db, headersWith(fresh))).ok).toBe(true);
  });

  it('deactivated users lose access on the next request and cannot sign in again', async () => {
    current = await seededDb();
    const cookie = await signInCookie(current.db, 'admin@kitstak.io');
    await current.db.update(users).set({ isActive: false }).where(eq(users.id, current.ids.admin));
    expect(await resolveSession(current.db, headersWith(cookie))).toEqual({
      ok: false,
      reason: 'user_inactive',
    });
    forgetSignInCookies(current.db);
    // The WMS sign-in gate answers inactive users like a wrong password (hook APIError).
    await expect(signInCookie(current.db, 'admin@kitstak.io')).rejects.toThrow(
      /Invalid email or password|401/,
    );
  });

  it('sign out other sessions keeps the chosen one', async () => {
    current = await seededDb();
    const keep = await signInCookie(current.db, 'admin@kitstak.io');
    const keepId = await sessionIdOf(keep);
    forgetSignInCookies(current.db);
    await signInCookie(current.db, 'admin@kitstak.io');
    forgetSignInCookies(current.db);
    await signInCookie(current.db, 'admin@kitstak.io');
    expect(await listActiveSessions(current.db, current.ids.admin)).toHaveLength(3);
    expect(await revokeUserSessions(current.db, current.ids.admin, { exceptSessionId: keepId })).toBe(2);
    expect((await listActiveSessions(current.db, current.ids.admin)).map((s) => s.id)).toEqual([keepId]);
    expect((await resolveSession(current.db, headersWith(keep))).ok).toBe(true);
  });

  it('wrong passwords fail sign-in and bcrypt-compat hashes verify (migration round-trip)', async () => {
    current = await seededDb();
    // The seeded credential is a bcrypt hash: a successful sign-in IS the compat proof.
    const cookie = await signInCookie(current.db, 'viewer@kitstak.io');
    expect((await resolveSession(current.db, headersWith(cookie))).ok).toBe(true);
    const [row] = await current.db
      .select({ n: coreSession.id })
      .from(coreSession)
      .limit(1);
    expect(row).toBeTruthy();
    forgetSignInCookies(current.db);
    await expect(signInCookie(current.db, 'viewer@kitstak.io', 'Wrong!password9')).rejects.toThrow(/401/);
  });
});
