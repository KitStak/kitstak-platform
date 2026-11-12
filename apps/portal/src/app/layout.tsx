import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import Script from 'next/script';
import { THEME_INIT_SCRIPT } from '@kitstak/ui/theme';
import '@/styles/globals.css';

/* KitStak type: Inter for all UI text and headings (same face as CRM and WMS). */
const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'KitStak Portal', template: '%s · KitStak' },
  description: 'KitStak — one account for every KitStak app: launch CRM and WMS, manage your organization.',
  robots: { index: false, follow: false },
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
        {/* Applies the saved light/dark theme before first paint (shared @kitstak/ui script). */}
        <Script id="ks-theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
        {children}
      </body>
    </html>
  );
}
