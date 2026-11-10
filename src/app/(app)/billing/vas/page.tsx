import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { VasPage } from "@/components/billing/vas-page";

export const metadata: Metadata = { title: "VAS Operations" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <VasPage />
    </Suspense>
  );
}
