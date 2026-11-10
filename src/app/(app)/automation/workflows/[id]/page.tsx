import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { WorkflowBuilder } from "@/components/automation/workflows/workflow-builder";

export const metadata: Metadata = { title: "Workflow" };

async function Content({ params }: { readonly params: Promise<{ id: string }> }) {
  const p = await params;
  return <WorkflowBuilder id={p.id} />;
}

export default function Page({ params }: { readonly params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={params} />
    </Suspense>
  );
}
