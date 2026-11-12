import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CountScanPage } from '@/components/counts/count-scan-page';
import { PageSkeleton } from '@/components/layout/shell-skeleton';

export const metadata: Metadata = { title: 'Count (handheld)' };

/** Handheld / RF count execution. Reads `?plan=` with useSearchParams, so it renders inside Suspense. */
export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <CountScanPage />
    </Suspense>
  );
}
