import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ShipListFallback } from '@/components/shipping/page-fallback';
import { PlanSubGridPage } from '@/components/shipment-plans/plan-subgrids';

export const metadata: Metadata = { title: 'Shipment Plan Orders' };

/** The grid reads its state from the URL (useSearchParams), so it renders inside Suspense. */
export default function Page() {
  return (
    <Suspense
      fallback={
        <ShipListFallback
          title="Shipment Plan Orders"
          tabs="shipment-plans"
        />
      }
    >
      <PlanSubGridPage kind="orders" />
    </Suspense>
  );
}
