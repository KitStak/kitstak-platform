/**
 * Credential check for POST /api/auth/login: rate limits (IP + account), lockout at the
 * policy threshold, constant-ish timing for unknown emails, audit rows for every outcome.
 */
import { eq } from "drizzle-orm";
import { users } from "@/server/db/schema";
import type { AppDb } from "@/server/api/db";
import { writeAudit } from "./audit";
import { hashPassword, needsRehash, verifyPassword } from "./password";
import { getPasswordPolicy, lockoutUntil } from "./password-policy";
import { hitRateLimit, RATE_LIMITS, resetRateLimit } from "./rate-limit";

/** Dummy hash compared when the user does not exist, so timing does not reveal registration. */
let timingPadHash: string | null = null;
function timingPad(): string {
  timingPadHash ??= hashPassword("kitstak-timing-pad", 10);
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
  | { readonly ok: false; readonly reason: "invalid" | "locked" }
  | { readonly ok: false; readonly reason: "rate_limited"; readonly retryAfterSeconds: number };

export const INVALID_CREDENTIALS_MESSAGE = "Invalid email or password";
export const LOCKED_MESSAGE = "This account is temporarily locked after too many failed attempts. Try again later.";

export function authenticate(db: AppDb, attempt: LoginAttempt, now: Date = new Date()): LoginOutcome {
  const email = attempt.email.trim().toLowerCase();
  const audit = (action: string, outcome: "success" | "failure", userId: string | null, detail: Record<string, unknown>) =>
    writeAudit(db, { action, entity: "user", entityId: userId ?? email, userId, outcome, detail: { email, ...detail }, ip: attempt.ip, userAgent: attempt.userAgent }, now);

  const ipLimit = hitRateLimit(db, RATE_LIMITS.loginIp, attempt.ip, now);
  const accountLimit = hitRateLimit(db, RATE_LIMITS.loginAccount, email, now);
  if (!ipLimit.allowed || !accountLimit.allowed) {
    audit("auth.login.rate_limited", "failure", null, {});
    return { ok: false, reason: "rate_limited", retryAfterSeconds: Math.max(ipLimit.retryAfterSeconds, accountLimit.retryAfterSeconds) };
  }

  const user = db.select().from(users).where(eq(users.email, email)).get();
  const passwordOk = verifyPassword(attempt.password, user?.passwordHash ?? timingPad());
  if (!user) {
    audit("auth.login", "failure", null, { reason: "unknown_email" });
    return { ok: false, reason: "invalid" };
  }
  if (user.lockedUntil && user.lockedUntil > now.toISOString()) {
    audit("auth.login", "failure", user.id, { reason: "locked" });
    return { ok: false, reason: "locked" };
  }
  if (!user.isActive || !passwordOk) {
    registerFailure(db, user.id, user.failedLoginCount, now);
    audit("auth.login", "failure", user.id, { reason: user.isActive ? "bad_password" : "inactive" });
    return { ok: false, reason: "invalid" };
  }

  db.update(users)
    .set({
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: now.toISOString(),
      ...(needsRehash(user.passwordHash) ? { passwordHash: hashPassword(attempt.password) } : {}),
    })
    .where(eq(users.id, user.id))
    .run();
  resetRateLimit(db, RATE_LIMITS.loginAccount, email);
  audit("auth.login", "success", user.id, {});
  return { ok: true, userId: user.id };
}

function registerFailure(db: AppDb, userId: string, previousCount: number, now: Date): void {
  const failedLoginCount = previousCount + 1;
  const policy = getPasswordPolicy(db);
  const locked = lockoutUntil(failedLoginCount, policy, now);
  db.update(users)
    .set({ failedLoginCount: locked ? 0 : failedLoginCount, lockedUntil: locked })
    .where(eq(users.id, userId))
    .run();
}
