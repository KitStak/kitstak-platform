import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ShipListFallback } from '@/components/shipping/page-fallback';
import { EndOfDayPage } from '@/components/shipping/end-of-day-page';

export const metadata: Metadata = { title: 'End Of The Day' };

/** The grid reads its state from the URL (useSearchParams), so it renders inside Suspense. */
export default function Page() {
  return (
    <Suspense
      fallback={
        <ShipListFallback
          title="End Of The Day"
          tabs="shipments"
        />
      }
    >
      <EndOfDayPage />
    </Suspense>
  );
}
