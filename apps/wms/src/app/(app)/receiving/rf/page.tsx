import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { RfReceivePage } from "@/components/receiving/rf-receive-page";

export const metadata: Metadata = { title: "RF receiving" };

/** Handheld receive-by-scan: scan PO, scan product, quantity / tracking, scan location / LP, confirm. */
export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <RfReceivePage />
    </Suspense>
  );
}
