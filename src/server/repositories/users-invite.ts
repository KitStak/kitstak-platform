/**
 * Welcome / invite email for Add user (M14). A dedicated invite: its own template, a
 * multi-day single-use link (the reset-password page consumes it), sent with the company mail
 * transport. Audit is written by the caller as the administrator (`user.invite_sent`), never
 * as a "password reset requested" by the new user.
 */
import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import { hashResetToken } from "@/server/auth/password-reset";
import * as s from "@/server/db/schema";
import { INVITE_TTL_HOURS, inviteEmail, type MailTransport } from "@/lib/grid-defs/admin/company-mail";
import { sendCompanyMail } from "./company-mail";
import { withWriteTx } from "@/server/db/sql";

export interface InviteResult {
  readonly transport: MailTransport;
  readonly delivered: boolean;
  readonly expiresAt: string;
}

export async function sendUserInvite(db: AppDb, input: { readonly userId: string; readonly baseUrl: string; readonly invitedBy: string }, now: Date = new Date()): Promise<InviteResult> {
  const user = (await db.select({ id: s.users.id, email: s.users.email, firstName: s.users.firstName, name: s.users.name }).from(s.users).where(eq(s.users.id, input.userId)).limit(1))[0];
  if (!user) throw new Error("Invite target not found");
  const company = (await db.select({ displayName: s.companySettings.displayName }).from(s.companySettings).limit(1))[0];
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + INVITE_TTL_HOURS * 3_600_000).toISOString();
  await withWriteTx(db, async (tx) => {
    await tx.update(s.passwordResetTokens).set({ usedAt: now.toISOString() }).where(and(eq(s.passwordResetTokens.userId, user.id), isNull(s.passwordResetTokens.usedAt)));
    await tx.insert(s.passwordResetTokens).values({ userId: user.id, tokenHash: hashResetToken(token), expiresAt });
  });
  const link = `${input.baseUrl.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(token)}`;
  const mail = inviteEmail({ companyName: company?.displayName ?? "KitStaks", firstName: user.firstName ?? user.name.split(" ")[0] ?? "", invitedBy: input.invitedBy, link });
  const result = await sendCompanyMail(db, { to: user.email, ...mail });
  return { ...result, expiresAt };
}
