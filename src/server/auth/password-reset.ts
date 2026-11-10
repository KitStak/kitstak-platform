/**
 * Forgot / reset password flow with hashed single-use tokens (`password_reset_tokens`).
 *
 * - `requestPasswordReset` always "succeeds" from the caller's view (no account enumeration).
 * - Only the SHA-256 of the token is stored; the raw token travels in the emailed link.
 * - A successful reset changes the hash, bumps `session_version` (kills every session),
 *   clears lockout and consumes the token.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { passwordResetTokens, users } from "@/server/db/schema";
import type { AppDb } from "@/server/api/db";
import { AppError } from "@/server/api/errors";
import { log } from "@/server/log";
import { writeAudit } from "./audit";
import { hashPassword } from "./password";
import { getPasswordPolicy, validatePassword } from "./password-policy";
import { bumpSessionVersion } from "./session-store";

export const RESET_TOKEN_TTL_MINUTES = 30;

/** Mail transport. Production wires a real adapter with `setMailAdapter`. */
export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}
export interface MailAdapter {
  send(message: MailMessage): Promise<void>;
}

/** Dev adapter: the reset link is written to the server log (BUILD_PLAN F3). */
export const devLogMailAdapter: MailAdapter = {
  async send(message) {
    log.info("mail (dev adapter)", { component: "mail", to: message.to, subject: message.subject, body: message.text });
  },
};

let mailAdapter: MailAdapter = devLogMailAdapter;
export function setMailAdapter(adapter: MailAdapter): void {
  mailAdapter = adapter;
}

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface ResetRequest {
  readonly email: string;
  readonly baseUrl: string;
  readonly ip?: string | null;
}

/** Creates a token and mails the link when the user exists and is active. */
export async function requestPasswordReset(db: AppDb, input: ResetRequest, now: Date = new Date()): Promise<void> {
  const email = input.email.trim().toLowerCase();
  const user = db.select({ id: users.id, email: users.email, isActive: users.isActive }).from(users).where(eq(users.email, email)).get();
  if (!user || !user.isActive) {
    writeAudit(db, { action: "auth.password_reset.request", entity: "user", entityId: email, outcome: "failure", detail: { reason: "unknown_or_inactive" }, ip: input.ip }, now);
    return;
  }
  const token = randomBytes(32).toString("base64url");
  db.transaction((tx) => {
    tx.update(passwordResetTokens)
      .set({ usedAt: now.toISOString() })
      .where(and(eq(passwordResetTokens.userId, user.id), isNull(passwordResetTokens.usedAt)))
      .run();
    tx.insert(passwordResetTokens)
      .values({
        userId: user.id,
        tokenHash: hashResetToken(token),
        expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MINUTES * 60_000).toISOString(),
      })
      .run();
  });
  writeAudit(db, { action: "auth.password_reset.request", entity: "user", entityId: user.id, userId: user.id, ip: input.ip }, now);
  const link = `${input.baseUrl.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(token)}`;
  await mailAdapter.send({
    to: user.email,
    subject: "Reset your KitStak password",
    text: `Use this link within ${RESET_TOKEN_TTL_MINUTES} minutes to set a new password:\n${link}\nIf you did not ask for this, ignore this email.`,
  });
}

export interface ResetInput {
  readonly token: string;
  readonly password: string;
  readonly ip?: string | null;
}

/** Consumes a token and sets the new password. Throws VALIDATION on any problem. */
export function resetPassword(db: AppDb, input: ResetInput, now: Date = new Date()): { userId: string } {
  const row = db
    .select({ token: passwordResetTokens, user: users })
    .from(passwordResetTokens)
    .innerJoin(users, eq(users.id, passwordResetTokens.userId))
    .where(eq(passwordResetTokens.tokenHash, hashResetToken(input.token)))
    .get();
  if (!row || row.token.usedAt || row.token.expiresAt <= now.toISOString() || !row.user.isActive) {
    throw new AppError("VALIDATION", "This reset link is invalid or has expired. Request a new one.", {
      fieldErrors: { token: ["Invalid or expired link"] },
    });
  }
  const issues = validatePassword(input.password, getPasswordPolicy(db), { email: row.user.email });
  if (issues.length > 0) {
    throw new AppError("VALIDATION", issues[0] ?? "Password does not meet the policy", { fieldErrors: { password: issues } });
  }
  const userId = row.user.id;
  db.transaction((tx) => {
    tx.update(passwordResetTokens).set({ usedAt: now.toISOString() }).where(eq(passwordResetTokens.id, row.token.id)).run();
    tx.update(users)
      .set({ passwordHash: hashPassword(input.password), passwordChangedAt: now.toISOString(), failedLoginCount: 0, lockedUntil: null })
      .where(eq(users.id, userId))
      .run();
    bumpSessionVersion(tx, userId, now);
  });
  writeAudit(db, { action: "auth.password_reset.complete", entity: "user", entityId: userId, userId, ip: input.ip }, now);
  return { userId };
}
