import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/layout/shell-skeleton';
import { ReturnStationPage } from '@/components/returns/return-station-page';

export const metadata: Metadata = { title: 'Return station' };

/** Return Station (M04 §3–5). `?rma=<code>` opens Return With RMA for that code. */
export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ReturnStationPage />
    </Suspense>
  );
}
