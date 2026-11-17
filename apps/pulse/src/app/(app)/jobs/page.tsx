import type { Metadata } from 'next';
import { JobsPage } from '@/features/jobs';

export const metadata: Metadata = { title: 'Jobs' };

export default function Page({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <JobsPage searchParams={searchParams} />;
}
