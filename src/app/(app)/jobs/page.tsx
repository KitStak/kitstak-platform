import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { JobsListPage } from "@/components/jobs/jobs-list-page";

export const metadata: Metadata = { title: "Jobs" };

/** Job Management. Grid state lives in the URL (useSearchParams), so it renders inside Suspense. */
export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <JobsListPage />
    </Suspense>
  );
}
