import type { Metadata } from 'next';
import { WallLinkPage } from '@/features/wall';

export const metadata: Metadata = { title: 'Wall display', robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default function Page({ params }: { readonly params: Promise<{ token: string }> }) {
  return <WallLinkPage params={params} />;
}
