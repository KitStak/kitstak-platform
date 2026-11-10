import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { ShortagePage } from "@/components/jobs/report-pages";

export const metadata: Metadata = { title: "Shortage report" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ShortagePage />
    </Suspense>
  );
}
