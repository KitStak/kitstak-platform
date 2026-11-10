import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { EndOfDayPage } from "@/components/shipping/end-of-day-page";

export const metadata: Metadata = { title: "End of the day" };

/** The grid reads its state from the URL (useSearchParams), so it renders inside Suspense. */
export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <EndOfDayPage />
    </Suspense>
  );
}
