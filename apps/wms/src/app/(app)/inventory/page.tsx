import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { TotalInventoryPage } from "@/components/inventory/total-inventory-page";

export const metadata: Metadata = { title: "Total Inventory" };

/** The grid reads its state from the URL (useSearchParams), so it renders inside Suspense. */
export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <TotalInventoryPage />
    </Suspense>
  );
}
