import type { Metadata } from 'next';
import { ProgramPage } from '@/features/programs';

type Params = Promise<{ key: string }>;

export async function generateMetadata({ params }: { readonly params: Params }): Promise<Metadata> {
  const key = decodeURIComponent((await params).key).toUpperCase();
  return { title: /^[A-Z][A-Z0-9]{1,5}$/.test(key) ? `${key} · Programs` : 'Program' };
}

export default function Page({ params, searchParams }: { readonly params: Params; readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <ProgramPage params={params} searchParams={searchParams} />;
}
