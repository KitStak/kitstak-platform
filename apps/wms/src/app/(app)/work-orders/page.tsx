import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/layout/shell-skeleton';
import { WorkOrdersPage } from '@/components/work-orders/work-orders-page';

export const metadata: Metadata = { title: 'Work Orders' };

/** Work Orders grid. URL-driven grid state (useSearchParams) renders inside Suspense. */
export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <WorkOrdersPage />
    </Suspense>
  );
}
