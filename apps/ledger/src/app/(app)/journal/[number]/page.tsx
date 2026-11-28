import type { Metadata } from 'next';
import { RecordPage } from '@/features/routes/record-page';

export const metadata: Metadata = { title: 'Entry' };

export default async function Page({ params }: { readonly params: Promise<{ readonly number: string }> }) {
  const { number } = await params;
  return <RecordPage kind="journal" refValue={number} path={`/journal/${number}`} nav="journal" />;
}
