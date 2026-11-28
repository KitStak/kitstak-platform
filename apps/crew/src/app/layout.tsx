import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { headers } from 'next/headers';
import { NONCE_HEADER } from '@/server/http/csp';
import { Providers } from './providers';
import { ThemeScript } from './theme-script';
import '@/styles/globals.css';

/** Sibling app origins for the cross app theme handoff; dev defaults match the dev ports. */
const SIBLING_APP_URLS = [
  process.env.NEXT_PUBLIC_PORTAL_URL ?? 'http://localhost:3300',
  process.env.NEXT_PUBLIC_CRM_URL ?? 'http://localhost:3100',
  process.env.NEXT_PUBLIC_WMS_URL ?? 'http://localhost:3000',
  process.env.NEXT_PUBLIC_PROJECTS_URL ?? 'http://localhost:3400',
  process.env.NEXT_PUBLIC_PULSE_URL ?? 'http://localhost:3500',
  ...(process.env.NEXT_PUBLIC_LEDGER_URL ? [process.env.NEXT_PUBLIC_LEDGER_URL] : []),
];

/* KitStak type: Inter for all UI text and headings (same face as every sibling app). */
const inter = Inter({ variable: '--font-inter', subsets: ['latin'], display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'KitStak Crew', template: '%s · KitStak Crew' },
  description: 'KitStak Crew: people, shifts, the time clock and labor planning for kitting, 3PL and contract packaging floors.',
  robots: { index: false, follow: false },
  applicationName: 'KitStak Crew',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f1e9' },
    { media: '(prefers-color-scheme: dark)', color: '#0d0e10' },
  ],
};

/**
 * Reading the nonce from the request headers keeps every route rendered per request, which the
 * nonce in the Content-Security-Policy needs (`src/proxy.ts`).
 */
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const nonce = (await headers()).get(NONCE_HEADER) ?? undefined;
  return (
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
