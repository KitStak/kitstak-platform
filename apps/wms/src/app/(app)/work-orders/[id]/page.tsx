import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { WorkOrderDetailPage } from "@/components/work-orders/work-order-detail-page";

export const metadata: Metadata = { title: "Work Order Details" };

async function Detail({ params }: { readonly params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WorkOrderDetailPage id={decodeURIComponent(id)} />;
}

/** Work order detail: `id` is the work order id or its code. */
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Detail params={params} />
    </Suspense>
  );
}
