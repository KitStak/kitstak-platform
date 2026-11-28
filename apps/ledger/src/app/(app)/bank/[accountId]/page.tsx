import type { Metadata } from 'next';
import { RecordPage } from '@/features/routes/record-page';

export const metadata: Metadata = { title: 'Bank account' };

export default async function Page({ params }: { readonly params: Promise<{ readonly accountId: string }> }) {
  const { accountId } = await params;
  return <RecordPage kind="bank_account" refValue={accountId} path={`/bank/${accountId}`} nav="bank" />;
}
