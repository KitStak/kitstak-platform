import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { AlgorithmEditor } from "@/components/automation/algorithms/algorithm-editor";

export const metadata: Metadata = { title: "Create Putaway Algorithm" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AlgorithmEditor slug="putaway" id={null} />
    </Suspense>
  );
}
