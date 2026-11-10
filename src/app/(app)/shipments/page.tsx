import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { ShipmentsPage } from "@/components/shipping/shipments-page";

export const metadata: Metadata = { title: "Carrier shipment details" };

/** The grid reads its state from the URL (useSearchParams), so it renders inside Suspense. */
export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ShipmentsPage />
    </Suspense>
  );
}
