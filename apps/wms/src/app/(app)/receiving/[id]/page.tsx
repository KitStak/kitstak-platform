import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { PoDetailPage } from "@/components/receiving/po-detail-page";

export const metadata: Metadata = { title: "Purchase order" };

/** Purchase order detail / edit. Loads through `/api/purchase-orders/[id]` (scoped; 404 for out-of-scope ids). */
export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PoDetailPage />
    </Suspense>
  );
}
