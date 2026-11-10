import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { RmaCreatePage } from "@/components/returns/rma-create-page";

export const metadata: Metadata = { title: "Create RMA" };

/** Create RMA (M04 §7) — `?orderIds=a,b` preselects shipped orders. */
export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <RmaCreatePage />
    </Suspense>
  );
}
