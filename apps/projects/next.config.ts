import type { NextConfig } from 'next';

const isProd = process.env.NODE_ENV === 'production';

/** Static security headers for every response (same set as apps/portal and apps/crm). */
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

/**
 * Several agents/devs can run `next dev` side by side: each picks its own dist dir so the dev
 * lockfile and caches never collide. It must live INSIDE `.next/` (e.g. `.next/alice`): Turbopack
 * only ignores `.next`, so a sibling `.next-alice` folder makes every dev log write trigger a
 * rebuild and an endless page reload. `.next-<name>` is mapped to `.next/<name>` automatically.
 */
function distDir(): string {
  const requested = process.env.NEXT_DIST_DIR?.trim();
  if (!requested) return '.next';
  if (requested.startsWith('.next-')) return `.next/${requested.slice('.next-'.length)}`;
  return requested;
}

const nextConfig: NextConfig = {
  distDir: distDir(),
  // `next build` would otherwise empty `.next/`, including teammates' running dev dirs (.next/<name>).
  // CI/Vercel builds start from a clean checkout, so nothing stale survives there.
  cleanDistDir: false,
  poweredByHeader: false,
  // Keep the dev badge away from the sidebar footer (Settings / collapse).
  devIndicators: { position: 'bottom-right' },
  reactStrictMode: true,
  // Workspace packages are shipped as TypeScript source; Next transpiles them.
  transpilePackages: ['@kitstak/auth', '@kitstak/db', '@kitstak/entitlements', '@kitstak/ui'],
  serverExternalPackages: ['pg'],
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
  experimental: {
    serverActions: {
      // Attachments upload through a server action; keep the cap explicit.
      bodySizeLimit: '26mb',
    },
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // Cross-app API (CRM/WMS embed panels) answers CORS itself; never cache API responses.
      { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
      // Cross-origin embeds (CRM item panel, WMS order page) fetch JSON from /api/v1/*.
      {
        source: '/api/v1/:path*',
        headers: [{ key: 'Cross-Origin-Resource-Policy', value: 'same-site' }],
      },
    ];
  },
};

export default nextConfig;
