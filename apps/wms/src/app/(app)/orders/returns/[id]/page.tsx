import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { RmaDetailPage } from "@/components/returns/rma-detail-page";

export const metadata: Metadata = { title: "Return order" };

async function Detail({ params }: { readonly params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RmaDetailPage id={decodeURIComponent(id)} />;
}

/** RMA detail (M04 §8). */
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Detail params={params} />
    </Suspense>
  );
}
