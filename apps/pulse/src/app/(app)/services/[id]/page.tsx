import type { Metadata } from 'next';
import { ServicePage } from '@/features/services';

export const metadata: Metadata = { title: 'Extra service' };

export default function Page({ params }: { readonly params: Promise<{ id: string }> }) {
  return <ServicePage params={params} />;
}
