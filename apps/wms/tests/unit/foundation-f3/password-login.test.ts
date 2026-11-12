import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditLog, companySettings, passwordResetTokens, users } from '@/server/db/schema';
import { authenticate } from '@/server/auth/login';
import { hashPassword, needsRehash, verifyPassword } from '@/server/auth/password';
import {
  DEFAULT_PASSWORD_POLICY,
  getPasswordPolicy,
  isPasswordExpired,
  lockoutUntil,
  validatePassword,
} from '@/server/auth/password-policy';
import {
  hashResetToken,
  requestPasswordReset,
  resetPassword,
  setMailAdapter,
  devLogMailAdapter,
  type MailMessage,
} from '@/server/auth/password-reset';
import { issueSession, resolveSession } from '@/server/auth/session-store';
import { seededDb, TEST_PASSWORD, type SeededDb } from './fixtures';

describe('password hashing + policy', () => {
  it('hashes and verifies; flags low-cost hashes for rehash', () => {
    const hash = hashPassword('Secret!123abc', 4);
    expect(verifyPassword('Secret!123abc', hash)).toBe(true);
    expect(verifyPassword('nope', hash)).toBe(false);
    expect(verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(needsRehash(hash)).toBe(true);
  });

  it('validates against the policy', () => {
    expect(validatePassword(TEST_PASSWORD, DEFAULT_PASSWORD_POLICY)).toEqual([]);
    expect(validatePassword('short', DEFAULT_PASSWORD_POLICY).length).toBeGreaterThan(2);
    expect(
      validatePassword('Mikelunsford!1x', DEFAULT_PASSWORD_POLICY, { email: 'mikelunsford@x.io' }),
    ).toContain('Do not include your email name.');
    const lax = {
      ...DEFAULT_PASSWORD_POLICY,
      requireSymbol: false,
      requireUpper: false,
      requireNumber: false,
      minLength: 8,
    };
    expect(validatePassword('abcdefgh', lax)).toEqual([]);
  });

  it('expiry and lockout helpers', () => {
    const now = new Date('2026-11-05T00:00:00.000Z');
    expect(
      isPasswordExpired('2026-01-01T00:00:00.000Z', { ...DEFAULT_PASSWORD_POLICY, maxAgeDays: 90 }, now),
    ).toBe(true);
    expect(isPasswordExpired(null, { ...DEFAULT_PASSWORD_POLICY, maxAgeDays: 90 }, now)).toBe(false);
    expect(lockoutUntil(4, DEFAULT_PASSWORD_POLICY, now)).toBeNull();
    expect(lockoutUntil(5, DEFAULT_PASSWORD_POLICY, now)).toBe('2026-11-05T00:15:00.000Z');
  });
});

describe('authenticate', () => {
  let t: SeededDb;
  afterEach(async () => await t.close());
  const attempt = (password: string, ip = 'ip1') => ({
    email: 'Admin@KitStak.io',
    password,
    ip,
    userAgent: 'vitest',
  });

  it('accepts the right password, audits, and resets counters', async () => {
    t = await seededDb();
    expect(await authenticate(t.db, attempt(TEST_PASSWORD))).toEqual({ ok: true, userId: t.ids.admin });
    const row = (await t.db.select().from(users).where(eq(users.id, t.ids.admin)).limit(1))[0];
    expect(row?.lastLoginAt).toBeTruthy();
    expect(
      (await t.db.select().from(auditLog)).some((a) => a.action === 'auth.login' && a.outcome === 'success'),
    ).toBe(true);
  });

  it('rejects unknown emails and wrong passwords with the same reason', async () => {
    t = await seededDb();
    expect(await authenticate(t.db, { ...attempt('x'), email: 'ghost@kitstak.io' })).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(await authenticate(t.db, attempt('wrong'))).toEqual({ ok: false, reason: 'invalid' });
  });

  it('locks the account at the policy threshold', async () => {
    t = await seededDb();
    await t.db
      .insert(companySettings)
      .values({
        displayName: 'K',
        fullName: 'K',
        passwordPolicy: { ...DEFAULT_PASSWORD_POLICY, lockoutThreshold: 3 },
      });
    expect((await getPasswordPolicy(t.db)).lockoutThreshold).toBe(3);
    const now = new Date('2026-11-05T10:00:00.000Z');
    for (let i = 0; i < 3; i += 1)
      await authenticate(t.db, attempt('wrong', `ip${i}`), new Date(now.getTime() + i));
    expect(await authenticate(t.db, attempt(TEST_PASSWORD, 'ip9'), new Date(now.getTime() + 10))).toEqual({
      ok: false,
      reason: 'locked',
    });
    expect(
      await authenticate(t.db, attempt(TEST_PASSWORD, 'ip8'), new Date(now.getTime() + 16 * 60_000)),
    ).toEqual({ ok: true, userId: t.ids.admin });
  });

  it('rate limits 5/min per IP', async () => {
    t = await seededDb();
    const now = new Date('2026-11-05T10:00:00.000Z');
    for (let i = 0; i < 5; i += 1) await authenticate(t.db, { ...attempt('x'), email: `n${i}@x.io` }, now);
    const blocked = await authenticate(t.db, attempt(TEST_PASSWORD), now);
    expect(blocked).toMatchObject({ ok: false, reason: 'rate_limited' });
  });
});

describe('password reset', () => {
  let t: SeededDb;
  afterEach(async () => {
    setMailAdapter(devLogMailAdapter);
    await t.close();
  });

  it('mails a single-use link, resets the password and revokes sessions', async () => {
    t = await seededDb();
    const sent: MailMessage[] = [];
    setMailAdapter({ send: vi.fn(async (m: MailMessage) => void sent.push(m)) });
    const session = await issueSession(t.db, t.ids.admin);
    await requestPasswordReset(t.db, { email: 'admin@kitstak.io', baseUrl: 'http://localhost:3000/' });
    expect(sent).toHaveLength(1);
    const token = decodeURIComponent(/token=([^\s]+)/.exec(sent[0]?.text ?? '')?.[1] ?? '');
    const stored = await t.db.select().from(passwordResetTokens);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.tokenHash).toBe(hashResetToken(token));
    expect(stored[0]?.tokenHash).not.toContain(token);

    await expect(async () => await resetPassword(t.db, { token, password: 'weak' })).rejects.toThrow(
      expect.objectContaining({ code: 'VALIDATION' }),
    );
    await resetPassword(t.db, { token, password: 'BrandNew!Pass42' });
    expect((await resolveSession(t.db, session.token)).ok).toBe(false);
    expect(
      (
        await authenticate(t.db, {
          email: 'admin@kitstak.io',
          password: 'BrandNew!Pass42',
          ip: 'z',
          userAgent: null,
        })
      ).ok,
    ).toBe(true);
    await expect(
      async () => await resetPassword(t.db, { token, password: 'Another!Pass42' }),
    ).rejects.toThrow(/invalid or has expired/);
  });

  it('does nothing (silently) for unknown emails', async () => {
    t = await seededDb();
    const send = vi.fn(async () => undefined);
    setMailAdapter({ send });
    await requestPasswordReset(t.db, { email: 'ghost@x.io', baseUrl: 'http://x' });
    expect(send).not.toHaveBeenCalled();
  });
});
