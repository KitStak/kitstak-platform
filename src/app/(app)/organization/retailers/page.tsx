import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { RetailersPage } from "@/components/organization/retailers-page";

export const metadata: Metadata = { title: "Retailers" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <RetailersPage />
    </Suspense>
  );
}
