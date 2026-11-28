import type { NextConfig } from 'next';

const isProd = process.env.NODE_ENV === 'production';

/**
 * Static security headers for every response (the sibling set). Crew differs in one place: the
 * kiosk takes a punch photo with the camera and the phone clock reads the location once per punch
 * (docs/crew/SPEC.md section 1), so `camera` and `geolocation` are allowed for this origin only.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(self), microphone=(), geolocation=(self), payment=(), usb=(), interest-cohort=()',
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
 * only ignores `.next`. `.next-<name>` is mapped to `.next/<name>` automatically.
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
  cleanDistDir: false,
  poweredByHeader: false,
  devIndicators: { position: 'bottom-right' },
  reactStrictMode: true,
  // Workspace packages are shipped as TypeScript source; Next transpiles them.
  transpilePackages: [
    '@kitstak/auth',
    '@kitstak/billing',
    '@kitstak/crew-bridge',
    '@kitstak/db',
    '@kitstak/entitlements',
    '@kitstak/mail',
    '@kitstak/pulse-bridge',
    '@kitstak/ui',
  ],
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
      // CSV imports are parsed in the browser and sent in chunks of raw rows to a route handler,
      // so no action carries a file. Keep the cap small and explicit.
      bodySizeLimit: '2mb',
    },
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // The Crew API is same origin only (sibling apps read through @kitstak/crew-bridge on their
      // own servers). Never cache API responses.
      { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
      // Kiosk device links and agency links carry a token in the path: never leak it in a Referer.
      { source: '/kiosk/t/:path*', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }, { key: 'X-Robots-Tag', value: 'noindex, nofollow' }] },
      { source: '/join/a/:path*', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }, { key: 'X-Robots-Tag', value: 'noindex, nofollow' }] },
    ];
  },
};

export default nextConfig;
