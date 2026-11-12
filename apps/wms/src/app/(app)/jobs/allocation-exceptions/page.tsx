import type { Metadata } from 'next';
import { Suspense } from 'react';
import { JobsPageSkeleton } from '@/components/jobs/jobs-page-skeleton';
import { AllocationExceptionsPage } from '@/components/jobs/report-pages';

export const metadata: Metadata = { title: 'Allocation exceptions' };

export default function Page() {
  return (
    <Suspense fallback={<JobsPageSkeleton title="Allocation exceptions" />}>
      <AllocationExceptionsPage />
    </Suspense>
  );
}
