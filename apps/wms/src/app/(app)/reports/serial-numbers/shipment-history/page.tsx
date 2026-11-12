import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/layout/shell-skeleton';
import { SerialShipmentsReport } from '@/components/reports/report-pages';

export const metadata: Metadata = { title: 'Serial Number Shipment History' };

/** The grid reads its state from the URL (useSearchParams), so it renders inside Suspense. */
export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SerialShipmentsReport />
    </Suspense>
  );
}
