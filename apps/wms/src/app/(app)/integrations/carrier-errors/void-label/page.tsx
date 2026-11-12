import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { CarrierErrorsPage } from "@/components/integrations/carrier-errors/carrier-errors-page";

export const metadata: Metadata = { title: "Void/Cancel Label - Carrier Monitoring" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <CarrierErrorsPage step="VoidLabel" />
    </Suspense>
  );
}
