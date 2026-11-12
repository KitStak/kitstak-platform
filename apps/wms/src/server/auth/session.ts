/**
 * Session API for Next.js (server components, route handlers, proxy).
 *
 * - `getSessionUser()`  — server components / layouts (reads `cookies()`), DB-verified.
 * - `getRequestSession(db, request)` — route handlers (reads the request cookie).
 * - `setSessionCookie` / `clearSessionCookie` — attach to a `NextResponse`.
 *
 * Verification rules live in `session-store.ts` (jti + sv + user_sessions revocation).
 */
import { cache } from "react";
import { cookies } from "next/headers";
import { connection, type NextRequest, type NextResponse } from "next/server";
import { getAppDb, type AppDb } from "@/server/api/db";
import { log } from "@/server/log";
import { resolveSession, type SessionResolution, type SessionUser } from "./session-store";

export {
  bumpSessionVersion,
  issueSession,
  listActiveSessions,
  revokeSession,
  revokeUserSessions,
  SESSION_TTL_SECONDS,
  type IssuedSession,
  type SessionUser,
} from "./session-store";

export const SESSION_COOKIE = "kitstak_session";

/** Legacy alias kept for existing imports. */
export type SessionRole = SessionUser["role"];

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export interface CookieSpec {
  readonly httpOnly: boolean;
  readonly sameSite: "lax" | "strict";
  readonly secure: boolean;
  readonly path: string;
  readonly maxAge: number;
}

export function sessionCookieOptions(maxAgeSeconds: number): CookieSpec {
  return { httpOnly: true, sameSite: "lax", secure: isProduction(), path: "/", maxAge: maxAgeSeconds };
}

export function setSessionCookie(response: NextResponse, token: string, maxAgeSeconds: number): void {
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(maxAgeSeconds));
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(0));
}

/** Verifies the session cookie of a route-handler request. */
export async function getRequestSession(db: AppDb, request: NextRequest | Request): Promise<SessionResolution> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return { ok: false, reason: "malformed" };
  return resolveSession(db, token);
}

/** Reads a cookie from a `NextRequest` or a plain `Request`. */
export function readCookie(request: NextRequest | Request, name: string): string | undefined {
  const maybeNext = request as { cookies?: { get(n: string): { value: string } | undefined } };
  if (maybeNext.cookies && typeof maybeNext.cookies.get === "function") {
    return maybeNext.cookies.get(name)?.value || undefined;
  }
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey === name) return decodeURIComponent(rest.join("=")) || undefined;
  }
  return undefined;
}

/**
 * Session user for server components (memoised per request via React `cache`).
 * Returns null when the cookie is missing, invalid, revoked or the user was deactivated.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  // `cookies()` stays outside the try: during prerendering Next signals dynamic usage
  // through it, and that signal must propagate.
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  // Session checks read the clock (expiry, lastSeenAt): mark the render as request-time.
  await connection();
  try {
    const db = await getAppDb();
    const resolution = await resolveSession(db, token);
    return resolution.ok ? resolution.user : null;
  } catch (error: unknown) {
    log.error("getSessionUser failed", { component: "auth", err: error });
    return null;
  }
});
