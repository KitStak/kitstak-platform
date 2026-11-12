import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CountPlansPage } from '@/components/counts/count-plans-page';
import { PageSkeleton } from '@/components/layout/shell-skeleton';

export const metadata: Metadata = { title: 'Count plans' };

/** Count Plan grid. URL-driven grid state (useSearchParams) renders inside Suspense. */
export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <CountPlansPage />
    </Suspense>
  );
}
