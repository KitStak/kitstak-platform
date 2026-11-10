/**
 * Server-side CSRF enforcement (double-submit cookie + same-origin check).
 * See `csrf-shared.ts` for the client contract consumed by F4's `apiFetch`.
 */
import type { NextResponse } from "next/server";
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  CSRF_MAX_AGE_SECONDS,
  generateCsrfToken,
  isSafeMethod,
  isWellFormedCsrfToken,
  timingSafeEqualStrings,
} from "./csrf-shared";
import { readCookie } from "./session";

export * from "./csrf-shared";

export type CsrfFailureReason = "missing_cookie" | "missing_header" | "mismatch" | "cross_origin";

export type CsrfCheck = { readonly ok: true } | { readonly ok: false; readonly reason: CsrfFailureReason };

function trustProxy(): boolean {
  return process.env.TRUST_PROXY === "1";
}

/** The host the client addressed (honours x-forwarded-host only when TRUST_PROXY=1). */
export function requestHost(request: Request): string | null {
  const forwarded = trustProxy() ? request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() : undefined;
  return forwarded || request.headers.get("host") || safeUrlHost(request.url);
}

function safeUrlHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * Rejects requests a browser marks as cross-site. Requests without Origin/Sec-Fetch-Site
 * (curl, server-to-server) pass this check and still need the token where required.
 */
export function isSameOriginRequest(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return origin !== "null";
  const host = requestHost(request);
  return host !== null && safeUrlHost(origin) === host;
}

/** Full check for state-changing requests. Safe methods always pass. */
export function verifyCsrf(request: Request): CsrfCheck {
  if (isSafeMethod(request.method)) return { ok: true };
  if (!isSameOriginRequest(request)) return { ok: false, reason: "cross_origin" };
  const cookie = readCookie(request, CSRF_COOKIE);
  if (!isWellFormedCsrfToken(cookie)) return { ok: false, reason: "missing_cookie" };
  const header = request.headers.get(CSRF_HEADER);
  if (!header) return { ok: false, reason: "missing_header" };
  return timingSafeEqualStrings(cookie, header) ? { ok: true } : { ok: false, reason: "mismatch" };
}

export function csrfCookieOptions(): {
  httpOnly: false;
  sameSite: "strict";
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: false,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CSRF_MAX_AGE_SECONDS,
  };
}

/** Sets a (new or given) CSRF token cookie on the response and returns the token. */
export function setCsrfCookie(response: NextResponse, token: string = generateCsrfToken()): string {
  response.cookies.set(CSRF_COOKIE, token, csrfCookieOptions());
  return token;
}

/** Returns the request's valid token, or null when a new one must be issued. */
export function existingCsrfToken(request: Request): string | null {
  const value = readCookie(request, CSRF_COOKIE);
  return isWellFormedCsrfToken(value) ? value : null;
}
