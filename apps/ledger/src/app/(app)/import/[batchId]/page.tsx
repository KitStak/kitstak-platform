import type { Metadata } from 'next';
import { RecordPage } from '@/features/routes/record-page';

export const metadata: Metadata = { title: 'Import' };

export default async function Page({ params }: { readonly params: Promise<{ readonly batchId: string }> }) {
  const { batchId } = await params;
  return <RecordPage kind="import" refValue={batchId} path={`/import/${batchId}`} nav="import" />;
}
