import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { ClientDetailPage } from "@/components/clients/client-detail-page";

export const metadata: Metadata = { title: "Client details" };

async function Detail({ params }: { readonly params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ClientDetailPage id={id} />;
}

export default function Page({ params }: { readonly params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Detail params={params} />
    </Suspense>
  );
}
