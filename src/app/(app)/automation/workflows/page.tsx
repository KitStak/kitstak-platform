import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { WorkflowsPage } from "@/components/automation/workflows/workflows-page";

export const metadata: Metadata = { title: "Workflows" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <WorkflowsPage  />
    </Suspense>
  );
}
