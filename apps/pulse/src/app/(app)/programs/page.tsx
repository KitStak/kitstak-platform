import type { Metadata } from 'next';
import { ProgramsPage } from '@/features/programs';

export const metadata: Metadata = { title: 'Programs' };

export default function Page({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <ProgramsPage searchParams={searchParams} />;
}
