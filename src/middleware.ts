import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "kitstak_session";

const PUBLIC_PREFIXES: readonly string[] = [
  "/login",
  "/api/auth/",
  "/_next/",
  "/favicon.ico",
];

/** Static assets (anything with a file extension) are always public. */
const STATIC_ASSET_RE = /\.[a-zA-Z0-9]+$/;

function isPublicPath(pathname: string): boolean {
  if (pathname === "/api/auth") return true;
  if (STATIC_ASSET_RE.test(pathname)) return true;
  return PUBLIC_PREFIXES.some(
    (prefix) =>
      pathname === prefix || pathname === prefix.replace(/\/$/, "") || pathname.startsWith(prefix)
  );
}

/**
 * Route guard: presence check only. Cryptographic verification of the JWT
 * happens server-side in the (app) layout via getSessionUser().
 */
export function middleware(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  if (hasSession) {
    return NextResponse.next();
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
