import type { Metadata, Viewport } from 'next';
import { Bebas_Neue, Inter } from 'next/font/google';
import Script from 'next/script';
import { AppProviders } from '@/components/layout/app-providers';
import { PRODUCT_NAME } from '@/config/brand';
import { THEME_INIT_SCRIPT } from '@/lib/theme-script';
import './globals.css';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  display: 'swap',
  // Inter is one variable file; preloading it on every route only produced
  // "preloaded but not used" warnings on pages that paint before the font is needed.
  preload: false,
});

/** Condensed display face for the KitStak wordmark (brand lockup). */
const bebas = Bebas_Neue({
  variable: '--font-bebas',
  weight: '400',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: PRODUCT_NAME, template: `%s · ${PRODUCT_NAME}` },
  description: 'Enterprise warehouse management for high-volume fulfillment.',
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
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${bebas.variable} antialiased`}>
        {/* Applies the saved light/dark theme before first paint (no flash). */}
        <Script id="ks-theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
