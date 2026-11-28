import type { Metadata } from 'next';
import { CustomerPage } from '@/features/customers/customer-page';

export const metadata: Metadata = { title: 'Customer' };

export default async function Page({ params }: { readonly params: Promise<{ readonly id: string }> }) {
  const { id } = await params;
  return <CustomerPage id={decodeURIComponent(id)} />;
}
