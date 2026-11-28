import type { Metadata } from 'next';
import { RecordPage } from '@/features/routes/record-page';

export const metadata: Metadata = { title: 'Recurring invoice' };

export default async function Page({ params }: { readonly params: Promise<{ readonly id: string }> }) {
  const { id } = await params;
  return <RecordPage kind="recurring" refValue={id} path={`/invoices/recurring/${id}`} nav="invoices" />;
}
