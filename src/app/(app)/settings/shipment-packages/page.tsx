import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { ShipmentPackagesPage } from "@/components/facility/shipment-packages/shipment-packages-page";

export const metadata: Metadata = { title: "Shipment Packages" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ShipmentPackagesPage />
    </Suspense>
  );
}
