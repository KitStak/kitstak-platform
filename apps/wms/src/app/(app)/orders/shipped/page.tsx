import type { Metadata } from 'next';
import { Suspense } from 'react';
import { OrdersListPage } from '@/components/orders/orders-list-page';
import { PageSkeleton } from '@/components/layout/shell-skeleton';

export const metadata: Metadata = { title: 'Shipped & canceled orders' };

/** Shipped & Canceled Orders (default chip: Actual shipment date, last 7 days). */
export default function ShippedOrders() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <OrdersListPage view="shipped" />
    </Suspense>
  );
}
