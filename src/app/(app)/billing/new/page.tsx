import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { BillingCreatePage } from "@/components/billing/billing-create-page";

export const metadata: Metadata = { title: "Create billing form" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <BillingCreatePage />
    </Suspense>
  );
}
