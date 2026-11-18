import type { Metadata } from 'next';
import { ClosePage } from '@/features/periods';

export const metadata: Metadata = { title: 'Month close' };

export default function Page({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <ClosePage searchParams={searchParams} />;
}
