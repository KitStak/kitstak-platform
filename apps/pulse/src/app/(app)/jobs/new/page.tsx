import type { Metadata } from 'next';
import { NewJobPage } from '@/features/jobs';

export const metadata: Metadata = { title: 'New job' };

export default function Page({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <NewJobPage searchParams={searchParams} />;
}
