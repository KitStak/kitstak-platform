import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/layout/shell-skeleton';
import { requirePagePermission } from '@/server/auth/permissions';
import { BillingCreatePage } from '@/components/billing/billing-create-page';

export const metadata: Metadata = { title: 'Create billing form' };

/** Server-side gate: roles that can't see billing go to /forbidden (create rights are checked in the page). */
async function Gated() {
  await requirePagePermission('settings.billing.view', '/billing/new');
  return <BillingCreatePage />;
}

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Gated />
    </Suspense>
  );
}
