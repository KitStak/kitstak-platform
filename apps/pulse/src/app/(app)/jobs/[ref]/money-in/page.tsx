import type { Metadata } from 'next';
import { JobPage } from '@/features/jobs';

export const metadata: Metadata = { title: 'Money in' };

export default function Page({ params }: { readonly params: Promise<{ ref: string }> }) {
  return <JobPage params={params} tab="money-in" />;
}
