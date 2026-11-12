import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/layout/shell-skeleton';
import { requirePagePermission } from '@/server/auth/permissions';
import { VasPage } from '@/components/billing/vas-page';

export const metadata: Metadata = { title: 'VAS Operations' };

/** Server-side gate: roles without access go to /forbidden instead of seeing a retryable 403 grid. */
async function Gated() {
  await requirePagePermission('settings.vas_operations.view', '/billing/vas');
  return <VasPage />;
}

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Gated />
    </Suspense>
  );
}
