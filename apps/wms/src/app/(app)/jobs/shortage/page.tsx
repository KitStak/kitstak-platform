import type { Metadata } from 'next';
import { Suspense } from 'react';
import { JobsPageSkeleton } from '@/components/jobs/jobs-page-skeleton';
import { ShortagePage } from '@/components/jobs/report-pages';

export const metadata: Metadata = { title: 'Shortage report' };

export default function Page() {
  return (
    <Suspense fallback={<JobsPageSkeleton title="Shortage report" />}>
      <ShortagePage />
    </Suspense>
  );
}
