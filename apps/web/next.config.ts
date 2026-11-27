import type { NextConfig } from 'next';

const isProd = process.env.NODE_ENV === 'production';
/** Vercel preview deploys load the Vercel toolbar from vercel.live; production never does. */
const isPreview = process.env.VERCEL_ENV === 'preview';
const toolbar = isPreview ? ' https://vercel.live' : '';

/**
 * The site is fully static, so its pages carry no per-request nonce. Next writes its hydration data
 * as inline scripts, which is why script-src allows inline. Everything else is locked to this
 * origin: no plugins, no framing, no form posts or base tags pointing elsewhere.
 * JSON-LD blocks are data, not script, and are not affected.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"}${toolbar}`,
  `style-src 'self' 'unsafe-inline'${toolbar}`,
  `img-src 'self' data: blob:${toolbar}${isPreview ? ' https://vercel.com' : ''}`,
  `font-src 'self' data:${toolbar}`,
  "media-src 'self'",
  `connect-src 'self'${toolbar}${isPreview ? ' wss://ws-us3.pusher.com' : ''}${isProd ? '' : ' ws:'}`,
  `frame-src ${isPreview ? 'https://vercel.live' : "'none'"}`,
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "manifest-src 'self'",
  "worker-src 'self' blob:",
  ...(isProd ? ['upgrade-insecure-requests'] : []),
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value:
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=(), browsing-topics=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  // No Cross-Origin-Resource-Policy: KitStak emails load brand images and fonts from this origin.
  // Apex only. Subdomains of kitstak.com (mail tracking and the like) are not ours to pin to HTTPS here.
  ...(isProd ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000' }] : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // @kitstak/ui ships TypeScript/CSS source; Next transpiles it.
  transpilePackages: ['@kitstak/billing', '@kitstak/mail', '@kitstak/ui'],
  async headers() {
    return [
      { source: '/(.*)', headers: securityHeaders },
      {
        // The brand display face, loaded by KitStak emails (packages/mail/src/layout.ts).
        // A web font from another origin needs CORS in mail clients and webmail.
        source: '/fonts/:file*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/.well-known/security.txt',
        headers: [{ key: 'Content-Type', value: 'text/plain; charset=utf-8' }],
      },
    ];
  },
};

export default nextConfig;
