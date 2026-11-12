import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { users, userSessions } from '@/server/db/schema';
import {
  bumpSessionVersion,
  getSessionSecret,
  issueSession,
  listActiveSessions,
  purgeStaleSessions,
  resolveSession,
  revokeSession,
  revokeUserSessions,
  SESSION_TTL_SECONDS,
} from '@/server/auth/session-store';
import { seededDb, type SeededDb } from './fixtures';

describe('sessions (jti + sv + user_sessions)', () => {
  let t: SeededDb;
  afterEach(async () => await t.close());

  it('issues a token that resolves to the user', async () => {
    t = await seededDb();
    const issued = await issueSession(t.db, t.ids.admin, { ip: '1.1.1.1', userAgent: 'vitest' });
    const res = await resolveSession(t.db, issued.token);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.user).toMatchObject({
        id: t.ids.admin,
        email: 'admin@kitstak.io',
        role: 'admin',
        sessionId: issued.sessionId,
        sessionVersion: 1,
      });
    }
    expect(issued.maxAgeSeconds).toBe(SESSION_TTL_SECONDS);
  });

  it('rejects a revoked session (logout)', async () => {
    t = await seededDb();
    const issued = await issueSession(t.db, t.ids.admin);
    expect(await revokeSession(t.db, issued.sessionId)).toBe(true);
    expect(await revokeSession(t.db, issued.sessionId)).toBe(false);
    expect(await resolveSession(t.db, issued.token)).toEqual({ ok: false, reason: 'revoked' });
  });

  it('bumping session_version kills every open session', async () => {
    t = await seededDb();
    const a = await issueSession(t.db, t.ids.admin);
    const b = await issueSession(t.db, t.ids.admin);
    expect(await bumpSessionVersion(t.db, t.ids.admin)).toBe(2);
    expect((await resolveSession(t.db, a.token)).ok).toBe(false);
    expect((await resolveSession(t.db, b.token)).ok).toBe(false);
    const fresh = await issueSession(t.db, t.ids.admin);
    expect((await resolveSession(t.db, fresh.token)).ok).toBe(true);
  });

  it('detects a version mismatch even without revocation', async () => {
    t = await seededDb();
    const issued = await issueSession(t.db, t.ids.admin);
    await t.db.update(users).set({ sessionVersion: 7 }).where(eq(users.id, t.ids.admin));
    expect(await resolveSession(t.db, issued.token)).toEqual({ ok: false, reason: 'version_mismatch' });
  });

  it('deactivated users lose access on the next request', async () => {
    t = await seededDb();
    const issued = await issueSession(t.db, t.ids.admin);
    await t.db.update(users).set({ isActive: false }).where(eq(users.id, t.ids.admin));
    expect(await resolveSession(t.db, issued.token)).toEqual({ ok: false, reason: 'user_inactive' });
    await expect(issueSession(t.db, t.ids.admin)).rejects.toThrow();
  });

  it('enforces the 12 h absolute TTL', async () => {
    t = await seededDb();
    const now = new Date('2026-11-05T00:00:00.000Z');
    const issued = await issueSession(t.db, t.ids.admin, {}, now);
    expect((await resolveSession(t.db, issued.token, new Date(now.getTime() + 11 * 3600_000))).ok).toBe(true);
    expect((await resolveSession(t.db, issued.token, new Date(now.getTime() + 13 * 3600_000))).ok).toBe(
      false,
    );
  });

  it('rejects tampered, foreign and malformed tokens', async () => {
    t = await seededDb();
    const issued = await issueSession(t.db, t.ids.admin);
    expect(await resolveSession(t.db, `${issued.token}x`)).toEqual({ ok: false, reason: 'invalid_token' });
    expect(await resolveSession(t.db, '')).toEqual({ ok: false, reason: 'malformed' });
    const forged = await new SignJWT({ sv: 1 })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(t.ids.viewer)
      .setJti(issued.sessionId)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(getSessionSecret());
    expect(await resolveSession(t.db, forged)).toEqual({ ok: false, reason: 'unknown_session' });
    const noSv = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(t.ids.admin)
      .setJti('x')
      .setExpirationTime('1h')
      .sign(getSessionSecret());
    expect(await resolveSession(t.db, noSv)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('slides lastSeenAt at most once per resolution window', async () => {
    t = await seededDb();
    const now = new Date('2026-11-05T00:00:00.000Z');
    const issued = await issueSession(t.db, t.ids.admin, {}, now);
    const seen = async (): Promise<string | null | undefined> =>
      (
        await t.db
          .select({ v: userSessions.lastSeenAt })
          .from(userSessions)
          .where(eq(userSessions.id, issued.sessionId))
          .limit(1)
      )[0]?.v;
    await resolveSession(t.db, issued.token, new Date(now.getTime() + 10_000));
    expect(await seen()).toBe(now.toISOString());
    const later = new Date(now.getTime() + 120_000);
    await resolveSession(t.db, issued.token, later);
    expect(await seen()).toBe(later.toISOString());
  });

  it('sign out other sessions keeps the current one; purge removes stale rows', async () => {
    t = await seededDb();
    const keep = await issueSession(t.db, t.ids.admin);
    await issueSession(t.db, t.ids.admin);
    await issueSession(t.db, t.ids.admin);
    expect(await listActiveSessions(t.db, t.ids.admin)).toHaveLength(3);
    expect(await revokeUserSessions(t.db, t.ids.admin, { exceptSessionId: keep.sessionId })).toBe(2);
    expect((await listActiveSessions(t.db, t.ids.admin)).map((s) => s.id)).toEqual([keep.sessionId]);
    expect((await resolveSession(t.db, keep.token)).ok).toBe(true);
    expect(await purgeStaleSessions(t.db, new Date(Date.now() + 30 * 86_400_000))).toBe(3);
  });
});
