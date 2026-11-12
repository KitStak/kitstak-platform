import { NextResponse } from "next/server";
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { failureBody, successBody } from "@/server/api/envelope";
import { AppError } from "@/server/api/errors";
import { generateCsrfToken, isSameOriginRequest, setCsrfCookie } from "@/server/auth/csrf";
import { authenticate, INVALID_CREDENTIALS_MESSAGE, LOCKED_MESSAGE } from "@/server/auth/login";
import { issueSession, setSessionCookie } from "@/server/auth/session";
import { roles, userRoles, users } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { passwordLoginBlockedBySso } from "@/server/repositories/apps-sso";

/**
 * The browser login form sends this header: a wrong password is an *expected* outcome there,
 * so it is answered with 200 + `{ success: false }` instead of 401 (which Chrome would log
 * as a console error). API clients without the header still get the standard 401.
 */
const SOFT_AUTH_FAILURE_HEADER = "x-ks-soft-auth-failure";

const loginSchema = z.object({
  email: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(200),
});

/**
 * POST /api/auth/login — CSRF-token exempt (no session yet) but must be same-origin.
 * Sets the session cookie and a fresh `ks_csrf` cookie; returns `{ user, csrfToken }`.
 */
export const POST = defineRoute({
  name: "POST /api/auth/login",
  auth: "public",
  csrf: false,
  rateLimit: false,
  transaction: false,
  handler: async ({ db, request, ip, userAgent }) => {
    if (!isSameOriginRequest(request)) throw new AppError("CSRF", "Cross-site login is not allowed");
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      throw new AppError("VALIDATION", "Invalid request body");
    }
    const parsed = loginSchema.safeParse(raw);
    if (!parsed.success) throw new AppError("UNAUTHENTICATED", INVALID_CREDENTIALS_MESSAGE);

    const outcome = await authenticate(db, { email: parsed.data.email, password: parsed.data.password, ip, userAgent });
    if (!outcome.ok) {
      if (outcome.reason === "rate_limited") {
        throw new AppError("RATE_LIMITED", "Too many login attempts. Please try again shortly.", {
          headers: { "Retry-After": String(outcome.retryAfterSeconds) },
        });
      }
      const failure = new AppError("UNAUTHENTICATED", outcome.reason === "locked" ? LOCKED_MESSAGE : INVALID_CREDENTIALS_MESSAGE);
      if (request.headers.get(SOFT_AUTH_FAILURE_HEADER) === "1") return NextResponse.json(failureBody(failure), { status: 200 });
      throw failure;
    }

    // Apps › Single sign-on with "Require SSO": password sign-in stays open to admins only (break-glass).
    if (await passwordLoginBlockedBySso(db, outcome.userId)) {
      const blocked = new AppError("UNAUTHENTICATED", "Your company signs in with single sign-on. Use the SSO button below.");
      if (request.headers.get(SOFT_AUTH_FAILURE_HEADER) === "1") return NextResponse.json(failureBody(blocked), { status: 200 });
      throw blocked;
    }
    const issued = await issueSession(db, outcome.userId, { ip, userAgent });
    const user = (await db
      .select({ id: users.id, email: users.email, name: users.name, role: users.role })
      .from(users)
      .where(eq(users.id, outcome.userId)).limit(1))[0];
    // Every role the user holds (custom roles included); `user.role` is the legacy base role
    // (deprecated: a user whose only role is custom still reads "operator" there).
    const held = await db
      .select({ key: roles.key, name: roles.name })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(userRoles.userId, outcome.userId));
    const csrfToken = generateCsrfToken();
    const response = NextResponse.json(successBody({ user: user ? { ...user, roleKeys: held.map((r) => r.key), roleNames: held.map((r) => r.name) } : user, csrfToken }));
    setCsrfCookie(response, csrfToken);
    setSessionCookie(response, issued.token, issued.maxAgeSeconds);
    return response;
  },
});
