import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { PackScreen } from "@/components/packing/pack-screen";
import { isPackMode } from "@/components/packing/pack-types";

export const metadata: Metadata = { title: "Pack orders" };

async function Screen({ params }: { readonly params: Promise<{ stationId: string; mode: string }> }) {
  const { stationId, mode } = await params;
  if (!isPackMode(mode)) notFound();
  return <PackScreen key={`${stationId}-${mode}`} stationId={decodeURIComponent(stationId)} mode={mode} />;
}

/** Pack screen (M04 §2): `mode` = tote | location | order | putwall. */
export default function Page({ params }: { params: Promise<{ stationId: string; mode: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Screen params={params} />
    </Suspense>
  );
}
