import { describe, expect, it } from "vitest";
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  generateCsrfToken,
  isSameOriginRequest,
  isWellFormedCsrfToken,
  readCsrfTokenFromCookie,
  timingSafeEqualStrings,
  verifyCsrf,
} from "@/server/auth/csrf";

const ORIGIN = "http://localhost:3000";

interface ReqOptions {
  readonly cookie?: string;
  readonly header?: string;
  readonly origin?: string;
  readonly site?: string;
}

function req(method: string, opts: ReqOptions = {}): Request {
  const headers = new Headers({ host: "localhost:3000" });
  if (opts.cookie !== undefined) headers.set("cookie", `other=1; ${CSRF_COOKIE}=${opts.cookie}`);
  if (opts.header !== undefined) headers.set(CSRF_HEADER, opts.header);
  if (opts.origin !== undefined) headers.set("origin", opts.origin);
  if (opts.site !== undefined) headers.set("sec-fetch-site", opts.site);
  return new Request(`${ORIGIN}/api/x`, { method, headers });
}

describe("CSRF tokens", () => {
  it("generates unique well-formed tokens", () => {
    const a = generateCsrfToken();
    expect(isWellFormedCsrfToken(a)).toBe(true);
    expect(a).not.toBe(generateCsrfToken());
    expect(isWellFormedCsrfToken("short")).toBe(false);
  });

  it("reads the token from a document.cookie string", () => {
    const token = generateCsrfToken();
    expect(readCsrfTokenFromCookie(`a=1; ${CSRF_COOKIE}=${token}; b=2`)).toBe(token);
    expect(readCsrfTokenFromCookie(`${CSRF_COOKIE}=garbage`)).toBeNull();
    expect(readCsrfTokenFromCookie("")).toBeNull();
  });

  it("compares strings without leaking length shortcuts", () => {
    expect(timingSafeEqualStrings("abc", "abc")).toBe(true);
    expect(timingSafeEqualStrings("abc", "abd")).toBe(false);
    expect(timingSafeEqualStrings("abc", "abcd")).toBe(false);
  });
});

describe("verifyCsrf", () => {
  const token = generateCsrfToken();

  it("lets safe methods through", () => {
    expect(verifyCsrf(req("GET"))).toEqual({ ok: true });
    expect(verifyCsrf(req("HEAD"))).toEqual({ ok: true });
  });

  it("accepts a matching double-submit pair", () => {
    expect(verifyCsrf(req("POST", { cookie: token, header: token, origin: ORIGIN }))).toEqual({ ok: true });
    expect(verifyCsrf(req("DELETE", { cookie: token, header: token }))).toEqual({ ok: true });
  });

  it("rejects missing cookie, missing header, mismatch and cross-origin", () => {
    expect(verifyCsrf(req("POST", { header: token }))).toEqual({ ok: false, reason: "missing_cookie" });
    expect(verifyCsrf(req("POST", { cookie: token }))).toEqual({ ok: false, reason: "missing_header" });
    expect(verifyCsrf(req("PATCH", { cookie: token, header: generateCsrfToken() }))).toEqual({ ok: false, reason: "mismatch" });
    expect(verifyCsrf(req("POST", { cookie: token, header: token, origin: "https://evil.example" }))).toEqual({ ok: false, reason: "cross_origin" });
    expect(verifyCsrf(req("POST", { cookie: token, header: token, site: "cross-site" }))).toEqual({ ok: false, reason: "cross_origin" });
  });

  it("same-origin check", () => {
    expect(isSameOriginRequest(req("POST", { origin: ORIGIN }))).toBe(true);
    expect(isSameOriginRequest(req("POST"))).toBe(true);
    expect(isSameOriginRequest(req("POST", { origin: "null" }))).toBe(false);
    expect(isSameOriginRequest(req("POST", { origin: "http://localhost:4000" }))).toBe(false);
  });
});
