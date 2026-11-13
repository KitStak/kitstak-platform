import type { Metadata } from 'next';
import { SearchPage } from '@/features/search';

export const metadata: Metadata = { title: 'Search' };

export default function Page({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <SearchPage searchParams={searchParams} />;
}
