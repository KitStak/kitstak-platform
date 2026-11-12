import type { Metadata } from 'next';
import { Suspense } from 'react';
import { JobsPageSkeleton } from '@/components/jobs/jobs-page-skeleton';
import { WaveRulesPage } from '@/components/wave-rules/wave-rules-page';

export const metadata: Metadata = { title: 'Wave rules' };

export default function Page() {
  return (
    <Suspense fallback={<JobsPageSkeleton title="Job wave rules" />}>
      <WaveRulesPage />
    </Suspense>
  );
}
