import type { Metadata, Viewport } from 'next';
import { Bebas_Neue, Inter } from 'next/font/google';
import '@kitstak/ui/styles/tokens.css';
import '@/styles/globals.css';
import { JsonLd } from '@/components/json-ld';
import { PULSE_IS_LIVE } from '@/components/site-links';
import { SITE_NAME, SITE_URL, organizationLd, websiteLd } from '@/lib/seo';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const bebas = Bebas_Neue({ subsets: ['latin'], weight: '400', variable: '--font-bebas', display: 'swap' });

/**
 * Search Console and Bing Webmaster ownership tokens. Set them in the Vercel project
 * (`GOOGLE_SITE_VERIFICATION`, `BING_SITE_VERIFICATION`) and redeploy; with none set, no tag is written.
 */
const GOOGLE_VERIFICATION = process.env.GOOGLE_SITE_VERIFICATION?.trim() || undefined;
const BING_VERIFICATION = process.env.BING_SITE_VERIFICATION?.trim() || undefined;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: SITE_NAME,
  publisher: SITE_NAME,
  creator: SITE_NAME,
  category: 'business software',
  formatDetection: { telephone: false, email: false, address: false },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1, 'max-video-preview': -1 },
  },
  verification: {
    google: GOOGLE_VERIFICATION,
    other: BING_VERIFICATION ? { 'msvalidate.01': BING_VERIFICATION } : undefined,
  },
  alternates: {
    types: { 'application/rss+xml': [{ url: '/articles/feed.xml', title: 'KitStak articles' }] },
  },
  title: 'KitStak - CRM, WMS, Projects and Pulse on one stack',
  description: PULSE_IS_LIVE
    ? 'KitStak runs your customers, your warehouse and your projects on one database and one sign-in. Pulse shows the profit on every job. Use the CRM, the WMS, Projects, Pulse, or any mix.'
    : 'KitStak runs your customers, your warehouse and your projects on one database and one sign-in. Pulse shows the profit on every job. Use the CRM, the WMS, Projects or any mix. Pulse is coming soon.',
  openGraph: {
    title: 'KitStak',
    description: 'CRM, WMS, Projects and Pulse on one stack.',
    url: 'https://kitstak.com',
    siteName: 'KitStak',
    type: 'website',
  },
  // The preview image itself comes from each route's opengraph-image and twitter-image files.
  twitter: { card: 'summary_large_image' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f1e9' },
    { media: '(prefers-color-scheme: dark)', color: '#0d0e10' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth" className={`${inter.variable} ${bebas.variable}`} suppressHydrationWarning>
      <head>
        {/* Static string: marks JS as available before first paint so scroll reveals do not flash. */}
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
      </head>
      <body>
        <JsonLd data={[organizationLd(), websiteLd()]} />
        {children}
      </body>
    </html>
  );
}
