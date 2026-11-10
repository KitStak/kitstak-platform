/**
 * `POST /api/account/password` — Change Password. CSRF (defineRoute), a strict per-user rate
 * limit (5 tries / 15 min), policy check, then session rotation: every session ends
 * (session version bump) and this browser gets a fresh session cookie.
 */
import { NextResponse } from "next/server";
import { defineRoute } from "@/server/api/define-route";
import { AppError } from "@/server/api/errors";
import { successBody } from "@/server/api/envelope";
import { issueSession, setSessionCookie } from "@/server/auth/session";
import { accountPasswordSchema } from "@/lib/grid-defs/admin/account";
import { changeOwnPassword } from "@/server/repositories/users-account";

const PASSWORD_CHANGE_LIMIT = { name: "account-password", limit: 5, windowMs: 15 * 60_000 } as const;

export const POST = defineRoute({
  permission: "settings.change_password.view",
  body: accountPasswordSchema,
  rateLimit: PASSWORD_CHANGE_LIMIT,
  transaction: false,
  handler: async ({ db, auth, actor, body, ip, userAgent, audit }) => {
    try {
      db.transaction((tx) => changeOwnPassword(tx, auth, actor, body.currentPassword, body.newPassword));
    } catch (error: unknown) {
      // A rejected change is a failure row of its own action, never "Password changed · Success".
      const reason = error instanceof AppError ? (error.fieldErrors?.currentPassword ? "wrong_current_password" : error.code.toLowerCase()) : "error";
      audit({ action: "auth.password_change_rejected", entity: "user", entityId: auth.user.id, outcome: "failure", detail: { reason } });
      throw error;
    }
    audit({ action: "auth.password_change", entity: "user", entityId: auth.user.id, detail: { otherSessionsEnded: true } });
    const issued = await issueSession(db, auth.user.id, { ip, userAgent });
    const response = NextResponse.json(successBody({ changed: true }));
    setSessionCookie(response, issued.token, issued.maxAgeSeconds);
    return response;
  },
});
