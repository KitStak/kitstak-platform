import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/layout/shell-skeleton';
import { requirePagePermission } from '@/server/auth/permissions';
import { BillingEditPage } from '@/components/billing/billing-edit-page';

export const metadata: Metadata = { title: 'Billing form' };

/** Server-side gate: roles without access go to /forbidden instead of seeing a retryable 403. */
async function Detail({ params }: { readonly params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePagePermission('settings.billing.view', `/billing/${id}`);
  return <BillingEditPage id={id} />;
}

export default function Page({ params }: { readonly params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Detail params={params} />
    </Suspense>
  );
}
