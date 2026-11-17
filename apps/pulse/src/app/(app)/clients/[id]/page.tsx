import type { Metadata } from 'next';
import { ClientPage } from '@/features/clients';

export const metadata: Metadata = { title: 'Client' };

export default function Page({ params }: { readonly params: Promise<{ id: string }> }) {
  return <ClientPage params={params} />;
}
