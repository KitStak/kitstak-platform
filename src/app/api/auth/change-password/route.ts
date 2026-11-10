import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { successBody } from "@/server/api/envelope";
import { AppError } from "@/server/api/errors";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { getPasswordPolicy, validatePassword } from "@/server/auth/password-policy";
import { bumpSessionVersion, issueSession, setSessionCookie } from "@/server/auth/session";
import { users } from "@/server/db/schema";

const bodySchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: z.string().min(1).max(200),
    confirmPassword: z.string().min(1).max(200),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match" });

/**
 * POST /api/auth/change-password — verifies the current password, applies the policy,
 * bumps session_version (every other session dies) and re-issues this device's session.
 */
export const POST = defineRoute({
  name: "POST /api/auth/change-password",
  body: bodySchema,
  transaction: false,
  handler: async ({ db, auth, body, ip, userAgent, audit }) => {
    const row = db.select({ hash: users.passwordHash, email: users.email }).from(users).where(eq(users.id, auth.user.id)).get();
    if (!row || !verifyPassword(body.currentPassword, row.hash)) {
      throw new AppError("VALIDATION", "Current password is incorrect", { fieldErrors: { currentPassword: ["Current password is incorrect"] } });
    }
    if (body.currentPassword === body.newPassword) {
      throw new AppError("VALIDATION", "Choose a password you have not just used", { fieldErrors: { newPassword: ["Must differ from the current password"] } });
    }
    const issues = validatePassword(body.newPassword, getPasswordPolicy(db), { email: row.email });
    if (issues.length > 0) {
      throw new AppError("VALIDATION", issues[0] ?? "Password does not meet the policy", { fieldErrors: { newPassword: issues } });
    }
    const now = new Date();
    db.transaction((tx) => {
      tx.update(users).set({ passwordHash: hashPassword(body.newPassword), passwordChangedAt: now.toISOString() }).where(eq(users.id, auth.user.id)).run();
      bumpSessionVersion(tx, auth.user.id, now);
    });
    audit({ action: "auth.password_change", entity: "user", entityId: auth.user.id });
    const issued = await issueSession(db, auth.user.id, { ip, userAgent });
    const response = NextResponse.json(successBody({ changed: true }));
    setSessionCookie(response, issued.token, issued.maxAgeSeconds);
    return response;
  },
});
