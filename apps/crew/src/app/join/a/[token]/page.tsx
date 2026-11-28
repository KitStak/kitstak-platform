import type { Metadata } from 'next';
import { AgencyJoinForm } from '@/features/agencies/join-form';
import { InactiveLink } from '@/features/phase/inactive-link';
import { readPublicLink } from '@/server/domain/agency-public';

export const metadata: Metadata = { title: 'Send your people', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export const dynamic = 'force-dynamic';

/**
 * The agency link (docs/crew/SPEC.md 6.1 `/join/a/[token]`). Public, no login (src/proxy.ts does
 * not gate it). Shows only the site name and the agency name. The token is never echoed back.
 */
export default async function Page({ params }: { readonly params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await readPublicLink(token);
  if (!link) return <InactiveLink what="agency link" />;
  return <AgencyJoinForm token={token} siteName={link.siteName} agencyName={link.agencyName} remaining={link.remaining} />;
}
