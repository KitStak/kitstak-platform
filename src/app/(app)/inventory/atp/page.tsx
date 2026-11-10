import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { AtpPage } from "@/components/inventory/atp-page";

export const metadata: Metadata = { title: "Available To Promise" };

/** The grid reads its state from the URL (useSearchParams), so it renders inside Suspense. */
export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AtpPage />
    </Suspense>
  );
}
