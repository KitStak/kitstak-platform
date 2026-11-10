import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { LocationDetailPage } from "@/components/locations/location-detail-page";

export const metadata: Metadata = { title: "Location details" };

async function Detail({ params }: { readonly params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LocationDetailPage id={id} />;
}

export default function Page({ params }: { readonly params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Detail params={params} />
    </Suspense>
  );
}
