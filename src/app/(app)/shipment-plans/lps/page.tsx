import type { Metadata } from "next";
import { Suspense } from "react";
import { ShipListFallback } from "@/components/shipping/page-fallback";
import { PlanSubGridPage } from "@/components/shipment-plans/plan-subgrids";

export const metadata: Metadata = { title: "Shipment Plan LPs" };

/** The grid reads its state from the URL (useSearchParams), so it renders inside Suspense. */
export default function Page() {
  return (
    <Suspense fallback={<ShipListFallback title="Shipment Plan LPs" helper="License plates allocated to or shipped from the orders of each shipment plan." tabs="shipment-plans" />}>
      <PlanSubGridPage kind="lps" />
    </Suspense>
  );
}
