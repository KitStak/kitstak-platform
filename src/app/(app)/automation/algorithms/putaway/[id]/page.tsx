import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { AlgorithmEditor } from "@/components/automation/algorithms/algorithm-editor";

export const metadata: Metadata = { title: "Edit Putaway Algorithm" };

async function Content({ params }: { readonly params: Promise<{ id: string }> }) {
  const p = await params;
  return <AlgorithmEditor slug="putaway" id={p.id} />;
}

export default function Page({ params }: { readonly params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={params} />
    </Suspense>
  );
}
