import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { PlanDetailPage } from "@/components/shipment-plans/plan-detail-page";

export const metadata: Metadata = { title: "Shipment plan" };

async function Detail({ params }: { readonly params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PlanDetailPage id={decodeURIComponent(id)} />;
}

/** Shipment plan detail: header, orders with live statuses, loading progress and timeline. */
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Detail params={params} />
    </Suspense>
  );
}
