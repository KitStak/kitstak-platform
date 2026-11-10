import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

type Redirect = Awaited<ReturnType<NonNullable<NextConfig["redirects"]>>>[number];
type HeaderEntry = { key: string; value: string };

const isDev = process.env.NODE_ENV !== "production";

/**
 * Content Security Policy — dev/prod aware.
 * Dev requires 'unsafe-eval' for React Fast Refresh; production does not get it.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
].join("; ");

export const HSTS_VALUE = "max-age=63072000; includeSubDomains; preload";

/** Security headers. HSTS only in production (it would pin localhost to HTTPS in dev). */
export function buildSecurityHeaders(production: boolean): readonly HeaderEntry[] {
  const base: readonly HeaderEntry[] = [
    { key: "Content-Security-Policy", value: contentSecurityPolicy },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ];
  return production ? [...base, { key: "Strict-Transport-Security", value: HSTS_VALUE }] : base;
}

/** Legacy query-tab URLs (`/orders?tab=shipped`) mapped to their real routes. */
export interface LegacyTabRedirect {
  readonly source: string;
  readonly tab: string;
  readonly destination: string;
}

export const LEGACY_TAB_REDIRECTS: readonly LegacyTabRedirect[] = [
  { source: "/orders", tab: "shipped", destination: "/orders/shipped" },
  { source: "/orders", tab: "returns", destination: "/orders/returns" },
  { source: "/receiving", tab: "history", destination: "/receiving/history" },
  { source: "/receiving", tab: "vendors", destination: "/receiving/vendors" },
  { source: "/inventory", tab: "by-location", destination: "/inventory/by-location" },
  { source: "/inventory", tab: "atp", destination: "/inventory/atp" },
  { source: "/products", tab: "listings", destination: "/products/listings" },
  { source: "/jobs", tab: "exceptions", destination: "/jobs/allocation-exceptions" },
  { source: "/settings", tab: "warehouses", destination: "/settings/warehouses" },
  { source: "/settings", tab: "carriers", destination: "/integrations/carriers" },
  { source: "/settings", tab: "audit", destination: "/settings/audit" },
];

const APP_DIR = path.join(process.cwd(), "src", "app");
const ROUTE_ROOTS = [APP_DIR, path.join(APP_DIR, "(app)")];
const PAGE_FILES = ["page.tsx", "page.ts", "page.jsx", "page.js"];

/** True when `src/app[/(app)]/<route>/page.*` exists. */
export function routeExists(route: string, roots: readonly string[] = ROUTE_ROOTS): boolean {
  const segments = route.split("/").filter(Boolean);
  return roots.some((root) =>
    PAGE_FILES.some((file) => fs.existsSync(path.join(root, ...segments, file)))
  );
}

/**
 * Builds the redirect list. A legacy URL only redirects once its destination
 * route is implemented, so the current query-tab pages keep working while
 * modules land their real routes. Destinations are re-checked on every build
 * and dev-server start.
 */
export function buildLegacyRedirects(
  entries: readonly LegacyTabRedirect[] = LEGACY_TAB_REDIRECTS,
  exists: (route: string) => boolean = routeExists
): Redirect[] {
  return entries
    .filter((entry) => exists(entry.destination))
    .map((entry) => ({
      source: entry.source,
      has: [{ type: "query", key: "tab", value: entry.tab }],
      destination: entry.destination,
      permanent: true,
    }));
}

const nextConfig: NextConfig = {
  devIndicators: false,
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [...buildSecurityHeaders(!isDev)],
      },
    ];
  },
  async redirects() {
    return buildLegacyRedirects();
  },
};

export default nextConfig;
