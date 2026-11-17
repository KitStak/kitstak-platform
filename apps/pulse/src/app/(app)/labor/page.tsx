import type { Metadata } from 'next';
import { LaborPage } from '@/features/labor';

export const metadata: Metadata = { title: 'Labor' };

export default function Page({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <LaborPage searchParams={searchParams} />;
}
