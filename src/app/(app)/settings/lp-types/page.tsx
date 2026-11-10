import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { LpTypesPage } from "@/components/facility/lp-types/lp-types-page";

export const metadata: Metadata = { title: "LP Types" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <LpTypesPage />
    </Suspense>
  );
}
