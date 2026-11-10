import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { WaveLogPage } from "@/components/jobs/report-pages";

export const metadata: Metadata = { title: "Wave log" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <WaveLogPage />
    </Suspense>
  );
}
