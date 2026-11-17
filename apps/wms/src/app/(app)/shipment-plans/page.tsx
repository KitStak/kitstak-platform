import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ShipListFallback } from '@/components/shipping/page-fallback';
import { PlansPage } from '@/components/shipment-plans/plans-page';

export const metadata: Metadata = { title: 'Shipment Plan' };

/** The grid reads its state from the URL (useSearchParams), so it renders inside Suspense. */
export default function Page() {
  return (
    <Suspense
      fallback={
        <ShipListFallback
          title="Shipment Plan"
          tabs="shipment-plans"
        />
      }
    >
      <PlansPage />
    </Suspense>
  );
}
