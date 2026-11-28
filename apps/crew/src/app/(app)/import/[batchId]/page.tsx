import type { Metadata } from 'next';
import { ImportBatchPage } from '@/features/imports/imports-page';

export const metadata: Metadata = { title: 'Import' };

export default async function Page({ params }: { readonly params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  return <ImportBatchPage batchId={batchId} />;
}
