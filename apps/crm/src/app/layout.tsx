import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { Inter } from 'next/font/google';
import { THEME_COOKIE, parseThemeCookie } from '@/features/shell/theme-script';
import { RouteProgress } from '@/features/shell/route-progress';
import { Providers } from './providers';
import '@/styles/globals.css';

/* KitStak type: Inter for all UI text and headings (same face as KitStak WMS). */
const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'KitStak CRM', template: '%s · KitStak' },
  description: 'KitStak — the work OS for revenue teams: boards, pipelines and automations.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f1e9' },
    { media: '(prefers-color-scheme: dark)', color: '#0d0e10' },
  ],
};

/**
 * Root document. The theme is rendered server-side from the `kitstak-theme` cookie (no inline
 * script, so React never warns about a <script> in the tree, including on not-found renders).
 * Without the cookie tokens.css follows `prefers-color-scheme`; the ThemeProvider then sets
 * `data-theme` on hydration. Reading cookies keeps every route dynamic, which the per-request
 * CSP nonce (src/proxy.ts) requires.
 */
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const theme = parseThemeCookie((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html
      lang="en"
      data-theme={theme ?? undefined}
      className={`${inter.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="min-h-full">
        <Providers>
          <RouteProgress />
          {children}
        </Providers>
      </body>
    </html>
  );
}
