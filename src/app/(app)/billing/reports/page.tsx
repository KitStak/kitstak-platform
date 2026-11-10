import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { BillingReportsPage } from "@/components/billing/billing-reports-page";

export const metadata: Metadata = { title: "Billing Report" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <BillingReportsPage />
    </Suspense>
  );
}
