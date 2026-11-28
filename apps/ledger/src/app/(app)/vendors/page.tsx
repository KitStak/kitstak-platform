import type { Metadata } from 'next';
import { VendorsPage } from '@/features/vendors/vendors-page';

export const metadata: Metadata = { title: 'Vendors' };

export default async function Page({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { show } = await searchParams;
  return <VendorsPage archived={show === 'archived'} />;
}
