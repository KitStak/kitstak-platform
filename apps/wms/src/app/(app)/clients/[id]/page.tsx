import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/layout/shell-skeleton';
import { requirePagePermission } from '@/server/auth/permissions';
import { ClientDetailPage } from '@/components/clients/client-detail-page';

export const metadata: Metadata = { title: 'Client details' };

/** Server-side gate: roles without Clients view land on /forbidden instead of a retryable 403. */
async function Detail({ params }: { readonly params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePagePermission('settings.clients.view', `/clients/${id}`);
  return <ClientDetailPage id={id} />;
}

export default function Page({ params }: { readonly params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Detail params={params} />
    </Suspense>
  );
}
