import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { AlgorithmsPage } from "@/components/automation/algorithms/algorithms-page";

export const metadata: Metadata = { title: "Putaway Algorithms" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AlgorithmsPage slug="putaway" />
    </Suspense>
  );
}
