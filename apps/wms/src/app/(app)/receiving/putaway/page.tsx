import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/layout/shell-skeleton';
import { PutawayWorklistPage } from '@/components/receiving/putaway-worklist-page';

export const metadata: Metadata = { title: 'Putaway' };

/** Putaway worklist: received stock still in a receiving location, with a scan-to-confirm step. */
export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PutawayWorklistPage />
    </Suspense>
  );
}
