import type { Metadata } from 'next';
import { RecordPage } from '@/features/routes/record-page';

export const metadata: Metadata = { title: 'Expense' };

export default async function Page({ params }: { readonly params: Promise<{ readonly id: string }> }) {
  const { id } = await params;
  return <RecordPage kind="expense" refValue={id} path={`/expenses/${id}`} nav="expenses" />;
}
