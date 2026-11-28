import type { Metadata } from 'next';
import { RecordPage } from '@/features/routes/record-page';

export const metadata: Metadata = { title: 'Invoice' };

export default async function Page({ params }: { readonly params: Promise<{ readonly ref: string }> }) {
  const { ref } = await params;
  return <RecordPage kind="invoice" refValue={ref} path={`/invoices/${ref}`} nav="invoices" />;
}
