import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { HealthOverviewPage } from "@/components/integrations/monitoring/monitoring-overview-pages";

export const metadata: Metadata = { title: "Channel Health Overview" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <HealthOverviewPage  />
    </Suspense>
  );
}
