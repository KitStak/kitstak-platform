import type { NextConfig } from 'next';

const isProd = process.env.NODE_ENV === 'production';

/**
 * Static security headers for every response. The nonce-based Content-Security-Policy is
 * set per request in `src/proxy.ts` (it needs a fresh nonce, so it cannot live here).
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  ...(isProd
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]
    : []),
];

const nextConfig: NextConfig = {
  // Pages are dynamically rendered (per-request CSP nonce + per-user data), so Cache
  // Components / Partial Prerendering are intentionally not enabled.
  poweredByHeader: false,
  reactStrictMode: true,
  // Workspace packages are shipped as TypeScript source; Next transpiles them.
  transpilePackages: ['@kitstak/auth', '@kitstak/billing', '@kitstak/mail', '@kitstak/db', '@kitstak/entitlements', '@kitstak/pm-bridge', '@kitstak/programs-engine', '@kitstak/pulse-bridge', '@kitstak/ui'],
  serverExternalPackages: ['pg', 'embedded-postgres'],
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
    ];
  },
};

export default nextConfig;
