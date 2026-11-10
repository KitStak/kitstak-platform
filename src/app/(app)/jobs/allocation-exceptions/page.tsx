import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { AllocationExceptionsPage } from "@/components/jobs/report-pages";

export const metadata: Metadata = { title: "Allocation exceptions" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AllocationExceptionsPage />
    </Suspense>
  );
}
