import type { Metadata } from 'next';
import { NewProgramPage } from '@/features/programs/wizard/new-program-page';

export const metadata: Metadata = { title: 'New program' };

export default async function Page({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <NewProgramPage searchParams={await searchParams} />;
}
