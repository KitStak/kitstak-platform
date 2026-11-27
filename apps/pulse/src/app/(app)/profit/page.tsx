import type { Metadata } from 'next';
import { ProfitPage } from '@/features/profit';

export const metadata: Metadata = { title: 'Profit' };

export default function Page({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <ProfitPage searchParams={searchParams} />;
}
