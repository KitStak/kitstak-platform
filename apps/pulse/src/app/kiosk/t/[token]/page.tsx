import type { Metadata } from 'next';
import { KioskPage } from '@/features/kiosk';

export const metadata: Metadata = { title: 'Floor tablet', robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default function Page({ params }: { readonly params: Promise<{ token: string }> }) {
  return <KioskPage params={params} />;
}
