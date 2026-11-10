import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { WorkflowBuilder } from "@/components/automation/workflows/workflow-builder";

export const metadata: Metadata = { title: "Create Workflow" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <WorkflowBuilder id={null} />
    </Suspense>
  );
}
