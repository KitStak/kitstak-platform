import type { Metadata, Viewport } from 'next';
import { Bebas_Neue, Inter } from 'next/font/google';
import '@kitstak/ui/styles/tokens.css';
import '@/styles/globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const bebas = Bebas_Neue({ subsets: ['latin'], weight: '400', variable: '--font-bebas', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL('https://kitstak.com'),
  title: 'KitStak - CRM, WMS, Projects and Pulse on one stack',
  description:
    'KitStak runs your customers, your warehouse and your projects on one database and one sign-in. Pulse shows the profit on every job. Use the CRM, the WMS, Projects, Pulse, or any mix.',
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
      <body>{children}</body>
    </html>
  );
}
