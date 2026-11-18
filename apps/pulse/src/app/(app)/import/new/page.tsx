import type { Metadata } from 'next';
import { NewImportPage } from '@/features/imports';

export const metadata: Metadata = { title: 'New import' };

export default function Page({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <NewImportPage searchParams={searchParams} />;
}
