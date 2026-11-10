import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { OrderLinesReport } from "@/components/reports/report-pages";

export const metadata: Metadata = { title: "Order Line Progress" };

/** The grid reads its state from the URL (useSearchParams), so it renders inside Suspense. */
export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <OrderLinesReport />
    </Suspense>
  );
}
