/**
 * Credential check for POST /api/auth/login: rate limits (IP + account), lockout at the
 * policy threshold, constant-ish timing for unknown emails, audit rows for every outcome.
 */
import { eq } from 'drizzle-orm';
import { users } from '@/server/db/schema';
import { withWriteTx } from '@/server/db/sql';
import type { AppDb } from '@/server/api/db';
import { writeAudit } from './audit';
import { hashPassword, needsRehash, verifyPassword } from './password';
import { getPasswordPolicy, lockoutUntil } from './password-policy';
import { hitRateLimit, RATE_LIMITS, refundRateLimit, resetRateLimit } from './rate-limit';

/** Dummy hash compared when the user does not exist, so timing does not reveal registration. */
let timingPadHash: string | null = null;
function timingPad(): string {
  timingPadHash ??= hashPassword('kitstak-timing-pad', 10);
  return timingPadHash;
}

export interface LoginAttempt {
  readonly email: string;
  readonly password: string;
  readonly ip: string;
  readonly userAgent: string | null;
}

export type LoginOutcome =
  | { readonly ok: true; readonly userId: string }
  | { readonly ok: false; readonly reason: 'invalid' | 'locked' }
  | { readonly ok: false; readonly reason: 'rate_limited'; readonly retryAfterSeconds: number };

export const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password';
export const LOCKED_MESSAGE =
  'This account is temporarily locked after too many failed attempts. Try again later.';

export async function authenticate(
  db: AppDb,
  attempt: LoginAttempt,
  now: Date = new Date(),
): Promise<LoginOutcome> {
  const email = attempt.email.trim().toLowerCase();
  const audit = async (
    action: string,
    outcome: 'success' | 'failure',
    userId: string | null,
    detail: Record<string, unknown>,
  ) =>
    await writeAudit(
      db,
      {
        action,
        entity: 'user',
        entityId: userId ?? email,
        userId,
        outcome,
        detail: { email, ...detail },
        ip: attempt.ip,
        userAgent: attempt.userAgent,
      },
      now,
    );

  const ipLimit = await hitRateLimit(db, RATE_LIMITS.loginIp, attempt.ip, now);
  const accountLimit = await hitRateLimit(db, RATE_LIMITS.loginAccount, email, now);
  if (!ipLimit.allowed || !accountLimit.allowed) {
    await audit('auth.login.rate_limited', 'failure', null, {});
    return {
      ok: false,
      reason: 'rate_limited',
      retryAfterSeconds: Math.max(ipLimit.retryAfterSeconds, accountLimit.retryAfterSeconds),
    };
  }

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const passwordOk = verifyPassword(attempt.password, user?.passwordHash ?? timingPad());
  if (!user) {
    await audit('auth.login', 'failure', null, { reason: 'unknown_email' });
    return { ok: false, reason: 'invalid' };
  }
  if (user.lockedUntil && user.lockedUntil > now.toISOString()) {
    await audit('auth.login', 'failure', user.id, { reason: 'locked' });
    return { ok: false, reason: 'locked' };
  }
  if (!user.isActive || !passwordOk) {
    await registerFailure(db, user.id, now);
    await audit('auth.login', 'failure', user.id, { reason: user.isActive ? 'bad_password' : 'inactive' });
    return { ok: false, reason: 'invalid' };
  }

  await db
    .update(users)
    .set({
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: now.toISOString(),
      ...(needsRehash(user.passwordHash) ? { passwordHash: hashPassword(attempt.password) } : {}),
    })
    .where(eq(users.id, user.id));
  await resetRateLimit(db, RATE_LIMITS.loginAccount, email);
  // Successful sign-ins give back their per-IP hit, so only failures use up the shared budget.
  await refundRateLimit(db, RATE_LIMITS.loginIp, attempt.ip);
  await audit('auth.login', 'success', user.id, {});
  return { ok: true, userId: user.id };
}

/**
 * Counts a failed attempt. The count is re-read under the app write lock: authenticate() runs
 * outside a write transaction, so concurrent failures must not each write the same N+1 (that
 * would never reach the lockout threshold). An attempt that lost the race to a lockout does
 * not touch the row (it must not clear lockedUntil).
 */
async function registerFailure(db: AppDb, userId: string, now: Date): Promise<void> {
  const policy = await getPasswordPolicy(db);
  await withWriteTx(db, async (tx) => {
    const [row] = await tx
      .select({ count: users.failedLoginCount, lockedUntil: users.lockedUntil })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!row || (row.lockedUntil && row.lockedUntil > now.toISOString())) return;
    const failedLoginCount = row.count + 1;
    const locked = lockoutUntil(failedLoginCount, policy, now);
    await tx
      .update(users)
      .set({ failedLoginCount: locked ? 0 : failedLoginCount, lockedUntil: locked })
      .where(eq(users.id, userId));
  });
}
