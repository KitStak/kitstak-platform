import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { ShipmentHistoryPage } from "@/components/shipping/shipment-history-page";

export const metadata: Metadata = { title: "Shipment history" };

/** The grid reads its state from the URL (useSearchParams), so it renders inside Suspense. */
export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ShipmentHistoryPage />
    </Suspense>
  );
}
