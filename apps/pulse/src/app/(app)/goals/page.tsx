import type { Metadata } from 'next';
import { GoalsPage } from '@/features/goals';

export const metadata: Metadata = { title: 'Goals' };

export default function Page({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <GoalsPage searchParams={searchParams} />;
}
