import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { MissingOrdersPage } from "@/components/integrations/monitoring/monitoring-review-pages";

export const metadata: Metadata = { title: "Missing Shipment Orders" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <MissingOrdersPage  />
    </Suspense>
  );
}
