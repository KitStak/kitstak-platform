import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/layout/shell-skeleton';
import { UserPerformanceReport } from '@/components/reports/report-pages';

export const metadata: Metadata = { title: 'User Performance Report' };

/** The grid reads its state from the URL (useSearchParams), so it renders inside Suspense. */
export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <UserPerformanceReport />
    </Suspense>
  );
}
