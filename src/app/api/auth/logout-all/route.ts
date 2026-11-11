import { NextResponse } from "next/server";
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { successBody } from "@/server/api/envelope";
import { clearSessionCookie, revokeUserSessions } from "@/server/auth/session";

const bodySchema = z.object({
  /** false (default): "Sign out other sessions"; true: sign out everywhere, including here. */
  includeCurrent: z.boolean().default(false),
});

/** POST /api/auth/logout-all — revokes the user's other sessions (or all of them). */
export const POST = defineRoute({
  name: "POST /api/auth/logout-all",
  body: bodySchema,
  handler: async ({ db, auth, body, audit }) => {
    const revoked = await revokeUserSessions(db, auth.user.id, body.includeCurrent ? {} : { exceptSessionId: auth.user.sessionId });
    await audit({ action: "auth.logout_all", entity: "user", entityId: auth.user.id, detail: { revoked, includeCurrent: body.includeCurrent } });
    const response = NextResponse.json(successBody({ revoked }));
    if (body.includeCurrent) clearSessionCookie(response);
    return response;
  },
});
