import { NextResponse } from "next/server";
import { defineRoute } from "@/server/api/define-route";
import { successBody } from "@/server/api/envelope";
import { AppError } from "@/server/api/errors";
import { isSameOriginRequest } from "@/server/auth/csrf";
import { clearSessionCookie, getRequestSession, revokeSession } from "@/server/auth/session";

/**
 * POST /api/auth/logout — revokes the current session row and clears the cookie.
 * Public (an already-invalid session can still clear its cookie). CSRF-token exempt so the
 * pre-foundation shell keeps working, but cross-site requests are rejected.
 */
export const POST = defineRoute({
  name: "POST /api/auth/logout",
  auth: "public",
  csrf: false,
  rateLimit: false,
  transaction: false,
  handler: async ({ db, request, audit }) => {
    if (!isSameOriginRequest(request)) throw new AppError("CSRF", "Cross-site logout is not allowed");
    const session = await getRequestSession(db, request);
    if (session.ok) {
      revokeSession(db, session.user.sessionId);
      audit({ action: "auth.logout", entity: "user", entityId: session.user.id });
    }
    const response = NextResponse.json(successBody({ loggedOut: true }));
    clearSessionCookie(response);
    return response;
  },
});
