import type { Metadata } from 'next';
import { InactiveLink } from '@/features/phase/inactive-link';

export const metadata: Metadata = { title: 'Agency link', robots: { index: false, follow: false }, referrer: 'no-referrer' };

/** Public, no login (src/proxy.ts does not gate it). The token is never echoed back. */
export default async function Page({ params }: { readonly params: Promise<{ token: string }> }) {
  await params;
  return <InactiveLink what="agency link" phase={1} />;
}
