import type { Metadata } from 'next';
import { PhasePage } from '@/features/phase/phase-page';

export const metadata: Metadata = { title: 'Import' };

export default async function Page({ params }: { readonly params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  return <PhasePage id="import-batch" path={`/import/${encodeURIComponent(batchId)}`} />;
}
