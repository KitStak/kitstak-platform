import type { Metadata } from "next";
import { Suspense } from "react";
import { AnalyticsSkeleton } from "@/components/analytics/analytics-skeleton";
import { AnalyticsPage } from "@/components/analytics/analytics-page";

export const metadata: Metadata = { title: "Management Dashboard" };

/** Filters live in the URL (useSearchParams), so the page renders inside Suspense. */
export default function Page() {
  return (
    <Suspense fallback={<AnalyticsSkeleton />}>
      <AnalyticsPage group="operational" page="management" />
    </Suspense>
  );
}
