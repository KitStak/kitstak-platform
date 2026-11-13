import type { Metadata, Viewport } from 'next';
import { Bebas_Neue, Inter } from 'next/font/google';
import '@kitstak/ui/styles/tokens.css';
import '@/styles/globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const bebas = Bebas_Neue({ subsets: ['latin'], weight: '400', variable: '--font-bebas', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL('https://kitstak.com'),
  title: 'KitStak — CRM and WMS on one stack',
  description:
    'KitStak runs your customers and your warehouse on one database and one sign-in. Use the CRM, the WMS, or both.',
  openGraph: {
    title: 'KitStak',
    description: 'CRM and WMS on one stack.',
    url: 'https://kitstak.com',
    siteName: 'KitStak',
    type: 'website',
  },
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
