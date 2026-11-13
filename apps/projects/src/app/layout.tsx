import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import Script from 'next/script';
import { THEME_INIT_SCRIPT } from '@kitstak/ui/theme';
import { Providers } from './providers';
import '@/styles/globals.css';

/** Sibling-app origins for the cross-app theme handoff; dev defaults match the dev ports. */
const SIBLING_APP_URLS = [
  process.env.NEXT_PUBLIC_PORTAL_URL ?? 'http://localhost:3300',
  process.env.NEXT_PUBLIC_CRM_URL ?? 'http://localhost:3100',
  process.env.NEXT_PUBLIC_WMS_URL ?? 'http://localhost:3000',
];

/* KitStak type: Inter for all UI text and headings (same face as Portal, CRM and WMS). */
const inter = Inter({ variable: '--font-inter', subsets: ['latin'], display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'KitStak Projects', template: '%s · KitStak Projects' },
  description: 'KitStak Projects: plan work, assign tasks and hit every deadline, together with your CRM and warehouse.',
  robots: { index: false, follow: false },
  applicationName: 'KitStak Projects',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f1e9' },
    { media: '(prefers-color-scheme: dark)', color: '#0d0e10' },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // data-theme is set by THEME_INIT_SCRIPT before hydration, so the attribute differs from SSR on purpose.
    <html lang="en" className={`${inter.variable} h-full`} suppressHydrationWarning>
      <body className="min-h-full">
        <Script id="ks-theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
        <Providers siblingUrls={SIBLING_APP_URLS}>{children}</Providers>
      </body>
    </html>
  );
}
