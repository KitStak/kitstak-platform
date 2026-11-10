import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { ByLocationPage } from "@/components/inventory/by-location-page";

export const metadata: Metadata = { title: "Inventory by Location" };

/** The grid reads its state from the URL (useSearchParams), so it renders inside Suspense. */
export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ByLocationPage />
    </Suspense>
  );
}
