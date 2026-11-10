import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { BillingPage } from "@/components/billing/billing-page";

export const metadata: Metadata = { title: "3PL Billing" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <BillingPage />
    </Suspense>
  );
}
