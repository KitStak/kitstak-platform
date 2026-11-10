import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { LocationsPage } from "@/components/locations/locations-page";

export const metadata: Metadata = { title: "Locations" };

/** The grid reads its state from the URL (useSearchParams), so it renders inside Suspense. */
export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <LocationsPage />
    </Suspense>
  );
}
