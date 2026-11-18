import type { Metadata } from 'next';
import { ReportsPage } from '@/features/reports';

export const metadata: Metadata = { title: 'Reports' };

export default function Page({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <ReportsPage searchParams={searchParams} />;
}
