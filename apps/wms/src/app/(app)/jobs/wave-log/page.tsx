import type { Metadata } from 'next';
import { Suspense } from 'react';
import { JobsPageSkeleton } from '@/components/jobs/jobs-page-skeleton';
import { WaveLogPage } from '@/components/jobs/report-pages';

export const metadata: Metadata = { title: 'Wave log' };

export default function Page() {
  return (
    <Suspense fallback={<JobsPageSkeleton title="Wave log report" />}>
      <WaveLogPage />
    </Suspense>
  );
}
