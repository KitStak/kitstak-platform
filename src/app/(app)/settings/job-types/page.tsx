import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { JobTypesPage } from "@/components/job-types/job-types-page";

export const metadata: Metadata = { title: "Job types" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <JobTypesPage />
    </Suspense>
  );
}
