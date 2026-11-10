import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { PoListPage } from "@/components/receiving/po-list-page";

export const metadata: Metadata = { title: "Purchase orders" };

/** Purchase order list. The grid reads its state from the URL (useSearchParams), so it renders inside Suspense. */
export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PoListPage />
    </Suspense>
  );
}
