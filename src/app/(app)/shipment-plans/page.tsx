import type { Metadata } from "next";
import { Suspense } from "react";
import { ShipListFallback } from "@/components/shipping/page-fallback";
import { PlansPage } from "@/components/shipment-plans/plans-page";

export const metadata: Metadata = { title: "Shipment Plan" };

/** The grid reads its state from the URL (useSearchParams), so it renders inside Suspense. */
export default function Page() {
  return (
    <Suspense fallback={<ShipListFallback title="Shipment Plan" helper="Plan trucks and loads: group orders, assign a gate and carrier, track loading and ship the whole load at once." tabs="shipment-plans" />}>
      <PlansPage />
    </Suspense>
  );
}
