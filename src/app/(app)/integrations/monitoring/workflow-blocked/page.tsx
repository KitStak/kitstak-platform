import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { WorkflowBlockedPage } from "@/components/integrations/monitoring/monitoring-review-pages";

export const metadata: Metadata = { title: "Workflow Blocked Shipment Orders" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <WorkflowBlockedPage  />
    </Suspense>
  );
}
