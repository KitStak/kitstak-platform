import type { Metadata } from 'next';
import { PhasePage } from '@/features/phase/phase-page';

export const metadata: Metadata = { title: 'Agency' };

export default async function Page({ params }: { readonly params: Promise<{ vendorId: string }> }) {
  const { vendorId } = await params;
  return <PhasePage id="agency" path={`/people/agencies/${encodeURIComponent(vendorId)}`} />;
}
