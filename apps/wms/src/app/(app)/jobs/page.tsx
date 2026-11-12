import type { Metadata } from "next";
import { Suspense } from "react";
import { JobsPageSkeleton } from "@/components/jobs/jobs-page-skeleton";
import { JobsListPage } from "@/components/jobs/jobs-list-page";

export const metadata: Metadata = { title: "Jobs" };

/** Job Management. Grid state lives in the URL (useSearchParams), so it renders inside Suspense. */
export default function Page() {
  return (
    <Suspense fallback={<JobsPageSkeleton title="Job Management" chip={{ label: "Job status", value: "Pending, Started" }} />}>
      <JobsListPage />
    </Suspense>
  );
}
