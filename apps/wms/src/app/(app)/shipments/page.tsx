import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ShipListFallback } from '@/components/shipping/page-fallback';
import { ShipmentsPage } from '@/components/shipping/shipments-page';

export const metadata: Metadata = { title: 'Carrier Shipment Details' };

/** The grid reads its state from the URL (useSearchParams), so it renders inside Suspense. */
export default function Page() {
  return (
    <Suspense
      fallback={
        <ShipListFallback
          title="Carrier Shipment Details"
          helper="Every label and package your carriers created. Track, reprint or void them in one place."
          tabs="shipments"
          chips={[{ label: 'Label create date', value: 'Last 30 days' }]}
        />
      }
    >
      <ShipmentsPage />
    </Suspense>
  );
}
