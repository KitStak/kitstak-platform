import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { RecentErrorsPage } from "@/components/integrations/monitoring/monitoring-review-pages";

export const metadata: Metadata = { title: "Recent Errors" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <RecentErrorsPage  />
    </Suspense>
  );
}
