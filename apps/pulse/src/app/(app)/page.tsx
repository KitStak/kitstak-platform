import type { Metadata } from 'next';
import { HomePage } from '@/features/home';

export const metadata: Metadata = { title: 'Home' };

export default function Page({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <HomePage searchParams={searchParams} />;
}
