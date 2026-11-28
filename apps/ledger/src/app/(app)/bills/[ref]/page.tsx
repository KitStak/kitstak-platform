import type { Metadata } from 'next';
import { RecordPage } from '@/features/routes/record-page';

export const metadata: Metadata = { title: 'Bill' };

export default async function Page({ params }: { readonly params: Promise<{ readonly ref: string }> }) {
  const { ref } = await params;
  return <RecordPage kind="bill" refValue={ref} path={`/bills/${ref}`} nav="bills" />;
}
