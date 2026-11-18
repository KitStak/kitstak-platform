import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { headers } from 'next/headers';
import { NONCE_HEADER } from '@/server/http/csp';
import { Providers } from './providers';
import { ThemeScript } from './theme-script';
import '@/styles/globals.css';

/** Sibling-app origins for the cross-app theme handoff; dev defaults match the dev ports. */
const SIBLING_APP_URLS = [
  process.env.NEXT_PUBLIC_PORTAL_URL ?? 'http://localhost:3300',
  process.env.NEXT_PUBLIC_CRM_URL ?? 'http://localhost:3100',
  process.env.NEXT_PUBLIC_WMS_URL ?? 'http://localhost:3000',
  process.env.NEXT_PUBLIC_PROJECTS_URL ?? 'http://localhost:3400',
];

/* KitStak type: Inter for all UI text and headings (same face as Portal, CRM, WMS and Projects). */
const inter = Inter({ variable: '--font-inter', subsets: ['latin'], display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'KitStak Pulse', template: '%s · KitStak Pulse' },
  description: 'KitStak Pulse: profit by job, client and service for kitting, 3PL and contract packaging teams.',
  robots: { index: false, follow: false },
  applicationName: 'KitStak Pulse',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f1e9' },
    { media: '(prefers-color-scheme: dark)', color: '#0d0e10' },
  ],
};

/**
 * Reading the nonce from the request headers keeps every route rendered per request, which the
 * nonce in the Content-Security-Policy needs (`src/proxy.ts`): a page built ahead of time would
 * carry scripts with no nonce and the browser would block them.
 */
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const nonce = (await headers()).get(NONCE_HEADER) ?? undefined;
  return (
    // data-theme is set by THEME_INIT_SCRIPT before hydration, so the attribute differs from SSR on purpose.
    <html lang="en" className={`${inter.variable} h-full`} suppressHydrationWarning>
      <head>
        <ThemeScript nonce={nonce} />
      </head>
      <body className="min-h-full">
        <Providers siblingUrls={SIBLING_APP_URLS}>{children}</Providers>
      </body>
    </html>
  );
}
