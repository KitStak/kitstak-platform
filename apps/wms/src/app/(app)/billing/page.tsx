import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/layout/shell-skeleton';
import { requirePagePermission } from '@/server/auth/permissions';
import { BillingPage } from '@/components/billing/billing-page';

export const metadata: Metadata = { title: '3PL Billing' };

/** Server-side gate: roles without access go to /forbidden instead of seeing a retryable 403 grid. */
async function Gated() {
  await requirePagePermission('settings.billing.view', '/billing');
  return <BillingPage />;
}

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Gated />
    </Suspense>
  );
}
