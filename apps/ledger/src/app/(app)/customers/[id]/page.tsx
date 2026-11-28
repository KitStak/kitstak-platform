import type { Metadata } from 'next';
import { RecordPage } from '@/features/routes/record-page';

export const metadata: Metadata = { title: 'Customer' };

export default async function Page({ params }: { readonly params: Promise<{ readonly id: string }> }) {
  const { id } = await params;
  return <RecordPage kind="customer" refValue={id} path={`/customers/${id}`} nav="customers" />;
}
