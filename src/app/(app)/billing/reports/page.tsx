import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { requirePagePermission } from "@/server/auth/permissions";
import { BillingReportsPage } from "@/components/billing/billing-reports-page";

export const metadata: Metadata = { title: "Billing Report" };

/** Server-side gate: roles without access go to /forbidden instead of seeing a retryable 403 grid. */
async function Gated() {
  await requirePagePermission(["settings.billing_report.view", "settings.billing.view"], "/billing/reports");
  return <BillingReportsPage />;
}

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Gated />
    </Suspense>
  );
}
