import type { Metadata } from 'next';
import { ImportBatchPage } from '@/features/imports';

export const metadata: Metadata = { title: 'Import' };

export default function Page({ params }: { readonly params: Promise<{ batchId: string }> }) {
  return <ImportBatchPage params={params} />;
}
