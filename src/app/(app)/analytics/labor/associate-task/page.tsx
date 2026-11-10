import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { AnalyticsPage } from "@/components/analytics/analytics-page";

export const metadata: Metadata = { title: "Associate Task Analysis" };

/** Filters live in the URL (useSearchParams), so the page renders inside Suspense. */
export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AnalyticsPage group="labor" page="associate-task" />
    </Suspense>
  );
}
