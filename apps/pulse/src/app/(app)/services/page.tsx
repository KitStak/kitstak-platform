import type { Metadata } from 'next';
import { ServicesPage } from '@/features/services';

export const metadata: Metadata = { title: 'Extra services' };

export default function Page({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <ServicesPage searchParams={searchParams} />;
}
