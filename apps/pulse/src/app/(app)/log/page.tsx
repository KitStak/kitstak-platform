import type { Metadata } from 'next';
import { LogPage } from '@/features/log';

export const metadata: Metadata = { title: 'Log work' };

export default function Page({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <LogPage searchParams={searchParams} />;
}
