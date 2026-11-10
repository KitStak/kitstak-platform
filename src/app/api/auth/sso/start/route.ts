/** `GET /api/auth/sso/start?returnTo=/path` — redirects to the identity provider (OpenID Connect + PKCE). */
import { NextResponse } from "next/server";
import { defineRoute } from "@/server/api/define-route";
import { AppError } from "@/server/api/errors";
import { sessionCookieOptions } from "@/server/auth/session";
import { SSO_STATE_COOKIE, SSO_STATE_TTL_SECONDS, startSso } from "@/server/repositories/apps-sso";

export const GET = defineRoute({
  auth: "public",
  transaction: false,
  handler: async ({ db, request }) => {
    const url = new URL(request.url);
    try {
      const { redirectUrl, cookie } = await startSso(db, url.origin, url.searchParams.get("returnTo"));
      const res = NextResponse.redirect(redirectUrl, 302);
      res.cookies.set(SSO_STATE_COOKIE, cookie, { ...sessionCookieOptions(SSO_STATE_TTL_SECONDS), path: "/api/auth/sso" });
      return res;
    } catch (e) {
      const message = e instanceof AppError ? e.message : "Single sign-on is unavailable right now";
      return NextResponse.redirect(new URL(`/login?sso_error=${encodeURIComponent(message)}`, url.origin), 302);
    }
  },
});
