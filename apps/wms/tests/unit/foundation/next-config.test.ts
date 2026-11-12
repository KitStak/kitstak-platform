import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import nextConfig, {
  HSTS_VALUE,
  LEGACY_TAB_REDIRECTS,
  buildLegacyRedirects,
  buildSecurityHeaders,
  routeExists,
} from "../../../next.config";

describe("security headers", () => {
  it("adds HSTS only in production", () => {
    const prod = buildSecurityHeaders(true);
    const dev = buildSecurityHeaders(false);
    expect(prod.find((h) => h.key === "Strict-Transport-Security")?.value).toBe(HSTS_VALUE);
    expect(dev.some((h) => h.key === "Strict-Transport-Security")).toBe(false);
    expect(HSTS_VALUE).toBe("max-age=63072000; includeSubDomains; preload");
  });

  it("keeps the baseline headers in both modes", () => {
    for (const headers of [buildSecurityHeaders(true), buildSecurityHeaders(false)]) {
      const keys = headers.map((h) => h.key);
      expect(keys).toEqual(
        expect.arrayContaining(["Content-Security-Policy", "X-Content-Type-Options", "Referrer-Policy", "X-Frame-Options", "Permissions-Policy"])
      );
    }
  });

  it("applies headers to every path", async () => {
    const rules = await nextConfig.headers?.();
    expect(rules?.[0]?.source).toBe("/:path*");
  });
});

describe("legacy ?tab= redirects", () => {
  it("covers every legacy tab URL named in the build plan", () => {
    const keys = LEGACY_TAB_REDIRECTS.map((r) => `${r.source}?tab=${r.tab}`);
    expect(keys).toEqual([
      "/orders?tab=shipped",
      "/orders?tab=returns",
      "/receiving?tab=history",
      "/receiving?tab=vendors",
      "/inventory?tab=by-location",
      "/inventory?tab=atp",
      "/products?tab=listings",
      "/jobs?tab=exceptions",
      "/settings?tab=warehouses",
      "/settings?tab=carriers",
      "/settings?tab=audit",
    ]);
  });

  it("emits permanent query-matched redirects for implemented destinations", () => {
    const redirects = buildLegacyRedirects(LEGACY_TAB_REDIRECTS, () => true);
    expect(redirects).toHaveLength(LEGACY_TAB_REDIRECTS.length);
    expect(redirects[0]).toEqual({
      source: "/orders",
      has: [{ type: "query", key: "tab", value: "shipped" }],
      destination: "/orders/shipped",
      permanent: true,
    });
  });

  it("holds back redirects whose destination route does not exist yet", () => {
    const redirects = buildLegacyRedirects(LEGACY_TAB_REDIRECTS, (route) => route === "/settings/audit");
    expect(redirects.map((r) => r.destination)).toEqual(["/settings/audit"]);
  });

  it("is wired into next.config", async () => {
    expect(Array.isArray(await nextConfig.redirects?.())).toBe(true);
  });
});

describe("routeExists", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kitstak-routes-"));
  const appRoot = path.join(tmp, "app");
  const groupRoot = path.join(appRoot, "(app)");
  fs.mkdirSync(path.join(groupRoot, "orders", "shipped"), { recursive: true });
  fs.writeFileSync(path.join(groupRoot, "orders", "shipped", "page.tsx"), "export default null;");
  fs.mkdirSync(path.join(appRoot, "login"), { recursive: true });
  fs.writeFileSync(path.join(appRoot, "login", "page.tsx"), "export default null;");

  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("finds pages inside the (app) route group and at the app root", () => {
    expect(routeExists("/orders/shipped", [appRoot, groupRoot])).toBe(true);
    expect(routeExists("/login", [appRoot, groupRoot])).toBe(true);
  });

  it("returns false for missing pages", () => {
    expect(routeExists("/orders/returns", [appRoot, groupRoot])).toBe(false);
  });
});
