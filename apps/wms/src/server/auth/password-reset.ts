/**
 * Forgot / reset password flow with hashed single-use tokens (`password_reset_tokens`).
 *
 * - `requestPasswordReset` always "succeeds" from the caller's view (no account enumeration).
 * - Only the SHA-256 of the token is stored; the raw token travels in the emailed link.
 * - A successful reset sets the core.account credential (Better Auth scrypt), revokes
 *   every Better Auth session, clears lockout and consumes the token.
 *
 * Kept (not replaced by Better Auth request-password-reset/reset-password) because the
 * admin "send invite" flow (users-invite.ts) issues these tokens and neither app has a
 * Better Auth mailer configured (blueprint §1.4 note).
 */
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { passwordResetTokens, users } from '@/server/db/schema';
import type { AppDb } from '@/server/api/db';
import { AppError } from '@/server/api/errors';
import { log } from '@/server/log';
import { withWriteTx } from '@/server/db/sql';
import { writeAudit } from './audit';
import { setCredentialPassword } from './credentials';
import { getPasswordPolicy, validatePassword } from './password-policy';
import { bumpSessionVersion } from './session-store';
import { sendCompanyMail } from '@/server/repositories/company-mail';

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
    log.info('mail (dev adapter)', {
      component: 'mail',
      to: message.to,
      subject: message.subject,
      body: message.text,
    });
  },
};

/**
 * Explicit transport (tests, custom deployments). When none is set, reset emails go through the
 * company transport (Settings › Company › Email delivery: SMTP, or the server log when SMTP is
 * not configured), the same path user invites use (admin-settings REQ-R6-3).
 */
let mailAdapter: MailAdapter | null = null;
export function setMailAdapter(adapter: MailAdapter | null): void {
  mailAdapter = adapter;
}

function adapterFor(db: AppDb): MailAdapter {
  return mailAdapter ?? { send: (m) => sendCompanyMail(db, m).then(() => undefined) };
}

export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface ResetRequest {
  readonly email: string;
  readonly baseUrl: string;
  readonly ip?: string | null;
}

/** Creates a token and mails the link when the user exists and is active. */
export async function requestPasswordReset(
  db: AppDb,
  input: ResetRequest,
  now: Date = new Date(),
): Promise<void> {
  const email = input.email.trim().toLowerCase();
  const [user] = await db
    .select({ id: users.id, email: users.email, isActive: users.isActive })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!user || !user.isActive) {
    await writeAudit(
      db,
      {
        action: 'auth.password_reset.request',
        entity: 'user',
        entityId: email,
        outcome: 'failure',
        detail: { reason: 'unknown_or_inactive' },
        ip: input.ip,
      },
      now,
    );
    return;
  }
  const token = randomBytes(32).toString('base64url');
  await withWriteTx(db, async (tx) => {
    await tx
      .update(passwordResetTokens)
      .set({ usedAt: now.toISOString() })
      .where(and(eq(passwordResetTokens.userId, user.id), isNull(passwordResetTokens.usedAt)));
    await tx.insert(passwordResetTokens).values({
      userId: user.id,
      tokenHash: hashResetToken(token),
      expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MINUTES * 60_000).toISOString(),
    });
  });
  await writeAudit(
    db,
    {
      action: 'auth.password_reset.request',
      entity: 'user',
      entityId: user.id,
      userId: user.id,
      ip: input.ip,
    },
    now,
  );
  const link = `${input.baseUrl.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
  try {
    await adapterFor(db).send({
      to: user.email,
      subject: 'Reset your KitStak password',
      text: `Use this link within ${RESET_TOKEN_TTL_MINUTES} minutes to set a new password:\n${link}\nIf you did not ask for this, ignore this email.`,
    });
  } catch (error) {
    // A mail failure must look exactly like success to the caller. An error here only for real
    // accounts would tell anyone which emails have one (no account enumeration). The person can
    // ask again, and the failure is in the server log.
    log.warn('password reset email failed', { component: 'auth', userId: user.id, err: error });
  }
}

export interface ResetInput {
  readonly token: string;
  readonly password: string;
  readonly ip?: string | null;
}

/** Consumes a token and sets the new password. Throws VALIDATION on any problem. */
export async function resetPassword(
  db: AppDb,
  input: ResetInput,
  now: Date = new Date(),
): Promise<{ userId: string }> {
  const [row] = await db
    .select({ token: passwordResetTokens, user: users })
    .from(passwordResetTokens)
    .innerJoin(users, eq(users.id, passwordResetTokens.userId))
    .where(eq(passwordResetTokens.tokenHash, hashResetToken(input.token)))
    .limit(1);
  if (!row || row.token.usedAt || row.token.expiresAt <= now.toISOString() || !row.user.isActive) {
    throw new AppError('VALIDATION', 'This reset link is invalid or has expired. Request a new one.', {
      fieldErrors: { token: ['Invalid or expired link'] },
    });
  }
  const issues = validatePassword(input.password, await getPasswordPolicy(db), { email: row.user.email });
  if (issues.length > 0) {
    throw new AppError('VALIDATION', issues[0] ?? 'Password does not meet the policy', {
      fieldErrors: { password: issues },
    });
  }
  const userId = row.user.id;
  await withWriteTx(db, async (tx) => {
    // Single use: the check above ran outside the write lock, so a concurrent redeem of the
    // same token must lose here (the conditional claim matches no row) and roll back.
    const claimed = await tx
      .update(passwordResetTokens)
      .set({ usedAt: now.toISOString() })
      .where(and(eq(passwordResetTokens.id, row.token.id), isNull(passwordResetTokens.usedAt)))
      .returning({ id: passwordResetTokens.id });
    if (claimed.length === 0) {
      throw new AppError('VALIDATION', 'This reset link is invalid or has expired. Request a new one.', {
        fieldErrors: { token: ['Invalid or expired link'] },
      });
    }
    // Credential lives in core.account (blueprint §1.4); the wms.users columns below are
    // legacy mirrors for admin grids only.
    await setCredentialPassword(tx, userId, input.password, { passwordChangedAt: now }, now);
    await tx
      .update(users)
      .set({ passwordChangedAt: now.toISOString(), failedLoginCount: 0, lockedUntil: null })
      .where(eq(users.id, userId));
    await bumpSessionVersion(tx, userId, now);
  });
  await writeAudit(
    db,
    { action: 'auth.password_reset.complete', entity: 'user', entityId: userId, userId, ip: input.ip },
    now,
  );
  return { userId };
}
