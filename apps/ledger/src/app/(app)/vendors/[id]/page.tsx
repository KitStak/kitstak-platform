import type { Metadata } from 'next';
import { VendorPage } from '@/features/vendors/vendor-page';

export const metadata: Metadata = { title: 'Vendor' };

export default async function Page({ params }: { readonly params: Promise<{ readonly id: string }> }) {
  const { id } = await params;
  return <VendorPage id={decodeURIComponent(id)} />;
}
