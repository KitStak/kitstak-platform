import type { Metadata } from "next";
import { Suspense } from "react";
import { CountDetailPage } from "@/components/counts/count-detail-page";
import { PageSkeleton } from "@/components/layout/shell-skeleton";

export const metadata: Metadata = { title: "Count details" };

async function Detail({ params }: { readonly params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CountDetailPage id={decodeURIComponent(id)} />;
}

/** Count detail: `id` is the plan id or its code (grid links use the code). */
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Detail params={params} />
    </Suspense>
  );
}
