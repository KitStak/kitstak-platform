import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ShipListFallback } from '@/components/shipping/page-fallback';
import { ShipmentHistoryPage } from '@/components/shipping/shipment-history-page';

export const metadata: Metadata = { title: 'Shipment History' };

/** The grid reads its state from the URL (useSearchParams), so it renders inside Suspense. */
export default function Page() {
  return (
    <Suspense
      fallback={
        <ShipListFallback
          title="Shipment History"
          helper="Every unit that left inventory: shipped orders and remove-inventory actions, by SKU, lot and LPN, straight from the ledger."
        />
      }
    >
      <ShipmentHistoryPage />
    </Suspense>
  );
}
