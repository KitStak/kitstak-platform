import type { Metadata } from 'next';
import { WallPage } from '@/features/wall';

export const metadata: Metadata = { title: 'Wall display' };

export default function Page({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <WallPage searchParams={searchParams} />;
}
