import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { WorkflowBuilder } from "@/components/automation/workflows/workflow-builder";
import { requirePagePermission } from "@/server/auth/permissions";

export const metadata: Metadata = { title: "Create Workflow" };

/** Server-side gate: roles without create permission land on /forbidden (the API also rejects the save). */
async function Gated() {
  await requirePagePermission("automation.workflows.create", "/automation/workflows/new");
  return <WorkflowBuilder id={null} />;
}

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Gated />
    </Suspense>
  );
}
