import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { ReturnOrdersPage } from "@/components/returns/return-orders-page";

export const metadata: Metadata = { title: "Return orders" };

/** Return Orders (M04 §6): one row per RMA line. */
export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ReturnOrdersPage />
    </Suspense>
  );
}
