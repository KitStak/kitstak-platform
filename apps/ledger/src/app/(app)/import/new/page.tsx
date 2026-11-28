import type { Metadata } from 'next';
import { NewImportPage } from '@/features/imports/import-pages';

export const metadata: Metadata = { title: 'Import a file' };

export default async function Page({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { stream } = await searchParams;
  return <NewImportPage stream={typeof stream === 'string' ? stream : null} />;
}
