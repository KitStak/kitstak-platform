import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { PlansPage } from "@/components/shipment-plans/plans-page";

export const metadata: Metadata = { title: "Shipment plan" };

/** The grid reads its state from the URL (useSearchParams), so it renders inside Suspense. */
export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PlansPage />
    </Suspense>
  );
}
