import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { MobileCartsPage } from "@/components/facility/mobile-carts/mobile-carts-page";

export const metadata: Metadata = { title: "Mobile Carts" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <MobileCartsPage />
    </Suspense>
  );
}
