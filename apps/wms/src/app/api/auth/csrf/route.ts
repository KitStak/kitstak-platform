import { NextResponse } from "next/server";
import { defineRoute } from "@/server/api/define-route";
import { successBody } from "@/server/api/envelope";
import { existingCsrfToken, generateCsrfToken, setCsrfCookie } from "@/server/auth/csrf";

/** GET /api/auth/csrf — returns the current `ks_csrf` token, issuing one when absent. */
export const GET = defineRoute({
  name: "GET /api/auth/csrf",
  auth: "public",
  handler: ({ request }) => {
    const token = existingCsrfToken(request) ?? generateCsrfToken();
    const response = NextResponse.json(successBody({ token }), { headers: { "Cache-Control": "no-store" } });
    setCsrfCookie(response, token);
    return response;
  },
});

/** POST /api/auth/csrf — rotates the token (the current token must be presented). */
export const POST = defineRoute({
  name: "POST /api/auth/csrf",
  auth: "public",
  rateLimit: false,
  transaction: false,
  handler: () => {
    const token = generateCsrfToken();
    const response = NextResponse.json(successBody({ token }), { headers: { "Cache-Control": "no-store" } });
    setCsrfCookie(response, token);
    return response;
  },
});
