import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { PlanSubGridPage } from "@/components/shipment-plans/plan-subgrids";

export const metadata: Metadata = { title: "Shipment plan orders" };

/** The grid reads its state from the URL (useSearchParams), so it renders inside Suspense. */
export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PlanSubGridPage kind="orders" />
    </Suspense>
  );
}
