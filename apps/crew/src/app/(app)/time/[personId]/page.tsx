import type { Metadata } from 'next';
import { PhasePage } from '@/features/phase/phase-page';

export const metadata: Metadata = { title: 'Time card' };

export default async function Page({ params }: { readonly params: Promise<{ personId: string }> }) {
  const { personId } = await params;
  return <PhasePage id="time-person" path={`/time/${encodeURIComponent(personId)}`} />;
}
