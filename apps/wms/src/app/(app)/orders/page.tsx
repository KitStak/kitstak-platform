import type { Metadata } from "next";
import { Suspense } from "react";
import { OrdersListPage } from "@/components/orders/orders-list-page";
import { PageSkeleton } from "@/components/layout/shell-skeleton";

export const metadata: Metadata = { title: "Shipment orders" };

/** Order Backlog. The grid reads its state from the URL (useSearchParams), so it renders inside Suspense. */
export default function Orders() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <OrdersListPage view="backlog" />
    </Suspense>
  );
}
