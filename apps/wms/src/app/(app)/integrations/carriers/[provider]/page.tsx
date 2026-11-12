import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/layout/shell-skeleton';
import { CarrierConnectionsPage } from '@/components/integrations/carriers/carrier-connections-page';

export const metadata: Metadata = { title: 'Carrier Integration' };

async function Content({ params }: { readonly params: Promise<{ provider: string }> }) {
  const p = await params;
  return <CarrierConnectionsPage provider={p.provider} />;
}

export default function Page({ params }: { readonly params: Promise<{ provider: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={params} />
    </Suspense>
  );
}
