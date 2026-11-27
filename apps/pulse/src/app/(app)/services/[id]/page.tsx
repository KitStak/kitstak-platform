import type { Metadata } from 'next';
import { ServicePage } from '@/features/services';

export const metadata: Metadata = { title: 'Extra service' };

export default function Page({ params, searchParams }: { readonly params: Promise<{ id: string }>; readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <ServicePage params={params} searchParams={searchParams} />;
}
