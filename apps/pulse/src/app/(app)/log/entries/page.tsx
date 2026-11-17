import type { Metadata } from 'next';
import { LogEntriesPage } from '@/features/log';

export const metadata: Metadata = { title: 'All entries' };

export default function Page({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <LogEntriesPage searchParams={searchParams} />;
}
