import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { AlgorithmEditor } from "@/components/automation/algorithms/algorithm-editor";

export const metadata: Metadata = { title: "Create Allocation Algorithm" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AlgorithmEditor slug="allocation" id={null} />
    </Suspense>
  );
}
