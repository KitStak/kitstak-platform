import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { VendorsPage } from "@/components/vendors/vendors-page";

export const metadata: Metadata = { title: "Vendors" };

/** Vendors (Organization tab group). The grid reads its state from the URL (useSearchParams), so it renders inside Suspense. */
export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <VendorsPage tabs="organization" />
    </Suspense>
  );
}
