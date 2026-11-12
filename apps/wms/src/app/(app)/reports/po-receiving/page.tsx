import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { PoReceivingReport } from "@/components/reports/report-pages";

export const metadata: Metadata = { title: "PO Receiving Report" };

/** The grid reads its state from the URL (useSearchParams), so it renders inside Suspense. */
export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PoReceivingReport />
    </Suspense>
  );
}
