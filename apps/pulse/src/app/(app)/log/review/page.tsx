import type { Metadata } from 'next';
import { LogReviewPage } from '@/features/log';

export const metadata: Metadata = { title: 'Review the day' };

export default function Page({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <LogReviewPage searchParams={searchParams} />;
}
