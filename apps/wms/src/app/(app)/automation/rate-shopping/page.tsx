import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { RateShoppingPage } from "@/components/automation/rate-shopping/rate-shopping-page";

export const metadata: Metadata = { title: "Rate Shopping Presets" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <RateShoppingPage  />
    </Suspense>
  );
}
