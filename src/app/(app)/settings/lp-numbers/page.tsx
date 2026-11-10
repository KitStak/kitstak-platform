import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { LpNumbersPage } from "@/components/facility/lp-numbers/lp-numbers-page";

export const metadata: Metadata = { title: "LP Numbers" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <LpNumbersPage />
    </Suspense>
  );
}
