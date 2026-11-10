import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { BillingReportDetailPage } from "@/components/billing/billing-report-detail-page";

export const metadata: Metadata = { title: "Billing report details" };

async function Detail({ params }: { readonly params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BillingReportDetailPage id={id} />;
}

export default function Page({ params }: { readonly params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Detail params={params} />
    </Suspense>
  );
}
